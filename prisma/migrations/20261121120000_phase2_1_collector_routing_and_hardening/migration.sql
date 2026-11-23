-- ─────────────────────────────────────────────────────────────────────────────
-- Knowletive: Phase 2.1 Collector Routing, Shared Codes & Financial Hardening
-- Migration: 20261121120000_phase2_1_collector_routing_and_hardening
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create PaymentCollectorRoute Table
CREATE TABLE IF NOT EXISTS "PaymentCollectorRoute" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "merchantId" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'DEMO',
    "collectorCode" TEXT NOT NULL,
    "routingDiscriminator" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentCollectorRoute_pkey" PRIMARY KEY ("id")
);

-- 2. Create Indexes for PaymentCollectorRoute
CREATE INDEX IF NOT EXISTS "PaymentCollectorRoute_tenantId_provider_environment_idx" ON "PaymentCollectorRoute"("tenantId", "provider", "environment");
CREATE INDEX IF NOT EXISTS "PaymentCollectorRoute_tenantId_collectorCode_idx" ON "PaymentCollectorRoute"("tenantId", "collectorCode");
CREATE INDEX IF NOT EXISTS "PaymentCollectorRoute_tenantId_merchantId_idx" ON "PaymentCollectorRoute"("tenantId", "merchantId");
CREATE INDEX IF NOT EXISTS "PaymentCollectorRoute_tenantId_branchId_idx" ON "PaymentCollectorRoute"("tenantId", "branchId");

-- 3. Composite Foreign Keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentCollectorRoute_tenantId_fkey') THEN
    ALTER TABLE "PaymentCollectorRoute" ADD CONSTRAINT "PaymentCollectorRoute_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentCollectorRoute_tenantId_branchId_fkey') THEN
    ALTER TABLE "PaymentCollectorRoute" ADD CONSTRAINT "PaymentCollectorRoute_tenantId_branchId_fkey"
      FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Safely replace unique (tenantId, collectorCode) constraint on Branch to allow shared collector codes
DROP INDEX IF EXISTS "uq_branch_tenant_collector";
CREATE INDEX IF NOT EXISTS "Branch_tenantId_collectorCode_idx" ON "Branch"("tenantId", "collectorCode");

-- 5. Backfill existing Branch collectorCode into PaymentCollectorRoute
INSERT INTO "PaymentCollectorRoute" ("id", "tenantId", "branchId", "provider", "environment", "collectorCode", "isActive", "createdAt", "updatedAt")
SELECT 'pcr_' || id, "tenantId", id, 'DEMO', 'DEMO', "collectorCode", true, NOW(), NOW()
FROM "Branch"
WHERE "collectorCode" IS NOT NULL
ON CONFLICT DO NOTHING;
