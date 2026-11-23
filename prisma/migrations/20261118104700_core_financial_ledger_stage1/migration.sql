-- Stage 1 & Stage 1.1: Core Financial Ledger Database Models & Integrity Hardening
-- Canonical Additive Prisma Migration
-- Models: PaymentReceipt, PaymentReceiptBalance, PaymentAllocation, PaymentAllocationReversal
-- Enums: PaymentReceiptStatus
-- Hardening: Composite Cross-Tenant Foreign Keys, Deferred Conservation Triggers, Immutability Guards

-- CreateEnum
CREATE TYPE "PaymentReceiptStatus" AS ENUM ('CAPTURED', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED', 'OVERPAID_UNALLOCATED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED', 'VOIDED');

-- CreateTable: PaymentReceipt (Layer 1 Immutable Event)
CREATE TABLE "PaymentReceipt" (
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

-- CreateTable: PaymentReceiptBalance (Layer 3 Mutable Projection)
CREATE TABLE "PaymentReceiptBalance" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentReceiptBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PaymentAllocation (Layer 1 Immutable Event)
CREATE TABLE "PaymentAllocation" (
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

-- CreateTable: PaymentAllocationReversal (Layer 1 Immutable Event)
CREATE TABLE "PaymentAllocationReversal" (
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

-- ----------------------------------------------------------------------------
-- Composite Unique Indexes for Cross-Tenant Referential Integrity
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX "Student_tenantId_id_key" ON "Student"("tenantId", "id");
CREATE UNIQUE INDEX "FeeInvoice_tenantId_id_key" ON "FeeInvoice"("tenantId", "id");
CREATE UNIQUE INDEX "PaymentReceipt_tenantId_id_key" ON "PaymentReceipt"("tenantId", "id");
CREATE UNIQUE INDEX "PaymentAllocation_tenantId_id_key" ON "PaymentAllocation"("tenantId", "id");
CREATE UNIQUE INDEX "PaymentReceiptBalance_tenantId_receiptId_key" ON "PaymentReceiptBalance"("tenantId", "receiptId");

-- Standard Indexes & Uniqueness
CREATE UNIQUE INDEX "PaymentReceipt_tenantId_receiptNumber_key" ON "PaymentReceipt"("tenantId", "receiptNumber");
CREATE INDEX "PaymentReceipt_tenantId_studentId_idx" ON "PaymentReceipt"("tenantId", "studentId");
CREATE INDEX "PaymentReceipt_tenantId_receivedAt_idx" ON "PaymentReceipt"("tenantId", "receivedAt");

-- Partial Unique Indexes (Provider and Cashier Idempotency)
CREATE UNIQUE INDEX "uq_receipt_provider_account_ref" ON "PaymentReceipt"("provider", "merchantAccountKey", "providerRef") WHERE "providerRef" IS NOT NULL AND "merchantAccountKey" IS NOT NULL;
CREATE UNIQUE INDEX "uq_receipt_cashier_idempotency" ON "PaymentReceipt"("tenantId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

-- PaymentReceiptBalance Indexes
CREATE UNIQUE INDEX "PaymentReceiptBalance_receiptId_key" ON "PaymentReceiptBalance"("receiptId");
CREATE INDEX "PaymentReceiptBalance_tenantId_status_idx" ON "PaymentReceiptBalance"("tenantId", "status");
CREATE INDEX "PaymentReceiptBalance_tenantId_unappliedAmount_idx" ON "PaymentReceiptBalance"("tenantId", "unappliedAmount");

-- PaymentAllocation Indexes
CREATE INDEX "PaymentAllocation_tenantId_receiptId_idx" ON "PaymentAllocation"("tenantId", "receiptId");
CREATE INDEX "PaymentAllocation_tenantId_feeInvoiceId_idx" ON "PaymentAllocation"("tenantId", "feeInvoiceId");
CREATE INDEX "PaymentAllocation_tenantId_studentId_idx" ON "PaymentAllocation"("tenantId", "studentId");
CREATE INDEX "PaymentAllocation_feeInvoiceId_allocatedAt_idx" ON "PaymentAllocation"("feeInvoiceId", "allocatedAt");

-- PaymentAllocationReversal Indexes
CREATE INDEX "PaymentAllocationReversal_tenantId_originalAllocationId_idx" ON "PaymentAllocationReversal"("tenantId", "originalAllocationId");
CREATE INDEX "PaymentAllocationReversal_originalAllocationId_idx" ON "PaymentAllocationReversal"("originalAllocationId");

-- ----------------------------------------------------------------------------
-- Composite Foreign Keys: Strict Database-Level Tenant Isolation
-- ----------------------------------------------------------------------------
-- Tenant FKs
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReceiptBalance" ADD CONSTRAINT "PaymentReceiptBalance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAllocationReversal" ADD CONSTRAINT "PaymentAllocationReversal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Composite Cross-Tenant Guards
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_tenantId_studentId_fkey" 
  FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentReceiptBalance" ADD CONSTRAINT "PaymentReceiptBalance_tenantId_receiptId_fkey" 
  FOREIGN KEY ("tenantId", "receiptId") REFERENCES "PaymentReceipt"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_receiptId_fkey" 
  FOREIGN KEY ("tenantId", "receiptId") REFERENCES "PaymentReceipt"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_studentId_fkey" 
  FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_feeInvoiceId_fkey" 
  FOREIGN KEY ("tenantId", "feeInvoiceId") REFERENCES "FeeInvoice"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocationReversal" ADD CONSTRAINT "PaymentAllocationReversal_tenantId_originalAllocationId_fkey" 
  FOREIGN KEY ("tenantId", "originalAllocationId") REFERENCES "PaymentAllocation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- Check Constraints: Field-Level Financial Invariants
-- ----------------------------------------------------------------------------
ALTER TABLE "PaymentReceipt"
  ADD CONSTRAINT "chk_receipt_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "PaymentReceipt"
  ADD CONSTRAINT "chk_receipt_external_merchant_key"
  CHECK (("provider" IN ('cashier', 'manual') AND "providerRef" IS NULL) OR ("providerRef" IS NOT NULL AND "merchantAccountKey" IS NOT NULL));

ALTER TABLE "PaymentReceiptBalance"
  ADD CONSTRAINT "chk_receipt_balance_non_negative"
  CHECK (
    "allocatedAmount" >= 0 AND 
    "transferredOutAmount" >= 0 AND 
    "unappliedAmount" >= 0 AND 
    "reservedRefundAmount" >= 0 AND 
    "refundedAmount" >= 0
  );

ALTER TABLE "PaymentReceiptBalance"
  ADD CONSTRAINT "chk_receipt_balance_version"
  CHECK ("version" >= 1);

ALTER TABLE "PaymentAllocation"
  ADD CONSTRAINT "chk_allocation_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "PaymentAllocationReversal"
  ADD CONSTRAINT "chk_reversal_amount_positive"
  CHECK ("amount" > 0);

-- ----------------------------------------------------------------------------
-- Deferred Constraint Triggers: Strict Receipt Balance Conservation
-- Invariant: PaymentReceipt.amount = allocated + transferredOut + unapplied + reservedRefund + refunded
-- Evaluated at COMMIT time (DEFERRABLE INITIALLY DEFERRED)
-- ----------------------------------------------------------------------------
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
  -- Identify receipt ID based on trigger origin
  IF TG_TABLE_NAME = 'PaymentReceipt' THEN
    v_receipt_id := NEW.id;
  ELSE
    v_receipt_id := NEW."receiptId";
  END IF;

  -- 1. Query the immutable PaymentReceipt record
  SELECT "tenantId", "amount"
  INTO v_receipt_tenant_id, v_receipt_amount
  FROM "PaymentReceipt"
  WHERE id = v_receipt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: PaymentReceipt % not found during balance conservation check', v_receipt_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Query the PaymentReceiptBalance projection
  SELECT "tenantId", "allocatedAmount", "transferredOutAmount", "unappliedAmount", "reservedRefundAmount", "refundedAmount"
  INTO v_balance_tenant_id, v_allocated, v_transferred_out, v_unapplied, v_reserved, v_refunded
  FROM "PaymentReceiptBalance"
  WHERE "receiptId" = v_receipt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Integrity violation: PaymentReceipt % exists without required PaymentReceiptBalance projection at commit', v_receipt_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Assert strict tenant consistency
  IF v_receipt_tenant_id IS DISTINCT FROM v_balance_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant violation: PaymentReceipt % (tenant %) and PaymentReceiptBalance (tenant %) belong to different tenants',
      v_receipt_id, v_receipt_tenant_id, v_balance_tenant_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Assert non-negative components
  IF v_allocated < 0 OR v_transferred_out < 0 OR v_unapplied < 0 OR v_reserved < 0 OR v_refunded < 0 THEN
    RAISE EXCEPTION 'Integrity violation: Negative balance component on PaymentReceipt %: allocated=%, transferredOut=%, unapplied=%, reserved=%, refunded=%',
      v_receipt_id, v_allocated, v_transferred_out, v_unapplied, v_reserved, v_refunded
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Assert exact mathematical equality (gross amount = sum of components)
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

-- ----------------------------------------------------------------------------
-- Immutability Protection Triggers: Layer 1 Append-Only Ledger
-- Prohibits UPDATE, DELETE, and TRUNCATE on immutable financial history
-- ----------------------------------------------------------------------------

-- PaymentReceipt Immutability
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

-- PaymentAllocation Immutability
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

-- PaymentAllocationReversal Immutability
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

-- Revoke destructive DCL permissions from PUBLIC
REVOKE UPDATE, DELETE, TRUNCATE ON "PaymentReceipt" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON "PaymentAllocation" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON "PaymentAllocationReversal" FROM PUBLIC;
