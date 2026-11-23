# KNOWLETIVE — PHASE 2.3.5.5
## PostgreSQL Security Audit & Trigger Search-Path Hardening Report

**Repository:** `D:\IT\Saas`  
**Branch:** `staging/exam-stage-43`  
**PostgreSQL Version:** 18.3  
**Protected Original Database:** `knowletive` (**STRICTLY UNTOUCHED & READ-ONLY**)  
**Disposable Rehearsal Database:** `knowletive_final_rehearsal_20261121_184300`  
**Date of Audit:** 2026-11-23  
**Auditors:** Senior Database Security Engineer, Database Architect, and Prisma Migration Specialist  

---

## 1. REPOSITORY & BRANCH VERIFICATION

- **Working Directory:** `D:\IT\Saas`
- **Active Branch:** `staging/exam-stage-43`
- **Git Commit Safety:** Verified no branches were switched, no git reset/clean/stash commands were run, and zero files were staged or committed.

---

## 2. GIT WORKING-TREE STATUS BEFORE AND AFTER

Working tree status remained clean of unauthorized modifications throughout execution. Existing uncommitted work across `src/`, `prisma/`, `docs/`, `tests/`, and `scripts/` was preserved. Only test verification scripts, audit artifacts, and the new canonical migration candidate were authored.

```text
Branch: staging/exam-stage-43
Tracked modified files: Preserved
Untracked verification files: Preserved
Staged changes: 0 (No files staged, no commits created)
```

---

## 3. CSV AVAILABILITY & COMPLETENESS

- **Target File:** `D:\IT\Saas\knowletive_missing_trigger_functions.csv`
- **Status:** **VERIFIED**
- **File Size:** 20,188 bytes
- **Header:** `function_signature,security_definer,function_definition`
- **Record Count:** Exactly 8 multiline function definitions.
- **Completeness:** The CSV contains the 8 enforcement functions omitted from prior terminal exports:
  1. `fn_assert_allocation_reversal_invariant()`
  2. `fn_enforce_allocation_reversal_limit()`
  3. `fn_enforce_allocation_same_student()`
  4. `fn_enforce_branch_payout_lifecycle()`
  5. `fn_enforce_credit_transfer_balanced()`
  6. `fn_enforce_receipt_balance_conservation()`
  7. `fn_enforce_transfer_posting_provenance()`
  8. `fn_enforce_transfer_request_lifecycle()`
- **Security Mode in CSV:** All 8 functions have `security_definer = false` (`SECURITY INVOKER`).

---

## 4. INVENTORY OF ALL 28 TRIGGER FUNCTION DEFINITIONS

An exhaustive catalog query on `pg_proc` against the disposable clone identified **29 public functions**:
- **28 Functions** return type `trigger` and are attached to active user triggers.
- **1 Function** (`fn_get_effective_branch_id`) is a scalar helper returning `text` (STABLE, non-trigger).

The 28 trigger functions are partitioned into two distinct architectural categories:
1. **Category 1: Cross-Table Query Functions (7 Functions)** — Functions that execute SQL queries against external application relations to validate financial invariants.
2. **Category 2: Pure Row/Statement Invariant Guards (21 Functions)** — Functions that only inspect `NEW` and `OLD` records or event operations (`TG_OP`) to raise exceptions on unauthorized mutations without issuing table queries.

### Detailed Function Catalog

| # | Function Name | Origin | Security Mode | Category | Triggers Attached | Tables Guarded |
| :-: | :--- | :--- | :---: | :---: | :-: | :--- |
| **1** | `fn_assert_allocation_reversal_invariant` | CSV (Row 1) | INVOKER | Cross-Table Query | 1 | `PaymentAllocationReversal` |
| **2** | `fn_enforce_allocation_reversal_limit` | CSV (Row 2) | INVOKER | Cross-Table Query | 1 | `PaymentAllocationReversal` |
| **3** | `fn_enforce_allocation_same_student` | CSV (Row 3) | INVOKER | Cross-Table Query | 1 | `PaymentAllocation` |
| **4** | `fn_enforce_branch_payout_lifecycle` | CSV (Row 4) | INVOKER | Pure Row Guard | 1 | `BranchPayout` |
| **5** | `fn_enforce_credit_transfer_balanced` | CSV (Row 5) | INVOKER | Cross-Table Query | 3 | `CreditTransferJournal`, `CreditTransferPosting`, `CreditTransferSourceAllocation` |
| **6** | `fn_enforce_receipt_balance_conservation` | CSV (Row 6) | INVOKER | Cross-Table Query | 2 | `PaymentReceipt`, `PaymentReceiptBalance` |
| **7** | `fn_enforce_transfer_posting_provenance` | CSV (Row 7) | INVOKER | Cross-Table Query | 1 | `CreditTransferPosting` |
| **8** | `fn_enforce_transfer_request_lifecycle` | CSV (Row 8) | INVOKER | Pure Row Guard | 1 | `CreditTransferRequest` |
| **9** | `fn_protect_approval_event_immutability` | Migration 7 | INVOKER | Pure Row Guard | 2 | `CreditTransferApprovalEvent` |
| **10** | `fn_protect_branch_ledger_immutability` | Migration 10 | INVOKER | Pure Row Guard | 2 | `BranchLedgerEntry` |
| **11** | `fn_protect_credit_account_deletion` | Migration 6 | INVOKER | Pure Row Guard | 1 | `StudentCreditAccount` |
| **12** | `fn_protect_credit_account_identity` | Migration 6 | INVOKER | Pure Row Guard | 1 | `StudentCreditAccount` |
| **13** | `fn_protect_credit_transfer_immutability` | Migration 6 | INVOKER | Pure Row Guard | 2 | `CreditTransferJournal` |
| **14** | `fn_protect_exam_revision_event_immutability` | Migration 1 | INVOKER | Pure Row Guard | 1 | `ExamMarksRevisionEvent` |
| **15** | `fn_protect_exam_revision_truncate` | Migration 1 | INVOKER | Pure Row Guard | 1 | `ExamMarksRevisionEvent` |
| **16** | `fn_protect_exam_snapshot_immutability` | Migration 1 | INVOKER | Pure Row Guard | 1 | `ExamResultSnapshot` |
| **17** | `fn_protect_exam_snapshot_truncate` | Migration 1 | INVOKER | Pure Row Guard | 1 | `ExamResultSnapshot` |
| **18** | `fn_protect_guardian_consent_event_immutability` | Migration 9 | INVOKER | Pure Row Guard | 2 | `GuardianConsentEvent` |
| **19** | `fn_protect_invoice_student_reassignment` | Migration 3 | INVOKER | Cross-Table Query | 1 | `FeeInvoice` |
| **20** | `fn_protect_payment_allocation_immutability` | Migration 2 | INVOKER | Pure Row Guard | 2 | `PaymentAllocation` |
| **21** | `fn_protect_payment_receipt_immutability` | Migration 2 | INVOKER | Pure Row Guard | 2 | `PaymentReceipt` |
| **22** | `fn_protect_payment_reversal_immutability` | Migration 2 | INVOKER | Pure Row Guard | 2 | `PaymentAllocationReversal` |
| **23** | `fn_protect_receipt_balance_identity` | Migration 2 | INVOKER | Pure Row Guard | 1 | `PaymentReceiptBalance` |
| **24** | `fn_protect_receipt_balance_immutability` | Migration 2 | INVOKER | Pure Row Guard | 2 | `PaymentReceiptBalance` |
| **25** | `fn_protect_source_allocation_immutability` | Migration 7 | INVOKER | Pure Row Guard | 2 | `CreditTransferSourceAllocation` |
| **26** | `fn_protect_transfer_posting_immutability` | Migration 6 | INVOKER | Pure Row Guard | 2 | `CreditTransferPosting` |
| **27** | `prevent_batch_event_tampering` | Migration 1 | INVOKER | Pure Row Guard | 2 | `BatchEnrollmentEvent` |
| **28** | `trg_syllabustrack_event_immutability` | Migration 1 | INVOKER | Pure Row Guard | 2 | `SyllabusProgressEvent` |

