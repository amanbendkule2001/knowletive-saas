# Knowletive PostgreSQL 18 Security Hardening & Test Design Specification

**Author:** Agent 2 (Security & RBAC Specialist)  
**Target Database:** `knowletive_final_rehearsal_20261121_184300` (PostgreSQL 18.3, port 5432)  
**Protected Database:** `knowletive` (STRICTLY READ-ONLY / UNTOUCHED)  
**Date:** 2026-11-23  
**Status:** COMPLETE TEST DESIGN & EXECUTABLE SUITE SPECIFICATION  

---

## 1. Executive Summary & Threat Architecture

This specification delivers the complete test harness and reproducible verification methodology for the Knowletive database security hardening milestone under PostgreSQL 18.3.

The design specifically isolates, reproduces, proves, and verifies four critical database security dimensions:
1. **Test A (Temporary-Table Shadowing PoC & Hardened Neutralization):** Demonstrates how an unprivileged or application session can exploit unqualified table references in PostgreSQL trigger functions by declaring temporary tables (`pg_temp`) that hijack function execution paths. Proves the vulnerability and validates the hardened fix.
2. **Test B (Normal Trigger Behavior):** Validates the full functional operational envelope of triggers, confirming that valid business transactions succeed while invalid lifecycle transitions fail with exact ANSI/PostgreSQL SQLSTATE codes.
3. **Test C (Financial Integrity Regressions):** Exhaustively tests all 13 financial ledger, audit log, and legal consent immutability invariants.
4. **Test D (Permission Regressions):** Proves that the runtime application database user `knowletive_app` is strictly confined by least-privilege grants (`NOSUPERUSER NOBYPASSRLS`, cannot perform DDL, cannot create triggers, cannot mutate functions, and cannot update/delete from immutable ledgers).

---

## 2. Test A: Temporary-Table Shadowing Proof-of-Concept & Resolution

### 2.1 Vulnerability Mechanism (The Shadowing Exploit)

In PostgreSQL:
- The default `search_path` is `"$user", public`.
- When an unqualified table name (e.g. `SELECT ... FROM "PaymentAllocation"`) is evaluated, PostgreSQL resolves schemas according to `search_path`.
- **PostgreSQL Precedence Invariant:** The temporary schema `pg_temp` is **implicitly searched before any other schema** in the search path for table lookups unless the table name is explicitly qualified (e.g., `public."PaymentAllocation"`).
- In functions lacking explicit schema qualification or fixed `search_path` (such as `fn_protect_invoice_student_reassignment`), an unprivileged user capable of creating temporary tables (`CREATE TEMP TABLE`) can shadow the genuine public table.

### 2.2 Vulnerable Function Analysis

Consider `public.fn_protect_invoice_student_reassignment()`:
```sql
CREATE OR REPLACE FUNCTION public.fn_protect_invoice_student_reassignment()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."studentId" IS DISTINCT FROM OLD."studentId" THEN
    IF EXISTS (
      SELECT 1 FROM "PaymentAllocation"      -- <-- UNQUALIFIED TABLE REFERENCE!
      WHERE "feeInvoiceId" = OLD.id
    ) THEN
      RAISE EXCEPTION 'Cannot reassign FeeInvoice.studentId (from % to %) because active PaymentAllocation records exist on invoice %',
        OLD."studentId", NEW."studentId", OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
```

### 2.3 The Exploit Walkthrough

1. **Legitimate Invariant:** When a student has a `FeeInvoice` with active payments allocated (`PaymentAllocation` row exists), changing `FeeInvoice.studentId` to another student is forbidden (to prevent misattributing settled payments to unrelated students).
2. **Attacker Actions:**
   ```sql
   -- Attacker creates an empty temporary table in their session matching the unqualified name
   CREATE TEMP TABLE "PaymentAllocation" (
     "feeInvoiceId" TEXT
   );

   -- Attacker attempts reassignment
   UPDATE "FeeInvoice"
   SET "studentId" = 'victim_or_counterparty_student_id'
   WHERE id = 'target_invoice_with_allocations';
   ```
