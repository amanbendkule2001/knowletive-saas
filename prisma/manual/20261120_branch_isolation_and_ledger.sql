-- ─────────────────────────────────────────────────────────────────────────────
-- Knowletive: Branch Isolation, Two-Track Ledger & Immutability Hardening
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Partial Unique Index on non-null collectorCode per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_tenant_collector 
ON "Branch" ("tenantId", "collectorCode") 
WHERE "collectorCode" IS NOT NULL;

-- 2. Immutability Protection for BranchLedgerEntry (Append-Only Financial Ledger)
CREATE OR REPLACE FUNCTION fn_protect_branch_ledger_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'BranchLedgerEntry records are immutable financial ledger entries and cannot be updated, deleted, or truncated (id: %, branchId: %, entryType: %)',
    OLD.id, OLD."branchId", OLD."entryType"
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_branch_ledger_protect ON "BranchLedgerEntry";
CREATE TRIGGER trg_branch_ledger_protect
BEFORE UPDATE OR DELETE ON "BranchLedgerEntry"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_branch_ledger_immutability();

DROP TRIGGER IF EXISTS trg_branch_ledger_truncate ON "BranchLedgerEntry";
CREATE TRIGGER trg_branch_ledger_truncate
BEFORE TRUNCATE ON "BranchLedgerEntry"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_protect_branch_ledger_immutability();

-- 3. Branch Payout Lifecycle Guard
CREATE OR REPLACE FUNCTION fn_enforce_branch_payout_lifecycle()
RETURNS TRIGGER AS $$
BEGIN
  -- Disallow mutating tenantId, branchId, payoutNumber, or amount once created
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR
     NEW."branchId" IS DISTINCT FROM OLD."branchId" OR
     NEW."payoutNumber" IS DISTINCT FROM OLD."payoutNumber" OR
     NEW."amount" IS DISTINCT FROM OLD."amount" THEN
    RAISE EXCEPTION 'Core payout immutable fields (tenantId, branchId, payoutNumber, amount) cannot be altered (id: %)', OLD.id
      USING ERRCODE = 'P0002';
  END IF;

  -- Disallow status regression once PAID, REJECTED, or FAILED
  IF OLD."status" IN ('PAID', 'REJECTED', 'FAILED') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'Branch payout in terminal status % cannot be transitioned to % (id: %)',
      OLD."status", NEW."status", OLD.id
      USING ERRCODE = 'P0003';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_branch_payout_lifecycle ON "BranchPayout";
CREATE TRIGGER trg_branch_payout_lifecycle
BEFORE UPDATE ON "BranchPayout"
FOR EACH ROW
EXECUTE FUNCTION fn_enforce_branch_payout_lifecycle();

-- 4. Row-Level Security (RLS) Defense-in-Depth Policies
-- App role setup (NOBYPASSRLS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowletive_app') THEN
    CREATE ROLE knowletive_app WITH LOGIN NOBYPASSRLS;
  END IF;
END $$;

ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BranchLedgerEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BranchPayout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeeInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeePayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentReceipt" ENABLE ROW LEVEL SECURITY;

-- Allow superuser/owner and apply tenant context check when app.current_tenant_id is set
DROP POLICY IF EXISTS tenant_isolation_branch ON "Branch";
CREATE POLICY tenant_isolation_branch ON "Branch"
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR "tenantId" = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS tenant_isolation_branch_ledger ON "BranchLedgerEntry";
CREATE POLICY tenant_isolation_branch_ledger ON "BranchLedgerEntry"
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR "tenantId" = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS tenant_isolation_branch_payout ON "BranchPayout";
CREATE POLICY tenant_isolation_branch_payout ON "BranchPayout"
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR "tenantId" = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS tenant_isolation_fee_invoice ON "FeeInvoice";
CREATE POLICY tenant_isolation_fee_invoice ON "FeeInvoice"
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR "tenantId" = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS tenant_isolation_fee_payment ON "FeePayment";
CREATE POLICY tenant_isolation_fee_payment ON "FeePayment"
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR "tenantId" = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS tenant_isolation_payment_receipt ON "PaymentReceipt";
CREATE POLICY tenant_isolation_payment_receipt ON "PaymentReceipt"
  FOR ALL
  USING (
    NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL
    OR "tenantId" = current_setting('app.current_tenant_id', true)
  );
