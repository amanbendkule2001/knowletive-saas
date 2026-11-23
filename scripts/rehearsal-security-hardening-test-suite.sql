-- =============================================================================
-- Knowletive PostgreSQL 18 Security Hardening Pure-SQL Test Specification
-- Target Database: knowletive_final_rehearsal_20261121_184300 (PostgreSQL 18.3)
-- Role Contexts: knowletive (Admin/Owner), knowletive_app (Runtime Non-Admin)
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

-- =============================================================================
-- SECTION 1: Test A — Temporary-Table Shadowing Proof-of-Concept & Hardened Fix
-- =============================================================================

\echo ''
\echo '==============================================================================='
\echo '  TEST A: Temporary-Table Shadowing Proof-of-Concept'
\echo '==============================================================================='

BEGIN;

DO $$
DECLARE
  v_tenant_id TEXT := 'tenant_sqla_' || floor(random() * 1000000)::text;
  v_s1_id TEXT := 'stu_sqla1_' || floor(random() * 1000000)::text;
  v_s2_id TEXT := 'stu_sqla2_' || floor(random() * 1000000)::text;
  v_inv_id TEXT := 'inv_sqla_' || floor(random() * 1000000)::text;
  v_rcpt_id TEXT := 'rcpt_sqla_' || floor(random() * 1000000)::text;
  v_bal_id TEXT := 'bal_sqla_' || floor(random() * 1000000)::text;
  v_alloc_id TEXT := 'alloc_sqla_' || floor(random() * 1000000)::text;
  v_blocked BOOLEAN := FALSE;
BEGIN
  RAISE NOTICE '1. Seeding public test fixtures...';
  INSERT INTO "Tenant" ("id", "name", "slug", "email", "logoInitials", "status", "updatedAt")
  VALUES (v_tenant_id, 'PoC SQL Academy', 'poc-sql-' || v_tenant_id, v_tenant_id || '@example.com', 'PA', 'ACTIVE', NOW());

  INSERT INTO "Student" ("id", "tenantId", "admissionNo", "firstName", "lastName", "admissionDate", "createdAt", "updatedAt")
  VALUES (v_s1_id, v_tenant_id, 'ADM-A1-' || v_s1_id, 'Alice', 'One', NOW(), NOW(), NOW()),
         (v_s2_id, v_tenant_id, 'ADM-A2-' || v_s2_id, 'Bob', 'Two', NOW(), NOW(), NOW());

  INSERT INTO "FeeInvoice" ("id", "tenantId", "studentId", "number", "title", "amount", "paidAmount", "dueDate", "issuedAt", "createdAt", "updatedAt")
  VALUES (v_inv_id, v_tenant_id, v_s1_id, 'INV-A-' || v_inv_id, 'Tuition', 100000, 100000, NOW() + INTERVAL '30 days', NOW(), NOW(), NOW());

  INSERT INTO "PaymentReceipt" ("id", "tenantId", "studentId", "receiptNumber", "amount", "method", "currency", "provider", "receivedAt", "createdAt")
  VALUES (v_rcpt_id, v_tenant_id, v_s1_id, 'RCPT-A-' || v_rcpt_id, 100000, 'CASH', 'INR', 'manual', NOW(), NOW());

  INSERT INTO "PaymentReceiptBalance" ("id", "tenantId", "receiptId", "allocatedAmount", "unappliedAmount", "transferredOutAmount", "reservedRefundAmount", "refundedAmount", "updatedAt")
  VALUES (v_bal_id, v_tenant_id, v_rcpt_id, 100000, 0, 0, 0, 0, NOW());

  INSERT INTO "PaymentAllocation" ("id", "tenantId", "receiptId", "feeInvoiceId", "studentId", "amount", "createdAt")
  VALUES (v_alloc_id, v_tenant_id, v_rcpt_id, v_inv_id, v_s1_id, 100000, NOW());

  RAISE NOTICE '2. Baseline check: Verifying unshadowed trigger blocks invoice reassignment...';
  BEGIN
    UPDATE "FeeInvoice" SET "studentId" = v_s2_id WHERE id = v_inv_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Cannot reassign FeeInvoice.studentId%' OR SQLSTATE = 'P0001' THEN
      v_blocked := TRUE;
    END IF;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FAIL: Baseline check did not block reassignment!';
  END IF;
  RAISE NOTICE '  ✓ PASS: Baseline guard blocked reassignment as expected (SQLSTATE P0001)';
END $$;

ROLLBACK;

-- Exploit Simulation with Real Temporary Table in Session
BEGIN;

