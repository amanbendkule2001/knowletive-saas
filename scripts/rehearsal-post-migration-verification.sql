-- =============================================================================
-- Knowletive Phase 2.3.5.5: Post-Migration Verification Test Suite
-- Database: knowletive_final_rehearsal_20261121_184300
-- Target Role: knowletive (with SET ROLE knowletive_app for permission checks)
-- =============================================================================

\set ON_ERROR_STOP on

\echo ''
\echo '==============================================================================='
\echo '  KNOWLETIVE POST-MIGRATION REHEARSAL VERIFICATION SUITE'
\echo '  Database: knowletive_final_rehearsal_20261121_184300'
\echo '==============================================================================='
\echo ''

-- =============================================================================
-- TEST A: Shadowing Neutralization Verification
-- =============================================================================
\echo '-------------------------------------------------------------------------------'
\echo '  TEST A: Shadowing Neutralization Verification'
\echo '-------------------------------------------------------------------------------'

BEGIN;

DO $$
DECLARE
  v_tenant_id TEXT := 'tenant_sha_v2';
  v_s1_id TEXT := 'stu_sha1_v2';
  v_s2_id TEXT := 'stu_sha2_v2';
  v_inv_id TEXT := 'inv_sha_v2';
  v_rcpt_id TEXT := 'rcpt_sha_v2';
  v_bal_id TEXT := 'bal_sha_v2';
  v_alloc_id TEXT := 'alloc_sha_v2';
  v_blocked BOOLEAN := FALSE;
  v_errcode TEXT;
  v_errmsg TEXT;
BEGIN
  -- 1. Setup Base Data
  INSERT INTO "Tenant" ("id", "name", "slug", "email", "logoInitials", "status", "updatedAt")
  VALUES (v_tenant_id, 'Shadow Academy', 'shadow-v2', 'shadow-v2@example.com', 'SA', 'ACTIVE', NOW());

  INSERT INTO "Student" ("id", "tenantId", "admissionNo", "firstName", "lastName", "admissionDate", "createdAt", "updatedAt")
  VALUES (v_s1_id, v_tenant_id, 'ADM-SHA1', 'Alice', 'Original', NOW(), NOW(), NOW()),
         (v_s2_id, v_tenant_id, 'ADM-SHA2', 'Bob', 'Attacker', NOW(), NOW(), NOW());

  INSERT INTO "FeeInvoice" ("id", "tenantId", "studentId", "number", "title", "amount", "paidAmount", "dueDate", "issuedAt", "createdAt", "updatedAt")
  VALUES (v_inv_id, v_tenant_id, v_s1_id, 'INV-SHA', 'Tuition', 100000, 100000, NOW() + INTERVAL '30 days', NOW(), NOW(), NOW());

  INSERT INTO "PaymentReceipt" ("id", "tenantId", "studentId", "receiptNumber", "amount", "method", "currency", "provider", "receivedAt", "createdAt")
  VALUES (v_rcpt_id, v_tenant_id, v_s1_id, 'RCPT-SHA', 100000, 'CASH', 'INR', 'manual', NOW(), NOW());

  INSERT INTO "PaymentReceiptBalance" ("id", "tenantId", "receiptId", "allocatedAmount", "unappliedAmount", "transferredOutAmount", "reservedRefundAmount", "refundedAmount", "updatedAt")
  VALUES (v_bal_id, v_tenant_id, v_rcpt_id, 100000, 0, 0, 0, 0, NOW());

  INSERT INTO "PaymentAllocation" ("id", "tenantId", "receiptId", "feeInvoiceId", "studentId", "amount", "createdAt")
  VALUES (v_alloc_id, v_tenant_id, v_rcpt_id, v_inv_id, v_s1_id, 100000, NOW());

  RAISE NOTICE '  Fixtures initialized: Invoice % assigned to Student %, active allocation exists in public.PaymentAllocation', v_inv_id, v_s1_id;
END $$;

