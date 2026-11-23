# Knowletive SaaS — Comprehensive QA Bug & Defect Report

**Audit Date:** November 10, 2026  
**Active Branch:** `staging/exam-stage-43`  
**Classification Standards:**
- **P0:** Data loss, cross-tenant leakage, authentication bypass, critical security vulnerability.
- **P1:** Core business workflow broken, incorrect financial data, incorrect published results.
- **P2:** Major module functionality broken, inconsistent state transition, concurrency hazard.
- **P3:** Minor UI defects, non-critical validation ergonomics, localized edge cases.

---

## 1. Summary of Defects Discovered & Remediated

| Defect ID | Severity | Component / Module | Description | Status |
| :---: | :---: | :--- | :--- | :---: |
| **BUG-01** | **P2** | `src/actions/exams.ts` | `deleteExaminationAction` permanent deletion guard queried `resultCount` but omitted historical results from the rejection message. | **RESOLVED & VERIFIED** |
| **BUG-02** | **P2** | `src/actions/leads.ts` | Advisory lock acquisition in `importLeadsCsvAction` used `$executeRawUnsafe` causing raw query execution deserialization errors. | **RESOLVED & VERIFIED** |
| **BUG-03** | **P2** | `src/actions/leads.ts` | Duplicate detection performed an unbounded full-table scan on the tenant's entire `Lead` table. Replaced with bounded candidate query. | **RESOLVED & VERIFIED** |
| **BUG-04** | **P2** | `src/lib/csv.ts` | CSV exports susceptible to CWE-1236 spreadsheet formula injection via `=,+,-,@,\t,\r` characters. | **RESOLVED & VERIFIED** |
| **BUG-05** | **P2** | `src/app/(app)/app/leads/lead-export-button.tsx` | Export CSV button remained unclickable under specific zero-count initialization conditions. | **RESOLVED & VERIFIED** |
| **BUG-06** | **P3** | `src/actions/leads.ts`, `src/actions/operations.ts` | Server action Zod schemas with `.optional().or(z.literal(""))` threw validation errors when `formData.get()` returned `null` instead of empty strings. | **RESOLVED & VERIFIED** |

---

## 2. Detailed Defect Reports

### BUG-01: Permanent Deletion Guard Omission in `deleteExaminationAction`