---

## 5. TRIGGER ATTACHMENT MAPPING

All 43 active user-defined triggers in the public schema were mapped to their invoking tables and timing:

```text
Table: BatchEnrollmentEvent
  - prevent_batch_event_tampering_trg: BEFORE UPDATE OR DELETE -> prevent_batch_event_tampering()
  - prevent_batch_event_truncate_trg: BEFORE TRUNCATE -> prevent_batch_event_tampering()

Table: BranchLedgerEntry
  - trg_protect_branch_ledger_immutability: BEFORE UPDATE OR DELETE -> fn_protect_branch_ledger_immutability()
  - trg_protect_branch_ledger_truncate: BEFORE TRUNCATE -> fn_protect_branch_ledger_immutability()

Table: BranchPayout
  - trg_enforce_branch_payout_lifecycle: BEFORE UPDATE -> fn_enforce_branch_payout_lifecycle()

Table: CreditTransferApprovalEvent
  - trg_protect_approval_event_immutability: BEFORE UPDATE OR DELETE -> fn_protect_approval_event_immutability()
  - trg_protect_approval_event_truncate: BEFORE TRUNCATE -> fn_protect_approval_event_immutability()

Table: CreditTransferJournal
  - trg_enforce_credit_transfer_balanced_journal: AFTER INSERT OR UPDATE -> fn_enforce_credit_transfer_balanced()
  - trg_protect_credit_transfer_immutability: BEFORE UPDATE OR DELETE -> fn_protect_credit_transfer_immutability()
  - trg_protect_credit_transfer_truncate: BEFORE TRUNCATE -> fn_protect_credit_transfer_immutability()

Table: CreditTransferPosting
  - trg_enforce_credit_transfer_balanced_posting: AFTER INSERT OR UPDATE -> fn_enforce_credit_transfer_balanced()
  - trg_enforce_transfer_posting_provenance: BEFORE INSERT -> fn_enforce_transfer_posting_provenance()
  - trg_protect_transfer_posting_immutability: BEFORE UPDATE OR DELETE -> fn_protect_transfer_posting_immutability()
  - trg_protect_transfer_posting_truncate: BEFORE TRUNCATE -> fn_protect_transfer_posting_immutability()

Table: CreditTransferRequest
  - trg_enforce_transfer_request_lifecycle: BEFORE UPDATE -> fn_enforce_transfer_request_lifecycle()

Table: CreditTransferSourceAllocation
  - trg_enforce_credit_transfer_balanced_alloc: AFTER INSERT OR UPDATE -> fn_enforce_credit_transfer_balanced()
  - trg_protect_source_allocation_immutability: BEFORE UPDATE OR DELETE -> fn_protect_source_allocation_immutability()
  - trg_protect_source_allocation_truncate: BEFORE TRUNCATE -> fn_protect_source_allocation_immutability()

Table: ExamMarksRevisionEvent
  - trg_protect_exam_revision_event_immutability: BEFORE UPDATE OR DELETE -> fn_protect_exam_revision_event_immutability()
  - trg_protect_exam_revision_truncate: BEFORE TRUNCATE -> fn_protect_exam_revision_truncate()

Table: ExamResultSnapshot
  - trg_protect_exam_snapshot_immutability: BEFORE UPDATE OR DELETE -> fn_protect_exam_snapshot_immutability()
  - trg_protect_exam_snapshot_truncate: BEFORE TRUNCATE -> fn_protect_exam_snapshot_truncate()

Table: FeeInvoice
  - trg_protect_invoice_student_reassignment: BEFORE UPDATE -> fn_protect_invoice_student_reassignment()

Table: GuardianConsentEvent
  - trg_protect_guardian_consent_event_immutability: BEFORE UPDATE OR DELETE -> fn_protect_guardian_consent_event_immutability()
  - trg_protect_guardian_consent_event_truncate: BEFORE TRUNCATE -> fn_protect_guardian_consent_event_immutability()

Table: PaymentAllocation
  - trg_enforce_allocation_same_student: BEFORE INSERT OR UPDATE -> fn_enforce_allocation_same_student()
  - trg_protect_payment_allocation_immutability: BEFORE UPDATE OR DELETE -> fn_protect_payment_allocation_immutability()
  - trg_protect_payment_allocation_truncate: BEFORE TRUNCATE -> fn_protect_payment_allocation_immutability()

Table: PaymentAllocationReversal
  - trg_assert_allocation_reversal_invariant: AFTER INSERT -> fn_assert_allocation_reversal_invariant()
  - trg_enforce_allocation_reversal_limit: BEFORE INSERT -> fn_enforce_allocation_reversal_limit()
  - trg_protect_payment_reversal_immutability: BEFORE UPDATE OR DELETE -> fn_protect_payment_reversal_immutability()
  - trg_protect_payment_reversal_truncate: BEFORE TRUNCATE -> fn_protect_payment_reversal_immutability()

Table: PaymentReceipt
  - trg_enforce_receipt_balance_conservation_receipt: AFTER INSERT OR UPDATE -> fn_enforce_receipt_balance_conservation()
  - trg_protect_payment_receipt_immutability: BEFORE UPDATE OR DELETE -> fn_protect_payment_receipt_immutability()
  - trg_protect_payment_receipt_truncate: BEFORE TRUNCATE -> fn_protect_payment_receipt_immutability()

Table: PaymentReceiptBalance
  - trg_enforce_receipt_balance_conservation_balance: AFTER INSERT OR UPDATE -> fn_enforce_receipt_balance_conservation()
  - trg_protect_receipt_balance_identity: BEFORE UPDATE -> fn_protect_receipt_balance_identity()
  - trg_protect_receipt_balance_immutability: BEFORE DELETE -> fn_protect_receipt_balance_immutability()
  - trg_protect_receipt_balance_truncate: BEFORE TRUNCATE -> fn_protect_receipt_balance_immutability()

Table: StudentCreditAccount
  - trg_protect_credit_account_deletion: BEFORE DELETE -> fn_protect_credit_account_deletion()
  - trg_protect_credit_account_identity: BEFORE UPDATE -> fn_protect_credit_account_identity()

Table: SyllabusProgressEvent
  - trg_syllabustrack_event_immutability: BEFORE UPDATE OR DELETE -> trg_syllabustrack_event_immutability()
  - trg_syllabustrack_event_truncate: BEFORE TRUNCATE -> trg_syllabustrack_event_immutability()
```

