-- Migration: 20261118124000_stage2_1_1_transfer_lifecycle_and_multi_receipt
-- Stage 2.1.1: Credit Transfer Lifecycle and Provenance Integrity Corrections
-- Introduces CreditTransferRequest, CreditTransferApprovalEvent, CreditTransferSourceAllocation,
-- updates CreditTransferJournal (nullable sourceReceiptId, requestId FK),
-- and hardens multi-receipt FIFO double-entry balancing and lifecycle validation.

-- CreateEnum
CREATE TYPE "CreditTransferRequestStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED', 'CANCELLED');

-- CreateTable: CreditTransferRequest
CREATE TABLE "CreditTransferRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "sourceStudentId" TEXT NOT NULL,
    "targetStudentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CreditTransferRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "authorizedGuardianId" TEXT,
    "guardianConsentRef" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditTransferRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CreditTransferApprovalEvent
CREATE TABLE "CreditTransferApprovalEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransferApprovalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CreditTransferSourceAllocation
CREATE TABLE "CreditTransferSourceAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "sourceReceiptId" TEXT NOT NULL,
    "sourceStudentId" TEXT NOT NULL,
    "targetStudentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransferSourceAllocation_pkey" PRIMARY KEY ("id")
);

-- AlterTable: CreditTransferJournal
ALTER TABLE "CreditTransferJournal" ADD COLUMN "requestId" TEXT;
ALTER TABLE "CreditTransferJournal" ALTER COLUMN "sourceReceiptId" DROP NOT NULL;

-- AlterTable: CreditTransferPosting
ALTER TABLE "CreditTransferPosting" ADD COLUMN "sourceAllocationId" TEXT;

-- CreateIndex: CreditTransferRequest
CREATE UNIQUE INDEX "CreditTransferRequest_tenantId_id_key" ON "CreditTransferRequest"("tenantId", "id");
CREATE UNIQUE INDEX "CreditTransferRequest_tenantId_requestNumber_key" ON "CreditTransferRequest"("tenantId", "requestNumber");
CREATE UNIQUE INDEX "CreditTransferRequest_tenantId_journalId_key" ON "CreditTransferRequest"("tenantId", "journalId");
CREATE INDEX "CreditTransferRequest_tenantId_sourceStudentId_idx" ON "CreditTransferRequest"("tenantId", "sourceStudentId");
CREATE INDEX "CreditTransferRequest_tenantId_targetStudentId_idx" ON "CreditTransferRequest"("tenantId", "targetStudentId");
CREATE INDEX "CreditTransferRequest_tenantId_status_idx" ON "CreditTransferRequest"("tenantId", "status");
CREATE INDEX "CreditTransferRequest_tenantId_createdAt_idx" ON "CreditTransferRequest"("tenantId", "createdAt");

-- CreateIndex: CreditTransferApprovalEvent
CREATE UNIQUE INDEX "CreditTransferApprovalEvent_tenantId_id_key" ON "CreditTransferApprovalEvent"("tenantId", "id");
CREATE INDEX "CreditTransferApprovalEvent_tenantId_requestId_idx" ON "CreditTransferApprovalEvent"("tenantId", "requestId");
CREATE INDEX "CreditTransferApprovalEvent_tenantId_createdAt_idx" ON "CreditTransferApprovalEvent"("tenantId", "createdAt");

-- CreateIndex: CreditTransferJournal requestId unique
CREATE UNIQUE INDEX "CreditTransferJournal_tenantId_requestId_key" ON "CreditTransferJournal"("tenantId", "requestId");

-- CreateIndex: CreditTransferSourceAllocation
CREATE UNIQUE INDEX "CreditTransferSourceAllocation_tenantId_id_key" ON "CreditTransferSourceAllocation"("tenantId", "id");
CREATE UNIQUE INDEX "CreditTransferSourceAllocation_tenantId_journalId_sourceReceiptId_key" ON "CreditTransferSourceAllocation"("tenantId", "journalId", "sourceReceiptId");
CREATE INDEX "CreditTransferSourceAllocation_tenantId_journalId_idx" ON "CreditTransferSourceAllocation"("tenantId", "journalId");
CREATE INDEX "CreditTransferSourceAllocation_tenantId_sourceReceiptId_idx" ON "CreditTransferSourceAllocation"("tenantId", "sourceReceiptId");
CREATE INDEX "CreditTransferSourceAllocation_tenantId_sourceStudentId_idx" ON "CreditTransferSourceAllocation"("tenantId", "sourceStudentId");
CREATE INDEX "CreditTransferSourceAllocation_tenantId_targetStudentId_idx" ON "CreditTransferSourceAllocation"("tenantId", "targetStudentId");