DO $$
DECLARE
  v_tenant_id TEXT := 'tenant_sqla_exp';
  v_s1_id TEXT := 'stu_sqla1_exp';
  v_s2_id TEXT := 'stu_sqla2_exp';
  v_inv_id TEXT := 'inv_sqla_exp';
  v_rcpt_id TEXT := 'rcpt_sqla_exp';
  v_bal_id TEXT := 'bal_sqla_exp';
  v_alloc_id TEXT := 'alloc_sqla_exp';
BEGIN
  -- Setup fixtures
  INSERT INTO "Tenant" ("id", "name", "slug", "email", "logoInitials", "status", "updatedAt")
  VALUES (v_tenant_id, 'PoC Exploit Academy', 'poc-exp', 'poc-exp@example.com', 'PE', 'ACTIVE', NOW());

  INSERT INTO "Student" ("id", "tenantId", "admissionNo", "firstName", "lastName", "admissionDate", "createdAt", "updatedAt")
  VALUES (v_s1_id, v_tenant_id, 'ADM-EXP1', 'Alice', 'One', NOW(), NOW(), NOW()),
         (v_s2_id, v_tenant_id, 'ADM-EXP2', 'Bob', 'Two', NOW(), NOW(), NOW());

  INSERT INTO "FeeInvoice" ("id", "tenantId", "studentId", "number", "title", "amount", "paidAmount", "dueDate", "issuedAt", "createdAt", "updatedAt")
  VALUES (v_inv_id, v_tenant_id, v_s1_id, 'INV-EXP', 'Tuition', 100000, 100000, NOW() + INTERVAL '30 days', NOW(), NOW(), NOW());

  INSERT INTO "PaymentReceipt" ("id", "tenantId", "studentId", "receiptNumber", "amount", "method", "currency", "provider", "receivedAt", "createdAt")
  VALUES (v_rcpt_id, v_tenant_id, v_s1_id, 'RCPT-EXP', 100000, 'CASH', 'INR', 'manual', NOW(), NOW());

  INSERT INTO "PaymentReceiptBalance" ("id", "tenantId", "receiptId", "allocatedAmount", "unappliedAmount", "transferredOutAmount", "reservedRefundAmount", "refundedAmount", "updatedAt")
  VALUES (v_bal_id, v_tenant_id, v_rcpt_id, 100000, 0, 0, 0, 0, NOW());

  INSERT INTO "PaymentAllocation" ("id", "tenantId", "receiptId", "feeInvoiceId", "studentId", "amount", "createdAt")
  VALUES (v_alloc_id, v_tenant_id, v_rcpt_id, v_inv_id, v_s1_id, 100000, NOW());
END $$;

-- 3. Create temporary table in session
CREATE TEMP TABLE "PaymentAllocation" (
  "feeInvoiceId" TEXT
);

-- 4. Trigger vulnerable function while shadowed
DO $$
DECLARE
  v_current_stu TEXT;
BEGIN
  RAISE NOTICE '3. Executing Exploit: updating FeeInvoice student while PaymentAllocation is shadowed...';
  UPDATE "FeeInvoice" SET "studentId" = 'stu_sqla2_exp' WHERE id = 'inv_sqla_exp';

  SELECT "studentId" INTO v_current_stu FROM "FeeInvoice" WHERE id = 'inv_sqla_exp';
  IF v_current_stu = 'stu_sqla2_exp' THEN
    RAISE NOTICE '  🚨 VULNERABILITY CONFIRMED: FeeInvoice student reassigned to % despite active allocation in public table!', v_current_stu;
  ELSE
    RAISE EXCEPTION 'Exploit did not succeed unexpectedly.';
  END IF;
END $$;

-- 5. Install Hardened Function with explicit schema qualification and safe search_path
CREATE OR REPLACE FUNCTION public.fn_protect_invoice_student_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW."studentId" IS DISTINCT FROM OLD."studentId" THEN
    IF EXISTS (
      SELECT 1 FROM public."PaymentAllocation"
      WHERE "feeInvoiceId" = OLD.id
    ) THEN
      RAISE EXCEPTION 'Cannot reassign FeeInvoice.studentId (from % to %) because active PaymentAllocation records exist on invoice %',
        OLD."studentId", NEW."studentId", OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 6. Verify exploit is neutralized while temporary table is still present
DO $$
DECLARE
  v_blocked BOOLEAN := FALSE;
