-- ─────────────────────────────────────────────────────────────────────────────
-- Knowletive: Phase 2.2 Pre-RLS Integrity & Branch Hardening Migration
-- Migration: 20261121130000_phase2_2_pre_rls_integrity_and_branch_hardening
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Ensure composite unique constraint on Branch(tenantId, id) exists
CREATE UNIQUE INDEX IF NOT EXISTS "Branch_tenantId_id_key" ON "Branch"("tenantId", "id");

-- 2. Enforce composite foreign key from PaymentCollectorRoute(tenantId, branchId) to Branch(tenantId, id) with ON DELETE RESTRICT
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentCollectorRoute_tenantId_branchId_fkey') THEN
    ALTER TABLE "PaymentCollectorRoute" DROP CONSTRAINT "PaymentCollectorRoute_tenantId_branchId_fkey";
  END IF;
  
  ALTER TABLE "PaymentCollectorRoute" ADD CONSTRAINT "PaymentCollectorRoute_tenantId_branchId_fkey"
    FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
END $$;

-- 3. PaymentCollectorRoute uniqueness and idempotency
-- A. Per-branch route identity with NULLS NOT DISTINCT
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pcr_branch_route_identity"
ON "PaymentCollectorRoute"("tenantId", "branchId", "provider", "environment", "collectorCode", "merchantId", "routingDiscriminator")
NULLS NOT DISTINCT;

-- B. Explicit discriminator uniqueness across branches (partial unique index for non-null discriminators)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pcr_explicit_discriminator"
ON "PaymentCollectorRoute"("tenantId", "provider", "environment", "collectorCode", "merchantId", "routingDiscriminator")
NULLS NOT DISTINCT
WHERE "routingDiscriminator" IS NOT NULL;

-- 4. Enforce MembershipBranch CHECK constraint rejecting TENANT_WIDE
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_membership_branch_scope') THEN
    ALTER TABLE "MembershipBranch"
    ADD CONSTRAINT "chk_membership_branch_scope"
    CHECK ("scopeMode" IN ('EXACT_BRANCH', 'BRANCH_AND_DESCENDANTS'));
  END IF;
END $$;

-- 5. Safe idempotent backfill of existing Branch collectorCode
INSERT INTO "PaymentCollectorRoute" ("id", "tenantId", "branchId", "provider", "environment", "collectorCode", "isActive", "createdAt", "updatedAt")
SELECT 'pcr_' || id, "tenantId", id, 'DEMO', 'DEMO', "collectorCode", true, NOW(), NOW()
FROM "Branch"
WHERE "collectorCode" IS NOT NULL
ON CONFLICT DO NOTHING;