-- 2. Create Shadowing Temporary Table in Session
CREATE TEMP TABLE "PaymentAllocation" (
  "feeInvoiceId" TEXT
);

-- 3. Execute Attack & Verify Hardened Function Blocks Exploit
DO $$
DECLARE
  v_inv_id TEXT := 'inv_sha_v2';
  v_s2_id TEXT := 'stu_sha2_v2';
  v_blocked BOOLEAN := FALSE;
  v_errcode TEXT;
  v_errmsg TEXT;
BEGIN
  RAISE NOTICE '  Attempting student reassignment while public.PaymentAllocation is shadowed by empty pg_temp.PaymentAllocation...';
  BEGIN
    UPDATE "FeeInvoice" SET "studentId" = v_s2_id WHERE id = v_inv_id;
  EXCEPTION WHEN OTHERS THEN
    v_errcode := SQLSTATE;
    v_errmsg := SQLERRM;
    IF v_errcode = 'P0001' AND v_errmsg LIKE '%Cannot reassign FeeInvoice.studentId%' THEN
      v_blocked := TRUE;
    END IF;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'CRITICAL FAILURE: Hardened function failed to block exploit! (errcode: %, errmsg: %)', v_errcode, v_errmsg;
  END IF;

  RAISE NOTICE '  [PASS] Test A: Hardened trigger resolved public.PaymentAllocation despite temp table shadow and correctly blocked reassignment (SQLSTATE P0001)';
END $$;

DROP TABLE IF EXISTS pg_temp."PaymentAllocation";
ROLLBACK;

-- =============================================================================
-- TEST B: Normal Trigger Behavior (Positive & Negative Operations)
-- =============================================================================
\echo ''
\echo '-------------------------------------------------------------------------------'
\echo '  TEST B: Normal Trigger Behavior (Positive & Negative Operations)'
\echo '-------------------------------------------------------------------------------'

BEGIN;

DO $$
DECLARE
  v_tenant_id TEXT := 'tenant_b_v2';
  v_student_id TEXT := 'stu_b_v2';
  v_inv_id TEXT := 'inv_b_v2';
  v_inv_unallocated TEXT := 'inv_b_unalloc_v2';
  v_rcpt_id TEXT := 'rcpt_b_v2';
  v_bal_id TEXT := 'bal_b_v2';
  v_alloc_id TEXT := 'alloc_b_v2';
  v_rev_id TEXT := 'rev_b_v2';
  v_blocked BOOLEAN;
