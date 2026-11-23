-- Migration: 20261123120000_phase2_3_5_5_trigger_search_path_hardening
-- Purpose: Harden all 28 PL/pgSQL trigger functions against temporary-table shadowing
-- Defense-in-Depth:
--   1. Explicit schema qualification (public."Table") on all cross-table relation lookups.
--   2. Fixed function-level search_path = pg_catalog, public, pg_temp across all functions.
--   3. Database TEMPORARY privilege revocation from PUBLIC.

-- =============================================================================
-- PART 1: Hardened Definitions for 7 Cross-Table Query Functions
-- =============================================================================

-- 1. Allocation Reversal Invariant Assertion
CREATE OR REPLACE FUNCTION public.fn_assert_allocation_reversal_invariant()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
    v_allocation_amount INTEGER;
    v_total_reversed INTEGER;
    v_isolation TEXT;
BEGIN
    v_isolation := current_setting('transaction_isolation');
    IF v_isolation NOT IN ('read committed', 'read uncommitted') THEN
        RAISE EXCEPTION 'PaymentAllocationReversal invariant check requires READ COMMITTED isolation (current: %)',
            v_isolation
            USING ERRCODE = '0A000';
    END IF;

    SELECT amount INTO v_allocation_amount
    FROM public."PaymentAllocation"
    WHERE id = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId";

    SELECT COALESCE(SUM(amount), 0) INTO v_total_reversed
    FROM public."PaymentAllocationReversal"
    WHERE "originalAllocationId" = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId";

    IF v_total_reversed > v_allocation_amount THEN
        RAISE EXCEPTION 'Cumulative reversal amount (%) exceeds original allocation amount (%) for PaymentAllocation %',
            v_total_reversed, v_allocation_amount, NEW."originalAllocationId"
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

-- 2. Allocation Reversal Limit Enforcement
CREATE OR REPLACE FUNCTION public.fn_enforce_allocation_reversal_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
    v_allocation_amount INTEGER;
    v_current_reversal_sum INTEGER;
    v_isolation TEXT;
BEGIN
    v_isolation := current_setting('transaction_isolation');
    IF v_isolation NOT IN ('read committed', 'read uncommitted') THEN
        RAISE EXCEPTION 'PaymentAllocationReversal requires READ COMMITTED transaction isolation to prevent snapshot isolation write-skew anomalies (current: %). Use READ COMMITTED for financial reversals.',
            v_isolation
            USING ERRCODE = '0A000';
    END IF;

    IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
        RAISE EXCEPTION 'Reversal amount must be positive (received: %)', NEW.amount
            USING ERRCODE = '23514';
    END IF;

    SELECT amount 
    INTO v_allocation_amount
    FROM public."PaymentAllocation"
    WHERE id = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId"
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target PaymentAllocation (id: %, tenantId: %) does not exist',
            NEW."originalAllocationId", NEW."tenantId"
            USING ERRCODE = '23503';
    END IF;

    SELECT COALESCE(SUM(amount), 0)
    INTO v_current_reversal_sum
    FROM public."PaymentAllocationReversal"
    WHERE "originalAllocationId" = NEW."originalAllocationId"
      AND "tenantId" = NEW."tenantId";

    IF v_current_reversal_sum >= v_allocation_amount THEN
        RAISE EXCEPTION 'PaymentAllocation % is already fully reversed (cumulative reversals: %, allocation amount: %)',
            NEW."originalAllocationId", v_current_reversal_sum, v_allocation_amount
            USING ERRCODE = '23514';
    END IF;

    IF (v_current_reversal_sum + NEW.amount) > v_allocation_amount THEN
        RAISE EXCEPTION 'Cumulative reversal amount (% + % = %) exceeds original allocation amount (%) for PaymentAllocation %',
            v_current_reversal_sum, NEW.amount, (v_current_reversal_sum + NEW.amount), 
            v_allocation_amount, NEW."originalAllocationId"
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

-- 3. Allocation Same Student Enforcement
CREATE OR REPLACE FUNCTION public.fn_enforce_allocation_same_student()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_receipt_student_id TEXT;
  v_receipt_tenant_id TEXT;
  v_invoice_student_id TEXT;
  v_invoice_tenant_id TEXT;
  v_transfer public."CreditTransferJournal"%ROWTYPE;
  v_has_receipt_provenance BOOLEAN := FALSE;