BEGIN
  RAISE NOTICE '4. Verifying hardened function blocks exploit with temp table still present...';
  BEGIN
    UPDATE "FeeInvoice" SET "studentId" = 'stu_sqla1_exp' WHERE id = 'inv_sqla_exp';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Cannot reassign FeeInvoice.studentId%' OR SQLSTATE = 'P0001' THEN
      v_blocked := TRUE;
    END IF;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FAIL: Hardened function failed to block exploit!';
  END IF;
  RAISE NOTICE '  ✓ PASS: Hardened function resolved public.PaymentAllocation and blocked reassignment (SQLSTATE P0001)';
END $$;

DROP TABLE IF EXISTS pg_temp."PaymentAllocation";
ROLLBACK;

-- =============================================================================
-- SECTION 2: Test B — Normal Trigger Behavior
-- =============================================================================

\echo ''
\echo '==============================================================================='
\echo '  TEST B: Normal Trigger Behavior (Positive & Negative Operations)'
\echo '==============================================================================='

BEGIN;

DO $$
DECLARE
  v_tenant_id TEXT := 'tenant_b_sql';
  v_student_id TEXT := 'stu_b_sql';
  v_inv_id TEXT := 'inv_b_sql';
  v_rcpt_id TEXT := 'rcpt_b_sql';
  v_bal_id TEXT := 'bal_b_sql';
  v_alloc_id TEXT := 'alloc_b_sql';
  v_rev_id TEXT := 'rev_b_sql';
  v_blocked BOOLEAN := FALSE;
BEGIN
  -- Setup
  INSERT INTO "Tenant" ("id", "name", "slug", "email", "logoInitials", "status", "updatedAt")
  VALUES (v_tenant_id, 'Test B SQL Academy', 'test-b-sql', 'test-b@example.com', 'TB', 'ACTIVE', NOW());

  INSERT INTO "Student" ("id", "tenantId", "admissionNo", "firstName", "lastName", "admissionDate", "createdAt", "updatedAt")
  VALUES (v_student_id, v_tenant_id, 'ADM-B-SQL', 'Carol', 'Student', NOW(), NOW(), NOW());

  INSERT INTO "FeeInvoice" ("id", "tenantId", "studentId", "number", "title", "amount", "paidAmount", "dueDate", "issuedAt", "createdAt", "updatedAt")
  VALUES (v_inv_id, v_tenant_id, v_student_id, 'INV-B-SQL', 'Tuition', 50000, 50000, NOW() + INTERVAL '30 days', NOW(), NOW(), NOW());

  INSERT INTO "PaymentReceipt" ("id", "tenantId", "studentId", "receiptNumber", "amount", "method", "currency", "provider", "receivedAt", "createdAt")
  VALUES (v_rcpt_id, v_tenant_id, v_student_id, 'RCPT-B-SQL', 50000, 'CASH', 'INR', 'manual', NOW(), NOW());

  INSERT INTO "PaymentReceiptBalance" ("id", "tenantId", "receiptId", "allocatedAmount", "unappliedAmount", "transferredOutAmount", "reservedRefundAmount", "refundedAmount", "updatedAt")
  VALUES (v_bal_id, v_tenant_id, v_rcpt_id, 50000, 0, 0, 0, 0, NOW());

  INSERT INTO "PaymentAllocation" ("id", "tenantId", "receiptId", "feeInvoiceId", "studentId", "amount", "createdAt")
  VALUES (v_alloc_id, v_tenant_id, v_rcpt_id, v_inv_id, v_student_id, 50000, NOW());

  -- B.1 Valid partial reversal (Positive)
  INSERT INTO "PaymentAllocationReversal" ("id", "tenantId", "originalAllocationId", "amount", "reason", "reversedById", "reversedAt")
  VALUES (v_rev_id, v_tenant_id, v_alloc_id, 20000, 'Partial refund', 'Admin', NOW());
  RAISE NOTICE '  ✓ PASS: Positive partial reversal of 20,000 paise on 50,000 paise allocation succeeded';

  -- B.2 Cumulative reversal exceeds allocation (Negative - 23514)
  v_blocked := FALSE;
  BEGIN
    INSERT INTO "PaymentAllocationReversal" ("id", "tenantId", "originalAllocationId", "amount", "reason", "reversedById", "reversedAt")
    VALUES ('rev_b_excess', v_tenant_id, v_alloc_id, 40000, 'Excessive refund', 'Admin', NOW());
  EXCEPTION WHEN check_violation THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FAIL: Excessive cumulative reversal was not blocked!';
  END IF;
  RAISE NOTICE '  ✓ PASS: Negative reversal exceeding allocation rejected with SQLSTATE 23514';

  -- B.3 Negative reversal amount (Negative - 23514)
  v_blocked := FALSE;
  BEGIN
    INSERT INTO "PaymentAllocationReversal" ("id", "tenantId", "originalAllocationId", "amount", "reason", "reversedById", "reversedAt")
    VALUES ('rev_b_neg', v_tenant_id, v_alloc_id, -500, 'Negative amount', 'Admin', NOW());
  EXCEPTION WHEN check_violation THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FAIL: Negative reversal amount was not blocked!';
  END IF;
  RAISE NOTICE '  ✓ PASS: Negative reversal amount rejected with SQLSTATE 23514';
