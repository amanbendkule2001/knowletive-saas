-- ─────────────────────────────────────────────────────────────────────────────
-- Knowletive: Phase 2.3.1 Pre-RLS Hardening Migration
-- Migration: 20261121150000_phase2_3_1_pre_rls_hardening
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Composite Foreign-Key Update Protection (ON DELETE RESTRICT ON UPDATE RESTRICT)
-- Enforces that neither tenantId nor historical financial branchId can be mutated via cascading updates.
-- All financial event references are immutable and strictly protected from cascade.

DO $$
BEGIN
  -- PaymentAllocation -> Branch
  ALTER TABLE "PaymentAllocation" DROP CONSTRAINT IF EXISTS "PaymentAllocation_tenantId_branchId_fkey";
  ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_branchId_fkey"
    FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

  -- CreditTransferJournal -> Branch (Source)
  ALTER TABLE "CreditTransferJournal" DROP CONSTRAINT IF EXISTS "CreditTransferJournal_tenantId_sourceBranchId_fkey";
  ALTER TABLE "CreditTransferJournal" ADD CONSTRAINT "CreditTransferJournal_tenantId_sourceBranchId_fkey"
    FOREIGN KEY ("tenantId", "sourceBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

  -- CreditTransferJournal -> Branch (Target)
  ALTER TABLE "CreditTransferJournal" DROP CONSTRAINT IF EXISTS "CreditTransferJournal_tenantId_targetBranchId_fkey";
  ALTER TABLE "CreditTransferJournal" ADD CONSTRAINT "CreditTransferJournal_tenantId_targetBranchId_fkey"
    FOREIGN KEY ("tenantId", "targetBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

  -- BranchReconciliationAudit -> Branch (Previous)
  ALTER TABLE "BranchReconciliationAudit" DROP CONSTRAINT IF EXISTS "BranchReconciliationAudit_tenantId_previousBranchId_fkey";
  ALTER TABLE "BranchReconciliationAudit" ADD CONSTRAINT "BranchReconciliationAudit_tenantId_previousBranchId_fkey"
    FOREIGN KEY ("tenantId", "previousBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

  -- BranchReconciliationAudit -> Branch (New)
  ALTER TABLE "BranchReconciliationAudit" DROP CONSTRAINT IF EXISTS "BranchReconciliationAudit_tenantId_newBranchId_fkey";
  ALTER TABLE "BranchReconciliationAudit" ADD CONSTRAINT "BranchReconciliationAudit_tenantId_newBranchId_fkey"
    FOREIGN KEY ("tenantId", "newBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

  -- Branch -> Branch (Parent hierarchy)
  ALTER TABLE "Branch" DROP CONSTRAINT IF EXISTS "Branch_tenantId_parentBranchId_fkey";
  ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_parentBranchId_fkey"
    FOREIGN KEY ("tenantId", "parentBranchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

  -- PaymentReceipt -> Branch
  ALTER TABLE "PaymentReceipt" DROP CONSTRAINT IF EXISTS "PaymentReceipt_branchId_fkey";
  ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

  -- FeePayment -> Branch
  ALTER TABLE "FeePayment" DROP CONSTRAINT IF EXISTS "FeePayment_branchId_fkey";
  ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

  -- PaymentCollectorRoute -> Branch
  ALTER TABLE "PaymentCollectorRoute" DROP CONSTRAINT IF EXISTS "PaymentCollectorRoute_tenantId_branchId_fkey";
  ALTER TABLE "PaymentCollectorRoute" ADD CONSTRAINT "PaymentCollectorRoute_tenantId_branchId_fkey"
    FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
END $$;

-- 2. View Security: Enforce SECURITY INVOKER on Effective Attribution Views
-- Ensures that when Row-Level Security (RLS) is introduced, view queries execute in the context of the calling role
-- and strictly obey the caller's RLS policies on the underlying tables, preventing privilege escalation.

ALTER VIEW public."v_effective_fee_payment" SET (security_invoker = true);
ALTER VIEW public."v_effective_payment_receipt" SET (security_invoker = true);
ALTER VIEW public."v_effective_payment_allocation" SET (security_invoker = true);

-- 3. Function Hardening: Fixed search_path and execution privilege control
ALTER FUNCTION public.fn_get_effective_branch_id(text, text, text, text) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.fn_get_effective_branch_id(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_effective_branch_id(text, text, text, text) TO knowletive;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowletive_app') THEN
    GRANT EXECUTE ON FUNCTION public.fn_get_effective_branch_id(text, text, text, text) TO knowletive_app;
  END IF;
END $$;

-- 4. Authoritative Disambiguation: Quarantine routes with ambiguous multiple provider configurations
-- If a branch matches more than one distinct active PaymentProviderConfig, it cannot be safely mapped automatically.
-- It must be quarantined with status = 'AMBIGUOUS_MULTIPLE_CONFIGS' and isActive = false.

UPDATE "PaymentCollectorRoute" pcr
SET
  "provider" = 'UNVERIFIED',
  "environment" = 'UNVERIFIED',
  "merchantId" = NULL,
  "isActive" = false,
  "metadata" = jsonb_build_object(
    'quarantinedAt', NOW(),
    'source', 'PaymentProviderConfig',
    'status', 'AMBIGUOUS_MULTIPLE_CONFIGS',
    'reason', 'Multiple conflicting PaymentProviderConfig rows found for this branch/collector code.'
  )
WHERE pcr."branchId" IN (
  SELECT b."id"
  FROM "Branch" b
  JOIN "PaymentProviderConfig" ppc
    ON ppc."tenantId" = b."tenantId"
   AND (ppc."branchId" = b."id" OR (ppc."branchId" IS NULL AND ppc."collectorCode" = b."collectorCode"))
  GROUP BY b."id"
  HAVING COUNT(DISTINCT ppc."id") > 1
);
