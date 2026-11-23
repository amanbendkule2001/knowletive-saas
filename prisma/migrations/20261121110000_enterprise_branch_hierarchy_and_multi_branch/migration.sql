-- ─────────────────────────────────────────────────────────────────────────────
-- Knowletive: Enterprise Branch Hierarchy, Multi-Branch Membership & Historical Financial Attribution
-- Migration: 20261121110000_enterprise_branch_hierarchy_and_multi_branch
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create BranchAssignmentScopeMode enum if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BranchAssignmentScopeMode') THEN
    CREATE TYPE "BranchAssignmentScopeMode" AS ENUM ('EXACT_BRANCH', 'BRANCH_AND_DESCENDANTS', 'TENANT_WIDE');
  END IF;
END $$;

-- 2. Ensure unique composite constraint on Membership(tenantId, id)
CREATE UNIQUE INDEX IF NOT EXISTS "Membership_tenantId_id_key" ON "Membership"("tenantId", "id");

-- 3. Branch parent hierarchy tenant-isolation composite foreign key and check constraint
ALTER TABLE "Branch" DROP CONSTRAINT IF EXISTS "Branch_parentBranchId_fkey";
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Branch_tenantId_parentBranchId_fkey') THEN
    ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_parentBranchId_fkey"
      FOREIGN KEY ("tenantId", "parentBranchId")
      REFERENCES "Branch"("tenantId", "id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_branch_no_self_parent') THEN
    ALTER TABLE "Branch" ADD CONSTRAINT "chk_branch_no_self_parent"
      CHECK ("parentBranchId" IS NULL OR "parentBranchId" <> "id");
  END IF;
END $$;

-- 4. Create MembershipBranch table
CREATE TABLE IF NOT EXISTS "MembershipBranch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "scopeMode" "BranchAssignmentScopeMode" NOT NULL DEFAULT 'EXACT_BRANCH',
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipBranch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MembershipBranch_tenantId_membershipId_branchId_key" ON "MembershipBranch"("tenantId", "membershipId", "branchId");
CREATE INDEX IF NOT EXISTS "MembershipBranch_tenantId_idx" ON "MembershipBranch"("tenantId");
CREATE INDEX IF NOT EXISTS "MembershipBranch_tenantId_membershipId_idx" ON "MembershipBranch"("tenantId", "membershipId");
CREATE INDEX IF NOT EXISTS "MembershipBranch_tenantId_branchId_idx" ON "MembershipBranch"("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "MembershipBranch_tenantId_scopeMode_idx" ON "MembershipBranch"("tenantId", "scopeMode");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MembershipBranch_tenantId_fkey') THEN
    ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MembershipBranch_tenantId_membershipId_fkey') THEN
    ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_tenantId_membershipId_fkey"
      FOREIGN KEY ("tenantId", "membershipId") REFERENCES "Membership"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MembershipBranch_tenantId_branchId_fkey') THEN
    ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_tenantId_branchId_fkey"
      FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MembershipBranch_tenantId_assignedById_fkey') THEN
    ALTER TABLE "MembershipBranch" ADD CONSTRAINT "MembershipBranch_tenantId_assignedById_fkey"
      FOREIGN KEY ("tenantId", "assignedById") REFERENCES "Membership"("tenantId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. Backfill existing legacy Membership.branchId into MembershipBranch
-- Preserve legitimate existing authorization: MAIN branches inherit descendants (BRANCH_AND_DESCENDANTS); SUB_BRANCH retains EXACT_BRANCH.
INSERT INTO "MembershipBranch" ("id", "tenantId", "membershipId", "branchId", "scopeMode", "createdAt", "updatedAt")
SELECT 
  'mb_' || m.id, 
  m."tenantId", 
  m.id, 
  m."branchId", 
  CASE 
    WHEN b."branchType" = 'MAIN' THEN 'BRANCH_AND_DESCENDANTS'::"BranchAssignmentScopeMode"
    ELSE 'EXACT_BRANCH'::"BranchAssignmentScopeMode"
  END, 
  NOW(), 
  NOW()
FROM "Membership" m
JOIN "Branch" b ON b."tenantId" = m."tenantId" AND b.id = m."branchId"
WHERE m."branchId" IS NOT NULL
ON CONFLICT ("tenantId", "membershipId", "branchId") DO NOTHING;

-- 6. CreditTransferJournal sourceBranchId and targetBranchId
ALTER TABLE "CreditTransferJournal" ADD COLUMN IF NOT EXISTS "sourceBranchId" TEXT;
ALTER TABLE "CreditTransferJournal" ADD COLUMN IF NOT EXISTS "targetBranchId" TEXT;
CREATE INDEX IF NOT EXISTS "CreditTransferJournal_tenantId_sourceBranchId_idx" ON "CreditTransferJournal"("tenantId", "sourceBranchId");
CREATE INDEX IF NOT EXISTS "CreditTransferJournal_tenantId_targetBranchId_idx" ON "CreditTransferJournal"("tenantId", "targetBranchId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditTransferJournal_tenantId_sourceBranchId_fkey') THEN
    ALTER TABLE "CreditTransferJournal" ADD CONSTRAINT "CreditTransferJournal_tenantId_sourceBranchId_fkey"
      FOREIGN KEY ("tenantId", "sourceBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreditTransferJournal_tenantId_targetBranchId_fkey') THEN
    ALTER TABLE "CreditTransferJournal" ADD CONSTRAINT "CreditTransferJournal_tenantId_targetBranchId_fkey"
      FOREIGN KEY ("tenantId", "targetBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 7. PaymentAllocation branchId
ALTER TABLE "PaymentAllocation" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
CREATE INDEX IF NOT EXISTS "PaymentAllocation_tenantId_branchId_idx" ON "PaymentAllocation"("tenantId", "branchId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentAllocation_tenantId_branchId_fkey') THEN
    ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_branchId_fkey"
      FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 8. FileAsset branchId
ALTER TABLE "FileAsset" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
CREATE INDEX IF NOT EXISTS "FileAsset_tenantId_branchId_idx" ON "FileAsset"("tenantId", "branchId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FileAsset_tenantId_branchId_fkey') THEN
    ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_tenantId_branchId_fkey"
      FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 9. Create BranchReconciliationAudit table
CREATE TABLE IF NOT EXISTS "BranchReconciliationAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "previousBranchId" TEXT,
    "newBranchId" TEXT,
    "reason" TEXT NOT NULL,
    "candidateEvidence" TEXT,
    "reconciledById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchReconciliationAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BranchReconciliationAudit_tenantId_idx" ON "BranchReconciliationAudit"("tenantId");
CREATE INDEX IF NOT EXISTS "BranchReconciliationAudit_tenantId_recordType_recordId_idx" ON "BranchReconciliationAudit"("tenantId", "recordType", "recordId");
CREATE INDEX IF NOT EXISTS "BranchReconciliationAudit_tenantId_newBranchId_idx" ON "BranchReconciliationAudit"("tenantId", "newBranchId");
CREATE INDEX IF NOT EXISTS "BranchReconciliationAudit_tenantId_reconciledById_idx" ON "BranchReconciliationAudit"("tenantId", "reconciledById");
CREATE INDEX IF NOT EXISTS "BranchReconciliationAudit_tenantId_createdAt_idx" ON "BranchReconciliationAudit"("tenantId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BranchReconciliationAudit_tenantId_fkey') THEN
    ALTER TABLE "BranchReconciliationAudit" ADD CONSTRAINT "BranchReconciliationAudit_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BranchReconciliationAudit_tenantId_previousBranchId_fkey') THEN
    ALTER TABLE "BranchReconciliationAudit" ADD CONSTRAINT "BranchReconciliationAudit_tenantId_previousBranchId_fkey"
      FOREIGN KEY ("tenantId", "previousBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BranchReconciliationAudit_tenantId_newBranchId_fkey') THEN
    ALTER TABLE "BranchReconciliationAudit" ADD CONSTRAINT "BranchReconciliationAudit_tenantId_newBranchId_fkey"
      FOREIGN KEY ("tenantId", "newBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BranchReconciliationAudit_tenantId_reconciledById_fkey') THEN
    ALTER TABLE "BranchReconciliationAudit" ADD CONSTRAINT "BranchReconciliationAudit_tenantId_reconciledById_fkey"
      FOREIGN KEY ("tenantId", "reconciledById") REFERENCES "Membership"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