3. **Execution Failure:**
   - The trigger executes `SELECT 1 FROM "PaymentAllocation" WHERE "feeInvoiceId" = OLD.id`.
   - PostgreSQL queries `pg_temp."PaymentAllocation"` instead of `public."PaymentAllocation"`.
   - Because `pg_temp."PaymentAllocation"` is empty, `EXISTS (...)` evaluates to `FALSE`!
   - The check is bypassed, and the invoice is reassigned to the counterparty student despite active public allocations.

### 2.4 The Hardened Resolution

The function is hardened through **dual-layer defense**:
1. Explicit schema qualification: `FROM public."PaymentAllocation"`
2. Explicit, locked `search_path`: `SET search_path = public, pg_temp`

```sql
CREATE OR REPLACE FUNCTION public.fn_protect_invoice_student_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
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
```

**Verification:** Even when `pg_temp."PaymentAllocation"` is actively present in the attacker's session, the query strictly targets `public."PaymentAllocation"`, detects the allocation, and aborts with `SQLSTATE P0001`.

---

## 3. Test B: Normal Trigger Behavior Specification

This module tests that functional trigger logic operates accurately under legitimate workflows and rejects invalid inputs with deterministic SQLSTATE error codes.

### 3.1 Test Cases & Assertions

| Test ID | Function / Trigger | Operation | Input Conditions | Expected Outcome | SQLSTATE |
|---|---|---|---|---|---|
| **B.1** | `fn_protect_invoice_student_reassignment` | UPDATE `FeeInvoice.studentId` | Invoice has 0 allocations in `PaymentAllocation` | **SUCCEEDS** (Invoice reassigned) | `00000` |
| **B.2** | `fn_enforce_allocation_reversal_limit` | INSERT `PaymentAllocationReversal` | Reversal amount (20,000 paise) <= remaining allocation (50,000 paise) | **SUCCEEDS** (Reversal inserted) | `00000` |
| **B.3** | `fn_enforce_allocation_reversal_limit` | INSERT `PaymentAllocationReversal` | Cumulative reversals (20,000 + 40,000 = 60,000) > allocation (50,000) | **REJECTED** (`Cumulative reversal amount exceeds original allocation amount`) | `23514` |
| **B.4** | `fn_enforce_allocation_reversal_limit` | INSERT `PaymentAllocationReversal` | Negative or zero amount (`-100`) | **REJECTED** (`Reversal amount must be positive`) | `23514` |
| **B.5** | `fn_enforce_transfer_request_lifecycle` | UPDATE `CreditTransferRequest` | Status `PENDING_APPROVAL` -> `APPROVED` -> `EXECUTED` | **SUCCEEDS** (Valid lifecycle progression) | `00000` |
| **B.6** | `fn_enforce_transfer_request_lifecycle` | UPDATE `CreditTransferRequest` | Attempting status change from terminal state `EXECUTED` -> `PENDING_APPROVAL` | **REJECTED** (`is in terminal state and cannot transition`) | `P0001` |
| **B.7** | `fn_enforce_transfer_request_lifecycle` | UPDATE `CreditTransferRequest` | Mutating immutable core fields (`amount`, `requestNumber`) | **REJECTED** (`Core request parameters are immutable`) | `P0001` |

---

## 4. Test C: Financial Integrity Regressions (13 Core Invariants)

This module validates that all 13 immutable financial entities, audit logs, and double-entry invariants are permanently protected from mutation, deletion, or ledger imbalance.

### 4.1 Invariant Matrix & Verification Points

```mermaid
flowchart LR
    subgraph Financial Ledgers
        PR["1. PaymentReceipt<br/>[IMMUTABLE]"]
        PA["2. PaymentAllocation<br/>[IMMUTABLE]"]
        PAR["3. Allocation Reversal<br/>[BOUNDED <= Allocation]"]
        PRB["4. Receipt Balance<br/>[CONSERVED: Gross == Sum]"]
        CTJ["5. Credit Transfer<br/>[BALANCED: Debits == Credits]"]
        CTP["6. Transfer Postings<br/>[PROVENANCE ENFORCED]"]
        BLE["8. Branch Ledger<br/>[IMMUTABLE]"]
        SCA["9. Student Credit Account<br/>[IDENTITY PROTECTED]"]
        FI["10. Fee Invoice<br/>[REASSIGNMENT RESTRICTED]"]
    end

    subgraph Legal & Audit Logs
        GC["7. Guardian Consent<br/>[IMMUTABLE EVENT]"]
        ERS["11. Exam Snapshot / Revision<br/>[IMMUTABLE LOG]"]
        BEE["12. Batch Enrollment<br/>[IMMUTABLE EVENT]"]
        SPE["13. Syllabus Progress<br/>[IMMUTABLE LOG]"]
    end
```

