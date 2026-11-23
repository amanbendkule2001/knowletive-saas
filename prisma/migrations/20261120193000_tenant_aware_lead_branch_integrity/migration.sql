-- ─────────────────────────────────────────────────────────────────────────────
-- Knowletive: Tenant-Aware Database-Level Lead-to-Branch Integrity
-- Migration: 20261120193000_tenant_aware_lead_branch_integrity
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Ensure unique composite constraint on Branch(tenantId, id)
CREATE UNIQUE INDEX IF NOT EXISTS "Branch_tenantId_id_key" ON "Branch"("tenantId", "id");

-- 2. Drop legacy single-column foreign key constraint if present
ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_branchId_fkey";

-- 3. Add composite tenant-aware foreign key constraint from Lead to Branch
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Lead_tenantId_branchId_fkey'
  ) THEN
    ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_branchId_fkey"
      FOREIGN KEY ("tenantId", "branchId")
      REFERENCES "Branch"("tenantId", "id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;
  END IF;
END $$;