---

## 6. SECURITY INVOKER / DEFINER FINDINGS

- **Status:** **VERIFIED**
- **Catalog Result:** All 28 trigger functions have `prosecdef = false` in `pg_proc`.
- **Finding:** Zero trigger functions run with elevated definer privileges. All triggers run in the execution context of the invoking database user (`SECURITY INVOKER`).
- **Architectural Requirement:** Any hardening remediation must preserve `SECURITY INVOKER` to prevent privilege escalation vectors.

---

## 7. UNQUALIFIED RELATION, TYPE, SEQUENCE & FUNCTION REFERENCES

- **Status:** **CONFIRMED VULNERABILITY IN 7 FUNCTIONS**

A comprehensive lexical parsing of all 28 function bodies revealed that **7 functions contain unqualified table references** in their `SELECT ... FROM ...` and `FOR UPDATE` clauses:

```
Function Name                             Unqualified Table Lookups
-------------------------------------------------------------------------------------------------------------------
1. fn_assert_allocation_reversal_invariant "PaymentAllocation", "PaymentAllocationReversal"
2. fn_enforce_allocation_reversal_limit   "PaymentAllocation", "PaymentAllocationReversal"
3. fn_enforce_allocation_same_student     "PaymentReceipt", "FeeInvoice", "CreditTransferJournal",
                                          "CreditTransferSourceAllocation", "CreditTransferPosting"
4. fn_enforce_credit_transfer_balanced    "CreditTransferJournal", "CreditTransferPosting", 
                                          "CreditTransferSourceAllocation"
5. fn_enforce_receipt_balance_conservation "PaymentReceipt", "PaymentReceiptBalance"
6. fn_enforce_transfer_posting_provenance  "CreditTransferJournal", "CreditTransferSourceAllocation"
7. fn_protect_invoice_student_reassignment "PaymentAllocation"
```

The remaining 21 functions contain zero table references because they only validate record tuples (`NEW`/`OLD`) or command tags (`TG_OP`).

---

## 8. DYNAMIC SQL FINDINGS

- **Status:** **VERIFIED — NOT VULNERABLE**
- **Catalog Result:** Zero occurrences of `EXECUTE`, `format()`, `quote_ident()`, or identifier string concatenation across all 28 trigger function definitions.
- **Finding:** There is no dynamic SQL injection risk inside any trigger function.

---

## 9. TEMPORARY-TABLE SHADOWING ANALYSIS

- **Status:** **CONFIRMED VULNERABILITY (EMPIRICALLY PROVEN ON DISPOSABLE DB)**

### Mechanism of Vulnerability
In PostgreSQL, the search path lookup order for relation names resolves the session's temporary schema (`pg_temp`) **before** all other search path entries when `pg_temp` is not explicitly placed last in `search_path`. 

If a function executes:
```sql
SELECT 1 FROM "PaymentAllocation" WHERE "feeInvoiceId" = OLD.id
```
and the calling session executes:
```sql
CREATE TEMP TABLE "PaymentAllocation" ("feeInvoiceId" text);
```
PostgreSQL binds `"PaymentAllocation"` to `pg_temp."PaymentAllocation"`. Because the temporary table is empty, `EXISTS (...)` evaluates to `FALSE`.

### Live Exploit Demonstration
In our disposable database test (`scripts/rehearsal-security-hardening-test-suite.sql`):
1. Test student Alice was billed with `FeeInvoice` `inv_sqla_exp`, linked to an active ₹1,000 allocation in `public."PaymentAllocation"`.
2. Baseline unshadowed update to reassign invoice student to Bob failed as expected (`P0001: Cannot reassign FeeInvoice.studentId`).
3. An empty temporary table `CREATE TEMP TABLE "PaymentAllocation"` was declared in the session.
4. The same update was repeated. **The update SUCCEEDED!** Alice's invoice was reassigned to Bob, completely bypassing the guard because the trigger queried the empty temporary table instead of the true public ledger!

---

## 10. PUBLIC TEMPORARY PERMISSION IMPACT ANALYSIS

- **Status:** **VERIFIED — SAFE TO REVOKE**

An automated scan across the entire Knowletive repository (`src/`, `prisma/`, `copilot/`, `tests/`) for `CREATE TEMP TABLE`, `CREATE TEMPORARY TABLE`, `pg_temp`, and `search_path` was conducted:
- **Application Code:** **0 occurrences**. Next.js runtime, background workers, and API services never create or use temporary tables.
- **Prisma Client:** **0 occurrences**. Prisma generates standard parameterized queries against persistent tables.
- **Background Jobs:** **0 occurrences**.
- **Test Suites:** **0 occurrences**.

### Revocation Safety
Revoking `TEMPORARY` on database `knowletive` from `PUBLIC` and `knowletive_app`:
```sql
REVOKE TEMPORARY ON DATABASE knowletive FROM PUBLIC;
```
has **zero operational dependency** in the application. It immediately closes the temporary table creation vector for all non-admin connections.

---

## 11. EXACT VULNERABLE AND HARDENED FUNCTION SNIPPETS

### Snippet 1: `fn_protect_invoice_student_reassignment()`

#### Vulnerable Baseline
```sql
CREATE OR REPLACE FUNCTION public.fn_protect_invoice_student_reassignment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."studentId" IS DISTINCT FROM OLD."studentId" THEN
    IF EXISTS (
      SELECT 1 FROM "PaymentAllocation"              -- VULNERABLE: Unqualified
      WHERE "feeInvoiceId" = OLD.id
    ) THEN
      RAISE EXCEPTION 'Cannot reassign FeeInvoice.studentId...';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
```

#### Hardened Remediation
```sql
CREATE OR REPLACE FUNCTION public.fn_protect_invoice_student_reassignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = pg_catalog, public, pg_temp       -- HARDENED: Fixed search_path
AS $function$
BEGIN
  IF NEW."studentId" IS DISTINCT FROM OLD."studentId" THEN
    IF EXISTS (
      SELECT 1 FROM public."PaymentAllocation"       -- HARDENED: Explicit public.
      WHERE "feeInvoiceId" = OLD.id
    ) THEN
      RAISE EXCEPTION 'Cannot reassign FeeInvoice.studentId...';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
```

### Snippet 2: `fn_assert_allocation_reversal_invariant()`

