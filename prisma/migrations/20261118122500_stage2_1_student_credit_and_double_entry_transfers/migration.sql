-- Migration: 20261118122500_stage2_1_student_credit_and_double_entry_transfers
-- Stage 2.1: Student Credit Accounts and Double-Entry Transfer Models
-- Implements StudentCreditAccount, CreditTransferJournal, CreditTransferPosting,
-- reconnects PaymentAllocation.creditTransferId, and enforces double-entry balancing and provenance.

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

-- ----------------------------------------------------------------------------
-- Immutability Protection: CreditTransferJournal
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Immutability Protection: CreditTransferPosting
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Identity & Deletion Protection: StudentCreditAccount
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Double-Entry Balance Verification (DEFERRABLE INITIALLY DEFERRED)
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

-- ----------------------------------------------------------------------------
-- CreditTransferPosting Provenance & Consistency Verification
-- ----------------------------------------------------------------------------
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
-- Update fn_enforce_allocation_same_student() to support validated sibling transfers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enforce_allocation_same_student()
RETURNS TRIGGER AS $$
DECLARE
  v_receipt_student_id TEXT;
  v_receipt_tenant_id TEXT;
  v_invoice_student_id TEXT;
  v_invoice_tenant_id TEXT;
  v_transfer "CreditTransferJournal"%ROWTYPE;
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
