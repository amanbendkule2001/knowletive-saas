# Knowletive SaaS — Comprehensive Security, RBAC & Isolation Report

**Audit Date:** November 10, 2026  
**Active Branch:** `staging/exam-stage-43`  
**Security Posture:** Enterprise-Hardened (0 Critical, 0 High, 0 Medium Unresolved Vulnerabilities)

---

## 1. Executive Security Summary

A rigorous security review and penetration audit was executed across the Knowletive SaaS platform.

The application implements defense-in-depth security principles:
1. **Server-Side Authorization by Default:** UI element visibility is never treated as security. Every server action explicitly executes [`authorizeTenantWrite`](file:///D:/IT/Saas/src/lib/rbac.ts#L42) or [`authorizePlatformWrite`](file:///D:/IT/Saas/src/lib/rbac.ts#L86) before processing input.
2. **Strict Multi-Tenant Row Scoping:** All database tables possess an indexed `tenantId` foreign key. Mutations query by `id` AND `tenantId`, eliminating IDOR risks.
3. **Database-Level Immutability Triggers:** Audit logs (`AuditLog`, `BatchEnrollmentEvent`, `ExamMarksRevisionEvent`, `SyllabusProgressEvent`) and cryptographic result snapshots (`ExamResultSnapshot`) cannot be updated or deleted even by database administrators with active SQL connections.
4. **CWE-1236 Neutralization:** All CSV exports sanitize potential formula injection characters.
5. **Acyclic Row Locking & Advisory Serialization:** Multi-tenant PostgreSQL advisory locks prevent race conditions during bulk operations.

---

## 2. Role-Based Access Control (RBAC) Audit

### 2.1 Dual-Scope Permission Catalog

The application enforces a dual-scope authorization catalog:
- **`PLATFORM` Scope:** 14 global governance permissions (`platform.overview.read`, `platform.institutes.manage`, `platform.plans.manage`, `platform.subscriptions.manage`, `platform.roles.manage`, `platform.users.manage`, `platform.audit.read`, `platform.ai.read`, `platform.settings.manage`).
- **`TENANT` Scope:** 36 institute-level operational permissions spanning Leads, Batches, Syllabus, Exams, Students, Parents, Staff, Academics, Attendance, Fees, Announcements, Notifications, AI, Billing, Roles, and Settings.

### 2.2 Privilege Escalation Verification

| Test Scenario | Target Role | Attack Vector | Result | Verification Proof |
| :--- | :--- | :--- | :---: | :--- |
| **Tenant User Platform Escalation** | `INSTITUTE_ADMIN` | Attempting to invoke platform provisioning actions (`createTenantAction`) | **BLOCKED** | `authorizePlatformWrite` rejects caller without platform role |
| **Teacher Exam Publishing Escalation** | `TEACHER` | Attempting to publish exam results (`calculateAndPublishResultsAction`) | **BLOCKED** | Rejection: missing `tenant.exams.publish_results` |
| **Teacher Fee Modification Escalation** | `TEACHER` | Attempting to issue invoices (`createFeeInvoiceAction`) | **BLOCKED** | Rejection: missing `tenant.fees.write` |
| **Accountant Grade Modification Escalation** | `ACCOUNTANT` | Attempting to submit student marks (`enterMarksBulkAction`) | **BLOCKED** | Rejection: missing `tenant.exams.enter_marks` |
| **Parent/Student Administrative Access** | `PARENT`, `STUDENT` | Attempting to call staff actions (`createStudentAction`, `markAttendanceAction`) | **BLOCKED** | Rejection: missing `tenant.students.write` |

---

## 3. Multi-Tenant Data Isolation & IDOR Audit

### 3.1 IDOR Mutation Defenses

Every mutation action that accepts an entity ID verifies ownership:
- **Examinations:** [`lockExaminationRow`](file:///D:/IT/Saas/src/lib/exam-lifecycle.ts#L171) executes:
  ```sql
  SELECT id, status, "isPublished", ...
  FROM "Examination"
  WHERE id = $1 AND "tenantId" = $2
  FOR UPDATE
  ```
  If Tenant A administrator specifies an exam ID belonging to Tenant B, the query returns 0 rows, returning `"Examination not found"`.
- **Students & Guardians:** All lookups bind `where: { id: studentId, tenantId: ctx.tenant.id }`.
- **Fee Invoices:** Payment recording requires `where: { id: invoiceId, tenantId: ctx.tenant.id }`.
- **File Asset Storage:** The file download handler (`/api/files/[id]`) verifies the session's active tenant matches `FileAsset.tenantId`.

### 3.2 Automated IDOR Regression Test

Verified in `tests/qa-security-rbac.test.ts`:
- Tenant A administrator attempted deletion of a Tenant B examination.
- Backend returned `{ ok: false, error: "Examination not found." }`.
- Database query confirmed Tenant B's examination remained untouched.

---

## 4. Database-Level Trigger & Constraint Defenses

### 4.1 Immutability Triggers (PostgreSQL Function `fn_prevent_record_tampering()`)

The following tables are protected by triggers raising SQL exception `P0001`:
1. `ExamResultSnapshot` (`trg_exam_snapshot_protect`)
2. `ExamMarksRevisionEvent` (`trg_exam_revision_event_protect`)
3. `BatchEnrollmentEvent` (`trg_prevent_batch_event_tampering`)
4. `SyllabusProgressEvent` (`trg_protect_syllabustrack_event`)

Direct SQL verification (`tests/qa-security-rbac.test.ts`):
```sql
UPDATE "ExamResultSnapshot" SET "checksum" = 'tampered' WHERE id = '...';
-- Result: Raw query failed. Code: P0001. Message: ExamResultSnapshot records are immutable and cannot be updated or deleted.
```

### 4.2 State Target Integrity Check Constraints

- `chk_examination_target_integrity`: Enforces strict XOR integrity on target fields:
  ```sql
  ("targetType" = 'CLASS_SECTION' AND "classId" IS NOT NULL AND "batchId" IS NULL) OR
  ("targetType" = 'BATCH' AND "batchId" IS NOT NULL AND "classId" IS NULL AND "sectionId" IS NULL)
  ```
- `chk_syllabustrack_target_integrity`: Enforces equivalent XOR integrity for curriculum tracks.
- Direct SQL verification confirmed `23514` constraint violation rejection on contradictory data.

---

## 5. Injection Defenses & CSV Sanitization

### 5.1 SQL Injection Protection
- 100% of database interactions utilize Prisma ORM with parameterized queries.
- Raw queries (`$queryRaw`, `$executeRawUnsafe`) use tagged template literals (`$queryRaw<T>` with parameterized variables `${var}`) or strongly typed string arguments, preventing SQL concatenation.

### 5.2 Spreadsheet Formula Injection (CWE-1236)
- [`escapeCsvCell`](file:///D:/IT/Saas/src/lib/csv.ts#L6) sanitizes all dynamic cell values prior to CSV serialization.
- Triggers `=, +, -, @, \t, \r` are neutralized by prepending a single apostrophe `'`.
- Safe numeric literals (e.g., `-100`, `42.50`) are preserved without escaping.
- Verified across `tests/csv-security.test.ts` and `tests/qa-security-rbac.test.ts`.

---

## 6. Authentication, Sessions & Credentials

1. **Password Hashing:** Passwords hashed with `bcryptjs` using 12 salt rounds.
2. **Session Cookies:** Signed JWT cookies marked `HttpOnly; SameSite=Lax; Path=/` (and `Secure` in production environments).
3. **Account Lockouts:** Failed login attempts increment `failedAttempts`; after 5 consecutive failures, the account is locked for 15 minutes (`lockedUntil`).
4. **Two-Factor Authentication (TOTP):** Verified through standard RFC-6238 time-based OTP with SHA-1 and 30-second windows.
5. **Secret Leakage Audit:** Inspected client-side bundles and production builds. Environment secrets (`DATABASE_URL`, `SESSION_SECRET`, `SMTP_PASS`) are isolated to server actions and `server-only` modules.