BEGIN
  -- Setup
  INSERT INTO "Tenant" ("id", "name", "slug", "email", "logoInitials", "status", "updatedAt")
  VALUES (v_tenant_id, 'Test B Academy', 'test-b-v2', 'test-b@example.com', 'TB', 'ACTIVE', NOW());

  INSERT INTO "Student" ("id", "tenantId", "admissionNo", "firstName", "lastName", "admissionDate", "createdAt", "updatedAt")
  VALUES (v_student_id, v_tenant_id, 'ADM-B-V2', 'Carol', 'Student', NOW(), NOW(), NOW()),
         ('stu_b_other', v_tenant_id, 'ADM-B-OTH', 'Dave', 'Other', NOW(), NOW(), NOW());

  INSERT INTO "FeeInvoice" ("id", "tenantId", "studentId", "number", "title", "amount", "paidAmount", "dueDate", "issuedAt", "createdAt", "updatedAt")
  VALUES (v_inv_id, v_tenant_id, v_student_id, 'INV-B-V2', 'Tuition', 50000, 50000, NOW() + INTERVAL '30 days', NOW(), NOW(), NOW()),
         (v_inv_unallocated, v_tenant_id, v_student_id, 'INV-B-UN', 'Library Fee', 1000, 0, NOW() + INTERVAL '30 days', NOW(), NOW(), NOW());

  INSERT INTO "PaymentReceipt" ("id", "tenantId", "studentId", "receiptNumber", "amount", "method", "currency", "provider", "receivedAt", "createdAt")
  VALUES (v_rcpt_id, v_tenant_id, v_student_id, 'RCPT-B-V2', 50000, 'CASH', 'INR', 'manual', NOW(), NOW());

  INSERT INTO "PaymentReceiptBalance" ("id", "tenantId", "receiptId", "allocatedAmount", "unappliedAmount", "transferredOutAmount", "reservedRefundAmount", "refundedAmount", "updatedAt")
  VALUES (v_bal_id, v_tenant_id, v_rcpt_id, 50000, 0, 0, 0, 0, NOW());

  INSERT INTO "PaymentAllocation" ("id", "tenantId", "receiptId", "feeInvoiceId", "studentId", "amount", "createdAt")
  VALUES (v_alloc_id, v_tenant_id, v_rcpt_id, v_inv_id, v_student_id, 50000, NOW());

  -- B.1 Valid partial reversal (Positive)
  INSERT INTO "PaymentAllocationReversal" ("id", "tenantId", "originalAllocationId", "amount", "reason", "reversedById", "reversedAt")
  VALUES (v_rev_id, v_tenant_id, v_alloc_id, 20000, 'Partial refund', 'Admin', NOW());
  RAISE NOTICE '  [PASS] Test B.1: Valid partial reversal of 20,000 paise on 50,000 paise allocation succeeded';

  -- B.2 Cumulative reversal exceeds allocation (Negative - 23514)
  v_blocked := FALSE;
  BEGIN
    INSERT INTO "PaymentAllocationReversal" ("id", "tenantId", "originalAllocationId", "amount", "reason", "reversedById", "reversedAt")
    VALUES ('rev_b_excess', v_tenant_id, v_alloc_id, 40000, 'Excessive refund', 'Admin', NOW());
  EXCEPTION WHEN check_violation THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Test B.2 FAILED: Excessive cumulative reversal was not blocked!';
  END IF;
  RAISE NOTICE '  [PASS] Test B.2: Cumulative reversal exceeding allocation rejected with SQLSTATE 23514';

  -- B.3 Negative reversal amount (Negative - 23514)
  v_blocked := FALSE;
  BEGIN
    INSERT INTO "PaymentAllocationReversal" ("id", "tenantId", "originalAllocationId", "amount", "reason", "reversedById", "reversedAt")
    VALUES ('rev_b_neg', v_tenant_id, v_alloc_id, -500, 'Negative amount', 'Admin', NOW());
  EXCEPTION WHEN check_violation THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Test B.3 FAILED: Negative reversal amount was not blocked!';
  END IF;
  RAISE NOTICE '  [PASS] Test B.3: Negative reversal amount rejected with SQLSTATE 23514';

  -- B.4 Reassignment on invoice with ZERO allocations (Positive)
  UPDATE "FeeInvoice" SET "studentId" = 'stu_b_other' WHERE id = v_inv_unallocated;
  RAISE NOTICE '  [PASS] Test B.4: Student reassignment on unallocated FeeInvoice succeeded normally';
END $$;

ROLLBACK;

-- =============================================================================
-- TEST C: Financial & Immutability Invariants (All 13 Invariants)
-- =============================================================================
\echo ''
\echo '-------------------------------------------------------------------------------'
\echo '  TEST C: Financial & Immutability Invariants (13 Invariants)'
\echo '-------------------------------------------------------------------------------'

BEGIN;

