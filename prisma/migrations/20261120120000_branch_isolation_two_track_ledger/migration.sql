-- ─────────────────────────────────────────────────────────────────────────────
-- Knowletive: Branch Isolation, Two-Track Ledger & Immutability Hardening
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BranchType') THEN
    CREATE TYPE "BranchType" AS ENUM ('MAIN', 'SUB_BRANCH');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BranchVerificationStatus') THEN
    CREATE TYPE "BranchVerificationStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BranchLedgerEntryType') THEN
    CREATE TYPE "BranchLedgerEntryType" AS ENUM ('CREDIT_SETTLEMENT', 'DEBIT_PAYOUT', 'DEBIT_BOUNCE', 'DEBIT_REFUND', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BranchLedgerChannel') THEN
    CREATE TYPE "BranchLedgerChannel" AS ENUM ('ONLINE_JODO', 'OFFLINE_RECORD');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BranchPayoutStatus') THEN
    CREATE TYPE "BranchPayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED');
  END IF;
END $$;

-- 2. Create Branch Table
CREATE TABLE IF NOT EXISTS "Branch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentBranchId" TEXT,
    "branchType" "BranchType" NOT NULL DEFAULT 'MAIN',
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "collectorCode" TEXT,
    "verificationStatus" "BranchVerificationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "bankBankName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- 3. Add branchId to existing tables
ALTER TABLE "Membership" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "FeeInvoice" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "FeePayment" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "PaymentReceipt" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "FeePaymentLink" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- 4. Create BranchLedgerEntry Table
CREATE TABLE IF NOT EXISTS "BranchLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "entryType" "BranchLedgerEntryType" NOT NULL,
    "channel" "BranchLedgerChannel" NOT NULL DEFAULT 'ONLINE_JODO',
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT,
    "utrReference" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "BranchLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- 5. Create BranchPayout Table
CREATE TABLE IF NOT EXISTS "BranchPayout" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "payoutNumber" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "BranchPayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "bankBankName" TEXT,
    "utrReference" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchPayout_pkey" PRIMARY KEY ("id")
);

-- 6. Indexes & Constraints
CREATE UNIQUE INDEX IF NOT EXISTS "Branch_tenantId_code_key" ON "Branch"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "Branch_tenantId_idx" ON "Branch"("tenantId");
CREATE INDEX IF NOT EXISTS "Branch_tenantId_branchType_idx" ON "Branch"("tenantId", "branchType");
CREATE INDEX IF NOT EXISTS "Branch_collectorCode_idx" ON "Branch"("collectorCode");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_branch_tenant_collector" ON "Branch"("tenantId", "collectorCode") WHERE "collectorCode" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "BranchLedgerEntry_tenantId_id_key" ON "BranchLedgerEntry"("tenantId", "id");
CREATE INDEX IF NOT EXISTS "BranchLedgerEntry_tenantId_branchId_postedAt_idx" ON "BranchLedgerEntry"("tenantId", "branchId", "postedAt");
CREATE INDEX IF NOT EXISTS "BranchLedgerEntry_tenantId_referenceType_referenceId_idx" ON "BranchLedgerEntry"("tenantId", "referenceType", "referenceId");

CREATE UNIQUE INDEX IF NOT EXISTS "BranchPayout_tenantId_id_key" ON "BranchPayout"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "BranchPayout_tenantId_payoutNumber_key" ON "BranchPayout"("tenantId", "payoutNumber");
CREATE INDEX IF NOT EXISTS "BranchPayout_tenantId_branchId_status_idx" ON "BranchPayout"("tenantId", "branchId", "status");

CREATE INDEX IF NOT EXISTS "Membership_branchId_idx" ON "Membership"("branchId");
CREATE INDEX IF NOT EXISTS "Student_branchId_idx" ON "Student"("branchId");
CREATE INDEX IF NOT EXISTS "FeeInvoice_tenantId_branchId_idx" ON "FeeInvoice"("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "FeePayment_tenantId_branchId_idx" ON "FeePayment"("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "PaymentReceipt_tenantId_branchId_idx" ON "PaymentReceipt"("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "FeePaymentLink_tenantId_branchId_idx" ON "FeePaymentLink"("tenantId", "branchId");

-- 7. Foreign Key Constraints
ALTER TABLE "Branch" DROP CONSTRAINT IF EXISTS "Branch_tenantId_fkey";
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Branch" DROP CONSTRAINT IF EXISTS "Branch_parentBranchId_fkey";
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_parentBranchId_fkey" FOREIGN KEY ("parentBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Membership" DROP CONSTRAINT IF EXISTS "Membership_branchId_fkey";
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Student" DROP CONSTRAINT IF EXISTS "Student_branchId_fkey";
ALTER TABLE "Student" ADD CONSTRAINT "Student_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FeeInvoice" DROP CONSTRAINT IF EXISTS "FeeInvoice_branchId_fkey";
ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FeePayment" DROP CONSTRAINT IF EXISTS "FeePayment_branchId_fkey";
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentReceipt" DROP CONSTRAINT IF EXISTS "PaymentReceipt_branchId_fkey";
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FeePaymentLink" DROP CONSTRAINT IF EXISTS "FeePaymentLink_branchId_fkey";
ALTER TABLE "FeePaymentLink" ADD CONSTRAINT "FeePaymentLink_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BranchLedgerEntry" DROP CONSTRAINT IF EXISTS "BranchLedgerEntry_tenantId_fkey";
ALTER TABLE "BranchLedgerEntry" ADD CONSTRAINT "BranchLedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BranchLedgerEntry" DROP CONSTRAINT IF EXISTS "BranchLedgerEntry_branchId_fkey";
ALTER TABLE "BranchLedgerEntry" ADD CONSTRAINT "BranchLedgerEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BranchPayout" DROP CONSTRAINT IF EXISTS "BranchPayout_tenantId_fkey";
ALTER TABLE "BranchPayout" ADD CONSTRAINT "BranchPayout_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BranchPayout" DROP CONSTRAINT IF EXISTS "BranchPayout_branchId_fkey";
ALTER TABLE "BranchPayout" ADD CONSTRAINT "BranchPayout_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