BEGIN
  SELECT "tenantId", "studentId"
  INTO v_receipt_tenant_id, v_receipt_student_id
  FROM public."PaymentReceipt"
  WHERE id = NEW."receiptId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: PaymentReceipt % not found', NEW."receiptId"
      USING ERRCODE = 'P0001';
  END IF;

  SELECT "tenantId", "studentId"
  INTO v_invoice_tenant_id, v_invoice_student_id
  FROM public."FeeInvoice"
  WHERE id = NEW."feeInvoiceId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: FeeInvoice % not found', NEW."feeInvoiceId"
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."tenantId" IS DISTINCT FROM v_receipt_tenant_id OR NEW."tenantId" IS DISTINCT FROM v_invoice_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant violation: allocation tenant % does not match receipt tenant % or invoice tenant %',
      NEW."tenantId", v_receipt_tenant_id, v_invoice_tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_receipt_student_id = v_invoice_student_id THEN
    RETURN NEW;
  END IF;

  IF NEW."creditTransferJournalId" IS NULL THEN
    RAISE EXCEPTION 'Cross-student allocation forbidden without credit transfer journal: receipt student % != invoice student %',
      v_receipt_student_id, v_invoice_student_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_transfer
  FROM public."CreditTransferJournal"
  WHERE id = NEW."creditTransferJournalId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: CreditTransferJournal % not found for allocation %',
      NEW."creditTransferJournalId", NEW.id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_transfer."tenantId" IS DISTINCT FROM NEW."tenantId" THEN
    RAISE EXCEPTION 'Cross-tenant credit transfer violation: transfer tenant % != allocation tenant %',
      v_transfer."tenantId", NEW."tenantId"
      USING ERRCODE = 'P0001';
  END IF;

  IF v_transfer."sourceStudentId" IS DISTINCT FROM v_receipt_student_id THEN
    RAISE EXCEPTION 'Credit transfer source mismatch: transfer sourceStudentId % != receipt studentId %',
      v_transfer."sourceStudentId", v_receipt_student_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_transfer."targetStudentId" IS DISTINCT FROM v_invoice_student_id THEN
    RAISE EXCEPTION 'Credit transfer target mismatch: transfer targetStudentId % != invoice studentId %',
      v_transfer."targetStudentId", v_invoice_student_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_transfer."sourceReceiptId" IS NOT NULL AND v_transfer."sourceReceiptId" = NEW."receiptId" THEN
    v_has_receipt_provenance := TRUE;
  ELSIF EXISTS (
    SELECT 1 FROM public."CreditTransferSourceAllocation"
    WHERE "journalId" = v_transfer.id AND "sourceReceiptId" = NEW."receiptId"
  ) THEN
    v_has_receipt_provenance := TRUE;
  END IF;

  IF NOT v_has_receipt_provenance THEN
    RAISE EXCEPTION 'Credit transfer receipt mismatch: receipt % is not linked to transfer journal %',
      NEW."receiptId", v_transfer.id
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."CreditTransferPosting"
    WHERE "journalId" = v_transfer.id
      AND "entryType" = 'DEBIT'
      AND "studentId" = v_receipt_student_id
      AND "counterpartyStudentId" = v_invoice_student_id
  ) THEN
    RAISE EXCEPTION 'Missing debit posting on credit transfer journal % for student %',
      v_transfer.id, v_receipt_student_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public."CreditTransferPosting"
    WHERE "journalId" = v_transfer.id
      AND "entryType" = 'CREDIT'
      AND "studentId" = v_invoice_student_id
      AND "counterpartyStudentId" = v_receipt_student_id
  ) THEN
    RAISE EXCEPTION 'Missing credit posting on credit transfer journal % for student %',
      v_transfer.id, v_invoice_student_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. Credit Transfer Balancing Enforcement