- **Severity:** P2 (Data Integrity / Audit Rule)
- **Component:** [`src/actions/exams.ts`](file:///D:/IT/Saas/src/actions/exams.ts#L267)
- **Description:**  
  When an administrator attempted to delete an examination, `tx.examResult.count()` was evaluated, but the user-facing error message only stated:
  `Operational examinations with enrolled candidates (${enrollmentCount}), marks (${markCount}), or revision events (${revisionEventCount}) cannot be permanently deleted.`
  If an examination had historical `ExamResult` records without active enrollments or marks, the message did not explicitly communicate why the deletion was blocked.
- **Reproduction Steps:**
  1. Create a `DRAFT` examination.
  2. Associate a historical `ExamResult` record with the examination.
  3. Ensure `enrollmentCount`, `markCount`, and `revisionEventCount` are 0.
  4. Call `deleteExaminationAction(examId)`.
- **Expected Behavior:**  
  Deletion is rejected with `INVALID_TRANSITION` and the error explicitly states `historical results (${resultCount})`.
- **Actual Behavior (Before Fix):**  
  Rejection message failed to mention historical results.
- **Resolution:**  
  Updated rejection message in commit `258d02b`:
  ```typescript
  error: `Operational examinations with enrolled candidates (${enrollmentCount}), marks (${markCount}), revision events (${revisionEventCount}), or historical results (${resultCount}) cannot be permanently deleted. Use cancellation instead.`
  ```
- **Regression Test:** Verified by `tests/exam-management.test.ts` (Test `2.1. Safeguard 5`).

---

### BUG-02: PostgreSQL Advisory Lock API Mismatch in Leads Import

- **Severity:** P2 (Concurrency Safety)
- **Component:** [`src/actions/leads.ts`](file:///D:/IT/Saas/src/actions/leads.ts)
- **Description:**  
  PostgreSQL advisory lock was invoked via Prisma's `$executeRawUnsafe("SELECT pg_advisory_xact_lock(...)")`. Because `SELECT` queries in PostgreSQL return a result set, Prisma threw runtime exception P2010 on type deserialization (`void`).
- **Reproduction Steps:**
  1. Trigger concurrent CSV imports on `/app/leads`.
  2. Observe `$executeRawUnsafe` throwing deserialization error.
- **Expected Behavior:**  
  Lock query executes cleanly using `$queryRawUnsafe` and serializes incoming batches without exception.
- **Resolution:**  
  Replaced `$executeRawUnsafe` with `$queryRawUnsafe` casting to `::text`:
  ```typescript
  await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))::text`, lockKey);
  ```
- **Regression Test:** Verified by `tests/leads-import-concurrency.integration.test.ts` (3/3 passing).

---

### BUG-03: Unbounded Full-Table Scan in Duplicate Detection

- **Severity:** P2 (Scalability & Performance)
- **Component:** [`src/lib/leads-import.ts`](file:///D:/IT/Saas/src/lib/leads-import.ts), [`src/actions/leads.ts`](file:///D:/IT/Saas/src/actions/leads.ts)
- **Description:**  
  Duplicate detection executed `tx.lead.findMany({ where: { tenantId } })`, fetching every lead belonging to the tenant into Node.js heap memory. For tenants with 10,000+ leads, this caused memory exhaustion and query timeouts.
- **Resolution:**  
  Introduced [`buildCandidateLeadsWhere`](file:///D:/IT/Saas/src/lib/leads-import.ts#L263), which builds a bounded SQL query extracting only candidate records whose student name, guardian phone, or guardian email match entries in the incoming CSV batch.
- **Regression Test:** Verified in `tests/leads-import.test.ts`.

---

### BUG-04: CSV Formula Injection (CWE-1236) Defense

- **Severity:** P2 (Security Vulnerability)
- **Component:** [`src/lib/csv.ts`](file:///D:/IT/Saas/src/lib/csv.ts)
- **Description:**  
  Exported student names or lead contact fields containing leading `=,+,-,@` allowed formula injection when opened in Microsoft Excel or Google Sheets.
- **Resolution:**  
  Implemented [`escapeCsvCell`](file:///D:/IT/Saas/src/lib/csv.ts#L6) with sanitization rules prefixing formula trigger characters with a single apostrophe `'`.
- **Regression Test:** Verified by `tests/csv-security.test.ts` and `tests/qa-security-rbac.test.ts`.

---

### BUG-05: Leads Export CSV Button Click Inactivity

- **Severity:** P2 (User Experience / UI Regression)
- **Component:** [`src/app/(app)/app/leads/lead-export-button.tsx`](file:///D:/IT/Saas/src/app/(app)/app/leads/lead-export-button.tsx)
- **Description:**  
  The Export CSV button remained unclickable because the `disabled` property remained persistently true when the component initialized with undefined `total` props.
- **Resolution:**  
  Hardened click handler, disabled state logic (`disabled={disabled || total === 0 || isExporting}`), and clear tooltip explanations.
- **Regression Test:** Verified in browser workflow suite.

---

### BUG-06: Optional Form Fields Schema Null Handling

- **Severity:** P3 (Validation Ergonomics)
- **Component:** [`src/actions/leads.ts`](file:///D:/IT/Saas/src/actions/leads.ts), [`src/actions/operations.ts`](file:///D:/IT/Saas/src/actions/operations.ts)
- **Description:**  
  When optional fields were omitted from `FormData`, `formData.get()` returned `null`. Zod schemas using `.optional().or(z.literal(""))` did not accept `null`, causing generic "Please fix the highlighted fields" errors.
- **Resolution:**  
  Added `.nullish()` or fallback empty strings `formData.get("key") ?? ""` in action parsers.
- **Regression Test:** Verified in `tests/qa-cross-module-workflows.test.ts`.