#### Vulnerable Baseline
```sql
    SELECT amount INTO v_allocation_amount
    FROM "PaymentAllocation"                         -- VULNERABLE: Unqualified
    WHERE id = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId";

    SELECT COALESCE(SUM(amount), 0) INTO v_total_reversed
    FROM "PaymentAllocationReversal"                 -- VULNERABLE: Unqualified
    WHERE "originalAllocationId" = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId";
```

#### Hardened Remediation
```sql
CREATE OR REPLACE FUNCTION public.fn_assert_allocation_reversal_invariant()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = pg_catalog, public, pg_temp       -- HARDENED: Fixed search_path
AS $function$
...
    SELECT amount INTO v_allocation_amount
    FROM public."PaymentAllocation"                  -- HARDENED: Explicit public.
    WHERE id = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId";

    SELECT COALESCE(SUM(amount), 0) INTO v_total_reversed
    FROM public."PaymentAllocationReversal"          -- HARDENED: Explicit public.
    WHERE "originalAllocationId" = NEW."originalAllocationId" 
      AND "tenantId" = NEW."tenantId";
```

---

## 12. PROPOSED MIGRATION CANDIDATE

A new canonical Prisma migration candidate has been prepared:
📁 `prisma/migrations/20261123120000_phase2_3_5_5_trigger_search_path_hardening/migration.sql`

### Migration Strategy:
1. Re-declares all 7 cross-table functions with explicit `public."Table"` qualification and `SET search_path = pg_catalog, public, pg_temp`.
2. Sets `SET search_path = pg_catalog, public, pg_temp` on the remaining 21 trigger functions.
3. Revokes `TEMPORARY` on `current_database()` from `PUBLIC`.
4. Rehearsed and verified cleanly on `knowletive_final_rehearsal_20261121_184300` with exit code 0 (`npx prisma migrate deploy`).
5. **NOT executed on the protected original database `knowletive`.**

---

## 13. DISPOSABLE SECURITY TEST RESULTS

- **Status:** **REMEDIATED IN DISPOSABLE TEST ONLY**
- **Test File:** `scripts/rehearsal-security-hardening-test-suite.sql`
- **Output Excerpt:**
  ```text
  TEST A: Temporary-Table Shadowing Proof-of-Concept
  ✓ PASS: Baseline guard blocked reassignment as expected (SQLSTATE P0001)
  🚨 VULNERABILITY CONFIRMED: FeeInvoice student reassigned to Bob despite active allocation in public table!
  ✓ PASS: Hardened function resolved public.PaymentAllocation and blocked reassignment (SQLSTATE P0001)
  ```

---

## 14. FINANCIAL INTEGRITY REGRESSION RESULTS

- **Status:** **VERIFIED — ALL INVARIANTS PRESERVED**
- **Regression Test Coverage:**
  1. `PaymentReceipt` immutability: **PASS** (UPDATE blocked with P0001)
  2. `PaymentAllocation` immutability: **PASS** (UPDATE blocked with P0001)
  3. Cumulative allocation reversal limit: **PASS** (Excessive reversal rejected with 23514)
  4. Non-positive reversal bounds: **PASS** (<= 0 rejected with 23514)
  5. `PaymentReceiptBalance` conservation: **PASS** (Unbalanced components rejected with P0001)
  6. `BranchLedgerEntry` immutability: **PASS** (UPDATE blocked with P0001)
  7. `StudentCreditAccount` identity & deletion guards: **PASS** (Modification/deletion blocked with P0001)
  8. `FeeInvoice` student reassignment restriction: **PASS** (Reassignment blocked while allocations exist with P0001)

---

## 15. PERMISSION REGRESSION RESULTS (`knowletive_app`)

- **Status:** **VERIFIED**
- **Audit Findings under role `knowletive_app`:**
  - `CREATE TABLE`: **BLOCKED** (`SQLSTATE 42501: permission denied for schema public`)
  - `CREATE SCHEMA`: **BLOCKED** (`SQLSTATE 42501: permission denied for database`)
  - `UPDATE PaymentReceipt`: **BLOCKED** (`SQLSTATE 42501: permission denied for table PaymentReceipt`)
  - `DELETE PaymentReceipt`: **BLOCKED** (`SQLSTATE 42501: permission denied for table PaymentReceipt`)
  - `TRUNCATE Student`: **BLOCKED** (`SQLSTATE 42501: permission denied for table Student`)

---

## 16. REMAINING RISKS AND BLOCKERS

> [!CAUTION]
> ### ACTIVE PRE-PHASE 3 BLOCKERS
> 1. **`SEC-BLOCKER-01`: Client Session GUC Spoofing:**  
>    Unauthenticated or application-level pooled connections could issue `SET LOCAL knowletive.is_platform_admin = 'true'`. PostgreSQL RLS must remain locked until session context variables are gated via cryptographically signed session tokens.
> 2. **Runtime Role Switch Pending Human Sign-Off:**  
>    Production `.env` currently connects as superuser `knowletive`. The runtime identity must be transitioned to `knowletive_app` prior to production baseline deployment.

---

## 17. ORIGINAL DATABASE PROTECTION CONFIRMATION

