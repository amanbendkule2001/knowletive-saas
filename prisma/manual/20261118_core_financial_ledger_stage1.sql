-- Stage 1, 1.1 & 1.2: Core Financial Ledger Database Models & Integrity Hardening
-- Manual Companion SQL Script (Idempotent for DBA manual execution / disaster recovery)
-- Models: PaymentReceipt, PaymentReceiptBalance, PaymentAllocation, PaymentAllocationReversal
-- Enums: PaymentReceiptStatus
-- Reference: docs/knowletive-functional-handbook/32-FINANCIAL-LEDGER-AND-PAYMENT-ALLOCATION-DESIGN.md (Revision 1.7)
--
-- NOTE ON CANONICAL MIGRATION PATH:
-- The canonical migration path for Knowletive is Prisma Migrate (stored in prisma/migrations/).
-- This script is a companion reference for DBAs and manual provisioning environments.
-- If applied manually outside Prisma CLI, execute:
--   npx prisma migrate resolve --applied 20261118104700_core_financial_ledger_stage1
--   npx prisma migrate resolve --applied 20261118110800_stage1_2_financial_ledger_integrity_hardening
-- to keep Prisma Migrate history synchronized.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentReceiptStatus') THEN
    CREATE TYPE "PaymentReceiptStatus" AS ENUM (
      'CAPTURED', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED', 
      'OVERPAID_UNALLOCATED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 
      'REFUNDED', 'DISPUTED', 'VOIDED'
    );
  END IF;
END $$;

-- 1. PaymentReceipt (Layer 1 Immutable Event)
CREATE TABLE IF NOT EXISTS "PaymentReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "merchantAccountKey" TEXT,
    "providerRef" TEXT,
    "idempotencyKey" TEXT,
    "payloadHash" TEXT,
    "payerName" TEXT,
    "payerPhone" TEXT,
    "payerEmail" TEXT,
    "payerRelationship" TEXT,
    "payerNotes" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

-- 2. PaymentReceiptBalance (Layer 3 Mutable Projection)
CREATE TABLE IF NOT EXISTS "PaymentReceiptBalance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "allocatedAmount" INTEGER NOT NULL DEFAULT 0,
    "transferredOutAmount" INTEGER NOT NULL DEFAULT 0,
    "unappliedAmount" INTEGER NOT NULL DEFAULT 0,
    "reservedRefundAmount" INTEGER NOT NULL DEFAULT 0,
    "refundedAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "PaymentReceiptStatus" NOT NULL DEFAULT 'CAPTURED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastRebalancedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReceiptBalance_pkey" PRIMARY KEY ("id")
);

-- 3. PaymentAllocation (Layer 1 Immutable Event)
CREATE TABLE IF NOT EXISTS "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "feeInvoiceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- 4. PaymentAllocationReversal (Layer 1 Immutable Event)
CREATE TABLE IF NOT EXISTS "PaymentAllocationReversal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "originalAllocationId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "destination" TEXT NOT NULL DEFAULT 'UNAPPLIED_CREDIT',
    "reversedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedById" TEXT,

    CONSTRAINT "PaymentAllocationReversal_pkey" PRIMARY KEY ("id")
);

-- Composite Unique Indexes for Cross-Tenant Integrity
CREATE UNIQUE INDEX IF NOT EXISTS "Student_tenantId_id_key" ON "Student"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "FeeInvoice_tenantId_id_key" ON "FeeInvoice"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentReceipt_tenantId_id_key" ON "PaymentReceipt"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentAllocation_tenantId_id_key" ON "PaymentAllocation"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentReceiptBalance_tenantId_receiptId_key" ON "PaymentReceiptBalance"("tenantId", "receiptId");