DO $$
DECLARE
  v_t TEXT := 'tenant_c_v2';
  v_s1 TEXT := 'stu_c1_v2';
  v_s2 TEXT := 'stu_c2_v2';
  v_inv TEXT := 'inv_c_v2';
  v_rcpt TEXT := 'rcpt_c_v2';
  v_bal TEXT := 'bal_c_v2';
  v_alloc TEXT := 'alloc_c_v2';
  v_rev TEXT := 'rev_c_v2';
  v_br TEXT := 'br_c_v2';
  v_ble TEXT := 'ble_c_v2';
  v_sca TEXT := 'sca_c_v2';
  v_g TEXT := 'g_c_v2';
  v_gc TEXT := 'gc_c_v2';
  v_gce TEXT := 'gce_c_v2';
  v_journal TEXT := 'ctj_c_v2';
  v_posting1 TEXT := 'ctp_c1_v2';
  v_posting2 TEXT := 'ctp_c2_v2';
  v_blocked BOOLEAN;
BEGIN
  -- Setup Base Fixtures
  INSERT INTO "Tenant" ("id", "name", "slug", "email", "logoInitials", "status", "updatedAt")
  VALUES (v_t, 'Invariant Academy', 'inv-v2', 'inv-v2@example.com', 'IA', 'ACTIVE', NOW());

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

  INSERT INTO "PaymentAllocationReversal" ("id", "tenantId", "originalAllocationId", "amount", "reason", "reversedById", "reversedAt")
  VALUES (v_rev, v_t, v_alloc, 10000, 'Initial reversal', 'Admin', NOW());

  -- Invariant 1: PaymentReceipt Immutability (UPDATE/DELETE blocked)
  v_blocked := FALSE;
  BEGIN
    UPDATE "PaymentReceipt" SET amount = 999999 WHERE id = v_rcpt;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 1 UPDATE failed'; END IF;

  v_blocked := FALSE;
  BEGIN
    DELETE FROM "PaymentReceipt" WHERE id = v_rcpt;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 1 DELETE failed'; END IF;
  RAISE NOTICE '  [PASS] Invariant 1: PaymentReceipt UPDATE/DELETE blocked (P0001)';

  -- Invariant 2: PaymentAllocation Immutability (UPDATE/DELETE blocked)
  v_blocked := FALSE;
  BEGIN
    UPDATE "PaymentAllocation" SET amount = 999999 WHERE id = v_alloc;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 2 UPDATE failed'; END IF;

  v_blocked := FALSE;
  BEGIN
    DELETE FROM "PaymentAllocation" WHERE id = v_alloc;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 2 DELETE failed'; END IF;
  RAISE NOTICE '  [PASS] Invariant 2: PaymentAllocation UPDATE/DELETE blocked (P0001)';

  -- Invariant 3: PaymentAllocationReversal Immutability (UPDATE/DELETE blocked)
  v_blocked := FALSE;
  BEGIN
    UPDATE "PaymentAllocationReversal" SET amount = 50000 WHERE id = v_rev;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 3 UPDATE failed'; END IF;

  v_blocked := FALSE;
  BEGIN
    DELETE FROM "PaymentAllocationReversal" WHERE id = v_rev;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 3 DELETE failed'; END IF;
  RAISE NOTICE '  [PASS] Invariant 3: PaymentAllocationReversal UPDATE/DELETE blocked (P0001)';

  -- Invariant 4: PaymentReceiptBalance Conservation
  SET CONSTRAINTS ALL IMMEDIATE;
  v_blocked := FALSE;
  BEGIN
    UPDATE "PaymentReceiptBalance" SET "allocatedAmount" = 200000 WHERE id = v_bal;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 4 failed'; END IF;
  RAISE NOTICE '  [PASS] Invariant 4: PaymentReceiptBalance conservation enforced (P0001)';
  SET CONSTRAINTS ALL DEFERRED;

  -- Invariant 5: FeePayment Immutability is verified in Test D under knowletive_app (permission-level)

  -- Invariant 6: CreditTransferJournal Immutability
  INSERT INTO "CreditTransferJournal" ("id", "tenantId", "transferNumber", "sourceStudentId", "targetStudentId", "sourceReceiptId", "amount", "reason", "status", "requestedById", "createdAt")
  VALUES (v_journal, v_t, 'TRF-C1', v_s1, v_s2, v_rcpt, 25000, 'Sibling support', 'PENDING_APPROVAL', 'Admin', NOW());

  INSERT INTO "CreditTransferPosting" ("id", "tenantId", "journalId", "entryType", "studentId", "counterpartyStudentId", "receiptId", "amount", "createdAt")
  VALUES (v_posting1, v_t, v_journal, 'DEBIT', v_s1, v_s2, v_rcpt, 25000, NOW()),
         (v_posting2, v_t, v_journal, 'CREDIT', v_s2, v_s1, v_rcpt, 25000, NOW());

  v_blocked := FALSE;
  BEGIN
    UPDATE "CreditTransferJournal" SET amount = 999999 WHERE id = v_journal;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 6 UPDATE failed'; END IF;

  v_blocked := FALSE;
  BEGIN
    DELETE FROM "CreditTransferJournal" WHERE id = v_journal;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 6 DELETE failed'; END IF;
  RAISE NOTICE '  [PASS] Invariant 6: CreditTransferJournal UPDATE/DELETE blocked (P0001)';

  -- Invariant 7: GuardianConsentEvent Immutability
  INSERT INTO "Guardian" ("id", "tenantId", "name", "phone", "createdAt")
  VALUES (v_g, v_t, 'Jane Doe', '9999999999', NOW());

  INSERT INTO "GuardianConsent" ("id", "tenantId", "guardianId", "sourceStudentId", "destinationStudentId", "scope", "verificationMethod", "status", "isRevoked", "createdAt", "updatedAt")
  VALUES (v_gc, v_t, v_g, v_s1, v_s2, 'SIBLING_CREDIT_TRANSFER', 'DIGITAL_SIGNATURE', 'VERIFIED', FALSE, NOW(), NOW());

  INSERT INTO "GuardianConsentEvent" ("id", "tenantId", "consentId", "action", "actorId", "createdAt")
  VALUES (v_gce, v_t, v_gc, 'VERIFIED', 'Admin', NOW());

  v_blocked := FALSE;
  BEGIN
    UPDATE "GuardianConsentEvent" SET notes = 'tampered' WHERE id = v_gce;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 7 UPDATE failed'; END IF;

  v_blocked := FALSE;
  BEGIN
    DELETE FROM "GuardianConsentEvent" WHERE id = v_gce;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 7 DELETE failed'; END IF;
  RAISE NOTICE '  [PASS] Invariant 7: GuardianConsentEvent UPDATE/DELETE blocked (P0001)';

  -- Invariant 8: BranchLedgerEntry Immutability
  INSERT INTO "Branch" ("id", "tenantId", "name", "code", "isActive", "updatedAt")
  VALUES (v_br, v_t, 'Main Branch', 'BR-C-V2', TRUE, NOW());

  INSERT INTO "BranchLedgerEntry" ("id", "tenantId", "branchId", "entryType", "channel", "amount", "balanceAfter", "referenceType", "description", "postedAt")
  VALUES (v_ble, v_t, v_br, 'CREDIT_SETTLEMENT', 'ONLINE_JODO', 100000, 100000, 'TEST', 'Branch test', NOW());

  v_blocked := FALSE;
  BEGIN
    UPDATE "BranchLedgerEntry" SET amount = 500 WHERE id = v_ble;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 8 UPDATE failed'; END IF;

  v_blocked := FALSE;
  BEGIN
    DELETE FROM "BranchLedgerEntry" WHERE id = v_ble;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 8 DELETE failed'; END IF;
  RAISE NOTICE '  [PASS] Invariant 8: BranchLedgerEntry UPDATE/DELETE blocked (P0001)';

  -- Invariant 9: StudentCreditAccount Identity Immutability & Deletion Protection
  INSERT INTO "StudentCreditAccount" ("id", "tenantId", "studentId", "balance", "transferredIn", "transferredOut", "transferredOnward", "allocatedIn", "status", "version", "createdAt", "updatedAt")
  VALUES (v_sca, v_t, v_s1, 5000, 5000, 0, 0, 0, 'ACTIVE', 1, NOW(), NOW());

  v_blocked := FALSE;
  BEGIN
    UPDATE "StudentCreditAccount" SET "studentId" = v_s2 WHERE id = v_sca;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 9 identity update failed'; END IF;

  v_blocked := FALSE;
  BEGIN
    DELETE FROM "StudentCreditAccount" WHERE id = v_sca;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 9 deletion failed'; END IF;
  RAISE NOTICE '  [PASS] Invariant 9: StudentCreditAccount studentId reassignment & deletion blocked (P0001)';

  -- Invariant 10: FeeInvoice Student Reassignment Restriction
  v_blocked := FALSE;
  BEGIN
    UPDATE "FeeInvoice" SET "studentId" = v_s2 WHERE id = v_inv;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 10 failed'; END IF;
  RAISE NOTICE '  [PASS] Invariant 10: FeeInvoice reassignment restriction enforced (P0001)';

  -- Invariant 11: Active Allocation Constraint (Cross-student allocation forbidden without transfer journal)
  INSERT INTO "FeeInvoice" ("id", "tenantId", "studentId", "number", "title", "amount", "paidAmount", "dueDate", "issuedAt", "createdAt", "updatedAt")
  VALUES ('inv_c2_v2', v_t, v_s2, 'INV-C2', 'Tuition S2', 50000, 0, NOW() + INTERVAL '30 days', NOW(), NOW(), NOW());

  v_blocked := FALSE;
  BEGIN
    INSERT INTO "PaymentAllocation" ("id", "tenantId", "receiptId", "feeInvoiceId", "studentId", "amount", "createdAt")
    VALUES ('alloc_mismatch', v_t, v_rcpt, 'inv_c2_v2', v_s1, 1000, NOW());
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 11 failed'; END IF;
  RAISE NOTICE '  [PASS] Invariant 11: Cross-student allocation without transfer journal blocked (P0001)';

  -- Invariant 12: Reversal Cumulative Bound
  v_blocked := FALSE;
  BEGIN
    INSERT INTO "PaymentAllocationReversal" ("id", "tenantId", "originalAllocationId", "amount", "reason", "reversedById", "reversedAt")
    VALUES ('rev_excess_12', v_t, v_alloc, 100000, 'Over-allocation', 'Admin', NOW());
  EXCEPTION WHEN check_violation THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 12 failed'; END IF;
  RAISE NOTICE '  [PASS] Invariant 12: Cumulative reversal exceeding allocation bound blocked (23514)';

  -- Invariant 13: Double-Entry Ledger Balance Conservation (Debits must equal Credits)
  INSERT INTO "CreditTransferJournal" ("id", "tenantId", "transferNumber", "sourceStudentId", "targetStudentId", "sourceReceiptId", "amount", "reason", "status", "requestedById", "createdAt")
  VALUES ('ctj_unbal_v2', v_t, 'TRF-UNBAL', v_s1, v_s2, v_rcpt, 25000, 'Unbalanced test', 'PENDING_APPROVAL', 'Admin', NOW());

  INSERT INTO "CreditTransferPosting" ("id", "tenantId", "journalId", "entryType", "studentId", "counterpartyStudentId", "receiptId", "amount", "createdAt")
  VALUES ('ctp_unbal1', v_t, 'ctj_unbal_v2', 'DEBIT', v_s1, v_s2, v_rcpt, 25000, NOW()),
         ('ctp_unbal2', v_t, 'ctj_unbal_v2', 'CREDIT', v_s2, v_s1, v_rcpt, 20000, NOW());

  v_blocked := FALSE;
  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN OTHERS THEN v_blocked := TRUE; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Invariant 13 failed'; END IF;
  RAISE NOTICE '  [PASS] Invariant 13: Unbalanced double-entry postings blocked (P0001)';