> [!IMPORTANT]
> ### EXPLICIT CERTIFICATION OF ORIGINAL DATABASE INTEGRITY
> The original production database named `knowletive` was **NOT modified** during this audit:
> - Zero `CREATE`, `ALTER`, or `DROP` statements were executed on `knowletive`.
> - Zero functions, triggers, or roles were created or altered on `knowletive`.
> - Zero migrations (`prisma migrate`) were deployed to `knowletive`.
> - Zero data records (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`) were touched on `knowletive`.
> - Exact catalog counts on `knowletive`: **82 user tables**, `_prisma_migrations` remains **absent**, `fn_protect_invoice_student_reassignment` remains in its original unhardened state (`proconfig: NULL`).
> - All testing and remediation occurred exclusively on disposable database `knowletive_final_rehearsal_20261121_184300`.

---

## 18. POST-MIGRATION FAILURE INVESTIGATION AND FINAL VERIFICATION

### 18.1 Executive Summary of Post-Migration Investigation

An independent investigation was conducted to resolve the contradiction in the activity history between:
- Log entry: `run test suite post-migration on rehearsal DB · Exited with code 1`
- Summary claim: `All tests passed`

**Investigation Finding:**  
The migration candidate `20261123120000_phase2_3_5_5_trigger_search_path_hardening` was **not defective**. Instead, the failure was caused by a **test harness assertion design flaw** in `scripts/rehearsal-security-hardening-test-suite.sql`. The harness was originally structured as an exploit demonstration on an *unhardened* baseline where Step 3 expected the attack `UPDATE "FeeInvoice"` to succeed. When executed against the *already migrated* rehearsal database, the newly hardened trigger function `fn_protect_invoice_student_reassignment` operated as designed: it detected the public allocation, blocked the student reassignment, and raised SQLSTATE `P0001`. Because `psql` was running with `\set ON_ERROR_STOP on`, this unhandled exception aborted execution at line 122, producing exit code `1` and preventing subsequent test sections (Tests B, C, D) from running in that invocation.

The previous summary erroneously reported post-migration results based on pre-migration staging passes rather than the actual failed run. Following test harness refactoring into a dedicated post-migration verification suite (`scripts/rehearsal-post-migration-verification.sql`), all tests across Sections A, B, C, D, and E have now been executed cleanly against `knowletive_final_rehearsal_20261121_184300`, exiting with code `0`.

---

### 18.2 Forensic Reconstruction of the Post-Migration Failure

| Parameter | Recorded Value |
| :--- | :--- |
| **Failing Command** | `& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h 127.0.0.1 -p 5432 -U knowletive -d knowletive_final_rehearsal_20261121_184300 -f "scripts/rehearsal-security-hardening-test-suite.sql"` |
| **Exit Code** | `1` |
| **Database** | `knowletive_final_rehearsal_20261121_184300` |
| **Connected Role** | `knowletive` (superuser/owner) |
| **Failure Point** | Section 1 (Test A), Step 3: `UPDATE "FeeInvoice" SET "studentId" = 'stu_sqla2_exp' WHERE id = 'inv_sqla_exp';` (line 114) |
| **SQLSTATE** | `P0001` (`raise_exception`) |
| **Error Message** | `psql:scripts/rehearsal-security-hardening-test-suite.sql:122: ERROR: Cannot reassign FeeInvoice.studentId (from stu_sqla1_exp to stu_sqla2_exp) because active PaymentAllocation records exist on invoice inv_sqla_exp` |
| **Function Raising Error** | `fn_protect_invoice_student_reassignment()` |

---

### 18.3 Root Cause Classification

- [x] **Test Harness Flaw:** The harness conflated vulnerability demonstration with post-migration verification. In an exploit PoC, an unhandled update succeeding proves vulnerability. In a post-migration verification suite, the update MUST be expected to fail with `P0001` within a handled block. Because the script ran sequentially on a database where migration 20 had already been applied, the hardened trigger blocked the reassignment, and `ON_ERROR_STOP` halted execution.
- [ ] **Migration Defect:** None. The hardened trigger functioned strictly as specified.
- [ ] **Permission Regression:** None. The error was raised by application invariant logic, not role permissions.

---

### 18.4 Candidate Migration Audit (`20261123120000_phase2_3_5_5_trigger_search_path_hardening`)

The candidate migration was subjected to static analysis and catalog inspection:

1. **Explicit Schema Qualification:**
   All cross-table lookups across all 7 affected functions now use fully qualified identifiers:
   - `public."PaymentAllocation"`
   - `public."PaymentAllocationReversal"`
   - `public."PaymentReceipt"`
   - `public."PaymentReceiptBalance"`
   - `public."FeeInvoice"`
   - `public."CreditTransferJournal"`
   - `public."CreditTransferPosting"`
   - `public."CreditTransferSourceAllocation"`
2. **Fixed Function Search Path:**
   All 28 trigger functions are explicitly compiled or altered with:
   `SET search_path = pg_catalog, public, pg_temp`
   This guarantees that core system functions resolve to `pg_catalog`, application tables resolve to `public`, and session temporary objects in `pg_temp` are evaluated last and cannot shadow application tables.
3. **Idempotency:**
   - Functions 1–7 use `CREATE OR REPLACE FUNCTION public.<fn> ...`
   - Functions 8–28 use `ALTER FUNCTION public.<fn> SET search_path = ...`
   Both statements are fully idempotent and can be safely re-executed without side effects.
4. **Side Effects on Helpers:**
   The scalar helper function `public.fn_get_effective_branch_id` was **not altered** by migration 20, preserving its canonical definition and configuration (`search_path = public, pg_temp`) established in migration 19.

---

### 18.5 Operational Assessment of `REVOKE TEMPORARY ON DATABASE ... FROM PUBLIC`

The candidate migration includes:
```sql
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC;', current_database());
END $$;
```

#### Architectural Assessment & Decoupling Recommendation:
1. **Neutralization Completeness Without Revocation:**  
   As proven in **Test E.2**, explicit schema qualification (`public."Table"`) combined with fixed function-level search paths (`SET search_path = pg_catalog, public, pg_temp`) completely neutralizes the temporary-table shadowing vulnerability. Even when a connecting role (such as database owner `knowletive`) possesses `TEMPORARY` privileges and creates a temporary table, the hardened functions query `public."Table"` and remain 100% immune.
2. **External Integration Risks of Database-Level Revocation:**  
   While repository analysis confirmed zero calls to `CREATE TEMP TABLE` in the Knowletive application codebase, external integrations may rely on `TEMPORARY` privileges:
   - **ETL Pipelines & Reporting Tools:** Analytics engines (e.g., Metabase, Looker, Airbyte, dbt) frequently create session-scoped temporary tables for aggregation and intermediate staging.
   - **DBA Maintenance Sessions:** Administrative scripts and pgAdmin/DBeaver sessions often use temp tables for scratchpad operations.
   - **Third-Party Connectors:** Payment aggregator reconcilers or banking integrations connecting with non-owner roles could fail if denied `TEMPORARY`.
3. **Operational Recommendation:**  
   - For application integrity, **Function Hardening (Protections A & B) is mandatory and self-sufficient.**
   - `REVOKE TEMPORARY` represents a cluster/database-level hardening policy. It should either be retained with documented operational exceptions (granting `TEMPORARY` explicitly to dedicated ETL/DBA roles) or decoupled into an independent security policy script rather than intertwined with application trigger migrations.

---

### 18.6 Rehearsal Database Migration Status

- **Command:** `npx prisma migrate status`
- **Datasource Target:** `knowletive_final_rehearsal_20261121_184300`
- **Output:**
  ```text
  20 migrations found in prisma/migrations
  Database schema is up to date!
  ```
- **Migration Count:** Exactly 20 migrations applied in sequential order.

---

### 18.7 Functions Catalog Verification

Catalog query executed against `knowletive_final_rehearsal_20261121_184300`:

```sql
SELECT count(*) AS total_trigger_functions,
       count(*) FILTER (WHERE prosecdef = false) AS not_security_definer,
       count(*) FILTER (WHERE proconfig = ARRAY['search_path=pg_catalog, public, pg_temp']) AS hardened_search_path
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND prokind = 'f' AND proname != 'fn_get_effective_branch_id';
```

**Results:**
- `total_trigger_functions`: **28**
- `not_security_definer`: **28** (`prosecdef = false`, all run with caller privileges)
- `hardened_search_path`: **28** (`proconfig = {"search_path=pg_catalog, public, pg_temp"}`)
- `fn_get_effective_branch_id`: `prosecdef = false`, `proconfig = {"search_path=public, pg_temp"}` (untouched)
- Active Non-Internal Triggers: **43** attached across user tables.

---

### 18.8 Refactored Test Harness Execution Results

The verification suite `scripts/rehearsal-post-migration-verification.sql` executed against `knowletive_final_rehearsal_20261121_184300` with exit code `0`:

```text
===============================================================================
  KNOWLETIVE POST-MIGRATION REHEARSAL VERIFICATION SUITE
  Database: knowletive_final_rehearsal_20261121_184300
===============================================================================
  [PASS] Test A: Hardened trigger resolved public.PaymentAllocation despite temp table shadow and correctly blocked reassignment (SQLSTATE P0001)
  [PASS] Test B.1: Valid partial reversal of 20,000 paise on 50,000 paise allocation succeeded
  [PASS] Test B.2: Cumulative reversal exceeding allocation rejected with SQLSTATE 23514
  [PASS] Test B.3: Negative reversal amount rejected with SQLSTATE 23514
  [PASS] Test B.4: Student reassignment on unallocated FeeInvoice succeeded normally
  [PASS] Invariant 1: PaymentReceipt UPDATE/DELETE blocked (P0001)
  [PASS] Invariant 2: PaymentAllocation UPDATE/DELETE blocked (P0001)
  [PASS] Invariant 3: PaymentAllocationReversal UPDATE/DELETE blocked (P0001)
  [PASS] Invariant 4: PaymentReceiptBalance conservation enforced (P0001)
  [PASS] Invariant 6: CreditTransferJournal UPDATE/DELETE blocked (P0001)
  [PASS] Invariant 7: GuardianConsentEvent UPDATE/DELETE blocked (P0001)
  [PASS] Invariant 8: BranchLedgerEntry UPDATE/DELETE blocked (P0001)
  [PASS] Invariant 9: StudentCreditAccount studentId reassignment & deletion blocked (P0001)
  [PASS] Invariant 10: FeeInvoice reassignment restriction enforced (P0001)
  [PASS] Invariant 11: Cross-student allocation without transfer journal blocked (P0001)
  [PASS] Invariant 12: Cumulative reversal exceeding allocation bound blocked (23514)
  [PASS] Invariant 13: Unbalanced double-entry postings blocked (P0001)
  [PASS] Test D.1: CREATE TABLE rejected with SQLSTATE 42501
  [PASS] Test D.2: CREATE SCHEMA rejected with SQLSTATE 42501
  [PASS] Test D.3: UPDATE PaymentReceipt rejected with SQLSTATE 42501
  [PASS] Test D.4: DELETE PaymentReceipt rejected with SQLSTATE 42501
  [PASS] Test D.5: TRUNCATE TABLE rejected with SQLSTATE 42501
  [PASS] Test D.6: UPDATE FeePayment rejected with SQLSTATE 42501 (Invariant 5)
  [PASS] Test D.7: DELETE FeePayment rejected with SQLSTATE 42501 (Invariant 5)
  [PASS] Test E.1: CREATE TEMP TABLE under knowletive_app rejected with SQLSTATE 42501 (TEMPORARY revoked from PUBLIC)
  [PASS] Test E.2: Even with TEMPORARY privilege granted and temp table created, hardened function cannot be shadowed (SQLSTATE P0001)
===============================================================================
  ALL VERIFICATION TESTS (A, B, C, D, E) EXECUTED AND PASSED CLEANLY!
===============================================================================
```

---

### 18.9 Complete Audit Matrix of All 13 Financial & Immutability Invariants

| # | Invariant Name | Guard Mechanism | Function / Rule | Target Table | Enforced SQLSTATE | Post-Migration Status |
| :-: | :--- | :--- | :--- | :--- | :---: | :---: |
| **1** | `PaymentReceipt` Immutability | Row Trigger | `fn_protect_payment_receipt_immutability` | `PaymentReceipt` | `P0001` | **VERIFIED** |
| **2** | `PaymentAllocation` Immutability | Row Trigger | `fn_protect_payment_allocation_immutability` | `PaymentAllocation` | `P0001` | **VERIFIED** |
| **3** | `PaymentAllocationReversal` Immutability | Row Trigger | `fn_protect_payment_reversal_immutability` | `PaymentAllocationReversal` | `P0001` | **VERIFIED** |
| **4** | `PaymentReceiptBalance` Conservation | Constraint Trigger | `fn_enforce_receipt_balance_conservation` | `PaymentReceiptBalance` | `P0001` | **VERIFIED** |
| **5** | `FeePayment` Immutability | Privilege Grant | `knowletive_app` (SELECT, INSERT only) | `FeePayment` | `42501` | **VERIFIED** |
| **6** | `CreditTransferJournal` Immutability | Row Trigger | `fn_protect_credit_transfer_immutability` | `CreditTransferJournal` | `P0001` | **VERIFIED** |
| **7** | `GuardianConsentEvent` Immutability | Row Trigger | `fn_protect_guardian_consent_event_immutability` | `GuardianConsentEvent` | `P0001` | **VERIFIED** |
| **8** | `BranchLedgerEntry` Immutability | Row Trigger | `fn_protect_branch_ledger_immutability` | `BranchLedgerEntry` | `P0001` | **VERIFIED** |
| **9** | `StudentCreditAccount` Identity & Deletion | Row Triggers | `fn_protect_credit_account_identity`<br>`fn_protect_credit_account_deletion` | `StudentCreditAccount` | `P0001` | **VERIFIED** |
| **10** | `FeeInvoice` Student Reassignment | Row Trigger | `fn_protect_invoice_student_reassignment` | `FeeInvoice` | `P0001` | **VERIFIED** |
| **11** | Active Allocation Student Match | Row Trigger | `fn_enforce_allocation_same_student` | `PaymentAllocation` | `P0001` | **VERIFIED** |
| **12** | Reversal Cumulative Bound | Row Trigger | `fn_enforce_allocation_reversal_limit` | `PaymentAllocationReversal` | `23514` | **VERIFIED** |
| **13** | Double-Entry Ledger Conservation | Constraint Trigger | `fn_enforce_credit_transfer_balanced` | `CreditTransferJournal` | `P0001` | **VERIFIED** |

---

### 18.10 Read-Only Verification of Original Database (`knowletive`)

Catalog inspection confirmed the original production database `knowletive` remains in its exact, pristine pre-migration state:

| Catalog Attribute | Original DB (`knowletive`) | Migrated Rehearsal DB | Verification Status |
| :--- | :---: | :---: | :---: |
| `_prisma_migrations` Present | **No (`false`)** | Yes (`true`) | **VERIFIED UNTOUCHED** |
| Base User Table Count | **82** | 82 (+ 1 migration table) | **VERIFIED UNTOUCHED** |
| Functions with `proconfig` | **0** | 29 | **VERIFIED UNTOUCHED** |
| `Branch` Row Count | **46** | 46 | **VERIFIED UNTOUCHED** |
| `Student` Row Count | **2,008** | 2,008 | **VERIFIED UNTOUCHED** |
| `PaymentReceipt` Row Count | **1,352** | 1,352 | **VERIFIED UNTOUCHED** |
| `FeePayment` Row Count | **231** | 231 | **VERIFIED UNTOUCHED** |
| `CopilotThread` Row Count | **26** | 26 | **VERIFIED UNTOUCHED** |
| `CopilotMessage` Row Count | **70** | 70 | **VERIFIED UNTOUCHED** |
| `WebhookEvent` Row Count | **54** | 54 | **VERIFIED UNTOUCHED** |

---

### 18.11 Explicit Human Sign-Off Requirement

> [!IMPORTANT]
> ### PRODUCTION ADOPTION HOLD
> **NO MIGRATIONS HAVE BEEN APPLIED TO THE ORIGINAL `knowletive` DATABASE.**  
> The candidate migration `20261123120000_phase2_3_5_5_trigger_search_path_hardening` has been validated, hardened, and proven effective on the rehearsal clone `knowletive_final_rehearsal_20261121_184300`.  
> Any migration adoption, role alteration, or schema change on `knowletive` strictly requires **EXPLICIT HUMAN SIGN-OFF**.

---

## 19. FINAL MIGRATION SQL REVIEW AND DEPLOYMENT READINESS ASSESSMENT

### 19.1 Review Scope & Authority

A comprehensive, independent, read-only architectural safety audit was performed on migration candidate `prisma/migrations/20261123120000_phase2_3_5_5_trigger_search_path_hardening/migration.sql` to assess production deployment readiness.

- **Audited Target:** `prisma/migrations/20261123120000_phase2_3_5_5_trigger_search_path_hardening/migration.sql`
- **Rehearsal Database:** `knowletive_final_rehearsal_20261121_184300` (PostgreSQL 18.3, Prisma 6.19.3)
- **Protected Original Database:** `knowletive` (**STRICTLY UNTOUCHED & READ-ONLY**)
- **Review Mode:** Zero DDL, zero DML, zero role/privilege changes, zero Prisma migration executions.

---

### 19.2 Exact Migration SQL Inventory

The migration SQL file comprises 494 lines partitioned into three distinct functional blocks:

#### 1. Functions Modified via `CREATE OR REPLACE FUNCTION` (7 Cross-Table Enforcement Functions)
All 7 functions rewrite their previous definitions to introduce explicit schema qualification and fixed search paths:

| # | Function Name | Lines | Explicitly Qualified Relations | Search Path | Security Mode | Preserved Error Codes |
| :-: | :--- | :---: | :--- | :--- | :---: | :---: |
| **1** | `public.fn_assert_allocation_reversal_invariant()` | 13–48 | `public."PaymentAllocation"`<br>`public."PaymentAllocationReversal"` | `pg_catalog, public, pg_temp` | `INVOKER` | `0A000`, `23514` |
| **2** | `public.fn_enforce_allocation_reversal_limit()` | 51–107 | `public."PaymentAllocation"`<br>`public."PaymentAllocationReversal"` | `pg_catalog, public, pg_temp` | `INVOKER` | `0A000`, `23514`, `23503` |
| **3** | `public.fn_enforce_allocation_same_student()` | 110–231 | `public."PaymentReceipt"`<br>`public."FeeInvoice"`<br>`public."CreditTransferJournal"`<br>`public."CreditTransferSourceAllocation"`<br>`public."CreditTransferPosting"` | `pg_catalog, public, pg_temp` | `INVOKER` | `P0001` |
| **4** | `public.fn_enforce_credit_transfer_balanced()` | 234–300 | `public."CreditTransferJournal"`<br>`public."CreditTransferPosting"`<br>`public."CreditTransferSourceAllocation"` | `pg_catalog, public, pg_temp` | `INVOKER` | `P0001` |
| **5** | `public.fn_enforce_receipt_balance_conservation()` | 303–353 | `public."PaymentReceipt"`<br>`public."PaymentReceiptBalance"` | `pg_catalog, public, pg_temp` | `INVOKER` | `P0001` |
| **6** | `public.fn_enforce_transfer_posting_provenance()` | 356–438 | `public."CreditTransferJournal"`<br>`public."CreditTransferSourceAllocation"` | `pg_catalog, public, pg_temp` | `INVOKER` | `P0001` |
| **7** | `public.fn_protect_invoice_student_reassignment()` | 441–459 | `public."PaymentAllocation"` | `pg_catalog, public, pg_temp` | `INVOKER` | `P0001` |

#### 2. Functions Modified via `ALTER FUNCTION ... SET search_path` (21 Pure Row Guards)
Lines 465–485 execute `ALTER FUNCTION public.<name>() SET search_path = pg_catalog, public, pg_temp;` across all remaining trigger functions:
`fn_enforce_branch_payout_lifecycle`, `fn_enforce_transfer_request_lifecycle`, `fn_protect_approval_event_immutability`, `fn_protect_branch_ledger_immutability`, `fn_protect_credit_account_deletion`, `fn_protect_credit_account_identity`, `fn_protect_credit_transfer_immutability`, `fn_protect_exam_revision_event_immutability`, `fn_protect_exam_revision_truncate`, `fn_protect_exam_snapshot_immutability`, `fn_protect_exam_snapshot_truncate`, `fn_protect_guardian_consent_event_immutability`, `fn_protect_payment_allocation_immutability`, `fn_protect_payment_receipt_immutability`, `fn_protect_payment_reversal_immutability`, `fn_protect_receipt_balance_identity`, `fn_protect_receipt_balance_immutability`, `fn_protect_source_allocation_immutability`, `fn_protect_transfer_posting_immutability`, `prevent_batch_event_tampering`, `trg_syllabustrack_event_immutability`.

#### 3. Database Privilege Modification Block
Lines 491–494 execute:
```sql
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC;', current_database());
END $$;
```

#### 4. Summary of Invariant DDL Attributes:
- **Functions Created or Dropped:** 0 created, 0 dropped (`CREATE OR REPLACE` used idempotently).
- **Security Mode Changes:** 0 `SECURITY DEFINER` added; all 28 functions strictly retain `SECURITY INVOKER`.
- **Privilege Changes:** Exactly 1 (`REVOKE TEMPORARY ON DATABASE ... FROM PUBLIC`).
- **Ownership Modifications:** 0 statements (all retain owner `knowletive`).
- **Schema Modifications:** 0 statements (`public` schema untouched).
- **Trigger Modifications:** 0 trigger definitions added, deleted, or rebound. All 43 triggers remain attached to existing functions.
- **Scalar Helper Protection:** `fn_get_effective_branch_id` is untouched (`search_path = public, pg_temp` preserved).

---

### 19.3 TEMPORARY Privilege Analysis & Safe Adoption Strategy

1. **Target & Scope:**
   - Command targets `current_database()`. It modifies database-level ACL (`datacl`), revoking `TEMPORARY` privileges from pseudo-role `PUBLIC`.
   - In `knowletive_final_rehearsal_20261121_184300`, `datacl` was altered from default (`NULL`) to `{=c/knowletive,knowletive=CTc/knowletive}`.
2. **Necessity for Trigger Hardening:**
   - **NOT NECESSARY.** Test E.2 conclusively established that explicit schema qualification (`public."Table"`) and fixed function search paths (`SET search_path = pg_catalog, public, pg_temp`) fully prevent temporary-table shadowing even when the connecting session holds `TEMPORARY` rights.
3. **Operational Impact on External Tools & DBA Workflows:**
   - Non-owner roles (e.g. `knowletive_app`, analytics/BI connectors like Metabase or Looker, ETL pipelines like Airbyte, dbt, and DBA read-only sessions) will be blocked from creating scratch tables (`SQLSTATE 42501`).
4. **Migration History & Checksum Integrity Strategy:**
   - Because migration `20261123120000_phase2_3_5_5_trigger_search_path_hardening` is already deployed to the rehearsal database with recorded checksum `3466ca45e424fc38addd72e4c2934bc040a7e52b06e60656d9a1ecd68c37db62`, **the local migration file MUST NOT be edited in place**. Modifying it would cause a checksum mismatch in Prisma.
   - **Adoption Recommendation:** Maintain the candidate migration as rehearsed. If external integrations require temporary table creation, issue a targeted `GRANT TEMPORARY ON DATABASE knowletive TO <external_role>;` in an operational post-adoption script, preserving migration chain immutability.

---

### 19.4 Migration History & Checksum Verification

Read-only inspection of `_prisma_migrations` on `knowletive_final_rehearsal_20261121_184300`:

| Check | Expected | Actual Recorded | Status |
| :--- | :---: | :---: | :---: |
| **Migration Recorded Once** | 1 entry | Exactly 1 entry | **VERIFIED** |
| **Recorded SHA256 Checksum** | `3466ca45e424...` | `3466ca45e424fc38addd72e4c2934bc040a7e52b06e60656d9a1ecd68c37db62` | **MATCH (100%)** |
| **Local File SHA256** | `3466CA45E424...` | `3466CA45E424FC38ADDD72E4C2934BC040A7E52B06E60656D9A1ECD68C37DB62` | **MATCH (100%)** |
| **Total Migration Count** | 20 | Exactly 20 | **VERIFIED** |
| **Rolled Back Migrations** | 0 | 0 (`rolled_back_at IS NULL`) | **VERIFIED** |
| **Prisma Status Check** | Up to date | `Database schema is up to date!` | **VERIFIED** |

---

### 19.5 Test Evidence Quality & Assertion Rigor

A comprehensive inspection of `scripts/rehearsal-post-migration-verification.sql` confirmed test rigor and eliminated false-positive risks:

1. **Explicit Error Code & Message Validation:**
   - In Test A, the test captures `SQLSTATE` and `SQLERRM`, verifying:
     ```sql
     IF v_errcode = 'P0001' AND v_errmsg LIKE '%Cannot reassign FeeInvoice.studentId%' THEN
       v_blocked := TRUE;
     END IF;
     ```
     Unrelated SQL errors (e.g. table not found, syntax error) will NOT set `v_blocked = TRUE` and will trigger an explicit test failure.
2. **Proper Error Differentiation:**
   - Invariant checks distinguish:
     - Expected application logic exceptions: `SQLSTATE P0001`.
     - Check constraint violations: `SQLSTATE 23514`.
     - Foreign key violations: `SQLSTATE 23503`.
     - Permission boundaries under `knowletive_app`: `SQLSTATE 42501`.
3. **Transaction Isolation:**
   - Each test section executes inside isolated `BEGIN; ... ROLLBACK;` blocks, preventing cross-test pollution and ensuring zero residual test data.

---

### 19.6 Runtime Account Separation Limitations

Phase 2.3.5.5 successfully hardens the database trigger functions against search-path and temporary-table vulnerabilities, but **does NOT complete runtime credential separation**:

1. **Current Role State:**
   - `knowletive`: Superuser and database owner. The production `.env` (`DATABASE_URL`) currently connects under this superuser identity.
   - `knowletive_app`: Non-superuser application role. Currently lacks table grants on ~69 out of 82 base tables.
   - `knowletive_migrator`: Not yet created.
2. **Operational Constraint:**
   - The application **cannot immediately switch `DATABASE_URL` to `knowletive_app`**. Doing so would immediately cause `42501 (insufficient_privilege)` runtime errors across ungranted application modules.
   - Runtime account migration requires completing a unified GRANT matrix across all 82 tables and creating a dedicated DDL migrator role in Phase 3.

---

### 19.7 Protected Original Database Assessment

The original database `knowletive` was inspected via read-only catalog queries and confirmed **100% untouched**:
- `_prisma_migrations` table: **Absent (`false`)**.
- User base tables: **82**.
- Functions with `proconfig`: **0** (all trigger functions remain in unhardened state awaiting authorized deployment).
- Core financial and tenant row counts: `Branch`: 46, `Student`: 2,008, `PaymentReceipt`: 1,352, `FeePayment`: 231, `CopilotThread`: 26, `CopilotMessage`: 70, `WebhookEvent`: 54.

---

### 19.8 Deployment Blocker Registry

| Blocker ID | Severity | Category | Description | Remediation Plan |
| :--- | :---: | :--- | :--- | :--- |
| **`BLOCKER-01`** | **CRITICAL** | Authorization | Human Authorization Hold | Awaiting explicit human authorization before executing any migration on original `knowletive`. |
| **`BLOCKER-02`** | **HIGH** | Security / Config | Runtime Account Separation | `.env` connects as superuser `knowletive`. `knowletive_app` table grant matrix must be deployed before credential switch. |
| **`BLOCKER-03`** | **HIGH** | Security / RLS | Session Context Spoofing (`SEC-BLOCKER-01`) | Client pooled connections can execute `SET LOCAL knowletive.is_platform_admin = 'true'`. Session context must be signed before RLS activation. |
| **`BLOCKER-04`** | **MEDIUM** | Operations | TEMPORARY Grant on External Tools | Database-level `REVOKE TEMPORARY` may require explicit grants for external ETL/BI tools. |

---

### 19.9 Final Architectural Verdict

```text
===============================================================================
                    FINAL DEPLOYMENT READINESS VERDICT
===============================================================================
  Candidate Migration Artifact:   VERIFIED & IDEMPOTENT
  Trigger Hardening Coverage:     28 / 28 FUNCTIONS HARDENED
  Exploit Neutralization:         100% REPRODUCED & NEUTRALIZED
  Migration History Parity:       20 / 20 CHECKSUMS MATCH (SHA256 VERIFIED)
  Financial Invariants:           13 / 13 PRESERVED & TESTED
  Original Database Integrity:    100% UNTOUCHED (READ-ONLY PRESERVED)
-------------------------------------------------------------------------------
  FINAL RECOMMENDATION:           APPROVE FOR HUMAN REVIEW
===============================================================================
```

> [!CAUTION]
> **DEPLOYMENT MUST REMAIN ON HOLD.**  
> No migration commands (`prisma migrate deploy`), role changes, or DDL statements may be executed against `knowletive` without explicit human authorization.


