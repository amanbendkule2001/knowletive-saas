-- Stage 1.2: Final Financial Ledger Database Integrity Hardening
-- Additive Follow-up Migration
-- Scope:
-- 1. PaymentReceiptBalance: Prevent direct deletion, truncation, and identity reassignment (receiptId, tenantId).
-- 2. PaymentAllocation: Enforce same-student provenance constraint (Receipt.studentId = Allocation.studentId = Invoice.studentId).
-- 3. Application Role Permissions: Revoke destructive DCL privileges from knowletive_app and PUBLIC.

-- ----------------------------------------------------------------------------
-- 1. PaymentReceiptBalance Identity & Deletion Protection
-- ----------------------------------------------------------------------------

-- Prevent DELETE and TRUNCATE on PaymentReceiptBalance
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

-- Prevent updating identity columns (receiptId, tenantId) on PaymentReceiptBalance
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

-- ----------------------------------------------------------------------------
-- 2. PaymentAllocation: Same-Student Provenance Guard
-- Rule: PaymentReceipt.studentId = PaymentAllocation.studentId = FeeInvoice.studentId
-- Prevents cross-student credit allocation until Stage 2 CreditTransferJournal exists
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enforce_allocation_same_student()
RETURNS TRIGGER AS $$
DECLARE
  v_receipt_student_id TEXT;
  v_receipt_tenant_id TEXT;
  v_invoice_student_id TEXT;
  v_invoice_tenant_id TEXT;
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

  -- 4. Same-Student Provenance Guard (Until Stage 2 CreditTransferJournal is implemented)
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

-- ----------------------------------------------------------------------------
-- 3. FeeInvoice: Student Reassignment Protection
-- Prohibits changing FeeInvoice.studentId when PaymentAllocation records exist
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 4. Application Role Permissions & Least Privilege
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- Revoke destructive permissions from knowletive_app if the role exists
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'knowletive_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "PaymentReceipt", "PaymentAllocation", "PaymentAllocationReversal" FROM knowletive_app;
    REVOKE DELETE, TRUNCATE ON "PaymentReceiptBalance" FROM knowletive_app;
  END IF;
END $$;

REVOKE DELETE, TRUNCATE ON "PaymentReceiptBalance" FROM PUBLIC;