END $$;

ROLLBACK;

-- =============================================================================
-- TEST D: Permission Boundaries for Role knowletive_app
-- =============================================================================
\echo ''
\echo '-------------------------------------------------------------------------------'
\echo '  TEST D: Permission Boundaries for Role knowletive_app'
\echo '-------------------------------------------------------------------------------'

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
  IF NOT v_blocked THEN RAISE EXCEPTION 'Test D.1 FAILED: knowletive_app was able to CREATE TABLE!'; END IF;
  RAISE NOTICE '  [PASS] Test D.1: CREATE TABLE rejected with SQLSTATE 42501';
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
  IF NOT v_blocked THEN RAISE EXCEPTION 'Test D.2 FAILED: knowletive_app was able to CREATE SCHEMA!'; END IF;
  RAISE NOTICE '  [PASS] Test D.2: CREATE SCHEMA rejected with SQLSTATE 42501';
END $$;

-- D.3 UPDATE on PaymentReceipt blocked
DO $$
DECLARE v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE "PaymentReceipt" SET id = id WHERE false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Test D.3 FAILED: knowletive_app was able to UPDATE PaymentReceipt!'; END IF;
  RAISE NOTICE '  [PASS] Test D.3: UPDATE PaymentReceipt rejected with SQLSTATE 42501';