-- CreateIndex: CreditTransferPosting sourceAllocationId
CREATE INDEX "CreditTransferPosting_tenantId_sourceAllocationId_idx" ON "CreditTransferPosting"("tenantId", "sourceAllocationId");

-- AddForeignKey: CreditTransferRequest
ALTER TABLE "CreditTransferRequest" ADD CONSTRAINT "CreditTransferRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferRequest" ADD CONSTRAINT "CreditTransferRequest_tenantId_sourceStudentId_fkey" FOREIGN KEY ("tenantId", "sourceStudentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferRequest" ADD CONSTRAINT "CreditTransferRequest_tenantId_targetStudentId_fkey" FOREIGN KEY ("tenantId", "targetStudentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferRequest" ADD CONSTRAINT "CreditTransferRequest_tenantId_journalId_fkey" FOREIGN KEY ("tenantId", "journalId") REFERENCES "CreditTransferJournal"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: CreditTransferApprovalEvent
ALTER TABLE "CreditTransferApprovalEvent" ADD CONSTRAINT "CreditTransferApprovalEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferApprovalEvent" ADD CONSTRAINT "CreditTransferApprovalEvent_tenantId_requestId_fkey" FOREIGN KEY ("tenantId", "requestId") REFERENCES "CreditTransferRequest"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: CreditTransferSourceAllocation
ALTER TABLE "CreditTransferSourceAllocation" ADD CONSTRAINT "CreditTransferSourceAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferSourceAllocation" ADD CONSTRAINT "CreditTransferSourceAllocation_tenantId_journalId_fkey" FOREIGN KEY ("tenantId", "journalId") REFERENCES "CreditTransferJournal"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferSourceAllocation" ADD CONSTRAINT "CreditTransferSourceAllocation_tenantId_sourceReceiptId_fkey" FOREIGN KEY ("tenantId", "sourceReceiptId") REFERENCES "PaymentReceipt"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferSourceAllocation" ADD CONSTRAINT "CreditTransferSourceAllocation_tenantId_sourceStudentId_fkey" FOREIGN KEY ("tenantId", "sourceStudentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferSourceAllocation" ADD CONSTRAINT "CreditTransferSourceAllocation_tenantId_targetStudentId_fkey" FOREIGN KEY ("tenantId", "targetStudentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: CreditTransferPosting sourceAllocationId
ALTER TABLE "CreditTransferPosting" ADD CONSTRAINT "CreditTransferPosting_tenantId_sourceAllocationId_fkey" FOREIGN KEY ("tenantId", "sourceAllocationId") REFERENCES "CreditTransferSourceAllocation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK Constraints
ALTER TABLE "CreditTransferRequest" ADD CONSTRAINT chk_request_amount_positive CHECK (amount > 0);
ALTER TABLE "CreditTransferRequest" ADD CONSTRAINT chk_request_distinct_students CHECK ("sourceStudentId" <> "targetStudentId");

ALTER TABLE "CreditTransferSourceAllocation" ADD CONSTRAINT chk_source_alloc_amount_positive CHECK (amount > 0);
ALTER TABLE "CreditTransferSourceAllocation" ADD CONSTRAINT chk_source_alloc_distinct_students CHECK ("sourceStudentId" <> "targetStudentId");

-- ----------------------------------------------------------------------------
-- Immutability Protection: CreditTransferApprovalEvent
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_protect_approval_event_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CreditTransferApprovalEvent records are immutable audit events and cannot be updated, deleted, or truncated (id: %, requestId: %)',
    OLD.id, OLD."requestId"
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approval_event_protect ON "CreditTransferApprovalEvent";
CREATE TRIGGER trg_approval_event_protect
BEFORE UPDATE OR DELETE ON "CreditTransferApprovalEvent"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_approval_event_immutability();

DROP TRIGGER IF EXISTS trg_approval_event_truncate ON "CreditTransferApprovalEvent";
CREATE TRIGGER trg_approval_event_truncate
BEFORE TRUNCATE ON "CreditTransferApprovalEvent"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_protect_approval_event_immutability();

-- ----------------------------------------------------------------------------
-- Immutability Protection: CreditTransferSourceAllocation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_protect_source_allocation_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CreditTransferSourceAllocation records are immutable financial provenance allocations and cannot be updated, deleted, or truncated (id: %, journalId: %)',
    OLD.id, OLD."journalId"
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_source_allocation_protect ON "CreditTransferSourceAllocation";
CREATE TRIGGER trg_source_allocation_protect
BEFORE UPDATE OR DELETE ON "CreditTransferSourceAllocation"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_source_allocation_immutability();

DROP TRIGGER IF EXISTS trg_source_allocation_truncate ON "CreditTransferSourceAllocation";
CREATE TRIGGER trg_source_allocation_truncate
BEFORE TRUNCATE ON "CreditTransferSourceAllocation"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_protect_source_allocation_immutability();

-- ----------------------------------------------------------------------------
-- Workflow Lifecycle State Guard: CreditTransferRequest
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enforce_transfer_request_lifecycle()
RETURNS TRIGGER AS $$
BEGIN
  -- Immutable identity and immutable core request parameters
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR
     NEW."sourceStudentId" IS DISTINCT FROM OLD."sourceStudentId" OR
     NEW."targetStudentId" IS DISTINCT FROM OLD."targetStudentId" OR
     NEW."amount" IS DISTINCT FROM OLD."amount" OR
     NEW."requestNumber" IS DISTINCT FROM OLD."requestNumber" THEN
    RAISE EXCEPTION 'Core request parameters (tenantId, sourceStudentId, targetStudentId, amount, requestNumber) of CreditTransferRequest % are immutable', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- Terminal state immutability
  IF OLD."status" IN ('REJECTED', 'CANCELLED', 'EXECUTED') THEN
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
      RAISE EXCEPTION 'CreditTransferRequest % is in terminal state % and cannot transition to %',
        OLD.id, OLD."status", NEW."status"
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Valid state transitions
  IF OLD."status" = 'PENDING_APPROVAL' THEN
    IF NEW."status" NOT IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid status transition for CreditTransferRequest % from PENDING_APPROVAL to %',
        OLD.id, NEW."status"
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF OLD."status" = 'APPROVED' THEN
    IF NEW."status" NOT IN ('APPROVED', 'EXECUTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid status transition for CreditTransferRequest % from APPROVED to %',
        OLD.id, NEW."status"
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transfer_request_lifecycle_guard ON "CreditTransferRequest";
CREATE TRIGGER trg_transfer_request_lifecycle_guard
BEFORE UPDATE ON "CreditTransferRequest"
FOR EACH ROW
EXECUTE FUNCTION fn_enforce_transfer_request_lifecycle();

-- ----------------------------------------------------------------------------
-- Multi-Receipt & Double-Entry Balance Verification Trigger (DEFERRED)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enforce_credit_transfer_balanced()
RETURNS TRIGGER AS $$
DECLARE
  v_journal_id TEXT;
  v_journal_status "CreditTransferStatus";
  v_journal_amount INT;
  v_debit_sum INT;
  v_credit_sum INT;
  v_debit_count INT;
  v_credit_count INT;
  v_source_alloc_count INT;
  v_source_alloc_sum INT;
  v_bad_line_count INT;
BEGIN
  IF TG_TABLE_NAME = 'CreditTransferPosting' THEN
    v_journal_id := NEW."journalId";
  ELSIF TG_TABLE_NAME = 'CreditTransferSourceAllocation' THEN
    v_journal_id := NEW."journalId";
  ELSE
    v_journal_id := NEW.id;
  END IF;

  SELECT "status", "amount"
  INTO v_journal_status, v_journal_amount
  FROM "CreditTransferJournal"
  WHERE id = v_journal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: CreditTransferJournal % not found', v_journal_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_journal_status = 'COMPLETED' THEN
    -- 1. Check double-entry equality across all postings
    SELECT 
      COALESCE(SUM(CASE WHEN "entryType" = 'DEBIT' THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN "entryType" = 'CREDIT' THEN amount ELSE 0 END), 0),
      COUNT(CASE WHEN "entryType" = 'DEBIT' THEN 1 END),
      COUNT(CASE WHEN "entryType" = 'CREDIT' THEN 1 END)
    INTO v_debit_sum, v_credit_sum, v_debit_count, v_credit_count
    FROM "CreditTransferPosting"
    WHERE "journalId" = v_journal_id;

    IF v_debit_sum <> v_journal_amount OR v_credit_sum <> v_journal_amount OR v_debit_sum <> v_credit_sum THEN
      RAISE EXCEPTION 'Double-entry balance violation: CreditTransferJournal % requires balanced postings (amount %, total debits %, total credits %)',
        v_journal_id, v_journal_amount, v_debit_sum, v_credit_sum
        USING ERRCODE = 'P0001';
    END IF;

    IF v_debit_count < 1 OR v_credit_count < 1 THEN
      RAISE EXCEPTION 'Double-entry balance violation: CreditTransferJournal % requires both DEBIT and CREDIT postings',
        v_journal_id
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. If multi-receipt CreditTransferSourceAllocation records exist, verify line breakdown
    SELECT 
      COUNT(*),
      COALESCE(SUM(amount), 0)
    INTO v_source_alloc_count, v_source_alloc_sum
    FROM "CreditTransferSourceAllocation"
    WHERE "journalId" = v_journal_id;

    IF v_source_alloc_count > 0 THEN
      IF v_source_alloc_sum <> v_journal_amount THEN
        RAISE EXCEPTION 'Multi-receipt allocation sum violation: CreditTransferJournal % total amount (%) does not match sum of source allocations (%)',
          v_journal_id, v_journal_amount, v_source_alloc_sum
          USING ERRCODE = 'P0001';
      END IF;

      -- Check that each source allocation has matching DEBIT and CREDIT postings for that exact receipt
      SELECT COUNT(*)
      INTO v_bad_line_count
      FROM "CreditTransferSourceAllocation" sa
      WHERE sa."journalId" = v_journal_id
        AND (
          sa.amount <> (
            SELECT COALESCE(SUM(p.amount), 0)
            FROM "CreditTransferPosting" p
            WHERE p."journalId" = v_journal_id
              AND p."receiptId" = sa."sourceReceiptId"
              AND p."entryType" = 'DEBIT'
          )
          OR
          sa.amount <> (
            SELECT COALESCE(SUM(p.amount), 0)
            FROM "CreditTransferPosting" p
            WHERE p."journalId" = v_journal_id
              AND p."receiptId" = sa."sourceReceiptId"
              AND p."entryType" = 'CREDIT'
          )
        );

      IF v_bad_line_count > 0 THEN
        RAISE EXCEPTION 'Multi-receipt posting mismatch: CreditTransferJournal % has % source allocation(s) without matching balanced postings for their respective receipts',
          v_journal_id, v_bad_line_count
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_journal_balanced ON "CreditTransferJournal";
CREATE CONSTRAINT TRIGGER trg_credit_journal_balanced
AFTER INSERT OR UPDATE OF "status", "amount" ON "CreditTransferJournal"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_enforce_credit_transfer_balanced();

DROP TRIGGER IF EXISTS trg_transfer_posting_balanced ON "CreditTransferPosting";
CREATE CONSTRAINT TRIGGER trg_transfer_posting_balanced
AFTER INSERT OR UPDATE ON "CreditTransferPosting"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_enforce_credit_transfer_balanced();

DROP TRIGGER IF EXISTS trg_source_allocation_balanced ON "CreditTransferSourceAllocation";
CREATE CONSTRAINT TRIGGER trg_source_allocation_balanced
AFTER INSERT OR UPDATE ON "CreditTransferSourceAllocation"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_enforce_credit_transfer_balanced();

-- ----------------------------------------------------------------------------
-- Update fn_enforce_transfer_posting_provenance() for multi-receipt allocations
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enforce_transfer_posting_provenance()
RETURNS TRIGGER AS $$
DECLARE
  v_journal "CreditTransferJournal"%ROWTYPE;
  v_alloc "CreditTransferSourceAllocation"%ROWTYPE;
  v_has_provenance BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_journal
  FROM "CreditTransferJournal"
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
    FROM "CreditTransferSourceAllocation"
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
    SELECT 1 FROM "CreditTransferSourceAllocation"
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transfer_posting_provenance ON "CreditTransferPosting";
CREATE TRIGGER trg_transfer_posting_provenance
BEFORE INSERT ON "CreditTransferPosting"
FOR EACH ROW
EXECUTE FUNCTION fn_enforce_transfer_posting_provenance();

-- ----------------------------------------------------------------------------
-- Update fn_enforce_allocation_same_student() supporting multi-receipt journals
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enforce_allocation_same_student()
RETURNS TRIGGER AS $$
DECLARE
  v_receipt_student_id TEXT;
  v_receipt_tenant_id TEXT;
  v_invoice_student_id TEXT;
  v_invoice_tenant_id TEXT;
  v_transfer "CreditTransferJournal"%ROWTYPE;
  v_has_receipt_provenance BOOLEAN := FALSE;
BEGIN
  -- 1. Fetch receipt student and tenant
  SELECT "tenantId", "studentId"
  INTO v_receipt_tenant_id, v_receipt_student_id
  FROM "PaymentReceipt"
  WHERE id = NEW."receiptId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: PaymentReceipt % not found', NEW."receiptId"
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Fetch invoice student and tenant
  SELECT "tenantId", "studentId"
  INTO v_invoice_tenant_id, v_invoice_student_id
  FROM "FeeInvoice"
  WHERE id = NEW."feeInvoiceId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: FeeInvoice % not found', NEW."feeInvoiceId"
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Strict Tenant Consistency Guard
  IF NEW."tenantId" IS DISTINCT FROM v_receipt_tenant_id OR NEW."tenantId" IS DISTINCT FROM v_invoice_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant allocation violation: PaymentAllocation (tenant %), PaymentReceipt (tenant %), and FeeInvoice (tenant %) must share the exact same tenantId',
      NEW."tenantId", v_receipt_tenant_id, v_invoice_tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. In all cases, PaymentAllocation beneficiary MUST match the FeeInvoice student
  IF NEW."studentId" IS DISTINCT FROM v_invoice_student_id THEN
    RAISE EXCEPTION 'Cross-student allocation violation: PaymentAllocation beneficiary student (%) does not match FeeInvoice billed student (%)',
      NEW."studentId", v_invoice_student_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Student Provenance Guard
  IF NEW."creditTransferId" IS NULL THEN
    -- Direct Allocation: Beneficiary must match original receipt student
    IF NEW."studentId" IS DISTINCT FROM v_receipt_student_id THEN
      RAISE EXCEPTION 'Cross-student allocation violation: PaymentAllocation beneficiary student (%) does not match PaymentReceipt source student (%) without an authorized credit transfer record',
        NEW."studentId", v_receipt_student_id
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Sibling Allocation via Transfer Provenance
    SELECT * INTO v_transfer
    FROM "CreditTransferJournal"
    WHERE id = NEW."creditTransferId" AND "tenantId" = NEW."tenantId";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid credit transfer provenance: CreditTransferJournal % not found for tenant %',
        NEW."creditTransferId", NEW."tenantId"
        USING ERRCODE = 'P0001';
    END IF;

    IF v_transfer."status" <> 'COMPLETED' THEN
      RAISE EXCEPTION 'Invalid credit transfer provenance: CreditTransferJournal % has status %, expected COMPLETED',
        NEW."creditTransferId", v_transfer."status"
        USING ERRCODE = 'P0001';
    END IF;

    IF v_transfer."targetStudentId" IS DISTINCT FROM NEW."studentId" THEN
      RAISE EXCEPTION 'Invalid credit transfer provenance: CreditTransferJournal % target student (%) does not match allocation studentId (%)',
        NEW."creditTransferId", v_transfer."targetStudentId", NEW."studentId"
        USING ERRCODE = 'P0001';
    END IF;

    -- Verify receipt provenance: check direct sourceReceiptId OR CreditTransferSourceAllocation line OR CreditTransferPosting
    IF v_transfer."sourceReceiptId" = NEW."receiptId" THEN
      v_has_receipt_provenance := TRUE;
    ELSIF EXISTS (
      SELECT 1 FROM "CreditTransferSourceAllocation"
      WHERE "journalId" = v_transfer.id
        AND "sourceReceiptId" = NEW."receiptId"
        AND "tenantId" = NEW."tenantId"
    ) THEN
      v_has_receipt_provenance := TRUE;
    ELSIF EXISTS (
      SELECT 1 FROM "CreditTransferPosting"
      WHERE "journalId" = v_transfer.id
        AND "receiptId" = NEW."receiptId"
        AND "studentId" = NEW."studentId"
        AND "entryType" = 'CREDIT'
        AND "tenantId" = NEW."tenantId"
    ) THEN
      v_has_receipt_provenance := TRUE;
    END IF;

    IF NOT v_has_receipt_provenance THEN
      RAISE EXCEPTION 'Invalid credit transfer provenance: CreditTransferJournal % has no provenance record for allocation receiptId (%)',
        NEW."creditTransferId", NEW."receiptId"
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