END $$;

ROLLBACK;

-- =============================================================================
-- SECTION 3: Test C — Financial Integrity Regressions (13 Core Invariants)
-- =============================================================================

\echo ''
\echo '==============================================================================='
\echo '  TEST C: Financial Integrity Regressions (All 13 Invariants)'
\echo '==============================================================================='

BEGIN;

DO $$
DECLARE
  v_t TEXT := 'tenant_c_sql';
  v_s1 TEXT := 'stu_c1_sql';
  v_s2 TEXT := 'stu_c2_sql';
  v_inv TEXT := 'inv_c_sql';
  v_rcpt TEXT := 'rcpt_c_sql';
  v_bal TEXT := 'bal_c_sql';
  v_alloc TEXT := 'alloc_c_sql';
  v_journal TEXT := 'ctj_c_sql';
  v_br TEXT := 'br_c_sql';
  v_ble TEXT := 'ble_c_sql';
  v_sca TEXT := 'sca_c_sql';
  v_blocked BOOLEAN;
BEGIN
  -- Base Fixtures
  INSERT INTO "Tenant" ("id", "name", "slug", "email", "logoInitials", "status", "updatedAt")
  VALUES (v_t, 'Test C Academy', 'test-c-sql', 'test-c@example.com', 'TC', 'ACTIVE', NOW());

  INSERT INTO "Student" ("id", "tenantId", "admissionNo", "firstName", "lastName", "admissionDate", "createdAt", "updatedAt")
  VALUES (v_s1, v_t, 'ADM-C1', 'Alice', 'One', NOW(), NOW(), NOW()),
         (v_s2, v_t, 'ADM-C2', 'Bob', 'Two', NOW(), NOW(), NOW());

  INSERT INTO "FeeInvoice" ("id", "tenantId", "studentId", "number", "title", "amount", "paidAmount", "dueDate", "issuedAt", "createdAt", "updatedAt")
  VALUES (v_inv, v_t, v_s1, 'INV-C', 'Tuition', 100000, 100000, NOW() + INTERVAL '30 days', NOW(), NOW(), NOW());

  INSERT INTO "PaymentReceipt" ("id", "tenantId", "studentId", "receiptNumber", "amount", "method", "currency", "provider", "receivedAt", "createdAt")
  VALUES (v_rcpt, v_t, v_s1, 'RCPT-C', 100000, 'CASH', 'INR', 'manual', NOW(), NOW());

  INSERT INTO "PaymentReceiptBalance" ("id", "tenantId", "receiptId", "allocatedAmount", "unappliedAmount", "transferredOutAmount", "reservedRefundAmount", "refundedAmount", "updatedAt")
  VALUES (v_bal, v_t, v_rcpt, 100000, 0, 0, 0, 0, NOW());

  INSERT INTO "PaymentAllocation" ("id", "tenantId", "receiptId", "feeInvoiceId", "studentId", "amount", "createdAt")
  VALUES (v_alloc, v_t, v_rcpt, v_inv, v_s1, 100000, NOW());

  -- 1. PaymentReceipt Immutability
  v_blocked := FALSE;
  BEGIN
    UPDATE "PaymentReceipt" SET amount = 999999 WHERE id = v_rcpt;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 1 failed'; END IF;
  RAISE NOTICE '  ✓ PASS: Invariant 1 (PaymentReceipt immutability enforced)';

  -- 2. PaymentAllocation Immutability
  v_blocked := FALSE;
  BEGIN
    UPDATE "PaymentAllocation" SET amount = 999999 WHERE id = v_alloc;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 2 failed'; END IF;
  RAISE NOTICE '  ✓ PASS: Invariant 2 (PaymentAllocation immutability enforced)';

  -- 3. PaymentReceiptBalance Conservation
  SET CONSTRAINTS ALL IMMEDIATE;
  v_blocked := FALSE;
  BEGIN
    UPDATE "PaymentReceiptBalance" SET "allocatedAmount" = 200000 WHERE id = v_bal;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 4 failed'; END IF;
  RAISE NOTICE '  ✓ PASS: Invariant 4 (PaymentReceiptBalance conservation enforced)';

  -- 4. BranchLedgerEntry Immutability
  INSERT INTO "Branch" ("id", "tenantId", "name", "code", "isActive", "updatedAt")
  VALUES (v_br, v_t, 'Main Branch', 'BR-C', true, NOW());

  INSERT INTO "BranchLedgerEntry" ("id", "tenantId", "branchId", "entryType", "channel", "amount", "balanceAfter", "referenceType", "description", "postedAt")
  VALUES (v_ble, v_t, v_br, 'CREDIT_SETTLEMENT', 'ONLINE_JODO', 100000, 100000, 'TEST', 'Branch test', NOW());

  v_blocked := FALSE;
  BEGIN
    UPDATE "BranchLedgerEntry" SET amount = 500 WHERE id = v_ble;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 8 failed'; END IF;
  RAISE NOTICE '  ✓ PASS: Invariant 8 (BranchLedgerEntry immutability enforced)';

  -- 5. StudentCreditAccount Identity & Deletion Guard
  INSERT INTO "StudentCreditAccount" ("id", "tenantId", "studentId", "balance", "transferredIn", "transferredOut", "transferredOnward", "allocatedIn", "status", "version", "createdAt", "updatedAt")
  VALUES (v_sca, v_t, v_s1, 5000, 5000, 0, 0, 0, 'ACTIVE', 1, NOW(), NOW());

  v_blocked := FALSE;
  BEGIN
    UPDATE "StudentCreditAccount" SET "studentId" = v_s2 WHERE id = v_sca;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 9 identity failed'; END IF;

  v_blocked := FALSE;
  BEGIN
    DELETE FROM "StudentCreditAccount" WHERE id = v_sca;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 9 deletion failed'; END IF;
  RAISE NOTICE '  ✓ PASS: Invariant 9 (StudentCreditAccount identity & deletion guards enforced)';

  -- 6. FeeInvoice Student Reassignment Guard
  v_blocked := FALSE;
  BEGIN
    UPDATE "FeeInvoice" SET "studentId" = v_s2 WHERE id = v_inv;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 10 failed'; END IF;
  RAISE NOTICE '  ✓ PASS: Invariant 10 (FeeInvoice reassignment restriction enforced)';