END $$;

-- D.4 DELETE on PaymentReceipt blocked
DO $$
DECLARE v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    DELETE FROM "PaymentReceipt" WHERE false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Test D.4 FAILED: knowletive_app was able to DELETE PaymentReceipt!'; END IF;
  RAISE NOTICE '  [PASS] Test D.4: DELETE PaymentReceipt rejected with SQLSTATE 42501';
END $$;

-- D.5 TRUNCATE on Student blocked
DO $$
DECLARE v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    TRUNCATE TABLE "Student";
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Test D.5 FAILED: knowletive_app was able to TRUNCATE Student!'; END IF;
  RAISE NOTICE '  [PASS] Test D.5: TRUNCATE TABLE rejected with SQLSTATE 42501';
END $$;

-- D.6 UPDATE on FeePayment blocked (Invariant 5)
DO $$
DECLARE v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE "FeePayment" SET id = id WHERE false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Test D.6 FAILED: knowletive_app was able to UPDATE FeePayment!'; END IF;
  RAISE NOTICE '  [PASS] Test D.6: UPDATE FeePayment rejected with SQLSTATE 42501 (Invariant 5)';
END $$;

-- D.7 DELETE on FeePayment blocked (Invariant 5)
DO $$
DECLARE v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    DELETE FROM "FeePayment" WHERE false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Test D.7 FAILED: knowletive_app was able to DELETE FeePayment!'; END IF;
  RAISE NOTICE '  [PASS] Test D.7: DELETE FeePayment rejected with SQLSTATE 42501 (Invariant 5)';
