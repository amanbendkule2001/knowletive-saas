-- ─────────────────────────────────────────────────────────────────────────────
-- Knowletive: Phase 2.3 Final Pre-RLS Closure Migration
-- Migration: 20261121140000_phase2_3_collector_routing_correction_and_pre_rls
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Correct previously backfilled routes in PaymentCollectorRoute
-- Determine provider, environment, and active status ONLY from authoritative existing PaymentProviderConfig.
-- If no authoritative config exists, the route must NEVER be converted to DEMO or activated.
-- It is classified as UNVERIFIED / inactive to prevent unauthorized live or simulated payments.

UPDATE "PaymentCollectorRoute" pcr
SET
  "provider" = COALESCE(ppc."provider", 'UNVERIFIED'),
  "environment" = COALESCE(ppc."environment", 'UNVERIFIED'),
  "merchantId" = ppc."merchantId",
  "isActive" = COALESCE(ppc."isEnabled", false),
  "metadata" = jsonb_build_object(
    'correctedAt', NOW(),
    'source', CASE WHEN ppc."id" IS NOT NULL THEN 'PaymentProviderConfig' ELSE 'Branch.collectorCode' END,
    'status', CASE WHEN ppc."id" IS NOT NULL THEN 'CONFIGURED' ELSE 'UNVERIFIED' END,
    'configId', ppc."id"
  )
FROM "Branch" b
LEFT JOIN "PaymentProviderConfig" ppc
  ON ppc."tenantId" = b."tenantId"
 AND (ppc."branchId" = b."id" OR (ppc."branchId" IS NULL AND ppc."collectorCode" = b."collectorCode"))
WHERE pcr."id" = 'pcr_' || b."id"
  AND pcr."branchId" = b."id";

-- 2. Authoritative Idempotent Backfill for any newly configured branches
INSERT INTO "PaymentCollectorRoute" (
  "id", "tenantId", "branchId", "provider", "environment", "merchantId", "collectorCode", "isActive", "createdAt", "updatedAt", "metadata"
)
SELECT
  'pcr_' || b."id",
  b."tenantId",
  b."id",
  COALESCE(ppc."provider", 'UNVERIFIED'),
  COALESCE(ppc."environment", 'UNVERIFIED'),
  ppc."merchantId",
  b."collectorCode",
  COALESCE(ppc."isEnabled", false),
  NOW(),
  NOW(),
  jsonb_build_object(
    'backfilledAt', NOW(),
    'source', CASE WHEN ppc."id" IS NOT NULL THEN 'PaymentProviderConfig' ELSE 'Branch.collectorCode' END,
    'status', CASE WHEN ppc."id" IS NOT NULL THEN 'CONFIGURED' ELSE 'UNVERIFIED' END,
    'configId', ppc."id"
  )
FROM "Branch" b
LEFT JOIN "PaymentProviderConfig" ppc
  ON ppc."tenantId" = b."tenantId"
 AND (ppc."branchId" = b."id" OR (ppc."branchId" IS NULL AND ppc."collectorCode" = b."collectorCode"))
WHERE b."collectorCode" IS NOT NULL
ON CONFLICT ("tenantId", "branchId", "provider", "environment", "collectorCode", "merchantId", "routingDiscriminator") DO UPDATE
SET
  "provider" = EXCLUDED."provider",
  "environment" = EXCLUDED."environment",
  "merchantId" = EXCLUDED."merchantId",
  "isActive" = EXCLUDED."isActive",
  "metadata" = EXCLUDED."metadata";

-- 3. Database-Managed Unique Indexes on PaymentCollectorRoute (Option B)
-- A. Per-branch route identity with NULLS NOT DISTINCT (PostgreSQL 15+)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pcr_branch_route_identity"
ON "PaymentCollectorRoute"("tenantId", "branchId", "provider", "environment", "collectorCode", "merchantId", "routingDiscriminator")
NULLS NOT DISTINCT;

-- B. Explicit discriminator uniqueness across branches (partial unique index for non-null discriminators)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pcr_explicit_discriminator"
ON "PaymentCollectorRoute"("tenantId", "provider", "environment", "collectorCode", "merchantId", "routingDiscriminator")
NULLS NOT DISTINCT
WHERE "routingDiscriminator" IS NOT NULL;

-- 4. Composite Foreign Key Deletion Protection (RESTRICT)
-- Prevents unsafe ON DELETE SET NULL on composite keys from wiping tenantId or branch attribution