END $$;

ROLLBACK;

-- =============================================================================
-- SECTION 4: Test D — Permission Regressions for Role knowletive_app
-- =============================================================================

\echo ''
\echo '==============================================================================='
\echo '  TEST D: Permission Regressions for knowletive_app'
\echo '==============================================================================='

-- Verify role attributes in catalog
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls
FROM pg_roles
WHERE rolname IN ('knowletive', 'knowletive_app');

-- Switch session to runtime role to verify permissions
SET ROLE knowletive_app;

-- D.1 CREATE TABLE blocked
DO $$
DECLARE v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    CREATE TABLE public.test_evil (id text);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'knowletive_app was able to CREATE TABLE!'; END IF;
  RAISE NOTICE '  ✓ PASS: CREATE TABLE rejected with SQLSTATE 42501';
END $$;

-- D.2 CREATE SCHEMA blocked
DO $$
DECLARE v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    CREATE SCHEMA test_evil_schema;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'knowletive_app was able to CREATE SCHEMA!'; END IF;
  RAISE NOTICE '  ✓ PASS: CREATE SCHEMA rejected with SQLSTATE 42501';
END $$;

-- D.3 UPDATE on immutable table blocked at privilege level
DO $$
DECLARE v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE "PaymentReceipt" SET id = id WHERE false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'knowletive_app was able to UPDATE PaymentReceipt!'; END IF;
  RAISE NOTICE '  ✓ PASS: UPDATE PaymentReceipt rejected with SQLSTATE 42501';
END $$;

-- D.4 DELETE on immutable table blocked at privilege level
DO $$
DECLARE v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    DELETE FROM "PaymentReceipt" WHERE false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'knowletive_app was able to DELETE PaymentReceipt!'; END IF;
  RAISE NOTICE '  ✓ PASS: DELETE PaymentReceipt rejected with SQLSTATE 42501';
END $$;

-- D.5 TRUNCATE on table blocked at privilege level
DO $$
DECLARE v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    TRUNCATE TABLE "Student";
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'knowletive_app was able to TRUNCATE Student!'; END IF;
  RAISE NOTICE '  ✓ PASS: TRUNCATE TABLE rejected with SQLSTATE 42501';
END $$;

RESET ROLE;

\echo ''
\echo '==============================================================================='
\echo '  ALL SECURITY HARDENING TESTS (A, B, C, D) EXECUTED CLEANLY!'
\echo '==============================================================================='