### 4.2 Invariant Verification Details

1. **Invariant 1: Immutable Payment Receipts (`PaymentReceipt`)**
   - Enforcing Trigger: `trg_payment_receipt_protect` (BEFORE UPDATE OR DELETE)
   - Test: Attempting `UPDATE "PaymentReceipt" SET amount = 200000` or `DELETE` throws `SQLSTATE P0001`.
2. **Invariant 2: Immutable Payment Allocations (`PaymentAllocation`)**
   - Enforcing Trigger: `trg_payment_allocation_protect` (BEFORE UPDATE OR DELETE)
   - Test: Attempting `UPDATE "PaymentAllocation" SET amount = 50000` or `DELETE` throws `SQLSTATE P0001`.
3. **Invariant 3: Allocation Reversal Bounds (`PaymentAllocationReversal`)**
   - Enforcing Trigger: `trg_allocation_reversal_limit` & `trg_allocation_reversal_invariant`
   - Test: Inserting reversal where `SUM(amount) > allocation.amount` throws `SQLSTATE 23514`.
4. **Invariant 4: Receipt Balance Conservation (`PaymentReceiptBalance`)**
   - Enforcing Trigger: `trg_receipt_conservation` & `trg_receipt_balance_conservation`
   - Test: Mutating balance components such that `allocated + transferredOut + unapplied + reservedRefund + refunded != gross amount` fails commit with `SQLSTATE P0001`.
5. **Invariant 5: Credit Transfer Balancing (`CreditTransferJournal`)**
   - Enforcing Trigger: `trg_credit_journal_balanced`
   - Test: Transitioning a journal to `COMPLETED` when debits != credits or debits != journal amount throws `SQLSTATE P0001`.
6. **Invariant 6: Transfer Provenance & Posting Integrity (`CreditTransferPosting`)**
   - Enforcing Trigger: `trg_transfer_posting_provenance`
   - Test: Inserting posting referencing a rogue receipt not present in the journal's source allocations throws `SQLSTATE P0001`.
7. **Invariant 7: Guardian Consent Immutability (`GuardianConsentEvent`)**
   - Enforcing Trigger: `trg_guardian_consent_event_protect`
   - Test: `UPDATE` or `DELETE` on `GuardianConsentEvent` throws `SQLSTATE P0001`.
8. **Invariant 8: Branch Ledger Immutability (`BranchLedgerEntry`)**
   - Enforcing Trigger: `trg_branch_ledger_protect`
   - Test: `UPDATE` or `DELETE` on `BranchLedgerEntry` throws `SQLSTATE P0001`.
9. **Invariant 9: Student Credit Account Identity & Deletion Guard (`StudentCreditAccount`)**
   - Enforcing Trigger: `trg_credit_account_identity_guard` & `trg_credit_account_deletion_guard`
   - Test: Mutating `studentId` or `tenantId` throws `SQLSTATE P0001`. Attempting to delete an account with `balance > 0` throws `SQLSTATE P0001`.
10. **Invariant 10: Invoice Reassignment Restrictions (`FeeInvoice`)**
    - Enforcing Trigger: `trg_invoice_student_reassignment_guard`
    - Test: Mutating `studentId` on `FeeInvoice` while active `PaymentAllocation` records exist throws `SQLSTATE P0001`.
11. **Invariant 11: Exam Snapshot & Revision Immutability (`ExamResultSnapshot`, `ExamMarksRevisionEvent`)**
    - Enforcing Trigger: `trg_exam_snapshot_protect` & `trg_exam_revision_event_protect`
    - Test: `UPDATE` or `DELETE` throws `SQLSTATE P0001`.
12. **Invariant 12: Batch Enrollment Event Immutability (`BatchEnrollmentEvent`)**
    - Enforcing Trigger: `trg_prevent_batch_event_tampering`
    - Test: `UPDATE` or `DELETE` throws `SQLSTATE P0001`.