CREATE OR REPLACE FUNCTION public.fn_enforce_credit_transfer_balanced()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_journal_id TEXT;
  v_journal_amount INTEGER;
  v_total_debits BIGINT;
  v_total_credits BIGINT;
  v_source_alloc_sum BIGINT;
  v_has_source_allocs BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'CreditTransferJournal' THEN
    v_journal_id := NEW.id;
  ELSE
    v_journal_id := NEW."journalId";
  END IF;

  SELECT amount
  INTO v_journal_amount
  FROM public."CreditTransferJournal"
  WHERE id = v_journal_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN "entryType" = 'DEBIT' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN "entryType" = 'CREDIT' THEN amount ELSE 0 END), 0)
  INTO v_total_debits, v_total_credits
  FROM public."CreditTransferPosting"
  WHERE "journalId" = v_journal_id;

  IF v_total_debits <> v_total_credits THEN
    RAISE EXCEPTION 'Credit transfer imbalance on journal %: total debits (% paise) <> total credits (% paise)',
      v_journal_id, v_total_debits, v_total_credits
      USING ERRCODE = 'P0001';
  END IF;

  IF v_total_debits <> v_journal_amount::BIGINT THEN
    RAISE EXCEPTION 'Credit transfer posting total mismatch on journal %: postings sum (% paise) <> journal amount (% paise)',
      v_journal_id, v_total_debits, v_journal_amount
      USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public."CreditTransferSourceAllocation" WHERE "journalId" = v_journal_id
  ) INTO v_has_source_allocs;

  IF v_has_source_allocs THEN
    SELECT COALESCE(SUM(amount), 0)
    INTO v_source_alloc_sum
    FROM public."CreditTransferSourceAllocation"
    WHERE "journalId" = v_journal_id;

    IF v_source_alloc_sum <> v_journal_amount::BIGINT THEN
      RAISE EXCEPTION 'Credit transfer source allocation mismatch on journal %: source lines sum (% paise) <> journal amount (% paise)',
        v_journal_id, v_source_alloc_sum, v_journal_amount
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NULL;
END;
$function$;

-- 5. Receipt Balance Conservation Enforcement
CREATE OR REPLACE FUNCTION public.fn_enforce_receipt_balance_conservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_receipt_id TEXT;
  v_receipt_amount INTEGER;
  v_tenant_id TEXT;
  v_allocated INTEGER;
  v_transferred_out INTEGER;
  v_unapplied INTEGER;
  v_reserved INTEGER;
  v_refunded INTEGER;
  v_total_components BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'PaymentReceipt' THEN
    v_receipt_id := NEW.id;
  ELSE
    v_receipt_id := NEW."receiptId";
  END IF;

  SELECT amount, "tenantId"
  INTO v_receipt_amount, v_tenant_id
  FROM public."PaymentReceipt"
  WHERE id = v_receipt_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT "allocatedAmount", "transferredOutAmount", "unappliedAmount", "reservedRefundAmount", "refundedAmount"
  INTO v_allocated, v_transferred_out, v_unapplied, v_reserved, v_refunded
  FROM public."PaymentReceiptBalance"
  WHERE "receiptId" = v_receipt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Missing PaymentReceiptBalance for receipt %', v_receipt_id
      USING ERRCODE = 'P0001';
  END IF;

  v_total_components := (v_allocated::BIGINT + v_transferred_out::BIGINT + v_unapplied::BIGINT + v_reserved::BIGINT + v_refunded::BIGINT);
  IF v_receipt_amount::BIGINT <> v_total_components THEN
    RAISE EXCEPTION 'Conservation violation on PaymentReceipt %: gross amount (% paise) does not equal sum of components (% paise: allocated=%, transferredOut=%, unapplied=%, reserved=%, refunded=%)',
      v_receipt_id, v_receipt_amount, v_total_components, v_allocated, v_transferred_out, v_unapplied, v_reserved, v_refunded
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NULL;
END;
$function$;

