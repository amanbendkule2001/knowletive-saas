-- ─────────────────────────────────────────────────────────────────────────────
-- Knowletive: Additive Branch Attribution for Prospective Leads
-- Migration: 20261120190000_lead_branch_isolation
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add nullable branchId to Lead table (non-destructive, leaves legacy leads unassigned)
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

-- 2. Create index for tenant and branch scoped lead queries
CREATE INDEX IF NOT EXISTS "Lead_tenantId_branchId_idx" ON "Lead"("tenantId", "branchId");

-- 3. Add foreign key relation to Branch
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Lead_branchId_fkey'
  ) THEN
    ALTER TABLE "Lead" ADD CONSTRAINT "Lead_branchId_fkey" 
      FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