13. **Invariant 13: Syllabus Progress Event Immutability (`SyllabusProgressEvent`)**
    - Enforcing Trigger: `trg_protect_syllabustrack_event`
    - Test: `UPDATE` or `DELETE` throws `SQLSTATE P0001`.

---

## 5. Test D: Permission Regressions (`knowletive_app`)

This module verifies that the runtime role `knowletive_app` has zero administrative authority and cannot breach least-privilege boundaries.

### 5.1 Permission Test Matrix

| Target Object / Command | Executed SQL | Expected SQLSTATE | Result |
|---|---|---|---|
| **Role Attributes** | `SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname = 'knowletive_app'` | All must be `false` | **PASS** |
| **Schema DDL** | `CREATE TABLE public.test_evil (id text);` | `42501` (`insufficient_privilege`) | **BLOCKED** |
| **Database DDL** | `CREATE SCHEMA test_evil;` | `42501` (`permission denied for database`) | **BLOCKED** |
| **Trigger Creation** | `CREATE TRIGGER evil_trg BEFORE INSERT ON "Student" ...` | `42501` (`must be owner of table`) | **BLOCKED** |
| **Function Modification** | `ALTER FUNCTION public.fn_get_effective_branch_id(...) OWNER TO knowletive_app;` | `42501` (`must be owner of function`) | **BLOCKED** |
| **Table Truncation** | `TRUNCATE TABLE "Student";` | `42501` (`permission denied for table Student`) | **BLOCKED** |
| **Ledger UPDATE** | `UPDATE "PaymentReceipt" SET amount = 1;` | `42501` (`permission denied for table PaymentReceipt`) | **BLOCKED** |
| **Ledger DELETE** | `DELETE FROM "PaymentReceipt";` | `42501` (`permission denied for table PaymentReceipt`) | **BLOCKED** |
| **AuditLog UPDATE** | `UPDATE "AuditLog" SET id = id;` | `42501` (`permission denied for table AuditLog`) | **BLOCKED** |

---

## 6. Execution Instructions for Rehearsal Target

The test suite is packaged in two formats:
1. **Automated Node/Prisma Suite:** `scripts/rehearsal-security-hardening-test-suite.mjs`
2. **Pure SQL Test Runner:** `scripts/rehearsal-security-hardening-test-suite.sql`

### 6.1 Execution via Node.js
```bash
# Executing against knowletive_final_rehearsal_20261121_184300
node scripts/rehearsal-security-hardening-test-suite.mjs
```

### 6.2 Execution via PSQL
```bash
psql postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300 -f scripts/rehearsal-security-hardening-test-suite.sql
```