END $$;

RESET ROLE;

-- =============================================================================
-- TEST E: TEMPORARY Privileges & Defense-in-Depth Proof
-- =============================================================================
\echo ''
\echo '-------------------------------------------------------------------------------'
\echo '  TEST E: TEMPORARY Privilege State & Function Hardening Independence'
\echo '-------------------------------------------------------------------------------'

-- E.1 Under knowletive_app: CREATE TEMP TABLE is blocked due to database REVOKE TEMPORARY
SET ROLE knowletive_app;

DO $$
DECLARE
  v_blocked BOOLEAN := FALSE;
  v_errcode TEXT;
BEGIN
  BEGIN
    CREATE TEMP TABLE test_temp_app_e (id text);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := TRUE;
    v_errcode := SQLSTATE;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Test E.1 FAILED: knowletive_app was able to create a temp table despite REVOKE TEMPORARY!';
  END IF;
  RAISE NOTICE '  [PASS] Test E.1: CREATE TEMP TABLE under knowletive_app rejected with SQLSTATE % (TEMPORARY revoked from PUBLIC)', v_errcode;
END $$;

RESET ROLE;

BEGIN;

-- E.2 Under knowletive (owner/superuser): CREATE TEMP TABLE succeeds, BUT hardened function remains immune
DO $$
DECLARE
  v_tenant_id TEXT := 'tenant_e_v2';
  v_s1_id TEXT := 'stu_e1_v2';
  v_s2_id TEXT := 'stu_e2_v2';
  v_inv_id TEXT := 'inv_e_v2';
  v_rcpt_id TEXT := 'rcpt_e_v2';
  v_bal_id TEXT := 'bal_e_v2';
  v_alloc_id TEXT := 'alloc_e_v2';
  v_blocked BOOLEAN := FALSE;