-- A. PaymentAllocation
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentAllocation_tenantId_branchId_fkey') THEN
    ALTER TABLE "PaymentAllocation" DROP CONSTRAINT "PaymentAllocation_tenantId_branchId_fkey";
  END IF;
  ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_branchId_fkey"
    FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
END $$;

-- B. CreditTransferJournal (Source & Target Branches)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditTransferJournal_tenantId_sourceBranchId_fkey') THEN
    ALTER TABLE "CreditTransferJournal" DROP CONSTRAINT "CreditTransferJournal_tenantId_sourceBranchId_fkey";
  END IF;
  ALTER TABLE "CreditTransferJournal" ADD CONSTRAINT "CreditTransferJournal_tenantId_sourceBranchId_fkey"
    FOREIGN KEY ("tenantId", "sourceBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditTransferJournal_tenantId_targetBranchId_fkey') THEN
    ALTER TABLE "CreditTransferJournal" DROP CONSTRAINT "CreditTransferJournal_tenantId_targetBranchId_fkey";
  END IF;
  ALTER TABLE "CreditTransferJournal" ADD CONSTRAINT "CreditTransferJournal_tenantId_targetBranchId_fkey"
    FOREIGN KEY ("tenantId", "targetBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
END $$;

-- C. BranchReconciliationAudit (Previous & New Branches)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BranchReconciliationAudit_tenantId_previousBranchId_fkey') THEN
    ALTER TABLE "BranchReconciliationAudit" DROP CONSTRAINT "BranchReconciliationAudit_tenantId_previousBranchId_fkey";
  END IF;
  ALTER TABLE "BranchReconciliationAudit" ADD CONSTRAINT "BranchReconciliationAudit_tenantId_previousBranchId_fkey"
    FOREIGN KEY ("tenantId", "previousBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BranchReconciliationAudit_tenantId_newBranchId_fkey') THEN
    ALTER TABLE "BranchReconciliationAudit" DROP CONSTRAINT "BranchReconciliationAudit_tenantId_newBranchId_fkey";
  END IF;
  ALTER TABLE "BranchReconciliationAudit" ADD CONSTRAINT "BranchReconciliationAudit_tenantId_newBranchId_fkey"
    FOREIGN KEY ("tenantId", "newBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
END $$;

-- D. PaymentReceipt and FeePayment (Immutable Ledger Rows)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentReceipt_branchId_fkey') THEN
    ALTER TABLE "PaymentReceipt" DROP CONSTRAINT "PaymentReceipt_branchId_fkey";
  END IF;
  ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeePayment_branchId_fkey') THEN
    ALTER TABLE "FeePayment" DROP CONSTRAINT "FeePayment_branchId_fkey";
  END IF;
  ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
END $$;

-- E. Branch.parentBranchId (Hierarchical Self-Reference)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Branch_tenantId_parentBranchId_fkey') THEN
    ALTER TABLE "Branch" DROP CONSTRAINT "Branch_tenantId_parentBranchId_fkey";
  END IF;
  ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_parentBranchId_fkey"
    FOREIGN KEY ("tenantId", "parentBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
END $$;

-- 5. Database Function for Effective Historical Branch Attribution
CREATE OR REPLACE FUNCTION fn_get_effective_branch_id(
  p_tenant_id TEXT,
  p_record_type TEXT,
  p_record_id TEXT,
  p_raw_branch_id TEXT
) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT "newBranchId"
     FROM "BranchReconciliationAudit"
     WHERE "tenantId" = p_tenant_id
       AND "recordType" = p_record_type
       AND "recordId" = p_record_id
       AND "newBranchId" IS NOT NULL
     ORDER BY "createdAt" DESC, "id" DESC
     LIMIT 1),
    p_raw_branch_id
  );
$$;

-- 6. Database Views for Effective Financial Events
CREATE OR REPLACE VIEW v_effective_fee_payment AS
SELECT
  p.*,
  fn_get_effective_branch_id(p."tenantId", 'FeePayment', p."id", p."branchId") AS "effectiveBranchId"
FROM "FeePayment" p;

CREATE OR REPLACE VIEW v_effective_payment_receipt AS
SELECT
  r.*,
  fn_get_effective_branch_id(r."tenantId", 'PaymentReceipt', r."id", r."branchId") AS "effectiveBranchId"
FROM "PaymentReceipt" r;

CREATE OR REPLACE VIEW v_effective_payment_allocation AS
SELECT
  a.*,
  fn_get_effective_branch_id(a."tenantId", 'PaymentAllocation', a."id", a."branchId") AS "effectiveBranchId"
FROM "PaymentAllocation" a;