### 6.3 Expected Console Summary Output
```text
===============================================================================
  KNOWLETIVE POSTGRESQL 18 SECURITY HARDENING REPRODUCIBLE TEST SUITE
  Target: knowletive_final_rehearsal_20261121_184300
===============================================================================

===============================================================================
  TEST A: Temporary-Table Shadowing Proof-of-Concept
===============================================================================
  ✓ PASS: Public test rows seeded: FeeInvoice linked to PaymentAllocation for Student 1
  ✓ PASS: Baseline guard verified: Reassignment blocked because active PaymentAllocation exists
  ✓ PASS: Temporary table pg_temp."PaymentAllocation" created (empty)
  ! VULNERABILITY CONFIRMED: Trigger queried pg_temp."PaymentAllocation" instead of public."PaymentAllocation"!
  ✓ PASS: Hardened function installed: forced 'public."PaymentAllocation"' and fixed search_path
  ✓ PASS: Exploit blocked: Hardened function resolved public."PaymentAllocation" and rejected update with P0001
  ✓ PASS: Test A cleanup complete.

===============================================================================
  TEST B: Normal Trigger Behavior (Positive & Negative Operations)
===============================================================================
  ✓ PASS: Positive: Unallocated FeeInvoice successfully reassigned to another student
  ✓ PASS: Positive: Valid partial reversal of 20,000 paise on 50,000 paise allocation succeeded
  ✓ PASS: Negative: Reversal exceeding allocation rejected with SQLSTATE 23514 (check_violation)
  ✓ PASS: Negative: Negative reversal amount rejected with SQLSTATE 23514
  ✓ PASS: Positive: Valid lifecycle transitions PENDING_APPROVAL -> APPROVED -> EXECUTED succeeded
  ✓ PASS: Negative: Transition from terminal state EXECUTED rejected with SQLSTATE P0001
  ✓ PASS: Negative: Mutating immutable amount rejected with SQLSTATE P0001
  ✓ PASS: Test B cleanup complete.

===============================================================================
  TEST C: Financial Integrity Regressions (13 Core Invariants)
===============================================================================
  ✓ PASS: Invariant 1a: PaymentReceipt UPDATE blocked with SQLSTATE P0001
  ✓ PASS: Invariant 1b: PaymentReceipt DELETE blocked with SQLSTATE P0001
  ✓ PASS: Invariant 2a: PaymentAllocation UPDATE blocked with SQLSTATE P0001
  ✓ PASS: Invariant 2b: PaymentAllocation DELETE blocked with SQLSTATE P0001
  ✓ PASS: Invariant 3: Allocation reversal bounds enforced (SQLSTATE 23514)
  ✓ PASS: Invariant 4: Balance conservation enforced (gross == sum of components, SQLSTATE P0001)
  ✓ PASS: Invariant 5: Double-entry credit transfer balance enforced (SQLSTATE P0001)
  ✓ PASS: Invariant 6: Transfer posting receipt provenance enforced (SQLSTATE P0001)
  ✓ PASS: Invariant 7: GuardianConsentEvent immutability enforced (SQLSTATE P0001)
  ✓ PASS: Invariant 8: BranchLedgerEntry immutability enforced (SQLSTATE P0001)
  ✓ PASS: Invariant 9: StudentCreditAccount identity mutation & deletion guards enforced (SQLSTATE P0001)
  ✓ PASS: Invariant 10: FeeInvoice reassignment restricted while allocations exist (SQLSTATE P0001)
  ✓ PASS: Invariant 11: ExamMarksRevisionEvent immutability enforced (SQLSTATE P0001)
  ✓ PASS: Invariant 12: BatchEnrollmentEvent immutability enforced
  ✓ PASS: Invariant 13: SyllabusProgressEvent immutability enforced (SQLSTATE P0001)
  ✓ PASS: Test C cleanup complete.

===============================================================================
  TEST D: Permission Regressions (Least-Privilege for knowletive_app)
===============================================================================
  ✓ PASS: Role attributes verified: rolsuper=false, rolcreatedb=false, rolcreaterole=false, rolbypassrls=false
  ✓ PASS: Blocked: CREATE TABLE rejected with SQLSTATE 42501 (insufficient_privilege)
  ✓ PASS: Blocked: CREATE SCHEMA rejected with SQLSTATE 42501
  ✓ PASS: Blocked: CREATE TRIGGER rejected with SQLSTATE 42501 (must be table owner)
  ✓ PASS: Blocked: ALTER FUNCTION rejected with SQLSTATE 42501 (must be function owner)
  ✓ PASS: Blocked: TRUNCATE TABLE rejected with SQLSTATE 42501
  ✓ PASS: Table PaymentReceipt: UPDATE and DELETE strictly DENIED (SQLSTATE 42501)
  ✓ PASS: Table FeePayment: UPDATE and DELETE strictly DENIED (SQLSTATE 42501)
  ✓ PASS: Table PaymentAllocation: UPDATE and DELETE strictly DENIED (SQLSTATE 42501)
  ✓ PASS: Table PaymentAllocationReversal: UPDATE and DELETE strictly DENIED (SQLSTATE 42501)
  ✓ PASS: Table CreditTransferJournal: UPDATE and DELETE strictly DENIED (SQLSTATE 42501)
  ✓ PASS: Table CreditTransferPosting: UPDATE and DELETE strictly DENIED (SQLSTATE 42501)
  ✓ PASS: Table BranchLedgerEntry: UPDATE and DELETE strictly DENIED (SQLSTATE 42501)
  ✓ PASS: Table AuditLog: UPDATE and DELETE strictly DENIED (SQLSTATE 42501)
  ✓ PASS: Test D completed successfully.

===============================================================================
  ALL TEST MODULES (A, B, C, D) PASSED CLEANLY WITH ZERO REGRESSIONS!
===============================================================================
```