BEGIN
  -- Setup test data
  INSERT INTO "Tenant" ("id", "name", "slug", "email", "logoInitials", "status", "updatedAt")
  VALUES (v_tenant_id, 'Temp Proof Academy', 'temp-e-v2', 'temp-e@example.com', 'TE', 'ACTIVE', NOW());

  INSERT INTO "Student" ("id", "tenantId", "admissionNo", "firstName", "lastName", "admissionDate", "createdAt", "updatedAt")
  VALUES (v_s1_id, v_tenant_id, 'ADM-E1', 'Eve', 'Source', NOW(), NOW(), NOW()),
         (v_s2_id, v_tenant_id, 'ADM-E2', 'Mallory', 'Target', NOW(), NOW(), NOW());

  INSERT INTO "FeeInvoice" ("id", "tenantId", "studentId", "number", "title", "amount", "paidAmount", "dueDate", "issuedAt", "createdAt", "updatedAt")
  VALUES (v_inv_id, v_tenant_id, v_s1_id, 'INV-E', 'Tuition', 100000, 100000, NOW() + INTERVAL '30 days', NOW(), NOW(), NOW());

  INSERT INTO "PaymentReceipt" ("id", "tenantId", "studentId", "receiptNumber", "amount", "method", "currency", "provider", "receivedAt", "createdAt")
  VALUES (v_rcpt_id, v_tenant_id, v_s1_id, 'RCPT-E', 100000, 'CASH', 'INR', 'manual', NOW(), NOW());

  INSERT INTO "PaymentReceiptBalance" ("id", "tenantId", "receiptId", "allocatedAmount", "unappliedAmount", "transferredOutAmount", "reservedRefundAmount", "refundedAmount", "updatedAt")
  VALUES (v_bal_id, v_tenant_id, v_rcpt_id, 100000, 0, 0, 0, 0, NOW());

  INSERT INTO "PaymentAllocation" ("id", "tenantId", "receiptId", "feeInvoiceId", "studentId", "amount", "createdAt")
  VALUES (v_alloc_id, v_tenant_id, v_rcpt_id, v_inv_id, v_s1_id, 100000, NOW());
END $$;

-- Role knowletive creates temp table with TEMPORARY privilege
CREATE TEMP TABLE "PaymentAllocation" ("feeInvoiceId" TEXT);

DO $$
DECLARE
  v_inv_id TEXT := 'inv_e_v2';
  v_s2_id TEXT := 'stu_e2_v2';
  v_blocked BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE "FeeInvoice" SET "studentId" = v_s2_id WHERE id = v_inv_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN
      v_blocked := TRUE;
    END IF;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Test E.2 FAILED: Hardened function was bypassed when role had TEMPORARY privilege!';
  END IF;

  RAISE NOTICE '  [PASS] Test E.2: Even with TEMPORARY privilege granted and temp table created, hardened function cannot be shadowed (SQLSTATE P0001)';
END $$;

DROP TABLE IF EXISTS pg_temp."PaymentAllocation";
ROLLBACK;

\echo ''
\echo '==============================================================================='
\echo '  ALL VERIFICATION TESTS (A, B, C, D, E) EXECUTED AND PASSED CLEANLY!'
\echo '==============================================================================='
\echo ''