-- 6. Transfer Posting Provenance Enforcement
CREATE OR REPLACE FUNCTION public.fn_enforce_transfer_posting_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_journal public."CreditTransferJournal"%ROWTYPE;
  v_alloc public."CreditTransferSourceAllocation"%ROWTYPE;
  v_has_provenance BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_journal
  FROM public."CreditTransferJournal"
  WHERE id = NEW."journalId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: CreditTransferJournal % not found for posting %', NEW."journalId", NEW.id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."tenantId" IS DISTINCT FROM v_journal."tenantId" THEN
    RAISE EXCEPTION 'Cross-tenant violation: CreditTransferPosting tenantId % does not match CreditTransferJournal tenantId %',
      NEW."tenantId", v_journal."tenantId"
      USING ERRCODE = 'P0001';
  END IF;

  -- Verify Receipt Provenance across single-receipt or multi-receipt source allocations
  IF v_journal."sourceReceiptId" IS NOT NULL AND NEW."receiptId" = v_journal."sourceReceiptId" THEN
    v_has_provenance := TRUE;
  ELSIF NEW."sourceAllocationId" IS NOT NULL THEN
    SELECT * INTO v_alloc
    FROM public."CreditTransferSourceAllocation"
    WHERE id = NEW."sourceAllocationId";

    IF FOUND THEN
      IF v_alloc."sourceReceiptId" = NEW."receiptId" AND v_alloc."journalId" = NEW."journalId" THEN
        v_has_provenance := TRUE;
      ELSE
        RAISE EXCEPTION 'Provenance violation: CreditTransferPosting receiptId % or journalId % does not match sourceAllocation (receipt %, journal %)',
          NEW."receiptId", NEW."journalId", v_alloc."sourceReceiptId", v_alloc."journalId"
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM public."CreditTransferSourceAllocation"
    WHERE "journalId" = v_journal.id AND "sourceReceiptId" = NEW."receiptId"
  ) THEN
    v_has_provenance := TRUE;
  END IF;

  IF NOT v_has_provenance THEN
    RAISE EXCEPTION 'Provenance violation: CreditTransferPosting receiptId % does not match CreditTransferJournal source receipt or any source allocation line',
      NEW."receiptId"
      USING ERRCODE = 'P0001';
  END IF;

  -- Verify student roles match journal
  IF NEW."entryType" = 'DEBIT' THEN
    IF NEW."studentId" IS DISTINCT FROM v_journal."sourceStudentId" THEN
      RAISE EXCEPTION 'Debit posting studentId % does not match journal sourceStudentId %',
        NEW."studentId", v_journal."sourceStudentId"
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW."counterpartyStudentId" IS DISTINCT FROM v_journal."targetStudentId" THEN
      RAISE EXCEPTION 'Debit posting counterpartyStudentId % does not match journal targetStudentId %',
        NEW."counterpartyStudentId", v_journal."targetStudentId"
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW."entryType" = 'CREDIT' THEN
    IF NEW."studentId" IS DISTINCT FROM v_journal."targetStudentId" THEN
      RAISE EXCEPTION 'Credit posting studentId % does not match journal targetStudentId %',
        NEW."studentId", v_journal."targetStudentId"
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW."counterpartyStudentId" IS DISTINCT FROM v_journal."sourceStudentId" THEN
      RAISE EXCEPTION 'Credit posting counterpartyStudentId % does not match journal sourceStudentId %',
        NEW."counterpartyStudentId", v_journal."sourceStudentId"
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 7. Invoice Student Reassignment Guard
CREATE OR REPLACE FUNCTION public.fn_protect_invoice_student_reassignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF NEW."studentId" IS DISTINCT FROM OLD."studentId" THEN
    IF EXISTS (
      SELECT 1 FROM public."PaymentAllocation"
      WHERE "feeInvoiceId" = OLD.id
    ) THEN
      RAISE EXCEPTION 'Cannot reassign FeeInvoice.studentId (from % to %) because active PaymentAllocation records exist on invoice %',
        OLD."studentId", NEW."studentId", OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- =============================================================================
-- PART 2: Search Path Hardening on Remaining 21 Trigger Functions
-- =============================================================================

ALTER FUNCTION public.fn_enforce_branch_payout_lifecycle() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_enforce_transfer_request_lifecycle() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_approval_event_immutability() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_branch_ledger_immutability() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_credit_account_deletion() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_credit_account_identity() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_credit_transfer_immutability() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_exam_revision_event_immutability() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_exam_revision_truncate() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_exam_snapshot_immutability() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_exam_snapshot_truncate() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_guardian_consent_event_immutability() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_payment_allocation_immutability() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_payment_receipt_immutability() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_payment_reversal_immutability() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_receipt_balance_identity() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_receipt_balance_immutability() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_source_allocation_immutability() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.fn_protect_transfer_posting_immutability() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.prevent_batch_event_tampering() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.trg_syllabustrack_event_immutability() SET search_path = pg_catalog, public, pg_temp;

-- =============================================================================
-- PART 3: Revoke TEMPORARY Privilege from PUBLIC on Database
-- =============================================================================

DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC;', current_database());
END $$;