-- Standard & Partial Unique Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentReceipt_tenantId_receiptNumber_key" ON "PaymentReceipt"("tenantId", "receiptNumber");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_tenantId_studentId_idx" ON "PaymentReceipt"("tenantId", "studentId");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_tenantId_receivedAt_idx" ON "PaymentReceipt"("tenantId", "receivedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_receipt_provider_account_ref" ON "PaymentReceipt"("provider", "merchantAccountKey", "providerRef") WHERE "providerRef" IS NOT NULL AND "merchantAccountKey" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_receipt_cashier_idempotency" ON "PaymentReceipt"("tenantId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentReceiptBalance_receiptId_key" ON "PaymentReceiptBalance"("receiptId");
CREATE INDEX IF NOT EXISTS "PaymentReceiptBalance_tenantId_status_idx" ON "PaymentReceiptBalance"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "PaymentReceiptBalance_tenantId_unappliedAmount_idx" ON "PaymentReceiptBalance"("tenantId", "unappliedAmount");

CREATE INDEX IF NOT EXISTS "PaymentAllocation_tenantId_receiptId_idx" ON "PaymentAllocation"("tenantId", "receiptId");
CREATE INDEX IF NOT EXISTS "PaymentAllocation_tenantId_feeInvoiceId_idx" ON "PaymentAllocation"("tenantId", "feeInvoiceId");
CREATE INDEX IF NOT EXISTS "PaymentAllocation_tenantId_studentId_idx" ON "PaymentAllocation"("tenantId", "studentId");
CREATE INDEX IF NOT EXISTS "PaymentAllocation_feeInvoiceId_allocatedAt_idx" ON "PaymentAllocation"("feeInvoiceId", "allocatedAt");

CREATE INDEX IF NOT EXISTS "PaymentAllocationReversal_tenantId_originalAllocationId_idx" ON "PaymentAllocationReversal"("tenantId", "originalAllocationId");
CREATE INDEX IF NOT EXISTS "PaymentAllocationReversal_originalAllocationId_idx" ON "PaymentAllocationReversal"("originalAllocationId");

-- Composite Foreign Keys with ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentReceipt_tenantId_fkey') THEN
    ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentReceipt_tenantId_studentId_fkey') THEN
    ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_tenantId_studentId_fkey" 
      FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentReceiptBalance_tenantId_fkey') THEN
    ALTER TABLE "PaymentReceiptBalance" ADD CONSTRAINT "PaymentReceiptBalance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentReceiptBalance_tenantId_receiptId_fkey') THEN
    ALTER TABLE "PaymentReceiptBalance" ADD CONSTRAINT "PaymentReceiptBalance_tenantId_receiptId_fkey" 
      FOREIGN KEY ("tenantId", "receiptId") REFERENCES "PaymentReceipt"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentAllocation_tenantId_fkey') THEN
    ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentAllocation_tenantId_receiptId_fkey') THEN
    ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_receiptId_fkey" 
      FOREIGN KEY ("tenantId", "receiptId") REFERENCES "PaymentReceipt"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentAllocation_tenantId_studentId_fkey') THEN
    ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_studentId_fkey" 
      FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentAllocation_tenantId_feeInvoiceId_fkey') THEN
    ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_feeInvoiceId_fkey" 
      FOREIGN KEY ("tenantId", "feeInvoiceId") REFERENCES "FeeInvoice"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentAllocationReversal_tenantId_fkey') THEN
    ALTER TABLE "PaymentAllocationReversal" ADD CONSTRAINT "PaymentAllocationReversal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentAllocationReversal_tenantId_originalAllocationId_fkey') THEN
    ALTER TABLE "PaymentAllocationReversal" ADD CONSTRAINT "PaymentAllocationReversal_tenantId_originalAllocationId_fkey" 
      FOREIGN KEY ("tenantId", "originalAllocationId") REFERENCES "PaymentAllocation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Check Constraints
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_receipt_amount_positive') THEN
    ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "chk_receipt_amount_positive" CHECK ("amount" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_receipt_external_merchant_key') THEN
    ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "chk_receipt_external_merchant_key" 
      CHECK (("provider" IN ('cashier', 'manual') AND "providerRef" IS NULL) OR ("providerRef" IS NOT NULL AND "merchantAccountKey" IS NOT NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_receipt_balance_non_negative') THEN
    ALTER TABLE "PaymentReceiptBalance" ADD CONSTRAINT "chk_receipt_balance_non_negative" 
      CHECK ("allocatedAmount" >= 0 AND "transferredOutAmount" >= 0 AND "unappliedAmount" >= 0 AND "reservedRefundAmount" >= 0 AND "refundedAmount" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_receipt_balance_version') THEN
    ALTER TABLE "PaymentReceiptBalance" ADD CONSTRAINT "chk_receipt_balance_version" CHECK ("version" >= 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_allocation_amount_positive') THEN
    ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "chk_allocation_amount_positive" CHECK ("amount" > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_reversal_amount_positive') THEN
    ALTER TABLE "PaymentAllocationReversal" ADD CONSTRAINT "chk_reversal_amount_positive" CHECK ("amount" > 0);
  END IF;
END $$;

-- Deferred Constraint Triggers for Receipt Balance Conservation
CREATE OR REPLACE FUNCTION fn_enforce_receipt_balance_conservation()
RETURNS TRIGGER AS $$
DECLARE
  v_receipt_id TEXT;
  v_receipt_tenant_id TEXT;
  v_receipt_amount INTEGER;
  v_balance_tenant_id TEXT;
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

  SELECT "tenantId", "amount"
  INTO v_receipt_tenant_id, v_receipt_amount
  FROM "PaymentReceipt"
  WHERE id = v_receipt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: PaymentReceipt % not found during balance conservation check', v_receipt_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT "tenantId", "allocatedAmount", "transferredOutAmount", "unappliedAmount", "reservedRefundAmount", "refundedAmount"
  INTO v_balance_tenant_id, v_allocated, v_transferred_out, v_unapplied, v_reserved, v_refunded
  FROM "PaymentReceiptBalance"
  WHERE "receiptId" = v_receipt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: PaymentReceipt % exists without required PaymentReceiptBalance projection at commit', v_receipt_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_receipt_tenant_id IS DISTINCT FROM v_balance_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant violation: PaymentReceipt % (tenant %) and PaymentReceiptBalance (tenant %) belong to different tenants',
      v_receipt_id, v_receipt_tenant_id, v_balance_tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_allocated < 0 OR v_transferred_out < 0 OR v_unapplied < 0 OR v_reserved < 0 OR v_refunded < 0 THEN
    RAISE EXCEPTION 'Integrity violation: Negative balance component on PaymentReceipt %: allocated=%, transferredOut=%, unapplied=%, reserved=%, refunded=%',
      v_receipt_id, v_allocated, v_transferred_out, v_unapplied, v_reserved, v_refunded
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_receipt_balance_conservation ON "PaymentReceiptBalance";
CREATE CONSTRAINT TRIGGER trg_receipt_balance_conservation
AFTER INSERT OR UPDATE ON "PaymentReceiptBalance"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_enforce_receipt_balance_conservation();

DROP TRIGGER IF EXISTS trg_receipt_conservation ON "PaymentReceipt";
CREATE CONSTRAINT TRIGGER trg_receipt_conservation
AFTER INSERT OR UPDATE ON "PaymentReceipt"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_enforce_receipt_balance_conservation();

-- Immutability Protection Triggers for Layer 1 Ledger Tables
CREATE OR REPLACE FUNCTION fn_protect_payment_receipt_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PaymentReceipt records are immutable financial events and cannot be updated, deleted, or truncated (id: %, receiptNumber: %)', OLD.id, OLD."receiptNumber"
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_receipt_protect ON "PaymentReceipt";
CREATE TRIGGER trg_payment_receipt_protect
BEFORE UPDATE OR DELETE ON "PaymentReceipt"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_payment_receipt_immutability();

DROP TRIGGER IF EXISTS trg_payment_receipt_truncate ON "PaymentReceipt";
CREATE TRIGGER trg_payment_receipt_truncate
BEFORE TRUNCATE ON "PaymentReceipt"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_protect_payment_receipt_immutability();

CREATE OR REPLACE FUNCTION fn_protect_payment_allocation_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PaymentAllocation records are immutable financial events and cannot be updated, deleted, or truncated (id: %, feeInvoiceId: %)', OLD.id, OLD."feeInvoiceId"
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_allocation_protect ON "PaymentAllocation";
CREATE TRIGGER trg_payment_allocation_protect
BEFORE UPDATE OR DELETE ON "PaymentAllocation"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_payment_allocation_immutability();

DROP TRIGGER IF EXISTS trg_payment_allocation_truncate ON "PaymentAllocation";
CREATE TRIGGER trg_payment_allocation_truncate
BEFORE TRUNCATE ON "PaymentAllocation"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_protect_payment_allocation_immutability();

CREATE OR REPLACE FUNCTION fn_protect_payment_reversal_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'PaymentAllocationReversal records are immutable financial events and cannot be updated, deleted, or truncated (id: %, originalAllocationId: %)', OLD.id, OLD."originalAllocationId"
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payment_reversal_protect ON "PaymentAllocationReversal";
CREATE TRIGGER trg_payment_reversal_protect
BEFORE UPDATE OR DELETE ON "PaymentAllocationReversal"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_payment_reversal_immutability();

DROP TRIGGER IF EXISTS trg_payment_reversal_truncate ON "PaymentAllocationReversal";
CREATE TRIGGER trg_payment_reversal_truncate
BEFORE TRUNCATE ON "PaymentAllocationReversal"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_protect_payment_reversal_immutability();

-- PaymentReceiptBalance Deletion & Identity Lock
CREATE OR REPLACE FUNCTION fn_protect_receipt_balance_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PaymentReceiptBalance records cannot be directly deleted (receiptId: %, tenantId: %)', OLD."receiptId", OLD."tenantId"
      USING ERRCODE = 'P0001';
  ELSIF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'PaymentReceiptBalance cannot be truncated'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_receipt_balance_prevent_delete ON "PaymentReceiptBalance";
CREATE TRIGGER trg_receipt_balance_prevent_delete
BEFORE DELETE ON "PaymentReceiptBalance"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_receipt_balance_immutability();

DROP TRIGGER IF EXISTS trg_receipt_balance_prevent_truncate ON "PaymentReceiptBalance";
CREATE TRIGGER trg_receipt_balance_prevent_truncate
BEFORE TRUNCATE ON "PaymentReceiptBalance"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_protect_receipt_balance_immutability();

CREATE OR REPLACE FUNCTION fn_protect_receipt_balance_identity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."receiptId" IS DISTINCT FROM OLD."receiptId" THEN
    RAISE EXCEPTION 'Identity violation: PaymentReceiptBalance.receiptId cannot be modified after creation (old: %, new: %)', OLD."receiptId", NEW."receiptId"
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" THEN
    RAISE EXCEPTION 'Identity violation: PaymentReceiptBalance.tenantId cannot be modified after creation (old: %, new: %)', OLD."tenantId", NEW."tenantId"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_receipt_balance_identity_guard ON "PaymentReceiptBalance";
CREATE TRIGGER trg_receipt_balance_identity_guard
BEFORE UPDATE ON "PaymentReceiptBalance"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_receipt_balance_identity();

-- PaymentAllocation Same-Student Provenance Guard
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

CREATE OR REPLACE FUNCTION fn_enforce_allocation_same_student()
RETURNS TRIGGER AS $$
DECLARE
  v_receipt_student_id TEXT;
  v_receipt_tenant_id TEXT;
  v_invoice_student_id TEXT;
  v_invoice_tenant_id TEXT;
BEGIN
  SELECT "tenantId", "studentId"
  INTO v_receipt_tenant_id, v_receipt_student_id
  FROM "PaymentReceipt"
  WHERE id = NEW."receiptId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: PaymentReceipt % not found', NEW."receiptId"
      USING ERRCODE = 'P0001';
  END IF;

  SELECT "tenantId", "studentId"
  INTO v_invoice_tenant_id, v_invoice_student_id
  FROM "FeeInvoice"
  WHERE id = NEW."feeInvoiceId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: FeeInvoice % not found', NEW."feeInvoiceId"
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."tenantId" IS DISTINCT FROM v_receipt_tenant_id OR NEW."tenantId" IS DISTINCT FROM v_invoice_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant allocation violation: PaymentAllocation (tenant %), PaymentReceipt (tenant %), and FeeInvoice (tenant %) must share the exact same tenantId',
      NEW."tenantId", v_receipt_tenant_id, v_invoice_tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."studentId" IS DISTINCT FROM v_receipt_student_id THEN
    RAISE EXCEPTION 'Cross-student allocation violation: PaymentAllocation beneficiary student (%) does not match PaymentReceipt source student (%) without an authorized credit transfer record',
      NEW."studentId", v_receipt_student_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."studentId" IS DISTINCT FROM v_invoice_student_id THEN
    RAISE EXCEPTION 'Cross-student allocation violation: PaymentAllocation beneficiary student (%) does not match FeeInvoice billed student (%)',
      NEW."studentId", v_invoice_student_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_allocation_same_student_guard ON "PaymentAllocation";
CREATE TRIGGER trg_allocation_same_student_guard
BEFORE INSERT OR UPDATE ON "PaymentAllocation"
FOR EACH ROW
EXECUTE FUNCTION fn_enforce_allocation_same_student();

-- FeeInvoice Student Reassignment Protection
CREATE OR REPLACE FUNCTION fn_protect_invoice_student_reassignment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."studentId" IS DISTINCT FROM OLD."studentId" THEN
    IF EXISTS (
      SELECT 1 FROM "PaymentAllocation"
      WHERE "feeInvoiceId" = OLD.id
    ) THEN
      RAISE EXCEPTION 'Cannot reassign FeeInvoice.studentId (from % to %) because active PaymentAllocation records exist on invoice %',
        OLD."studentId", NEW."studentId", OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_student_reassignment_guard ON "FeeInvoice";
CREATE TRIGGER trg_invoice_student_reassignment_guard
BEFORE UPDATE OF "studentId" ON "FeeInvoice"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_invoice_student_reassignment();

-- Revoke destructive permissions from knowletive_app and PUBLIC
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'knowletive_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "PaymentReceipt", "PaymentAllocation", "PaymentAllocationReversal" FROM knowletive_app;
    REVOKE DELETE, TRUNCATE ON "PaymentReceiptBalance" FROM knowletive_app;
  END IF;
END $$;

REVOKE UPDATE, DELETE, TRUNCATE ON "PaymentReceipt" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON "PaymentAllocation" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON "PaymentAllocationReversal" FROM PUBLIC;
REVOKE DELETE, TRUNCATE ON "PaymentReceiptBalance" FROM PUBLIC;

-- Stage 1.4: Payment Allocation Reversal Cumulative Limit and Concurrency Hardening
CREATE OR REPLACE FUNCTION fn_enforce_allocation_reversal_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_allocation_amount INTEGER;
    v_current_reversal_sum INTEGER;
BEGIN
    IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
        RAISE EXCEPTION 'Reversal amount must be positive (received: %)', NEW.amount
            USING ERRCODE = '23514';
    END IF;

    SELECT amount 
    INTO v_allocation_amount
    FROM "PaymentAllocation"
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
    FROM "PaymentAllocationReversal"
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_allocation_reversal_limit ON "PaymentAllocationReversal";
CREATE TRIGGER trg_allocation_reversal_limit
BEFORE INSERT ON "PaymentAllocationReversal"
FOR EACH ROW
EXECUTE FUNCTION fn_enforce_allocation_reversal_limit();

CREATE OR REPLACE FUNCTION fn_assert_allocation_reversal_invariant()
RETURNS TRIGGER AS $$
DECLARE
    v_allocation_amount INTEGER;
    v_total_reversed INTEGER;
BEGIN
    SELECT amount INTO v_allocation_amount
    FROM "PaymentAllocation"
    WHERE id = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId";

    SELECT COALESCE(SUM(amount), 0) INTO v_total_reversed
    FROM "PaymentAllocationReversal"
    WHERE "originalAllocationId" = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId";

    IF v_total_reversed > v_allocation_amount THEN
        RAISE EXCEPTION 'Cumulative reversal amount (%) exceeds original allocation amount (%) for PaymentAllocation %',
            v_total_reversed, v_allocation_amount, NEW."originalAllocationId"
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_allocation_reversal_invariant ON "PaymentAllocationReversal";
CREATE CONSTRAINT TRIGGER trg_allocation_reversal_invariant
AFTER INSERT ON "PaymentAllocationReversal"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION fn_assert_allocation_reversal_invariant();

-- Stage 1.5: Financial Reversal Transaction Isolation Hardening
-- Enforces Option A: Restrict reversal writes to READ COMMITTED.
CREATE OR REPLACE FUNCTION fn_enforce_allocation_reversal_limit()
RETURNS TRIGGER AS $$
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
    FROM "PaymentAllocation"
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
    FROM "PaymentAllocationReversal"
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_assert_allocation_reversal_invariant()
RETURNS TRIGGER AS $$
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
    FROM "PaymentAllocation"
    WHERE id = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId";

    SELECT COALESCE(SUM(amount), 0) INTO v_total_reversed
    FROM "PaymentAllocationReversal"
    WHERE "originalAllocationId" = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId";

    IF v_total_reversed > v_allocation_amount THEN
        RAISE EXCEPTION 'Cumulative reversal amount (%) exceeds original allocation amount (%) for PaymentAllocation %',
            v_total_reversed, v_allocation_amount, NEW."originalAllocationId"
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- Stage 2.1: Student Credit Accounts & Double-Entry Sibling Transfers
-- ----------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "CreditTransferStatus" AS ENUM ('PENDING_APPROVAL', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TransferPostingType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "StudentCreditAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "transferredIn" INTEGER NOT NULL DEFAULT 0,
    "transferredOut" INTEGER NOT NULL DEFAULT 0,
    "allocatedIn" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCreditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransferJournal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "sourceStudentId" TEXT NOT NULL,
    "targetStudentId" TEXT NOT NULL,
    "sourceReceiptId" TEXT NOT NULL,
    "receiptProvenanceRef" TEXT,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CreditTransferStatus" NOT NULL DEFAULT 'COMPLETED',
    "authorizedGuardianId" TEXT,
    "guardianConsentRef" TEXT,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransferJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransferPosting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "entryType" "TransferPostingType" NOT NULL,
    "studentId" TEXT NOT NULL,
    "counterpartyStudentId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "receiptProvenanceRef" TEXT,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "CreditTransferPosting_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "PaymentAllocation" ADD COLUMN "creditTransferId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StudentCreditAccount_studentId_key" ON "StudentCreditAccount"("studentId");
CREATE UNIQUE INDEX "StudentCreditAccount_tenantId_id_key" ON "StudentCreditAccount"("tenantId", "id");
CREATE UNIQUE INDEX "StudentCreditAccount_tenantId_studentId_key" ON "StudentCreditAccount"("tenantId", "studentId");
CREATE INDEX "StudentCreditAccount_tenantId_status_idx" ON "StudentCreditAccount"("tenantId", "status");
CREATE INDEX "StudentCreditAccount_tenantId_balance_idx" ON "StudentCreditAccount"("tenantId", "balance");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransferJournal_tenantId_id_key" ON "CreditTransferJournal"("tenantId", "id");
CREATE UNIQUE INDEX "CreditTransferJournal_tenantId_transferNumber_key" ON "CreditTransferJournal"("tenantId", "transferNumber");
CREATE UNIQUE INDEX "CreditTransferJournal_tenantId_idempotencyKey_key" ON "CreditTransferJournal"("tenantId", "idempotencyKey");
CREATE INDEX "CreditTransferJournal_tenantId_sourceStudentId_idx" ON "CreditTransferJournal"("tenantId", "sourceStudentId");
CREATE INDEX "CreditTransferJournal_tenantId_targetStudentId_idx" ON "CreditTransferJournal"("tenantId", "targetStudentId");
CREATE INDEX "CreditTransferJournal_tenantId_sourceReceiptId_idx" ON "CreditTransferJournal"("tenantId", "sourceReceiptId");
CREATE INDEX "CreditTransferJournal_tenantId_createdAt_idx" ON "CreditTransferJournal"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransferPosting_tenantId_id_key" ON "CreditTransferPosting"("tenantId", "id");
CREATE INDEX "CreditTransferPosting_tenantId_journalId_idx" ON "CreditTransferPosting"("tenantId", "journalId");
CREATE INDEX "CreditTransferPosting_tenantId_studentId_idx" ON "CreditTransferPosting"("tenantId", "studentId");
CREATE INDEX "CreditTransferPosting_tenantId_counterpartyStudentId_idx" ON "CreditTransferPosting"("tenantId", "counterpartyStudentId");
CREATE INDEX "CreditTransferPosting_tenantId_receiptId_idx" ON "CreditTransferPosting"("tenantId", "receiptId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_tenantId_creditTransferId_idx" ON "PaymentAllocation"("tenantId", "creditTransferId");

-- AddForeignKey
ALTER TABLE "StudentCreditAccount" ADD CONSTRAINT "StudentCreditAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentCreditAccount" ADD CONSTRAINT "StudentCreditAccount_tenantId_studentId_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransferJournal" ADD CONSTRAINT "CreditTransferJournal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferJournal" ADD CONSTRAINT "CreditTransferJournal_tenantId_sourceStudentId_fkey" FOREIGN KEY ("tenantId", "sourceStudentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferJournal" ADD CONSTRAINT "CreditTransferJournal_tenantId_targetStudentId_fkey" FOREIGN KEY ("tenantId", "targetStudentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferJournal" ADD CONSTRAINT "CreditTransferJournal_tenantId_sourceReceiptId_fkey" FOREIGN KEY ("tenantId", "sourceReceiptId") REFERENCES "PaymentReceipt"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransferPosting" ADD CONSTRAINT "CreditTransferPosting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferPosting" ADD CONSTRAINT "CreditTransferPosting_tenantId_journalId_fkey" FOREIGN KEY ("tenantId", "journalId") REFERENCES "CreditTransferJournal"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferPosting" ADD CONSTRAINT "CreditTransferPosting_tenantId_studentId_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferPosting" ADD CONSTRAINT "CreditTransferPosting_tenantId_counterpartyStudentId_fkey" FOREIGN KEY ("tenantId", "counterpartyStudentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditTransferPosting" ADD CONSTRAINT "CreditTransferPosting_tenantId_receiptId_fkey" FOREIGN KEY ("tenantId", "receiptId") REFERENCES "PaymentReceipt"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_creditTransferId_fkey" FOREIGN KEY ("tenantId", "creditTransferId") REFERENCES "CreditTransferJournal"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK Constraints
ALTER TABLE "StudentCreditAccount" ADD CONSTRAINT chk_student_credit_balance_non_negative CHECK (balance >= 0);
ALTER TABLE "StudentCreditAccount" ADD CONSTRAINT chk_student_credit_transferred_in_non_negative CHECK ("transferredIn" >= 0);
ALTER TABLE "StudentCreditAccount" ADD CONSTRAINT chk_student_credit_transferred_out_non_negative CHECK ("transferredOut" >= 0);
ALTER TABLE "StudentCreditAccount" ADD CONSTRAINT chk_student_credit_allocated_in_non_negative CHECK ("allocatedIn" >= 0);

ALTER TABLE "CreditTransferJournal" ADD CONSTRAINT chk_transfer_amount_positive CHECK (amount > 0);
ALTER TABLE "CreditTransferJournal" ADD CONSTRAINT chk_transfer_distinct_students CHECK ("sourceStudentId" <> "targetStudentId");

ALTER TABLE "CreditTransferPosting" ADD CONSTRAINT chk_posting_amount_positive CHECK (amount > 0);

-- Triggers: Immutability, identity, double-entry, and allocation provenance
CREATE OR REPLACE FUNCTION fn_protect_credit_transfer_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CreditTransferJournal records are immutable financial audit events and cannot be updated, deleted, or truncated (id: %, transferNumber: %)',
    OLD.id, OLD."transferNumber"
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_transfer_protect ON "CreditTransferJournal";
CREATE TRIGGER trg_credit_transfer_protect
BEFORE UPDATE OR DELETE ON "CreditTransferJournal"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_credit_transfer_immutability();

DROP TRIGGER IF EXISTS trg_credit_transfer_truncate ON "CreditTransferJournal";
CREATE TRIGGER trg_credit_transfer_truncate
BEFORE TRUNCATE ON "CreditTransferJournal"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_protect_credit_transfer_immutability();

CREATE OR REPLACE FUNCTION fn_protect_transfer_posting_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CreditTransferPosting records are immutable financial ledger entries and cannot be updated, deleted, or truncated (id: %, journalId: %)',
    OLD.id, OLD."journalId"
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transfer_posting_protect ON "CreditTransferPosting";
CREATE TRIGGER trg_transfer_posting_protect
BEFORE UPDATE OR DELETE ON "CreditTransferPosting"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_transfer_posting_immutability();

DROP TRIGGER IF EXISTS trg_transfer_posting_truncate ON "CreditTransferPosting";
CREATE TRIGGER trg_transfer_posting_truncate
BEFORE TRUNCATE ON "CreditTransferPosting"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_protect_transfer_posting_immutability();

CREATE OR REPLACE FUNCTION fn_protect_credit_account_identity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW."studentId" IS DISTINCT FROM OLD."studentId" THEN
    RAISE EXCEPTION 'Identity mutation prohibited: StudentCreditAccount tenantId and studentId are immutable (id: %)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_account_identity_guard ON "StudentCreditAccount";
CREATE TRIGGER trg_credit_account_identity_guard
BEFORE UPDATE OF "tenantId", "studentId" ON "StudentCreditAccount"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_credit_account_identity();

CREATE OR REPLACE FUNCTION fn_protect_credit_account_deletion()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.balance > 0 OR OLD."transferredIn" > 0 OR OLD."transferredOut" > 0 OR OLD."allocatedIn" > 0 THEN
    RAISE EXCEPTION 'Cannot delete StudentCreditAccount % with active balance or historical transactions', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_account_deletion_guard ON "StudentCreditAccount";
CREATE TRIGGER trg_credit_account_deletion_guard
BEFORE DELETE ON "StudentCreditAccount"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_credit_account_deletion();

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
BEGIN
  IF TG_TABLE_NAME = 'CreditTransferPosting' THEN
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

CREATE OR REPLACE FUNCTION fn_enforce_transfer_posting_provenance()
RETURNS TRIGGER AS $$
DECLARE
  v_journal "CreditTransferJournal"%ROWTYPE;
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

  IF NEW."receiptId" IS DISTINCT FROM v_journal."sourceReceiptId" THEN
    RAISE EXCEPTION 'Provenance violation: CreditTransferPosting receiptId % does not match CreditTransferJournal sourceReceiptId %',
      NEW."receiptId", v_journal."sourceReceiptId"
      USING ERRCODE = 'P0001';
  END IF;

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

CREATE OR REPLACE FUNCTION fn_enforce_allocation_same_student()
RETURNS TRIGGER AS $$
DECLARE
  v_receipt_student_id TEXT;
  v_receipt_tenant_id TEXT;
  v_invoice_student_id TEXT;
  v_invoice_tenant_id TEXT;
  v_transfer "CreditTransferJournal"%ROWTYPE;
BEGIN
  SELECT "tenantId", "studentId"
  INTO v_receipt_tenant_id, v_receipt_student_id
  FROM "PaymentReceipt"
  WHERE id = NEW."receiptId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: PaymentReceipt % not found', NEW."receiptId"
      USING ERRCODE = 'P0001';
  END IF;

  SELECT "tenantId", "studentId"
  INTO v_invoice_tenant_id, v_invoice_student_id
  FROM "FeeInvoice"
  WHERE id = NEW."feeInvoiceId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: FeeInvoice % not found', NEW."feeInvoiceId"
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."tenantId" IS DISTINCT FROM v_receipt_tenant_id OR NEW."tenantId" IS DISTINCT FROM v_invoice_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant allocation violation: PaymentAllocation (tenant %), PaymentReceipt (tenant %), and FeeInvoice (tenant %) must share the exact same tenantId',
      NEW."tenantId", v_receipt_tenant_id, v_invoice_tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."studentId" IS DISTINCT FROM v_invoice_student_id THEN
    RAISE EXCEPTION 'Cross-student allocation violation: PaymentAllocation beneficiary student (%) does not match FeeInvoice billed student (%)',
      NEW."studentId", v_invoice_student_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."creditTransferId" IS NULL THEN
    IF NEW."studentId" IS DISTINCT FROM v_receipt_student_id THEN
      RAISE EXCEPTION 'Cross-student allocation violation: PaymentAllocation beneficiary student (%) does not match PaymentReceipt source student (%) without an authorized credit transfer record',
        NEW."studentId", v_receipt_student_id
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
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

    IF v_transfer."sourceReceiptId" IS DISTINCT FROM NEW."receiptId" THEN
      RAISE EXCEPTION 'Invalid credit transfer provenance: CreditTransferJournal % source receipt (%) does not match allocation receiptId (%)',
        NEW."creditTransferId", v_transfer."sourceReceiptId", NEW."receiptId"
        USING ERRCODE = 'P0001';
    END IF;

    IF v_transfer."targetStudentId" IS DISTINCT FROM NEW."studentId" THEN
      RAISE EXCEPTION 'Invalid credit transfer provenance: CreditTransferJournal % target student (%) does not match allocation studentId (%)',
        NEW."creditTransferId", v_transfer."targetStudentId", NEW."studentId"
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- Stage 2.1.1: Credit Transfer Lifecycle and Provenance Integrity Corrections
-- ----------------------------------------------------------------------------

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

-- Triggers: Immutability, lifecycle, and multi-receipt balancing
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

CREATE OR REPLACE FUNCTION fn_enforce_transfer_request_lifecycle()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR
     NEW."sourceStudentId" IS DISTINCT FROM OLD."sourceStudentId" OR
     NEW."targetStudentId" IS DISTINCT FROM OLD."targetStudentId" OR
     NEW."amount" IS DISTINCT FROM OLD."amount" OR
     NEW."requestNumber" IS DISTINCT FROM OLD."requestNumber" THEN
    RAISE EXCEPTION 'Core request parameters (tenantId, sourceStudentId, targetStudentId, amount, requestNumber) of CreditTransferRequest % are immutable', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  IF OLD."status" IN ('REJECTED', 'CANCELLED', 'EXECUTED') THEN
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
      RAISE EXCEPTION 'CreditTransferRequest % is in terminal state % and cannot transition to %',
        OLD.id, OLD."status", NEW."status"
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

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
  SELECT "tenantId", "studentId"
  INTO v_receipt_tenant_id, v_receipt_student_id
  FROM "PaymentReceipt"
  WHERE id = NEW."receiptId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: PaymentReceipt % not found', NEW."receiptId"
      USING ERRCODE = 'P0001';
  END IF;

  SELECT "tenantId", "studentId"
  INTO v_invoice_tenant_id, v_invoice_student_id
  FROM "FeeInvoice"
  WHERE id = NEW."feeInvoiceId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: FeeInvoice % not found', NEW."feeInvoiceId"
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."tenantId" IS DISTINCT FROM v_receipt_tenant_id OR NEW."tenantId" IS DISTINCT FROM v_invoice_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant allocation violation: PaymentAllocation (tenant %), PaymentReceipt (tenant %), and FeeInvoice (tenant %) must share the exact same tenantId',
      NEW."tenantId", v_receipt_tenant_id, v_invoice_tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."studentId" IS DISTINCT FROM v_invoice_student_id THEN
    RAISE EXCEPTION 'Cross-student allocation violation: PaymentAllocation beneficiary student (%) does not match FeeInvoice billed student (%)',
      NEW."studentId", v_invoice_student_id
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."creditTransferId" IS NULL THEN
    IF NEW."studentId" IS DISTINCT FROM v_receipt_student_id THEN
      RAISE EXCEPTION 'Cross-student allocation violation: PaymentAllocation beneficiary student (%) does not match PaymentReceipt source student (%) without an authorized credit transfer record',
        NEW."studentId", v_receipt_student_id
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
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
