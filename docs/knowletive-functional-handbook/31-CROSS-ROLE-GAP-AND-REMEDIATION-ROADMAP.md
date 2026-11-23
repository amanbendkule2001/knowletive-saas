# KNOWLETIVE — CROSS-ROLE GAP AND REMEDIATION ROADMAP

| Document Metadata | Specification Attribute |
| :--- | :--- |
| **Document Identification** | `DOC-31-REMEDIATION-ROADMAP` |
| **Document Version** | `Revision 1.3` (Final Classification, Intra-Tenant RBAC Audit & Test Precision) |
| **System Name** | Knowletive Multi-Tenant Educational Management Platform |
| **Target Document** | `docs/knowletive-functional-handbook/31-CROSS-ROLE-GAP-AND-REMEDIATION-ROADMAP.md` |
| **Repository Baseline** | `D:\IT\Saas` on branch `staging/exam-stage-43` |
| **Audited Scope** | Cross-Role Functional Integrity, Security, Multi-Tenancy, Concurrency, Onboarding & Test Coverage |
| **Audited Roles** | `PLATFORM_OWNER`, `INSTITUTE_ADMIN`, `PRINCIPAL`, `TEACHER`, `ACCOUNTANT`, `FRONT_DESK`, `STUDENT`, `PARENT` |
| **Core Reference Corpus** | Documents 00 through 30 (Functional Handbook Baseline) |
| **Identified Issue Scope** | Exactly **26 Categorized Findings** across 6 Core Engineering Domains |
| **Domain Partition** | **4 Security & Storage Access** + **5 Financial Integrity** + **4 Identity & Onboarding** + **4 Academic Engine** + **5 Operational Workflows (incl. reclassified GAP-SEC-01)** + **4 Test Coverage** |
| **Prioritization Partition**| **2 P0 (Critical Financial & Onboarding Blockers)** + **8 P1 (High-Impact Production Blockers & Hardening)** + **10 P2 (Important Functional & Operational Improvements)** + **6 P3 (Optional Enhancements & Technical Debt)** |
| **Document Classification** | Canonical Engineering Specification & Prioritized Implementation Roadmap |

---

## 1. Executive Summary

This specification establishes an evidence-based, prioritized remediation roadmap for the Knowletive educational SaaS platform. Synthesized primarily from static source inspection of repository `D:\IT\Saas` on branch `staging/exam-stage-43` and cross-referenced against the 31-document Functional Handbook corpus (Documents 00 through 30), this audit identifies source-level architectural maturity, concrete implementation gaps, concurrency race hazards, identity handoff defects, and cross-role workflow fractures.

### Evidence Standard and Terminology Distinction

To avoid unsupported claims of operational readiness, this specification strictly distinguishes four distinct evidence tiers:
1. **Strong Implementation Coverage:** The complete schema models, server actions, and UI routes are present in the codebase.
2. **Source-Level Architectural Maturity:** The design structures, finite state machines, and relational models adhere to robust principles on static code analysis.
3. **Runtime-Tested Behavior:** Specific workflows validated dynamically in local or automated execution environments.
4. **Operational Production Readiness:** End-to-end operational viability under live multi-tenant traffic, concurrent load, external cloud gateway integrations, and production error budgets.

Static code inspection verifies strong implementation coverage and source-level architectural maturity in core domains, but **does not by itself establish operational production readiness**.

### Key Architectural Findings & Defect Classifications

An exhaustive re-examination of the codebase across all operational domains resolves previous evidence conflicts and identifies two critical (P0) architectural blockers alongside high-impact production hardening requirements:

1. **The Disconnected Onboarding Pipeline (`GAP-IDN-01` — Priority P0):** Inspected administrative creation workflows (`createStudentAction`, `importStudentsAction`, and `createGuardianAction` in `src/actions/students.ts`) create records in `model Student` and `model Guardian` without automatically creating corresponding `model User` or `model Membership` records. Consequently, new student and guardian records created through standard UI workflows remain unlinked (`userId = NULL`), preventing student and parent portal access without out-of-band database scripting.
2. **Financial Concurrency & Cashier Race Hazard (`GAP-FIN-01` — Priority P0):** A confirmed source-level race condition exists between manual offline cash recording (`recordFeePaymentAction`) and payment link verification (`verifyFeePaymentLinkAction` / `settleFeePaymentLink`). Both actions read outstanding balances outside the write transaction and update `FeeInvoice` without acquiring an exclusive pessimistic row lock (`SELECT ... FOR UPDATE`), creating potential lost updates, balance overwrite, or ledger desynchronization under concurrent execution.
3. **Stale Active Payment Links & Proof-Submission Validation Gaps (`GAP-FIN-03` & `GAP-SEC-02` — Priority P1):** Active `FeePaymentLink` tokens remain in `PENDING` status when an invoice is settled offline via cash or waived. Furthermore, public proof submissions (`submitPaymentProofAction`) omit checks for link expiration or already-settled invoices, creating ghost verification tasks for accountants.
4. **Mocked Communication Transports (`GAP-OPS-03` & `GAP-IDN-03` — Priority P1):** External notification mechanisms (SMS alerts for student absences, fee payment reminders, and staff invitation emails) route to console/mock adapters when cloud communication gateway environment variables are unconfigured.
5. **Storage Asset Access Control Disambiguation (`GAP-SEC-04` & `GAP-SEC-05` — Priority P2 & P1):** Re-investigation of `src/app/api/files/[id]/route.ts` establishes that **zero cross-tenant access paths exist** (non-platform owners are strictly blocked with HTTP 403 on tenant mismatches). The route contains two distinct intra-tenant access control findings:
   - `GAP-SEC-04` (Priority P2): A **Student Portal Self-Access Defect** where authenticated students cannot download their own uploaded files because the route checks only `studentGuardian` linkages.
   - `GAP-SEC-05` (Priority P1 — High Severity): **Coarse Tenant-Membership Staff File Access** where any custom role within the tenant bypasses granular RBAC permissions (`tenant.students.read` or `tenant.fees.read`) to retrieve confidential student documents (`DOCUMENT`, `STUDENT_PHOTO`) and financial receipts (`RECEIPT`).

### Explicit Resolution and Reclassification of Student Capacity Enforcement

Previous draft analyses hypothesized an asymmetric quota bypass in direct student creation and CSV import (`GAP-SEC-01`). An exhaustive source-code re-audit across `src/actions/leads.ts`, `src/actions/students.ts`, and `src/lib/entitlements.ts` conclusively confirms the earlier findings of **Document 29 (Section 9.7)**:
- **All three production student creation pathways** (`convertLeadAction`, `createStudentAction`, and `importStudentsAction`) participate in the **identical transactional locking mechanism**.
- Inside `assertStudentCapacityTx` (`src/lib/entitlements.ts:52`), every creation path executes `SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE` inside a Prisma interactive transaction before counting students and inserting records.
- Consequently, **tenant student quota limits CANNOT be exceeded or bypassed under concurrent requests** in any of the three production paths. The quota bypass hypothesis is disproven.
- The remaining limitation in CSV import (`importStudentsAction`) is an **operational batch atomicity design choice**: each student row is inserted in an independent transaction, which causes partial imports (earlier rows committed, remaining rows skipped) when a batch hits the capacity ceiling midway.
- In accordance with verifiable source evidence, `GAP-SEC-01` is **formally reclassified from the Security domain into the Operations domain** (`GAP-SEC-01: Reconciled Admission Quota Enforcement and CSV Import Batch Atomicity Limitation` under Section 7) as a **Priority P2 Functional/Operational Improvement**. It is not a security vulnerability.

---

## 2. Overall Cross-Role System Health

System maturity across Knowletive's eleven core functional subsystems is evaluated through an evidence-qualified qualitative scorecard based on verifiable static source inspection of transaction models, authorization guards, schema constraints, and cross-role handoffs:

```
+------------------------------------------------------------------------------------------------------------------------------------+
|                                    KNOWLETIVE CROSS-ROLE SUBSYSTEM HEALTH SCORECARD                                                |
+--------------------------+-------------------------------------+-------------------------------------------------------------------+
| Subsystem Domain         | Evidence-Qualified Health Status    | Architectural Maturity & Identified Risk Profile (Static Basis)   |
+--------------------------+-------------------------------------+-------------------------------------------------------------------+
| Examination & Grading    | High Source-Level Maturity          | Airtight 49-cell FSM, pessimistic row locks, SHA-256 snapshots.   |
| Daily Attendance         | Strong Implementation Coverage      | Institutional roll oversight, overrides, chronic absence tracking.|
| Batches & Coaching       | Strong Implementation Coverage      | Capacity checks, teacher allocation; hard deletion barred by design|
| Academics & Hierarchy    | Functional / CRUD Incompleteness    | Subject deletion supported; ClassLevel and Section are CR-only.    |
| Curriculum & Syllabus    | High Source-Level Maturity          | Tracks, chapters, topics & lesson plans with progress telemetry.  |
| CRM Leads & Admissions   | High Source-Level Maturity          | All 3 student creation paths lock Tenant row; CSV non-atomic batch |
| Student/Parent Portals   | Core Onboarding Blocker             | Portals render cleanly, but creation actions do not link User IDs.|
| Fee Management & Cashier | Financial Concurrency Risk          | Waivers & proofs exist; concurrent settlement lacks FeeInvoice lock|
| Platform SaaS Billing    | Strong Implementation Coverage      | Razorpay subscription webhooks active; tenant billing view-only.  |
| External Communications  | Functional / Gateway Gap            | NotificationLog tables populated; SMS/SMTP uses console fallbacks. |
| Automated Test Coverage  | Quality Assurance Debt              | Exam engine tested; multi-actor concurrency test suites absent.    |
+--------------------------+-------------------------------------+-------------------------------------------------------------------+
```

### Qualitative Architectural Synthesis

1. **Source-Level Academic Maturity:** The institutional core—examinations, grading scales, attendance tracking, coaching batches, and curriculum structures—demonstrates strong source-level architectural maturity. The examination engine's finite state machine enforces complete data integrity with immutable audit trails. However, operational production readiness requires runtime load testing under multi-threaded institutional concurrency.
2. **Multi-Tenant Boundary Isolation:** Multi-tenant scoping (`where: { tenantId }`) is universally present across database queries. In object storage (`/api/files/[id]`), strict tenant membership validation prevents cross-tenant file leakage.
3. **Consumer Layer Onboarding Disconnect:** The consumer layer (Student and Parent portals) is functionally isolated from standard admissions workflows because creation actions do not provision or link user accounts. Resolving this identity handoff is the foundational prerequisite for consumer portal activation.
4. **Financial Concurrency Hardening:** While fee schedules operate reliably under sequential single-user workflows, concurrent cashier desk payments and online link verifications require pessimistic row-level locking on `FeeInvoice` to guarantee zero balance corruption under load.

---

## 3. Consolidated Issue Register

The following register indexes all 26 source-verified findings, ranked by severity, priority tier, and operational domain:

```
+------------------------------------------------------------------------------------------------------------------------------------+
|                                      CONSOLIDATED ARCHITECTURAL ISSUE REGISTER (26 FINDINGS)                                       |
+------------+------+----------+--------------------------------------------------+----------------------------------+---------------+
| Issue ID   | Sev. | Priority | Evidence Classification                          | Summary Title                    | Affected Roles|
+------------+------+----------+--------------------------------------------------+----------------------------------+---------------+
| GAP-FIN-01 | CRIT | P0       | Confirmed source-level weakness                  | Concurrent Payment Race Hazard   | Acct, Admin   |
| GAP-IDN-01 | CRIT | P0       | Confirmed source-level weakness                  | Unlinked Student Creation Records| Stud, Parent  |
| GAP-FIN-02 | HIGH | P1       | Potential risk requiring runtime validation      | Missing Settlement Idempotency   | Acct, Parent  |
| GAP-FIN-03 | MED  | P1       | Confirmed source-level weakness                  | Stale Links After Cash Settlement| Acct, Parent  |
| GAP-SEC-02 | MED  | P1       | Confirmed source-level weakness                  | Stale Payment Proof Submissions  | Public, Parent|
| GAP-SEC-05 | HIGH | P1       | Confirmed source-level weakness                  | Custom-Role File RBAC Bypass     | Staff, Custom |
| GAP-IDN-02 | HIGH | P1       | Product capability gap                           | Missing Self-Service Activation  | Parent, Stud  |
| GAP-IDN-03 | HIGH | P1       | Product capability gap / Config dependency       | Staff Invite Email Transport Mock| Admin, Staff  |
| GAP-OPS-03 | HIGH | P1       | Product capability gap / Gateway dependency      | Mocked SMS Absence/Fee Alerts    | Parent, Admin |
| GAP-TST-01 | HIGH | P1       | Product capability gap / QA Test debt            | Missing Concurrency Test Suites  | All Roles     |
| GAP-SEC-01 | MED  | P2       | Product capability gap / Batch atomicity (OPS)   | CSV Import Non-Atomic Quota UX   | Front Desk, Pr|
| GAP-SEC-03 | MED  | P2       | Potential risk requiring runtime validation      | Missing Proof Rate Limiting / DoS| Public Entry  |
| GAP-SEC-04 | MED  | P2       | Confirmed source-level weakness                  | Student Portal Self-Access Defect| Student       |
| GAP-FIN-04 | MED  | P2       | Product capability gap                           | Missing Student Fee Webhook Route| Acct, Admin   |
| GAP-EXM-01 | MED  | P2       | Product capability gap / Operational UX          | Cannot Delete Cancelled Zero-Mark| Principal, Adm|
| GAP-EXM-02 | MED  | P2       | Product capability gap                           | Missing Exam Timetable Clash Check| Principal, Tea|
| GAP-EXM-04 | MED  | P2       | Product capability gap                           | Missing Candidate Admit-Card PDF | Student, Princ|
| GAP-OPS-01 | MED  | P2       | Product capability gap / CRUD Incompleteness     | ClassLevel and Section CR-Only   | Principal, Adm|
| GAP-TST-02 | MED  | P2       | Product capability gap / Security test debt      | Missing Multi-Tenant Switch Tests| All Users     |
| GAP-TST-03 | MED  | P2       | Product capability gap / Disaster recovery debt  | Missing Snapshot Recovery Tests  | Principal, Adm|
| GAP-FIN-05 | LOW  | P3       | Optional product enhancement                     | ESC/POS Thermal Printing & PDF   | Accountant    |
| GAP-IDN-04 | LOW  | P3       | Optional governance enhancement                  | In-App Operational Delegation    | Admin, Princ   |
| GAP-EXM-03 | LOW  | P3       | Optional grading policy enhancement              | Historical GPA Recomputation     | Principal     |
| GAP-OPS-02 | LOW  | P3       | Design-governed retention / Optional cleanup     | Batch Deletion Guardrails        | Principal, Adm|
| GAP-OPS-04 | LOW  | P3       | Optional enhancement / Hardware roadmap          | Biometric Hardware TCP/IP Daemon | Teacher, Princ |
| GAP-TST-04 | LOW  | P3       | Documentation-only / Repository hygiene debt     | Working-Tree Tracked File Debt   | Dev, DevOps   |
+------------+------+----------+--------------------------------------------------+----------------------------------+---------------+
```

---

## 4. Security and Tenant-Isolation Findings

This section details four source-verified findings governing public endpoint gating, bearer token lifecycles, tenant boundary isolation, student self-access, and custom-role storage authorization.

> [!NOTE]
> **Reclassification Notice — GAP-SEC-01 Moved to Operations Domain:**
> The student capacity bypass hypothesis has been conclusively disproven: all three student creation paths enforce PostgreSQL `Tenant` row locks (`SELECT ... FOR UPDATE`) inside transactions via `assertStudentCapacityTx`. The remaining limitation in `importStudentsAction` concerns non-atomic batch iterations (partial imports on limit exhaustion), which is an **operational batch UX consideration, not a security vulnerability**. In accordance with this audit, `GAP-SEC-01` is formally reclassified into the **Operations Domain** (detailed in Section 7 under Operational Workflows).

---

### GAP-SEC-02: Public Payment Link Stale Lifecycle State and Proof-Submission Validation Gaps

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-SEC-02` |
| **Issue Title** | Public Payment Link Stale Lifecycle State and Proof-Submission Validation Gaps |
| **Actual Problem Description** | In Knowletive, payment links (`/pay/[token]`) use unauthenticated bearer tokens by design, enabling parents to inspect tuition invoices and submit transaction proofs without requiring pre-registered portal credentials (matching industry standards such as Razorpay Payment Links and Stripe Invoicing). The security and operational concern is **not bearer-token access itself**, but rather **lifecycle synchronization and proof validation gaps** in `src/actions/operations.ts` (`submitPaymentProofAction`):<br>1. **Stale Link Retention:** When an accountant settles an invoice at the cashier desk via `recordFeePaymentAction` or waives an invoice via `waiveFeeInvoiceAction`, `FeeInvoice.status` changes to `PAID` or `WAIVED`. However, the transaction does *not* cancel pending `FeePaymentLink` records. The link token remains in `status = "PENDING"`.<br>2. **Missing Proof Gating:** In `submitPaymentProofAction`, the validation check only verifies `if (link.status === "PAID") return { error: ... };`. It fails to check if `link.status === "EXPIRED"`, `link.status === "CANCELED"`, whether `link.expiresAt < new Date()`, or whether the parent invoice `link.feeInvoice.status === "PAID"`.<br>3. **Financial Consequence Scope:** Submitting a proof does *not* trigger automated funds transfer or alter `FeeInvoice.paidAmount`. It merely populates `utrReference` on the link and creates an in-app `NotificationLog` entry for school accountants. The accountant must still manually audit and approve the entry via `verifyFeePaymentLinkAction`. Thus, the defect creates administrative reconciliation clutter and parent confusion rather than direct financial leakage. |
| **Affected Roles** | `ACCOUNTANT`, `INSTITUTE_ADMIN`, `PARENT` (Public Anonymous Users) |
| **Affected Modules** | Public Fee Payment Portal (`src/app/(public)/pay/[token]/`), Fee Operations (`src/actions/operations.ts`) |
| **Source File & Relevant Action/Function** | `src/actions/operations.ts:503` (`submitPaymentProofAction`); `src/actions/operations.ts:246` (`recordFeePaymentAction`) |
| **Supporting Document & Section Reference** | Document 28 (Accountant User Journey, Section 8.3 & Section 27.2); Document 25 (Parent User Journey, Section 5); Document 20 (Accuracy Audit, Section 7) |
| **Evidence Classification** | `Confirmed source-level weakness` |
| **Business Impact** | **Medium / Operational Inefficiency & Reconciliation Overhead.** Accountants receive notifications to verify payments for invoices that are already settled by cash; parents can mistakenly submit proofs against expired or waived fees. |
| **Severity** | `Medium` (Operational Workflow & Lifecycle Synchronization — Reclassified from High) |
| **Reproduction / Validation Procedure** | 1. Issue an invoice and generate a payment link.<br>2. Settle the invoice in full with cash via cashier screen (`recordFeePaymentAction`). Verify invoice is `PAID`.<br>3. Open `/pay/[token]` in an incognito window.<br>4. Enter a dummy UTR (`UTR123456`) and submit.<br>5. Observe that submission succeeds and generates an accountant notification for a settled invoice. |
| **Recommended Resolution** | 1. In `submitPaymentProofAction`, add complete lifecycle checks: verify that `link.status === "PENDING"`, `link.expiresAt > new Date()`, and `link.feeInvoice.status !== "PAID" && link.feeInvoice.status !== "WAIVED"`.<br>2. In `recordFeePaymentAction` and `waiveFeeInvoiceAction`, atomically cancel all associated pending links: `await tx.feePaymentLink.updateMany({ where: { feeInvoiceId: invoice.id, status: "PENDING" }, data: { status: "CANCELED" } });`.<br>3. On `/pay/[token]/page.tsx`, render an explicit read-only "Invoice Settled" banner when the invoice is closed. |
| **Test Cases Required** | `TC-SEC-02A`: Reject proof submission on expired payment link.<br>`TC-SEC-02B`: Reject proof submission on cancelled or paid invoice.<br>`TC-SEC-02C`: Auto-cancel pending links upon full cash payment. |
| **Acceptance Criteria** | Payment links associated with settled or waived invoices are immediately transitioned to `CANCELED`; `/pay/[token]` blocks proof submission on non-pending links. |
| **Dependencies & Implementation Priority** | **Priority P1.** High-impact production hardening for fee collection. |

---

### GAP-SEC-03: Missing Rate Limiting and Anti-Automation on Public Payment Proof Submissions

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-SEC-03` |
| **Issue Title** | Missing Rate Limiting and Anti-Automation on Public Payment Proof Submissions |
| **Actual Problem Description** | The public endpoint `/pay/[token]` and its underlying Server Action `submitPaymentProofAction` (`src/actions/operations.ts:503`) operate without client-IP rate limiting, proof-of-work challenges, or CAPTCHA verification. An unauthenticated external actor can invoke `submitPaymentProofAction` in an automated loop, submitting thousands of arbitrary UTR strings against known or brute-forced payment tokens. Because each invocation executes an update query on `db.feePaymentLink` and inserts a row into `db.notificationLog`, an automated attack can saturate database disk storage, exhaust connection pools, and poison the accountant in-app notification center with spam volume. |
| **Affected Roles** | `ACCOUNTANT`, `INSTITUTE_ADMIN`, Platform Infrastructure Engineers |
| **Affected Modules** | Public Payment Gateway (`src/app/(public)/pay/[token]/`), Notification Subsystem (`src/lib/notifications.ts`) |
| **Source File & Relevant Action/Function** | `src/actions/operations.ts:503` (`submitPaymentProofAction`); `src/middleware.ts` |
| **Supporting Document & Section Reference** | Document 28 (Accountant User Journey, Section 8.4); Document 20 (Accuracy Audit, Section 7) |
| **Evidence Classification** | `Potential risk requiring runtime validation` |
| **Business Impact** | **Medium / Availability & DoS Exposure.** Platform degradation, notification queue bloat, and administrative disruption for finance staff under deliberate automation. |
| **Severity** | `Medium` (Anti-Automation & DoS Prevention) |
| **Reproduction / Validation Procedure** | 1. Send 50 rapid sequential POST requests to `submitPaymentProofAction` with incremented UTR strings (`UTR0001` through `UTR0050`) using curl.<br>2. Inspect database: observe that all 50 requests succeed without 429 Too Many Requests status and create 50 notification rows. |
| **Recommended Resolution** | 1. Implement sliding-window rate limiting in Next.js middleware using Redis/Upstash or an in-memory token bucket keyed by client IP and token (e.g., maximum 5 submissions per IP per 15 minutes).<br>2. Add a tenant-scoped duplicate UTR check to reject identical reference strings.<br>3. Enforce a minimum cooldown period between submissions on the same payment token. |
| **Test Cases Required** | `TC-SEC-03A`: Rate limit enforcement on public proof submission (verify HTTP 429 after 5 requests in window).<br>`TC-SEC-03B`: Duplicate UTR rejection across the tenant. |
| **Acceptance Criteria** | Public proof submissions exceeding rate thresholds receive HTTP 429; duplicate UTR submissions are rejected; no notification rows are inserted for throttled requests. |
| **Dependencies & Implementation Priority** | **Priority P2.** Infrastructure protection and rate-limiting enhancement. |

---

### GAP-SEC-04: File Asset Download Authorization Scope and Student Portal Self-Access Defect

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-SEC-04` |
| **Issue Title** | File Asset Download Authorization Scope and Student Portal Self-Access Defect |
| **Actual Problem Description** | In `src/app/api/files/[id]/route.ts`, file asset downloads are authenticated and authorized through session and tenant membership checks. The route enforces tenant boundary isolation by verifying `membership.tenantId === fileAsset.tenantId` (returning HTTP 403 on tenant mismatches). **Zero cross-tenant access paths exist.** However, for non-staff users accessing student-scoped files (`fileAsset.studentId != null`), the authorization logic contains a logic defect:<br>`const isStaff = !["PARENT", "STUDENT"].includes(membership.roleName.toUpperCase());`<br>`if (!isStaff) { const linkedGuardian = await db.studentGuardian.findFirst({ where: { studentId: fileAsset.studentId, guardian: { userId: user.id, tenantId: fileAsset.tenantId } } }); if (!linkedGuardian) return Response.json({ error: "Access denied" }, { status: 403 }); }`.<br><br>While this logic correctly permits linked parents to download their wards' documents, it causes **student self-access to fail completely**. When an authenticated student user (`membership.roleName = "STUDENT"`) attempts to download their own uploaded certificate, health record, or enrollment document, the route executes the `studentGuardian` query searching for a guardian matching `userId: user.id`. Because a student is not their own guardian, the lookup returns `null`, and the student receives an HTTP 403 Access Denied. The route fails to check `fileAsset.student.userId === user.id`.<br><br>**Conclusion:** This is a **confirmed source-level defect in student self-access**, NOT a cross-tenant data breach or IDOR exploit. |
| **Affected Roles** | `STUDENT` |
| **Affected Modules** | Storage & Object Serving (`src/app/api/files/[id]/route.ts`), Student Portal (`src/app/portal/`) |
| **Source File & Relevant Action/Function** | `src/app/api/files/[id]/route.ts:40–54` (GET handler) |
| **Supporting Document & Section Reference** | Document 26 (Student User Journey, Section 11); Document 25 (Parent User Journey, Section 9); Document 11 (Role Permission Matrix, Section 4) |
| **Evidence Classification** | `Confirmed source-level weakness` (Student self-access logic defect) |
| **Business Impact** | **Medium / Consumer Portal Defect.** Admitted students cannot view or download their own uploaded certificates, health records, or academic forms in the Student Portal. |
| **Severity** | `Medium` (Access Control Defect / Student Portal Incompleteness) |
| **Reproduction / Validation Procedure** | 1. Upload a birth certificate document for student $S_1$ (`fileAsset.studentId = S1`).<br>2. Log in as student $S_1$ (`membership.roleName = "STUDENT"`).<br>3. Attempt to download the document via `GET /api/files/[id]`.<br>4. Observe HTTP 403 Access Denied because `studentGuardian` lookup fails for the student's own user ID. |
| **Recommended Resolution** | 1. Update `src/app/api/files/[id]/route.ts`: if `membership.roleName.toUpperCase() === "STUDENT"`, verify `fileAsset.student?.userId === user.id`. If matched, grant download access.<br>2. If role is `PARENT`, maintain the existing `studentGuardian` check. |
| **Test Cases Required** | `TC-SEC-04A`: Student self-download of personal file asset (verify HTTP 200).<br>`TC-SEC-04B`: Student cross-download of another student's file asset in same tenant (verify HTTP 403).<br>`TC-SEC-04C`: Guardian download of linked ward's document (verify HTTP 200). |
| **Acceptance Criteria** | Authenticated students can download their own documents; guardians can download their linked wards' documents; unauthorized users within the tenant are blocked. |
| **Dependencies & Implementation Priority** | **Priority P2.** Consumer portal document access requirement; depends on resolving `GAP-IDN-01`. |

---

### GAP-SEC-05: Coarse Tenant-Membership Staff File Access and Missing RBAC Permission Enforcement on Storage Assets

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-SEC-05` |
| **Issue Title** | Coarse Tenant-Membership Staff File Access and Missing RBAC Permission Enforcement on Storage Assets |
| **Actual Problem Description** | In `src/app/api/files/[id]/route.ts`, storage asset access for internal staff relies on coarse tenant membership rather than granular RBAC catalog permissions. An exhaustive inspection of the authorization logic and `model FileAsset` reveals:<br><br>1. **Classification of Staff & Custom Roles:** The route defines staff as `const isStaff = !["PARENT", "STUDENT"].includes(membership.roleName.toUpperCase());`. Any user holding an active membership in the file's tenant whose role name is neither `PARENT` nor `STUDENT` is treated as staff. When an institution creates custom operational roles with limited scope (e.g., "Bus Driver", "Hostel Warden", "Sports Coach", "Library Assistant"), these users are automatically classified as `isStaff = true`.<br>2. **Absence of Granular Permission Checks:** The route checks neither `membership.role.permissions` nor `hasTenantPermission`. Once `isStaff` evaluates to `true`, the route completely skips document-level authorization guards, streaming the requested file immediately.<br>3. **Accessible Sensitive File Categories:** Under `enum FileKind` in `prisma/schema.prisma` (`LOGO`, `STUDENT_PHOTO`, `DOCUMENT`, `RECEIPT`), restricted custom-role users can access:<br>   - `FileKind.DOCUMENT` (when `studentId != null`): Sensitive student birth certificates, medical history forms, government ID proofs, and transfer certificates.<br>   - `FileKind.STUDENT_PHOTO`: Candidate facial identity photographs.<br>   - `FileKind.RECEIPT` & General `DOCUMENT` (when `studentId == null`): Official fee collection receipts, bank transaction proofs, and institutional financial records.<br>4. **Conflict with Platform RBAC Model:** This behavior directly conflicts with Knowletive's 38-key RBAC catalog (`TENANT_PERMISSION_KEYS` in `src/lib/catalog.ts`). In administrative UI routes and Server Actions, access to student data is gated by `tenant.students.read`, and fee receipts by `tenant.fees.read`. In the file download route, these permissions are completely bypassed.<br>5. **Tenant Isolation & Platform Owner Verification:** The access is **strictly restricted to the same tenant** (`membership.tenantId === fileAsset.tenantId`). A user from Tenant A cannot access files belonging to Tenant B (returns HTTP 403). Platform-owner access across tenants is an **intentional administrative diagnostic exception** by design. Therefore, **zero cross-tenant access paths exist (not an IDOR)**. However, within the tenant boundary, over-privileged custom roles can access confidential student medical records, birth certificates, and fee receipts without holding relevant permissions. |
| **Affected Roles** | `INSTITUTE_ADMIN`, `PRINCIPAL`, Custom Roles, Teaching & Non-Teaching Staff |
| **Affected Modules** | Storage & Object Serving (`src/app/api/files/[id]/route.ts`), RBAC Engine (`src/lib/auth.ts`, `src/lib/catalog.ts`) |
| **Source File & Relevant Action/Function** | `src/app/api/files/[id]/route.ts:38–42` (GET handler); `src/lib/auth.ts` (`hasTenantPermission`) |
| **Supporting Document & Section Reference** | Document 11 (Role Permission Matrix, Section 4); Document 27 (Institute Admin Journey, Section 4); Document 20 (Accuracy Audit, Section 6) |
| **Evidence Classification** | `Confirmed source-level weakness` (Intra-tenant least-privilege violation) |
| **Business Impact** | **High / Internal Data Privacy & Least-Privilege Violation.** Low-privilege institutional employees (e.g., bus drivers or facility attendants) possessing a platform account can access confidential student medical dossiers, family ID documents, and financial fee receipts of all students in the institution, violating statutory student data privacy regulations. |
| **Severity** | `High` (Intra-Tenant Least-Privilege Violation & Confidential PII Exposure — Reclassified from Medium) |
| **Reproduction / Validation Procedure** | 1. Create a custom role in Tenant $T_1$ named "Transport Assistant" with only `tenant.announcements.read` permission (all student and fee permissions withheld).<br>2. Assign user $U_1$ to that role in Tenant $T_1$.<br>3. Upload a confidential student medical report as `FileAsset` $F_1$ in Tenant $T_1$.<br>4. Log in as user $U_1$ and request `GET /api/files/[F1_id]`.<br>5. Observe that HTTP 200 OK is returned and file bytes are streamed, despite user $U_1$ lacking `tenant.students.read`. |
| **Recommended Resolution** | 1. In `src/app/api/files/[id]/route.ts`, replace the coarse `isStaff` heuristic with granular permission checks using `hasTenantPermission(ctx, ...)`:<br>   - If `fileAsset.studentId != null` or `fileAsset.kind === "STUDENT_PHOTO"`, require `tenant.students.read`.<br>   - If `fileAsset.kind === "RECEIPT"` or file is associated with a fee transaction, require `tenant.fees.read`.<br>   - For general institutional assets, require `tenant.settings.read`.<br>2. Maintain `PARENT` ward verification and `STUDENT` self-access checks as specialized consumer portal exceptions. |
| **Test Cases Required** | `TC-SEC-05A`: Restricted custom role blocked from student file download (verify HTTP 403 when lacking `tenant.students.read`).<br>`TC-SEC-05B`: Authorized staff member with `tenant.students.read` succeeds in downloading student file.<br>`TC-SEC-05C`: Strict cross-tenant rejection for custom roles (verify HTTP 403 on mismatched tenant). |
| **Acceptance Criteria** | Within a tenant, staff and custom roles must hold explicit domain permissions (`tenant.students.read` or `tenant.fees.read`) to download corresponding asset files; cross-tenant access remains completely blocked. |
| **Dependencies & Implementation Priority** | **Priority P1.** High-impact data privacy and storage authorization hardening. |

---

## 5. Financial Integrity Findings

This section details five source-verified findings governing ledger accuracy, concurrent settlements, idempotency, offline cash reconciliation, and receipt generation.

---

### GAP-FIN-01: Concurrent Payment Settlement and Manual Cash Receipt Race Hazard

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-FIN-01` |
| **Issue Title** | Concurrent Payment Settlement and Manual Cash Receipt Race Hazard |
| **Actual Problem Description** | In `src/actions/operations.ts:246` (`recordFeePaymentAction`) and `src/lib/payments.ts:217` (`settleFeePaymentLink`), mutations to invoice balances occur without acquiring a PostgreSQL pessimistic row-level lock (`SELECT ... FOR UPDATE`) on the target `FeeInvoice` record. In both functions, the invoice record is read via `db.feeInvoice.findFirst` *outside* the write transaction.<br><br>**Confirmed Source-Level Concurrency Weakness:**<br>1. In `recordFeePaymentAction`: `invoice` is fetched at line 258 outside `db.$transaction`. `outstanding` is computed in memory as `invoice.amount - invoice.paidAmount`. Inside `db.$transaction` (lines 272–289), `paidAmount` is updated with `invoice.paidAmount + amount` without re-reading the row or acquiring a row lock.<br>2. In `settleFeePaymentLink`: `invoice` is fetched at line 235 outside `db.$transaction`. Inside the transaction (lines 255–277), `paidAmount` is updated with `invoice.paidAmount + amount` without a lock.<br><br>**Potential Data-Integrity Consequences:**<br>If an accountant records an offline cash receipt at the cashier counter while another accountant verifies an online payment link (`verifyFeePaymentLinkAction` / `settleFeePaymentLink`) for the same invoice simultaneously:<br>- Both transactions read the same initial state (`invoice.paidAmount = 0`, `outstanding = 10000`).<br>- Cashier records ₹10,000 cash; online verification records ₹10,000 via manual verification.<br>- Both transactions execute independent write transactions (`db.feePayment.create` and `db.feeInvoice.update`).<br>- Result: Two `FeePayment` records are created totaling ₹20,000, while `FeeInvoice.paidAmount` is overwritten to ₹10,000 (lost update). Alternatively, under partial payment concurrency, `paidAmount` can overwrite with a stale balance, causing permanent ledger desynchronization and balance corruption.<br><br>**Runtime Reproduction Status:**<br>Statically confirmed source-level weakness; **runtime unvalidated**. This race condition has been diagnosed through static code analysis of transaction boundaries and Prisma queries; it has not yet been executed in a multi-threaded automated test harness. |
| **Affected Roles** | `ACCOUNTANT`, `INSTITUTE_ADMIN` |
| **Affected Modules** | Fee Management & Cashiering (`src/actions/operations.ts`), Payment Settlement Engine (`src/lib/payments.ts`) |
| **Source File & Relevant Action/Function** | `src/actions/operations.ts:246` (`recordFeePaymentAction`); `src/lib/payments.ts:217` (`settleFeePaymentLink`); `src/actions/operations.ts:587` (`verifyFeePaymentLinkAction`) |
| **Supporting Document & Section Reference** | Document 28 (Accountant User Journey, Section 8.1 & Section 27.1); Document 20 (Accuracy Audit, Section 7); Document 17 (Coverage & Gaps, Section 5) |
| **Evidence Classification** | `Confirmed source-level weakness` (Runtime load testing unvalidated) |
| **Business Impact** | **Critical / Financial Loss & Ledger Corruption.** Over-collection of student fees, incorrect outstanding balance calculations, unreconciled bank settlement reports, and legal/compliance liability during institutional financial audits. |
| **Severity** | `Critical` (Data Integrity / Concurrency Race Condition) |
| **Reproduction / Validation Procedure** | Execute the mandatory two-actor concurrency test specification below against a PostgreSQL test database instance to confirm whether un-locked reads result in lost updates or double credits. |
| **Recommended Resolution** | 1. In both `recordFeePaymentAction` and `settleFeePaymentLink`, acquire an explicit exclusive row-lock inside the transaction before reading invoice state:<br>`await tx.$queryRaw`SELECT id FROM "FeeInvoice" WHERE id = ${invoiceId} AND "tenantId" = ${tenantId} FOR UPDATE`;`<br>2. Re-read current `paidAmount` and `status` inside the transaction under the lock.<br>3. If `invoice.status === "PAID"` or `currentOutstanding <= 0`, abort the second payment atomically with `{ error: "This invoice has already been settled." }`.<br>4. Add a database CHECK constraint in PostgreSQL: `CHECK ("paidAmount" <= "amount")` to guarantee physical database rejection of overpayments at the storage engine level. |
| **Test Cases Required** | **Mandatory Two-Actor Concurrency Test (`TC-FIN-01-CONCURRENT-SETTLEMENT`):**<br><br>1. **Initial Test Fixture:**<br>   - Target invoice $I_1$ created in tenant $T_1$ with `amount = 1000000` (₹10,000 in paise), initial `paidAmount = 0`, status `PENDING`.<br>   - Initial outstanding balance = ₹10,000.<br>   - Active `FeePaymentLink` $L_1$ generated for $I_1$ with `amount = 1000000`, status `PENDING`.<br>2. **Actor 1 Action:** Cashier invokes `recordFeePaymentAction` attempting to record full offline payment of ₹10,000 cash.<br>3. **Actor 2 Action:** Accountant invokes `verifyFeePaymentLinkAction` (manual payment-proof verification pathway invoking `settleFeePaymentLink({ provider: "manual", referenceId: L1.id, amountPaid: 1000000 })`) for the exact same invoice simultaneously.<br>   *(Note: This test exercises the manual Accountant verification pathway; it does not simulate an automated gateway webhook since no tenant fee webhook endpoint is mounted).*<br>4. **Execution Protocol:** Both operations execute concurrently across isolated database connections with sub-millisecond offset.<br>5. **Expected Final State & Assertions:**<br>   - `FeeInvoice.paidAmount` must strictly equal ₹10,000 (never ₹20,000).<br>   - `FeeInvoice.status` must equal `PAID`.<br>   - Outstanding balance must equal ₹0.<br>   - No overpayment can occur (`paidAmount <= amount`).<br>   - Exactly one successful settlement recorded for the ₹10,000 outstanding amount.<br>   - The losing operation must fail or be safely rejected without creating a duplicate successful ledger entry in `model FeePayment`.<br><br>*Execution Status: Specified as a mandatory pre-deployment gating test; has NOT yet been executed in automated CI.* |
| **Acceptance Criteria** | Under arbitrary concurrency of offline cashier payments and online manual link verifications, `SUM(FeePayment.amount)` for any invoice must strictly equal `FeeInvoice.paidAmount`, and `FeeInvoice.paidAmount` must never exceed `FeeInvoice.amount`. |
| **Dependencies & Implementation Priority** | **Priority P0.** Core financial integrity blocker. |

---

### GAP-FIN-02: Missing Idempotency Key and Retry Coordination in Payment Settlement Actions

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-FIN-02` |
| **Issue Title** | Missing Idempotency Key and Retry Coordination in Payment Settlement Actions |
| **Actual Problem Description** | In `verifyFeePaymentLinkAction` (`src/actions/operations.ts:587`) and `settleFeePaymentLink` (`src/lib/payments.ts:217`), payment settlement operations lack client-provided or webhook-provided idempotency keys. If a network timeout, socket disconnect, or gateway delay occurs while `db.$transaction` is committing, the client receives a 504 Gateway Timeout or network drop while the server-side commit outcome remains unknown. If the client or automated retry mechanism immediately resubmits the request while the original transaction is still completing or after commit, the function re-reads the database. Although `settleFeePaymentLink` checks `if (link.status === "PAID") return link;`, there is an in-flight vulnerability window: if the retry arrives during the commit phase before `FeePaymentLink.status` is persisted, or if `referenceId` is omitted, the retry can insert a duplicate `FeePayment` record. |
| **Affected Roles** | `ACCOUNTANT`, `PARENT` |
| **Affected Modules** | Payment Settlement Engine (`src/lib/payments.ts`), Fee Actions (`src/actions/operations.ts`) |
| **Source File & Relevant Action/Function** | `src/lib/payments.ts:217` (`settleFeePaymentLink`); `src/actions/operations.ts:587` (`verifyFeePaymentLinkAction`) |
| **Supporting Document & Section Reference** | Document 28 (Accountant User Journey, Section 8.2 & Revision 1.3 Section 1); Document 20 (Accuracy Audit, Section 7) |
| **Evidence Classification** | `Potential risk requiring runtime validation` (Network timeout retry hazard) |
| **Business Impact** | **High / Financial Discrepancy.** Duplicate ledger entries created under unstable network conditions, requiring manual journal adjustments by accountants. |
| **Severity** | `High` (Idempotency & Network Reliability) |
| **Reproduction / Validation Procedure** | 1. Mock a network proxy delay between the client and Next.js server.<br>2. Trigger `verifyFeePaymentLinkAction`.<br>3. Simulate a client socket abort at 5,000ms followed by an immediate automated retry.<br>4. Observe potential duplicate execution paths when the database connection pool is under load. |
| **Recommended Resolution** | 1. Add an `idempotencyKey` column with a `UNIQUE` database constraint on `FeePayment` (`tenantId`, `idempotencyKey`).<br>2. Require `verifyFeePaymentLinkAction` and webhook handlers to pass a deterministic idempotency key (e.g., `linkId + "_" + utrReference` or provider event ID).<br>3. If a duplicate key is detected, return the existing payment record cleanly without executing write logic. |
| **Test Cases Required** | `TC-FIN-02A`: Network retry idempotency test (send identical settlement request 5 times in parallel; verify exactly one `FeePayment` created).<br>`TC-FIN-02B`: Unique constraint violation recovery test (verify duplicate idempotency key returns HTTP 200 with original transaction payload). |
| **Acceptance Criteria** | Multiple identical settlement requests submitted concurrently or sequentially with the same idempotency key must result in exactly one database mutation and idempotent response payloads. |
| **Dependencies & Implementation Priority** | **Priority P1.** High-impact financial hardening requirement. |

---

### GAP-FIN-03: Stale Active Payment Links Remaining After Offline Cash Settlement

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-FIN-03` |
| **Issue Title** | Stale Active Payment Links Remaining After Offline Cash Settlement |
| **Actual Problem Description** | When an accountant settles a fee invoice at the cashier counter via `recordFeePaymentAction` or waives an invoice via `waiveFeeInvoiceAction` in `src/actions/operations.ts`, the database transaction updates `FeeInvoice.status` to `PAID` or `WAIVED`. However, the transaction does *not* query, invalidate, or cancel existing records in `model FeePaymentLink`. Any public payment link tokens previously generated for that invoice remain in `status = "PENDING"` with valid future expiration timestamps. This is a **sequential lifecycle state omission** that occurs under normal single-user cashier workflows without requiring concurrency. If a parent clicks a previously received WhatsApp or SMS link, `/pay/[token]` loads normally, displays payment instructions, generates dynamic UPI QR codes, and accepts UTR payment proofs for an invoice that no longer requires payment. |
| **Affected Roles** | `ACCOUNTANT`, `PARENT` |
| **Affected Modules** | Fee Operations (`src/actions/operations.ts`), Public Payment View (`src/app/(public)/pay/[token]/page.tsx`) |
| **Source File & Relevant Action/Function** | `src/actions/operations.ts:246` (`recordFeePaymentAction`); `src/actions/operations.ts:312` (`waiveFeeInvoiceAction`) |
| **Supporting Document & Section Reference** | Document 28 (Accountant User Journey, Section 8.3 & Revision 1.4 Section 1); Document 25 (Parent User Journey, Section 5.2) |
| **Evidence Classification** | `Confirmed source-level weakness` (Sequential lifecycle state omission) |
| **Business Impact** | **Medium / Customer Confusion & Double Payment.** Parents inadvertently pay invoices that have already been settled by another family member in cash; schools must process embarrassing, time-consuming manual bank refunds. |
| **Severity** | `Medium` (Lifecycle State Synchronization — Reclassified from High) |
| **Reproduction / Validation Procedure** | 1. Issue an invoice and click "Generate Payment Link". Copy the link URL.<br>2. Record full cash payment for the invoice via cashier screen.<br>3. Open the link URL in an incognito browser window.<br>4. Observe that the page displays the full amount due, active UPI QR code, and allows submitting bank reference details. |
| **Recommended Resolution** | 1. In `recordFeePaymentAction`, inside the settlement transaction, execute:<br>`if (fullyPaid) { await tx.feePaymentLink.updateMany({ where: { feeInvoiceId: invoice.id, status: "PENDING" }, data: { status: "CANCELED" } }); }`.<br>2. In `waiveFeeInvoiceAction`, atomically cancel all pending links for that invoice.<br>3. In `/pay/[token]/page.tsx`, if `link.status === "CANCELED" || link.feeInvoice.status === "PAID"`, render a read-only "Invoice Already Settled" banner and suppress the payment QR code and submission form. |
| **Test Cases Required** | `TC-FIN-03A`: Cash settlement link cancellation test (verify all pending links transition to `CANCELED` upon full cash payment).<br>`TC-FIN-03B`: Fee waiver link cancellation test (verify all pending links transition to `CANCELED` upon invoice waiver).<br>`TC-FIN-03C`: Public page UI state test (verify `/pay/[token]` renders settled banner when link or invoice is closed). |
| **Acceptance Criteria** | Settling or waiving any fee invoice offline must immediately and atomically transition all active `FeePaymentLink` records for that invoice to `CANCELED`, disabling online payment capture and proof submission. |
| **Dependencies & Implementation Priority** | **Priority P1.** High-impact production hardening for fee collection. |

---

### GAP-FIN-04: Absence of Dedicated Webhook Ingestion Route for Tenant Student Fee Gateways

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-FIN-04` |
| **Issue Title** | Absence of Dedicated Webhook Ingestion Route for Tenant Student Fee Gateways |
| **Actual Problem Description** | In `src/lib/payments.ts`, comprehensive webhook verification routines exist for Razorpay (`verifyRazorpayWebhook`, `processRazorpayWebhook`) and Stripe (`verifyStripeWebhook`, `processStripeWebhook`). However, the repository contains no dedicated, publicly exposed HTTP route handler for tenant fee webhooks (e.g., `src/app/api/webhooks/fees/route.ts`). The existing webhook route `src/app/api/billing/webhook/route.ts` is strictly scoped to platform-level SaaS subscriptions (`model PlatformInvoice`). While `processRazorpayWebhook` contains logic to settle fee payment links (`settleFeePaymentLink`), live gateway events from Razorpay or Stripe cannot reach this function because no public API route exposes it. Consequently, student online fee collection currently operates exclusively through the manual fallback workflow: parents submit offline UTR references, and accountants must manually click "Verify" in the back-office UI. |
| **Affected Roles** | `ACCOUNTANT`, `INSTITUTE_ADMIN`, `PLATFORM_OWNER` |
| **Affected Modules** | Public Webhooks (`src/app/api/webhooks/`), Payment Integration (`src/lib/payments.ts`) |
| **Source File & Relevant Action/Function** | `src/lib/payments.ts:321` (`processRazorpayWebhook`); `src/app/api/billing/webhook/route.ts` |
| **Supporting Document & Section Reference** | Document 28 (Accountant User Journey, Section 8.5 & Section 27.3); Document 17 (Coverage & Gaps, Section 5); Document 22 (Platform Owner Provisioning, Section 7) |
| **Evidence Classification** | `Product capability gap` |
| **Business Impact** | **Medium / Operational Scalability Bottleneck.** School accountants must manually audit and click verification for every single online fee payment, defeating the purpose of automated gateway integration and creating severe back-office processing delays during term starts. |
| **Severity** | `Medium` (Automation & Integration Gap) |
| **Reproduction / Validation Procedure** | 1. Inspect route definitions in `src/app/api/`.<br>2. Confirm the absence of any webhook endpoint listening for tenant student fee events.<br>3. Configure Razorpay webhook dashboard to point to `/api/billing/webhook` and observe that student fee payment link events fail or are ignored because the handler targets platform subscription invoices. |
| **Recommended Resolution** | 1. Create a dedicated API route `src/app/api/webhooks/fees/route.ts`.<br>2. In the POST handler, read raw request body and signature headers (`x-razorpay-signature` or `stripe-signature`).<br>3. Verify cryptographic signatures using `verifyRazorpayWebhook` or `verifyStripeWebhook`.<br>4. Dispatch valid payloads to `processRazorpayWebhook` or `processStripeWebhook` to achieve zero-touch, automated settlement of student fee invoices. |
| **Test Cases Required** | `TC-FIN-04A`: Razorpay fee webhook validation and automated settlement test.<br>`TC-FIN-04B`: Stripe fee webhook validation and automated settlement test.<br>`TC-FIN-04C`: Invalid webhook signature rejection test (verify HTTP 400/401). |
| **Acceptance Criteria** | When a parent completes payment on a live Razorpay or Stripe checkout page, the gateway webhook must automatically mark the fee payment link `PAID`, create the `FeePayment` record, update the `FeeInvoice` balance to `PAID`, and dispatch a receipt notification without manual accountant intervention. |
| **Dependencies & Implementation Priority** | **Priority P2.** Requires resolving `GAP-FIN-01` (row locking) and creating `src/app/api/webhooks/fees/route.ts`. |

---

### GAP-FIN-05: Absence of ESC/POS Thermal Printing and Downloadable Fee Receipt PDF

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-FIN-05` |
| **Issue Title** | Absence of ESC/POS Thermal Printing and Downloadable Fee Receipt PDF |
| **Actual Problem Description** | In `src/actions/operations.ts` (`recordFeePaymentAction`), recording a fee payment inserts a database record into `model FeePayment` and writes an audit event. The cashier web interface functions correctly, and standard browser printing (`window.print()`) is operational. However, the system lacks specialized support for 80mm/58mm ESC/POS thermal receipt printers commonly used at cashier counters, as well as a standardized downloadable fee receipt PDF with institutional seals and tax breakdowns for parent reimbursement claims. This is an **optional product enhancement** for cashier ergonomics, not a functional defect or financial failure. |
| **Affected Roles** | `ACCOUNTANT`, `PARENT`, `STUDENT` |
| **Affected Modules** | Cashier UI (`src/app/app/fees/`), Parent Portal (`src/app/portal/fees/`), PDF Engine |
| **Source File & Relevant Action/Function** | `src/actions/operations.ts:246` (`recordFeePaymentAction`); `src/lib/format.ts` |
| **Supporting Document & Section Reference** | Document 28 (Accountant User Journey, Section 8.6); Document 25 (Parent User Journey, Section 5.3) |
| **Evidence Classification** | `Optional product enhancement` |
| **Business Impact** | **Low / Operational Polish & Convenience.** Slower cashier desk throughput during peak admission seasons; recurring parent support requests for official fee receipts. |
| **Severity** | `Low` (Optional Enhancement / Non-Defect) |
| **Reproduction / Validation Procedure** | 1. Navigate to `/app/fees` and record a cash payment.<br>2. Inspect UI response and observe that only standard browser printing is available; no ESC/POS layout or downloadable PDF is generated. |
| **Recommended Resolution** | 1. Implement a dedicated receipt rendering route `GET /app/fees/receipt/[paymentId]` optimized for standard thermal receipt printers (80mm width CSS `@media print`).<br>2. Implement server-side PDF generation using `@react-pdf/renderer` or headless Chromium to produce official institutional fee receipts with school logo, authorized signatory signature line, tax breakdown, and verification QR code. |
| **Test Cases Required** | `TC-FIN-05A`: Thermal receipt print CSS rendering test (verify layout within 80mm width).<br>`TC-FIN-05B`: Receipt PDF download test (verify valid PDF byte stream with correct invoice and payment totals). |
| **Acceptance Criteria** | Cashiers can trigger an 80mm thermal receipt print with one click immediately after recording payment; parents can download official PDF receipts from `/portal/fees`. |
| **Dependencies & Implementation Priority** | **Priority P3.** Optional cashier efficiency enhancement. |

---

## 6. Identity and Onboarding Findings

This section details four source-verified findings governing authentication, user provisioning, portal account linkage, and administrative delegation.

---

### GAP-IDN-01: Unlinked Student and Guardian Creation Records and Missing User Account Provisioning

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-IDN-01` |
| **Issue Title** | Unlinked Student and Guardian Creation Records and Missing User Account Provisioning |
| **Actual Problem Description** | In Knowletive, student and parent portal access (`/portal`) requires an authenticated `model User` record and an active `model Membership` linked to academic profiles (`student.userId === session.user.id` or `guardian.userId === session.user.id`). An inspection of the administrative onboarding actions reveals an identity handoff gap between academic admissions and user account provisioning:<br><br>1. **Inspected Source Creation Workflows:** In `src/actions/students.ts`, the standard admission workflows—`createStudentAction` (line 40), `importStudentsAction` (line 321), and `createGuardianAction` (line 503)—create records exclusively in `model Student`, `model Guardian`, and `model StudentGuardian`. These actions do *not* call `db.user.create`, do *not* create `model Membership` rows, and do *not* generate initial credentials. `Student.userId` and `Guardian.userId` are set to `null` on insertion.<br>2. **Account Linkage Absence in Creation Workflows:** New student and guardian records registered through the administrative UI or bulk CSV import pathways are **not automatically linked to user accounts** or granted portal memberships. Front desk staff and school administrators are given no form fields, toggles, or automated hooks to provision consumer portal credentials during enrollment.<br>3. **Scope and Production Record Distinction:** This finding identifies that **newly admitted students and guardians cannot log into consumer portals via standard creation actions**. It does *not* claim that every historical or existing record in live production databases is unlinked: records seeded via demonstration scripts (`prisma/seed.ts`, `src/lib/demo-accounts.ts`) or provisioned via out-of-band administrative database migrations can possess valid `userId` links. The defect resides specifically in the application's production administrative creation workflows. |
| **Affected Roles** | `STUDENT`, `PARENT`, `FRONT_DESK`, `INSTITUTE_ADMIN` |
| **Affected Modules** | Admissions Engine (`src/actions/students.ts`), User Authentication (`src/lib/auth.ts`), Consumer Portal (`src/app/portal/`) |
| **Source File & Relevant Action/Function** | `src/actions/students.ts:40` (`createStudentAction`); `src/actions/students.ts:321` (`importStudentsAction`); `src/actions/students.ts:503` (`createGuardianAction`); `src/lib/auth.ts` |
| **Supporting Document & Section Reference** | Document 29 (Front Desk User Journey, Section 6.2 & Section 27.2); Document 26 (Student User Journey, Section 2 & Section 27.1); Document 25 (Parent User Journey, Section 2 & Section 27.1); Document 20 (Accuracy Audit, Section 5) |
| **Evidence Classification** | `Confirmed source-level weakness` (Administrative onboarding creation gap) |
| **Business Impact** | **Critical / Core Value Proposition Failure.** Educational institutions using standard UI or CSV admissions cannot onboard families to the digital Student and Parent portals without developer database interventions or manual script execution. |
| **Severity** | `Critical` (Identity Architecture / Onboarding Blocker) |
| **Reproduction / Validation Procedure** | 1. Log in as Front Desk and create a student with guardian details via `createStudentAction`.<br>2. Inspect database query results: observe `Student.userId` is `NULL` and `Guardian.userId` is `NULL`.<br>3. Inspect `Membership` table: confirm zero memberships created for the student or guardian.<br>4. Attempt to log in at `/login` with the student or guardian email. Observe authentication failure ("Invalid credentials" or user does not exist). |
| **Recommended Resolution** | 1. In `createStudentAction` and `createGuardianAction`, add an automated user provisioning pipeline: when a valid email or mobile number is provided, automatically create a `model User` record with status `INVITED` or `ACTIVE`, hash a temporary initial password, create a `model Membership` with role `STUDENT` or `PARENT`, and populate `Student.userId` or `Guardian.userId`.<br>2. In `importStudentsAction`, support bulk user account generation with automated invitation tokens.<br>3. Provide a backfill script to scan existing unlinked `Student` and `Guardian` records and generate linked User accounts where missing. |
| **Test Cases Required** | `TC-IDN-01A`: Single student creation with linked User and Membership generation (verify `Student.userId` is populated).<br>`TC-IDN-01B`: Guardian creation with linked User and Membership generation (verify `Guardian.userId` is populated).<br>`TC-IDN-01C`: Student portal login with newly provisioned student credentials (verify successful dashboard access).<br>`TC-IDN-01D`: CSV import user account bulk provisioning test. |
| **Acceptance Criteria** | Creating a student or guardian record through standard administrative UI or API paths must establish a corresponding `User` record, `Membership` record with appropriate role, and persist non-null `userId` foreign keys on the academic records. |
| **Dependencies & Implementation Priority** | **Priority P0.** Foundational prerequisite for all parent and student portal workflows. |

---

### GAP-IDN-02: Absence of Self-Service Parent and Student Account Activation Workflows

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-IDN-02` |
| **Issue Title** | Absence of Self-Service Parent and Student Account Activation Workflows |
| **Actual Problem Description** | The platform lacks a self-service digital activation or claim-account portal (e.g., `/activate` or `/claim-account`). When an educational institution enrolls a student, guardians typically receive an admission number and an invitation letter or SMS. However, Knowletive provides no self-service mechanism where a guardian or student can navigate to a public or tenant-branded activation page, enter their registered mobile number or admission number, receive a one-time password (OTP), verify their identity, and set their personal login password. The only existing user creation mechanism in the administrative UI is `inviteStaffAction` in `src/actions/students.ts`, which requires the administrator to manually type a plaintext password on behalf of the user (`formData.get("password")`). |
| **Affected Roles** | `PARENT`, `STUDENT`, `FRONT_DESK`, `INSTITUTE_ADMIN` |
| **Affected Modules** | Authentication & Onboarding (`src/app/login/`, `src/actions/auth.ts`), Identity Lifecycle |
| **Source File & Relevant Action/Function** | `src/actions/auth.ts`; `src/app/login/page.tsx` |
| **Supporting Document & Section Reference** | Document 29 (Front Desk User Journey, Section 6.3); Document 25 (Parent User Journey, Section 2.2); Document 20 (Accuracy Audit, Section 5) |
| **Evidence Classification** | `Product capability gap` (Self-service onboarding workflow) |
| **Business Impact** | **High / Support Overhead & User Friction.** Educational institutions cannot roll out portal access to thousands of students without staff having to manually assign and distribute passwords individually, creating massive administrative friction and password security vulnerabilities. |
| **Severity** | `High` (User Onboarding Experience) |
| **Reproduction / Validation Procedure** | 1. Review all routes in `src/app/(public)/` and `src/app/(auth)/`.<br>2. Confirm the absence of an `/activate`, `/claim-account`, or `/register` route for students or guardians.<br>3. Inspect `src/actions/auth.ts` and confirm absence of OTP generation or account claiming actions. |
| **Recommended Resolution** | 1. Develop a dedicated public activation workflow at `/activate`.<br>2. Create a Server Action `claimAccountAction` that verifies `admissionNo` + `guardianPhone` against database records, generates a cryptographically secure 6-digit OTP, records it with a 10-minute expiry in an `ActivationToken` table, and dispatches it via SMS/email.<br>3. Create a completion action `completeActivationAction` that verifies the OTP, provisions/updates the `User` record with the user-selected password, and redirects directly to `/portal`. |
| **Test Cases Required** | `TC-IDN-02A`: Account claim verification with matching admission number and phone (verify OTP generation).<br>`TC-IDN-02B`: Account claim rejection with mismatched details (verify generic anti-enumeration error).<br>`TC-IDN-02C`: OTP expiration and replay prevention test.<br>`TC-IDN-02D`: Successful password creation and automatic login to `/portal`. |
| **Acceptance Criteria** | Guardians and students can self-activate their accounts using their registered mobile number or admission number without administrative staff ever knowing or handling their passwords. |
| **Dependencies & Implementation Priority** | **Priority P1.** High-impact production blocker; depends on resolving `GAP-IDN-01` and SMS gateway connectivity (`GAP-OPS-03`). |

---

### GAP-IDN-03: Staff Invitation Email Delivery Bound to Mock / Console Logger

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-IDN-03` |
| **Issue Title** | Staff Invitation Email Delivery Bound to Mock / Console Logger |
| **Actual Problem Description** | In `src/actions/students.ts:731` (`inviteStaffAction`), staff member onboarding does not follow a standard email invitation token flow. Instead, the administrator creating the staff record must provide a password directly in the form (`d.password`). If external notification delivery is attempted via `sendNotification` in `src/lib/notifications.ts`, email delivery requires either zero-cost SMTP credentials (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) or a Resend API key (`RESEND_API_KEY`, `EMAIL_FROM`). In standard production deployments where these environment variables are unconfigured, `deliverEmail` silently falls back to `deliverToConsole("email", ...)` which prints credentials to `stdout` in development, or marks the notification row `SKIPPED` in production (`NODE_ENV === "production"`). Consequently, newly recruited teachers and accountants receive no email notification or onboarding link. |
| **Affected Roles** | `TEACHER`, `ACCOUNTANT`, `PRINCIPAL`, `INSTITUTE_ADMIN` |
| **Affected Modules** | Staff Management (`src/actions/students.ts`), Notification Engine (`src/lib/notifications.ts`) |
| **Source File & Relevant Action/Function** | `src/actions/students.ts:731` (`inviteStaffAction`); `src/lib/notifications.ts:38` (`deliverEmail`) |
| **Supporting Document & Section Reference** | Document 27 (Institute Admin Journey, Section 7); Document 24 (Teacher Journey, Section 2); Document 20 (Accuracy Audit, Section 5) |
| **Evidence Classification** | `Product capability gap / Configuration dependency` |
| **Business Impact** | **High / Administrative Burden & Security Exposure.** Administrators must manually communicate initial passwords out-of-band via WhatsApp or insecure channels; in production, without SMTP keys, no email alerts reach staff members. |
| **Severity** | `High` (Communication Reliability & Staff Onboarding) |
| **Reproduction / Validation Procedure** | 1. In a staging environment without `SMTP_HOST` configured, execute `inviteStaffAction` for a new teacher email.<br>2. Check inbox of the invited email address. Observe no email arrives.<br>3. Inspect `NotificationLog` table. In production, observe row status is `SKIPPED`. |
| **Recommended Resolution** | 1. Refactor `inviteStaffAction` to use standard invitation tokens: do not require the administrator to set a staff password; instead, generate an invitation token with a 72-hour expiry and email an invite link (`/invite/[token]`).<br>2. Add an environment variable configuration health check in the Institute Admin dashboard (`/app/settings`) indicating whether email and SMS gateways are active or operating in fallback mode.<br>3. Provide an explicit in-app "Copy Invitation Link" fallback button in the staff list so administrators can copy onboarding URLs directly if email delivery fails. |
| **Test Cases Required** | `TC-IDN-03A`: Staff invite token generation and URL creation test.<br>`TC-IDN-03B`: Invite token redemption and staff password setting test.<br>`TC-IDN-03C`: In-app copy invite link fallback verification. |
| **Acceptance Criteria** | Creating a staff member generates a secure invitation token; if email gateway is unconfigured, the UI provides a one-click copyable invite URL; administrators are never prompted to enter passwords for other staff. |
| **Dependencies & Implementation Priority** | **Priority P1.** High-impact staff onboarding requirement; depends on `src/actions/students.ts` and `src/lib/notifications.ts`. |

---

### GAP-IDN-04: Absence of In-App Operational Delegation Between Admin and Principal Roles

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-IDN-04` |
| **Issue Title** | Absence of In-App Operational Delegation Between Admin and Principal Roles |
| **Actual Problem Description** | The RBAC catalog in `src/lib/catalog.ts` strictly withholds eight critical operational permissions from the `PRINCIPAL` role template: `tenant.billing.manage`, `tenant.fees.write`, `tenant.leads.delete`, `tenant.portal.read`, `tenant.roles.manage`, `tenant.settings.manage`, `tenant.staff.write`, and `tenant.students.delete`. This withholding is an **intended segregation of duties** by design, ensuring that financial configurations, platform subscriptions, and staff terminations remain exclusive to Institute Admins. However, in real-world institutions, temporary operational delegation is often needed (e.g., when the Institute Admin is on medical leave or travel). Currently, the platform provides no time-bounded, audit-logged delegation mechanism (e.g., "Act as Acting Admin"). Granting temporary authority requires permanently reassigning the Principal's role in `Membership` to `INSTITUTE_ADMIN`, which breaks audit trail role fidelity. This is an **optional governance enhancement**, not a defect. |
| **Affected Roles** | `PRINCIPAL`, `INSTITUTE_ADMIN` |
| **Affected Modules** | Role & Permission Engine (`src/lib/catalog.ts`, `src/lib/auth.ts`), Institute Settings |
| **Source File & Relevant Action/Function** | `src/lib/catalog.ts:77` (`ROLE_CATALOG`); `src/lib/auth.ts` (`authorizeTenantWrite`) |
| **Supporting Document & Section Reference** | Document 30 (Principal User Journey, Section 4.2 & Revision 1.1 Section 1); Document 27 (Institute Admin Journey, Section 4) |
| **Evidence Classification** | `Optional governance enhancement` (Design-governed RBAC extension) |
| **Business Impact** | **Low / Governance & Operational Rigidity.** Administrative inconvenience when primary administrators are absent; potential security exposure if temporary rights are granted via permanent role changes. |
| **Severity** | `Low` (Optional Governance Feature / Non-Defect) |
| **Reproduction / Validation Procedure** | 1. Log in as Principal.<br>2. Attempt to create a staff member or modify institute settings.<br>3. Observe 403 Forbidden with withheld permissions.<br>4. Confirm no delegation or acting-role feature exists in `/app/settings`. |
| **Recommended Resolution** | 1. Introduce an optional `RoleDelegation` table (`id`, `tenantId`, `delegatorUserId`, `delegateeUserId`, `delegatedRoleId`, `validFrom`, `validUntil`, `reason`, `status`).<br>2. In `authorizeTenantWrite`, evaluate active unexpired delegations for the authenticated user session.<br>3. Record all actions performed under delegation with dual audit metadata (`actorId: delegatee`, `onBehalfOf: delegator`). |
| **Test Cases Required** | `TC-IDN-04A`: Time-bounded delegation activation test (verify Principal acquires admin permissions during active window).<br>`TC-IDN-04B`: Delegation auto-expiration test (verify instant revocation once `validUntil` timestamp passes).<br>`TC-IDN-04C`: Dual-actor audit log verification during delegated actions. |
| **Acceptance Criteria** | Institute Admins can configure time-bounded operational delegations to Principals; permissions auto-expire; all delegated actions are distinctly audit-logged. |
| **Dependencies & Implementation Priority** | **Priority P3.** Optional governance enhancement. |

---

## 7. Functional Workflow Gaps

This section details nine source-verified findings across examination management, operational admissions batch atomicity, academic hierarchy maintenance, batch lifecycles, notification transports, and hardware integration.

---

### Part A: Academic & Examination Engine

---

### GAP-EXM-01: Inability to Delete Cancelled Examinations with Zero Mark Records

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-EXM-01` |
| **Issue Title** | Inability to Delete Cancelled Examinations with Zero Mark Records |
| **Actual Problem Description** | In `src/actions/exams.ts:267`, `deleteExaminationAction` enforces an exceptionally strict deletion guard: it allows deletion *only* if `lockedExam.status === "DRAFT"` and zero candidates, marks, revision events, or results exist. This restriction is an **intended data integrity safeguard** in the 49-cell examination FSM (`VALID_EXAM_TRANSITIONS`), designed to prevent accidental destruction of academic records. However, if an exam is scheduled by mistake and subsequently cancelled via `cancelExaminationAction` (`SCHEDULED -> CANCELLED`), the FSM does *not* permit transitioning from `CANCELLED` back to `DRAFT`, nor does `deleteExaminationAction` permit deleting a `CANCELLED` exam—even if zero marks were ever entered. Consequently, erroneously scheduled and cancelled exams remain permanently in institutional registers, cluttering listings. This is an **operational UX limitation**, not a data-loss defect. |
| **Affected Roles** | `PRINCIPAL`, `INSTITUTE_ADMIN`, `TEACHER` |
| **Affected Modules** | Examination Lifecycle (`src/actions/exams.ts`, `src/lib/exams.ts`) |
| **Source File & Relevant Action/Function** | `src/actions/exams.ts:267` (`deleteExaminationAction`); `src/lib/exams.ts:18` (`VALID_EXAM_TRANSITIONS`) |
| **Supporting Document & Section Reference** | Document 30 (Principal User Journey, Section 10.2 & Revision 1.2 Section 2); Document 27 (Institute Admin Journey, Section 9); Document 20 (Accuracy Audit, Section 8) |
| **Evidence Classification** | `Product capability gap / Operational UX enhancement` |
| **Business Impact** | **Medium / Data Clutter & Administrative Inconvenience.** Test exams, mistaken schedules, and cancelled drafts remain visible in institutional lists indefinitely, causing visual clutter. |
| **Severity** | `Medium` (Operational Usability & Lifecycle Maintenance) |
| **Reproduction / Validation Procedure** | 1. Create a draft exam and transition to `SCHEDULED`.<br>2. Cancel the exam via `cancelExaminationAction`. Current status is `CANCELLED`.<br>3. Attempt to invoke `deleteExaminationAction(examId)`.<br>4. Observe rejection error: "Only draft examinations can be deleted (current status: 'CANCELLED')." |
| **Recommended Resolution** | 1. Update `deleteExaminationAction` to permit deletion of `CANCELLED` examinations provided that `markCount === 0` and `resultCount === 0` (i.e., no marks were ever entered and no results were ever computed).<br>2. If enrollments exist on a cancelled exam without marks, perform cascading deletion of `tx.examEnrollment` and `tx.examSubject` under the examination row lock.<br>3. Add an audit log event `exam.cancelled_deleted`. |
| **Test Cases Required** | `TC-EXM-01A`: Delete cancelled examination with zero marks (verify successful deletion).<br>`TC-EXM-01B`: Reject deletion of cancelled examination with existing mark revision logs (verify rejection).<br>`TC-EXM-01C`: FSM integrity test ensuring published or evaluated exams cannot be deleted. |
| **Acceptance Criteria** | Principals and Admins can cleanly delete cancelled examinations that never progressed to mark entry, while historical exams with recorded marks remain permanently undeletable. |
| **Dependencies & Implementation Priority** | **Priority P2.** Operational usability enhancement for exam management. |

---

### GAP-EXM-02: Absence of Candidate Timetable Examination Conflict Detection

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-EXM-02` |
| **Issue Title** | Absence of Candidate Timetable Examination Conflict Detection |
| **Actual Problem Description** | In `src/actions/exams.ts` (`saveExamSubjectsAction`), timetable slots are created for subjects by specifying `examDate`, `startTime`, and `endTime`. The validation logic verifies that `startTime < endTime` and checks for physical classroom or hall overlap. However, the system does *not* execute a cross-subject candidate enrollment conflict check. In secondary schools and coaching academies where students enroll in elective subjects or cross-grade tracks, two exams can be scheduled at the exact same date and overlapping time window. The scheduling engine does not detect that Candidate $C_1$ is enrolled in Subject $A$ (e.g., Computer Science) and Subject $B$ (e.g., Physical Education) simultaneously. The timetable allows this overlapping schedule to be saved and published without any conflict warnings. |
| **Affected Roles** | `PRINCIPAL`, `TEACHER`, `STUDENT` |
| **Affected Modules** | Examination Timetabling (`src/actions/exams.ts`), Timetable Scheduling Engine |
| **Source File & Relevant Action/Function** | `src/actions/exams.ts:342` (`saveExamSubjectsAction`) |
| **Supporting Document & Section Reference** | Document 30 (Principal User Journey, Section 10.3); Document 24 (Teacher Journey, Section 8) |
| **Evidence Classification** | `Product capability gap` (Scheduling conflict validation) |
| **Business Impact** | **Medium / Operational Disruption.** Timetable collisions discovered only on exam day when students realize they have two overlapping papers, causing exam delays and emergency rescheduling. |
| **Severity** | `Medium` (Scheduling Logic & Conflict Detection) |
| **Reproduction / Validation Procedure** | 1. Schedule Subject 1 for Grade 11 (Math) on Oct 10 from 09:00 to 12:00.<br>2. Schedule Subject 2 for Grade 11 (Informatics) on Oct 10 from 10:00 to 13:00.<br>3. Enroll a student who takes both subjects.<br>4. Observe that `saveExamSubjectsAction` and `enrollStudentsAction` succeed without raising any scheduling conflict warning. |
| **Recommended Resolution** | 1. In `saveExamSubjectsAction`, implement a conflict detection routine: query `examEnrollment` and `student` subject enrollments for overlapping time windows on the same date.<br>2. Return structured conflict diagnostics: `{ ok: false, code: "CANDIDATE_TIMETABLE_CLASH", clashingCandidates: [...], clashingSubjects: [...] }`.<br>3. Allow administrators an explicit override checkbox (`allowOverlap: true`) for rare specialized sittings. |
| **Test Cases Required** | `TC-EXM-02A`: Timetable conflict detection on overlapping exam subject time windows.<br>`TC-EXM-02B`: Non-overlapping subjects on same date (verify acceptance).<br>`TC-EXM-02C`: Override flag verification for permitted parallel sittings. |
| **Acceptance Criteria** | Attempting to save exam subject slots with overlapping time windows for the same enrolled candidate cohort must be intercepted and surfaced with detailed conflict details. |
| **Dependencies & Implementation Priority** | **Priority P2.** Timetabling enhancement. |

---

### GAP-EXM-03: Absence of Historical GPA Recomputation on Retroactive Grade Band Edits

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-EXM-03` |
| **Issue Title** | Absence of Historical GPA Recomputation on Retroactive Grade Band Edits |
| **Actual Problem Description** | In `src/actions/exams.ts`, when results are calculated and published via `calculateAndPublishResultsAction`, an immutable cryptographic snapshot (`model ExamResultSnapshot`) is generated with a SHA-256 seal. Preserving snapshot immutability is an **intended cryptographic audit feature** of Knowletive, guaranteeing that historical marks and published transcripts cannot be silently altered. However, if an Institute Admin modifies or replaces grading scale boundaries (`createGradeScaleAction`, `deleteGradeScaleAction`) retroactively across an entire academic year, the system provides no controlled, version-aware historical recalculation pipeline. Administrators must manually unpublish, reopen, recalculate, and republish every individual exam. This is an **optional grading policy enhancement**, not a data defect. |
| **Affected Roles** | `PRINCIPAL`, `INSTITUTE_ADMIN` |
| **Affected Modules** | Examination Results Engine (`src/actions/exams.ts`), Grade Scale Configuration |
| **Source File & Relevant Action/Function** | `src/actions/exams.ts:512` (`calculateAndPublishResultsAction`); `src/actions/exams.ts:601` (`createGradeScaleAction`) |
| **Supporting Document & Section Reference** | Document 30 (Principal User Journey, Section 10.5 & Section 27.2); Document 20 (Accuracy Audit, Section 8) |
| **Evidence Classification** | `Optional grading policy enhancement` |
| **Business Impact** | **Low / Institutional Policy & Transcript Management.** Inconvenience when institutional grading policies change retroactively; manual effort required to unpublish and recompute transcripts. |
| **Severity** | `Low` (Optional Feature / Non-Defect) |
| **Reproduction / Validation Procedure** | 1. Publish an exam with Grade Scale 1 (80% = A). Result snapshot records Grade A.<br>2. Edit Grade Scale 1 (raise A threshold to 85%).<br>3. Inspect student cumulative transcript report. Observe that student with 82% still displays Grade A based on the stale snapshot. |
| **Recommended Resolution** | 1. Implement grade scale versioning (`GradeScale.version`) where grade scale edits create a new immutable version rather than mutating existing rows in place.<br>2. Introduce a dedicated batch action `recalculateTranscriptsAction` that audits and updates cumulative GPA records while preserving historical examination snapshot seals with audit notes. |
| **Test Cases Required** | `TC-EXM-03A`: Grade scale versioning integrity test.<br>`TC-EXM-03B`: Batch transcript recalculation test with audit trail logging. |
| **Acceptance Criteria** | Grade scale modifications must be versioned; administrators can trigger selective transcript re-evaluation with cryptographic audit trails. |
| **Dependencies & Implementation Priority** | **Priority P3.** Optional grading policy enhancement. |

---

### GAP-EXM-04: Lack of Automated Candidate Admit-Card / Hall-Ticket Generation

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-EXM-04` |
| **Issue Title** | Lack of Automated Candidate Admit-Card / Hall-Ticket Generation |
| **Actual Problem Description** | In `src/actions/exams.ts`, once an exam transitions to `SCHEDULED`, candidates are enrolled via `enrollStudentsAction` or `autoEnrollEligibleStudentsAction`. However, the platform provides no automated utility to generate official candidate Admit Cards (Hall Tickets). In South Asian and international school systems, students must present a physical or digital admit card containing their roll number, seat allocation, exam timetable, subject codes, candidate photograph, and institutional rules before entering the examination hall. Currently, schools must design and print admit cards using external third-party software or spreadsheets, re-entering exam dates and enrollment numbers manually. |
| **Affected Roles** | `STUDENT`, `PARENT`, `PRINCIPAL`, `TEACHER` |
| **Affected Modules** | Examination Operations (`src/app/app/exams/`), Student Portal (`src/app/portal/exams/`) |
| **Source File & Relevant Action/Function** | `src/actions/exams.ts:391` (`enrollStudentsAction`); `src/app/app/exams/[id]/page.tsx` |
| **Supporting Document & Section Reference** | Document 30 (Principal User Journey, Section 10.4); Document 26 (Student User Journey, Section 6); Document 25 (Parent User Journey, Section 6) |
| **Evidence Classification** | `Product capability gap` (Document generation feature) |
| **Business Impact** | **Medium / High Manual Overhead.** Substantial manual workload for administrative staff during exam weeks; increased risk of candidate seat confusion and impersonation in the exam hall. |
| **Severity** | `Medium` (Operational Feature Gap) |
| **Reproduction / Validation Procedure** | 1. Navigate to a scheduled examination `/app/exams/[id]`.<br>2. Look for an "Admit Cards" or "Hall Tickets" download/print button.<br>3. Confirm that no admit card generation endpoint or UI exists. |
| **Recommended Resolution** | 1. Implement a bulk admit-card generation route `GET /app/exams/[id]/admit-cards` that renders a printable grid (2 cards per A4 page) with student photo, barcode/QR code, seat assignment, and subject timetable.<br>2. Add a self-service "Download Admit Card" PDF button in the Student and Parent portals (`/portal/exams`) for scheduled examinations. |
| **Test Cases Required** | `TC-EXM-04A`: Bulk admit-card PDF rendering test.<br>`TC-EXM-04B`: Student portal admit card download verification. |
| **Acceptance Criteria** | Staff can bulk-print admit cards for all enrolled candidates with one click; students can download their personal hall ticket PDF from the portal. |
| **Dependencies & Implementation Priority** | **Priority P2.** Operational exam document feature. |

---

### Part B: Operational Workflows & Batch Lifecycles

---

### GAP-SEC-01: Reconciled Admission Quota Enforcement and CSV Import Batch Atomicity Limitation

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-SEC-01` |
| **Issue Title** | Reconciled Admission Quota Enforcement and CSV Import Batch Atomicity Limitation |
| **Actual Problem Description** | In previous draft evaluations, it was hypothesized that direct student creation and CSV import lacked transactional row locks and could allow concurrent requests to exceed the contracted SaaS student limit. An exhaustive source code re-audit reconciles this finding and confirms the architectural analysis in **Document 29 (Section 9.7)**. All three production student creation pathways (`convertLeadAction`, `createStudentAction`, and `importStudentsAction`) invoke the shared transactional capacity guard `assertStudentCapacityTx` (`src/lib/entitlements.ts:52`). Inside this function, every admission path executes `SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE` on the primary `Tenant` record, reads active plan limits under the lock, and counts current non-alumni students (`tx.student.count`). Because PostgreSQL serializes concurrent transactions on this row lock, **tenant quota limits CANNOT be exceeded or bypassed in any production creation path**.<br><br>The genuine architectural limitation identified in the codebase is an **operational batch atomicity design choice in `importStudentsAction` (`src/actions/students.ts:460–498`)**: instead of executing the entire CSV import within a single parent transaction, the action runs an un-locked pre-check (`if (count + candidates.length > plan.maxStudents)`), followed by an iterative per-row transaction loop (`for (const c of candidates) { await db.$transaction(...) }`). Under high concurrency or when a CSV batch exceeds remaining capacity, earlier rows commit successfully while subsequent rows throw errors and are appended to `skipped`. This causes a **partial batch import** (non-atomic UX) rather than a commercial quota overrun. This finding is formally classified in the **Operations Domain**; it is not a security vulnerability. |
| **Affected Roles** | `FRONT_DESK`, `INSTITUTE_ADMIN`, `PRINCIPAL` |
| **Affected Modules** | Admissions Engine (`src/actions/students.ts`, `src/actions/leads.ts`), Plan Entitlements (`src/lib/entitlements.ts`) |
| **Source File & Relevant Action/Function** | `src/actions/leads.ts:422` (`convertLeadAction`); `src/actions/students.ts:95` (`createStudentAction`); `src/actions/students.ts:463` (`importStudentsAction`); `src/lib/entitlements.ts:52` (`assertStudentCapacityTx`) |
| **Supporting Document & Section Reference** | Document 29 (Front Desk User Journey, Section 9.7 & Section 27.1); Document 27 (Institute Admin Journey, Section 6.2); Document 20 (Accuracy Audit, Section 4) |
| **Evidence Classification** | `Product capability gap / Batch atomicity limitation (Operations Domain)` |
| **Business Impact** | **Medium / Operational Usability.** When a CSV import hits plan capacity midway, the institution is left with partially imported rosters requiring manual inspection of skipped row logs. Total student limits remain strictly protected. |
| **Severity** | `Medium` (Batch Atomicity & Operational UX — Reclassified from Security Critical) |
| **Reproduction / Validation Procedure** | 1. Configure a tenant with `maxStudents = 100` and 95 existing students.<br>2. Upload a valid CSV containing 10 students.<br>3. Inspect execution: the upfront check checks `95 + 10 = 105 > 100` and rejects upfront if count exceeds limit; if 92 exist and 10 are submitted, upfront check rejects; if 92 exist and 8 are submitted, rows commit. If concurrent imports occur, rows commit up to 100, and remaining rows fail with `could not be saved`.<br>4. Observe that total students in `model Student` equals exactly 100 (never 101 or 102). Quota is strictly enforced, but the batch is partially committed. |
| **Recommended Resolution** | 1. In `importStudentsAction`, wrap the entire candidate import within a single interactive database transaction `db.$transaction(async (tx) => { ... }, { timeout: 30000 })`.<br>2. Acquire the `Tenant` row lock at the start of the batch transaction, calculate remaining capacity once, and reject the entire batch atomically if `candidates.length > remainingCapacity`.<br>3. Relocate the admission number duplicate pre-check in `createStudentAction` inside `tx` to return structured form errors rather than raw unique constraint violations (`P2002`). |
| **Test Cases Required** | `TC-SEC-01A`: Atomic batch rollback test (verify that if row 10 of a 10-student CSV fails, rows 1–9 are rolled back completely).<br>`TC-SEC-01B`: Quota limit boundary test (verify zero over-subscription under parallel student creation). |
| **Acceptance Criteria** | CSV student imports must be atomic (all-or-nothing); quota limits remain mathematically unbreachable across all entry vectors. |
| **Dependencies & Implementation Priority** | **Priority P2.** Operational UX and batch atomicity improvement. |

---

### Comparative Evaluation of Student Capacity Across All Three Insertion Pathways

The following table records the definitive source-level reconciliation across all three student creation entry points in the Knowletive codebase:

```
+-----------------------------------+-----------------------------------+-----------------------------------+-----------------------------------+
| Architectural Criterion           | Path 1: convertLeadAction         | Path 2: createStudentAction       | Path 3: importStudentsAction      |
+-----------------------------------+-----------------------------------+-----------------------------------+-----------------------------------+
| Domain Classification             | Operations (Admissions CRM)       | Operations (Student Admissions)   | Operations (Bulk CSV Ingestion)   |
| Source File & Line Number         | src/actions/leads.ts:422          | src/actions/students.ts:95        | src/actions/students.ts:463       |
| Capacity Check Exists?            | YES (assertStudentCapacityTx)     | YES (assertStudentCapacityTx)     | YES (assertStudentCapacityTx)     |
| Transactionally Protected?        | YES (db.$transaction block)       | YES (db.$transaction block)       | YES (per-candidate tx block)      |
| Tenant Row Lock Acquired?         | YES (SELECT ... FOR UPDATE)       | YES (SELECT ... FOR UPDATE)       | YES (SELECT ... FOR UPDATE)       |
| Lock Precedes Capacity Count?     | YES (Lock acquired at line 52)    | YES (Lock acquired at line 52)    | YES (Lock acquired at line 52)    |
| Creation Inside Same Transaction? | YES (tx.student.create)           | YES (tx.student.create)           | YES (tx.student.create)           |
| Can Quota Be Bypassed?            | NO (Mathematically Impossible)    | NO (Mathematically Impossible)    | NO (Mathematically Impossible)    |
| Batch Transaction Granularity     | Atomic (Single Lead Conversion)   | Atomic (Single Student Record)    | Non-Atomic (Iterative Row Loops)  |
| Evidence Method                   | Confirmed by static inspection    | Confirmed by static inspection    | Confirmed by static inspection    |
+-----------------------------------+-----------------------------------+-----------------------------------+-----------------------------------+
```

---

### GAP-OPS-01: Inability to Edit or Delete ClassLevel and Section Academic Entities (CR-Only)

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-OPS-01` |
| **Issue Title** | Inability to Edit or Delete ClassLevel and Section Academic Entities (CR-Only) |
| **Actual Problem Description** | In `src/actions/students.ts`, academic hierarchy management provides `createClassAction`, `createSectionAction`, `createSubjectAction`, and `deleteSubjectAction`. While subjects support both creation and deletion, the `ClassLevel` and `Section` entities are strictly **Create-and-Read (CR) only**. The codebase contains no `updateClassAction`, `deleteClassAction`, `updateSectionAction`, or `deleteSectionAction`. If an administrator mistypes a class name (e.g., "Garde 10" instead of "Grade 10"), creates a redundant section (e.g., Section "C" when only "A" and "B" exist), or changes section student capacity limits, there is no UI or Server Action to correct or remove the entity. Institutes must either tolerate typographic errors permanently in all drop-downs or submit manual database correction requests. |
| **Affected Roles** | `INSTITUTE_ADMIN`, `PRINCIPAL` |
| **Affected Modules** | Academic Hierarchy (`src/actions/students.ts`), Academics Setup UI (`src/app/app/academics/`) |
| **Source File & Relevant Action/Function** | `src/actions/students.ts:907` (`createClassAction`); `src/actions/students.ts:935` (`createSectionAction`) |
| **Supporting Document & Section Reference** | Document 30 (Principal User Journey, Section 6.1 & Revision 1.2 Section 1); Document 27 (Institute Admin Journey, Section 6); Document 20 (Accuracy Audit, Section 4) |
| **Evidence Classification** | `Product capability gap / CRUD Incompleteness` |
| **Business Impact** | **Medium / Data Quality & Usability Defect.** Typographical errors in core academic structure propagate across student registrations, report cards, fee invoices, and attendance registers without any UI mechanism to correct them. |
| **Severity** | `Medium` (Core CRUD Incompleteness) |
| **Reproduction / Validation Procedure** | 1. Navigate to `/app/academics` as Principal or Admin.<br>2. Create a class named "Test Class".<br>3. Inspect the UI for an "Edit" or "Delete" button next to the class or section.<br>4. Observe that only Subjects have a delete button; ClassLevels and Sections have no edit or delete controls. |
| **Recommended Resolution** | 1. Implement `updateClassAction` and `updateSectionAction` in `src/actions/students.ts` with `tenant.academics.write` authorization.<br>2. Implement `deleteClassAction` and `deleteSectionAction` with referential integrity safeguards: reject deletion if active students, attendance rolls, or timetable entries are assigned to the target class or section.<br>3. Add modal dialogs in the academics UI for entity renaming and capacity adjustments. |
| **Test Cases Required** | `TC-OPS-01A`: Update class name and display order test.<br>`TC-OPS-01B`: Delete empty section test (verify clean deletion).<br>`TC-OPS-01C`: Reject deletion of section containing enrolled students (verify referential guard). |
| **Acceptance Criteria** | Administrators can edit class names, section names, and section capacities; empty classes and sections can be deleted safely with foreign key validation. |
| **Dependencies & Implementation Priority** | **Priority P2.** Important administrative CRUD requirement. |

---

### GAP-OPS-02: Batch Deletion Guardrails and Clean-up for Un-enrolled Coaching Batches

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-OPS-02` |
| **Issue Title** | Batch Deletion Guardrails and Clean-up for Un-enrolled Coaching Batches |
| **Actual Problem Description** | In `src/actions/batches.ts`, coaching batch lifecycle actions include `createBatchAction`, `updateBatchAction`, `assignTeachersAction`, `enrollStudentsAction`, `dropStudentAction`, `transferStudentAction`, and `completeBatchAction`. The absence of a `deleteBatchAction` for completed or active batches is an **intended data retention safeguard by design**, preventing the accidental destruction of historical student enrollment, attendance rolls, and fee records. However, for empty, newly created draft batches (e.g., batches created by mistake with zero enrollments and zero attendance rolls), administrators have no cleanup action. They can only mark them `COMPLETED`, which retains them permanently in historical records. This is an **optional administrative cleanup enhancement**, not a system defect. |
| **Affected Roles** | `PRINCIPAL`, `INSTITUTE_ADMIN` |
| **Affected Modules** | Coaching & Batch Operations (`src/actions/batches.ts`) |
| **Source File & Relevant Action/Function** | `src/actions/batches.ts:16` (`createBatchAction`); `src/actions/batches.ts:182` (`completeBatchAction`) |
| **Supporting Document & Section Reference** | Document 30 (Principal User Journey, Section 7.2 & Revision 1.2 Section 1); Document 20 (Accuracy Audit, Section 4) |
| **Evidence Classification** | `Design-governed retention / Optional cleanup enhancement` |
| **Business Impact** | **Low / Minor Menu Clutter.** Empty accidental batches clutter selector menus; historical data remains strictly protected by design. |
| **Severity** | `Low` (Optional Cleanup / Non-Defect) |
| **Reproduction / Validation Procedure** | 1. Inspect exports in `src/actions/batches.ts`.<br>2. Confirm absence of any `deleteBatchAction`.<br>3. Check UI at `/app/batches` and confirm only "Complete Batch" option exists. |
| **Recommended Resolution** | 1. Implement `deleteBatchAction` in `src/actions/batches.ts`.<br>2. Enforce strict referential safeguards: allow deletion *only* if `enrolledCount === 0` and zero historical attendance records exist.<br>3. Prohibit deletion of active or completed batches with student history (maintain existing retention design). |
| **Test Cases Required** | `TC-OPS-02A`: Delete empty un-enrolled batch test (verify clean deletion).<br>`TC-OPS-02B`: Reject deletion of batch with student history test (verify preservation). |
| **Acceptance Criteria** | Empty batches created by mistake can be permanently deleted; batches with historical enrollments or attendance records are protected from deletion. |
| **Dependencies & Implementation Priority** | **Priority P3.** Optional administrative cleanup enhancement. |

---

### GAP-OPS-03: Mocked SMS Notification Transport for Absence and Fee Collection Alerts

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-OPS-03` |
| **Issue Title** | Mocked SMS Notification Transport for Absence and Fee Collection Alerts |
| **Actual Problem Description** | In `src/lib/notifications.ts:75` (`deliverSms`), outbound SMS notification delivery is hardcoded to require Twilio credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`). If these environment variables are missing, `deliverSms` falls back to `deliverToConsole("sms", to, body)`. In production (`NODE_ENV === "production"`), `deliverToConsole` marks the message row `SKIPPED` in `NotificationLog`. Furthermore, Twilio is rarely used for domestic educational SMS in primary target markets such as India, where Telecom Regulatory Authority of India (TRAI) DLT (Distributed Ledger Technology) registration and Indian SMS gateways (e.g., MSG91, Gupshup, Fast2SMS) are legally mandatory. Consequently, critical daily attendance alerts (notifying parents when a student is marked ABSENT) and fee payment reminders fail to reach parent mobile phones. |
| **Affected Roles** | `PARENT`, `STUDENT`, `TEACHER`, `PRINCIPAL`, `ACCOUNTANT` |
| **Affected Modules** | Attendance Management (`src/actions/operations.ts`), Fee Collection, Notification System (`src/lib/notifications.ts`) |
| **Source File & Relevant Action/Function** | `src/lib/notifications.ts:75` (`deliverSms`); `src/actions/operations.ts:16` (`markAttendanceAction`) |
| **Supporting Document & Section Reference** | Document 28 (Accountant User Journey, Section 8.7); Document 25 (Parent User Journey, Section 4.2); Document 24 (Teacher Journey, Section 4) |
| **Evidence Classification** | `Product capability gap / Integration dependency` |
| **Business Impact** | **High / Student Safety & Communication Breakdown.** Parents do not receive real-time notifications regarding unexcused student absences, creating child safety risks; institutes experience delayed fee collections due to missing payment reminders. |
| **Severity** | `High` (Communication Reliability & Safety) |
| **Reproduction / Validation Procedure** | 1. Mark a student `ABSENT` in daily attendance rolls.<br>2. Check `NotificationLog` table.<br>3. In production environments without Twilio keys, observe `NotificationLog.status = "SKIPPED"`. No SMS is ever dispatched to Indian mobile carriers. |
| **Recommended Resolution** | 1. Implement multi-provider SMS transport adapters in `src/lib/notifications.ts` supporting Indian DLT-compliant gateways (MSG91 / Gupshup / Fast2SMS) alongside Twilio.<br>2. Add DLT Template ID parameters (`dltTemplateId`, `entityId`) to `NotificationInput` to comply with telecom regulations.<br>3. Provide an in-app WhatsApp Business API adapter (via Meta Cloud API or Gupshup) for instant, low-cost delivery of absence alerts and payment receipts. |
| **Test Cases Required** | `TC-OPS-03A`: MSG91/DLT SMS payload generation and mock delivery test.<br>`TC-OPS-03B`: Absence alert end-to-end trigger test upon marking student absent.<br>`TC-OPS-03C`: WhatsApp notification fallback test. |
| **Acceptance Criteria** | Marking a student absent or issuing a fee link automatically dispatches an SMS/WhatsApp alert via configured domestic gateways with valid DLT compliance headers. |
| **Dependencies & Implementation Priority** | **Priority P1.** High-impact production communication requirement. |

---

### GAP-OPS-04: Absence of Biometric Hardware TCP/IP Daemon Integration for Attendance Capture

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-OPS-04` |
| **Issue Title** | Absence of Biometric Hardware TCP/IP Daemon Integration for Attendance Capture |
| **Actual Problem Description** | Currently, attendance tracking in Knowletive is 100% manual: teachers or administrators navigate to `/app/attendance` and submit web forms (`markAttendanceAction` or `saveAttendanceRegisterAction`). The manual workflow is fully operational and serves standard classroom roll-call requirements. The platform provides no real-time webhook ingestion endpoint, background socket daemon, or hardware integration API to receive automated biometric attendance logs (e.g., ZKTeco, Essl, or Realtime RFID/fingerprint/facial recognition machines commonly installed at school turnstiles). Supporting direct machine push protocols is an **optional enterprise product enhancement**, not a functional defect. |
| **Affected Roles** | `TEACHER`, `PRINCIPAL`, `INSTITUTE_ADMIN` |
| **Affected Modules** | Attendance Engine (`src/actions/operations.ts`, `src/app/app/attendance/`) |
| **Source File & Relevant Action/Function** | `src/actions/operations.ts:16` (`markAttendanceAction`); `src/app/api/` |
| **Supporting Document & Section Reference** | Document 30 (Principal User Journey, Section 8.4); Document 24 (Teacher Journey, Section 4.3); Document 17 (Coverage & Gaps, Section 4) |
| **Evidence Classification** | `Optional enhancement / Hardware roadmap` |
| **Business Impact** | **Low / Operational Efficiency.** Teachers spend 10–15 minutes every morning manually recording attendance rolls that could be automated via biometric hardware in larger schools. |
| **Severity** | `Low` (Optional Hardware Integration / Non-Defect) |
| **Reproduction / Validation Procedure** | 1. Review all routes in `src/app/api/`.<br>2. Confirm the absence of any biometric punch ingestion endpoint (e.g., `/api/biometric/punch` or ADMS protocol handler). |
| **Recommended Resolution** | 1. Implement a standardized machine webhook endpoint `POST /api/v1/attendance/punch` secured via per-device API tokens.<br>2. Support ADMS (Automatic Data Master Server) protocol pushes used by ZKTeco and Essl biometric devices.<br>3. Automatically map device biometric user IDs to `Student.admissionNo` or `Membership.id` and record daily attendance entries. |
| **Test Cases Required** | `TC-OPS-04A`: Biometric punch ingestion authentication test with valid API key.<br>`TC-OPS-04B`: Automated attendance roll transition from punch event (verify `PRESENT` recorded). |
| **Acceptance Criteria** | Biometric hardware can push punch events to `/api/v1/attendance/punch` with automated student matching and attendance register synchronization. |
| **Dependencies & Implementation Priority** | **Priority P3.** Optional hardware integration roadmap item. |

---

## 8. Test Coverage Gaps

This section details four source-verified findings governing automated testing deficiencies, concurrency test harnesses, multi-tenant isolation verification, and test repository stabilization.

---

### GAP-TST-01: Missing Multi-Actor Concurrency and Row-Locking Automated Test Suites

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-TST-01` |
| **Issue Title** | Missing Multi-Actor Concurrency and Row-Locking Automated Test Suites |
| **Actual Problem Description** | The existing automated test suite in `tests/` (e.g., `tests/exam-management.test.ts`, `tests/leads.test.ts`) verifies single-threaded business logic, status transitions, schema validations, and sequential CRUD operations. However, the repository contains *zero* automated integration tests that simulate concurrent, multi-threaded request execution against PostgreSQL row locks. Specifically, critical concurrency mechanisms—such as the `SELECT ... FOR UPDATE` row lock in `convertLeadAction`, the required row lock on `FeeInvoice` during cashier and online payment settlements, and concurrent candidate mark entry locks—have never been exercised under simulated load in CI/CD. Without concurrency test harnesses, regressions in database locking, deadlocks, or lock-bypass vulnerabilities cannot be detected prior to production deployments. |
| **Affected Roles** | All Roles (`PLATFORM_OWNER`, `INSTITUTE_ADMIN`, `ACCOUNTANT`, `TEACHER`, `FRONT_DESK`) |
| **Affected Modules** | Quality Assurance, Testing Framework (`tests/`), Concurrency Harness |
| **Source File & Relevant Action/Function** | `tests/`; `src/actions/leads.ts:422`; `src/actions/operations.ts:246`; `src/actions/exams.ts` |
| **Supporting Document & Section Reference** | Document 20 (Accuracy Audit, Section 9); Document 28 (Accountant User Journey, Section 27.1); Document 29 (Front Desk Journey, Section 27.1) |
| **Evidence Classification** | `Product capability gap / QA Test debt` |
| **Business Impact** | **High / Regression Risk.** Race conditions and deadlocks pass CI silently and surface only during high-traffic institutional events (e.g., term fee due dates or annual admission lotteries). |
| **Severity** | `High` (Quality Engineering / Concurrency Verification) |
| **Reproduction / Validation Procedure** | 1. Inspect `tests/` directory.<br>2. Run `npm test` and review test execution log.<br>3. Confirm that all test cases execute serially on a single thread and no worker pools simulate concurrent HTTP/action calls against identical database rows. |
| **Recommended Resolution** | 1. Implement a specialized concurrency integration test helper (`tests/helpers/concurrency.ts`) using `Promise.all` across isolated database client connections.<br>2. Create automated concurrency suites: `tests/concurrency/fee-settlement-race.test.ts`, `tests/concurrency/admission-quota-race.test.ts`, and `tests/concurrency/exam-mark-lock.test.ts`.<br>3. Integrate PostgreSQL deadlock and lock-timeout detection into CI test runners. |
| **Test Cases Required** | `TC-TST-01A`: 10 parallel admissions attempting to claim the final 2 plan seats (verify exactly 2 succeed and 8 fail gracefully).<br>`TC-TST-01B`: Concurrent cash payment and webhook verification race test.<br>`TC-TST-01C`: Concurrent mark revisions on same candidate exam subject (verify serial execution via revision events). |
| **Acceptance Criteria** | CI pipeline executes automated multi-actor concurrency tests validating that row-level locks prevent data corruption and deadlocks under concurrent write bursts. |
| **Dependencies & Implementation Priority** | **Priority P1.** Essential quality gate for P0 concurrency fixes. |

---

### GAP-TST-02: Missing Automated Integration Tests for Multi-Tenant Header and Cookie Switching

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-TST-02` |
| **Issue Title** | Missing Automated Integration Tests for Multi-Tenant Header and Cookie Switching |
| **Actual Problem Description** | In Knowletive, users can belong to multiple educational institutions (e.g., an educator teaching at School A in the morning and Coaching Academy B in the afternoon). Tenant isolation relies on the active tenant context resolved in `src/lib/auth.ts` from session cookies (`session.tenantId`) or custom headers. While individual tenant queries include `where: { tenantId }`, the test suite lacks automated integration coverage for rapid context switching. Specifically, there are no tests verifying that when a multi-tenant user switches institutes mid-session, cached Next.js Server Components, memoized React cache entries, or in-flight Server Actions do not leak data or write entities across tenant boundaries. |
| **Affected Roles** | All Roles, Platform Security Engineers |
| **Affected Modules** | Multi-Tenancy Architecture (`src/lib/auth.ts`), Session Management, Cache Invalidation |
| **Source File & Relevant Action/Function** | `src/lib/auth.ts:18` (`authorizeTenantWrite`, `getSession`); `tests/` |
| **Supporting Document & Section Reference** | Document 20 (Accuracy Audit, Section 9); Document 27 (Institute Admin Journey, Section 3.2); Document 22 (Platform Owner Provisioning, Section 4) |
| **Evidence Classification** | `Product capability gap / Security test debt` |
| **Business Impact** | **Medium / Data Confidentiality & Cross-Tenant Leakage Risk.** Potential cross-tenant data leakage or inadvertent data modifications across separate institutes if context resolution is compromised by client caching. |
| **Severity** | `Medium` (Tenant Isolation & Boundary Testing) |
| **Reproduction / Validation Procedure** | 1. Create a user with active memberships in Tenant 1 and Tenant 2.<br>2. Review existing test files in `tests/`.<br>3. Confirm that no test executes alternating requests between Tenant 1 and Tenant 2 to verify cache isolation. |
| **Recommended Resolution** | 1. Create `tests/integration/multi-tenant-switching.test.ts`.<br>2. Simulate sequential and concurrent requests from a single user session toggling active tenant headers.<br>3. Verify that all returned entities strictly match the requested tenant ID and that unauthorized cross-tenant writes return 403 Forbidden. |
| **Test Cases Required** | `TC-TST-02A`: Multi-tenant user switching between Tenant A and Tenant B (verify zero cross-tenant entity visibility).<br>`TC-TST-02B`: Rejection of cross-tenant foreign key linkages (attempt to assign Student from Tenant A to Class in Tenant B; verify rejection). |
| **Acceptance Criteria** | Automated test suite verifies that switching active tenants completely purges tenant cache contexts and that cross-tenant operations are rejected at the database query layer. |
| **Dependencies & Implementation Priority** | **Priority P2.** Security testing requirement. |

---

### GAP-TST-03: Missing Automated Regression Tests for Examination Snapshot Corruption Recovery

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-TST-03` |
| **Issue Title** | Missing Automated Regression Tests for Examination Snapshot Corruption Recovery |
| **Actual Problem Description** | In `src/actions/exams.ts:560`, `verifyResultSnapshotIntegrityAction` verifies published exam results against their SHA-256 cryptographic snapshot (`model ExamResultSnapshot.checksum`). If a mismatch is detected (indicating database tampering or data corruption), the function flags the snapshot as tampered. However, the repository contains no automated integration tests or regression suites that verify the end-to-end recovery workflow: unpublishing the exam, recording an administrative mark correction via `correctPublishedMarkAction`, re-evaluating results, and generating a new sealed snapshot. Without automated tests, the failure recovery pipeline remains unverified in automated CI. |
| **Affected Roles** | `PRINCIPAL`, `INSTITUTE_ADMIN`, Platform Auditors |
| **Affected Modules** | Examination Integrity (`src/actions/exams.ts`, `src/lib/exams.ts`) |
| **Source File & Relevant Action/Function** | `src/actions/exams.ts:560` (`verifyResultSnapshotIntegrityAction`); `src/actions/exams.ts:585` (`correctPublishedMarkAction`) |
| **Supporting Document & Section Reference** | Document 30 (Principal User Journey, Section 10.6 & Revision 1.3); Document 20 (Accuracy Audit, Section 8) |
| **Evidence Classification** | `Product capability gap / Disaster recovery debt` |
| **Business Impact** | **Medium / Audit Compliance & System Integrity.** In the event of data corruption during academic grading audits, administrators lack verified operational confidence in snapshot recalculation workflows. |
| **Severity** | `Medium` (Data Integrity & Disaster Recovery) |
| **Reproduction / Validation Procedure** | 1. Publish an examination and compute snapshots.<br>2. Review test suite in `tests/` for tests modifying snapshot bytes and asserting recovery behaviors.<br>3. Confirm that snapshot tampering recovery is untested in automated scripts. |
| **Recommended Resolution** | 1. Create `tests/integration/exam-snapshot-integrity.test.ts`.<br>2. Programmatically simulate database-level mark tampering (modifying an `ExamMark` row directly in PostgreSQL).<br>3. Assert that `verifyResultSnapshotIntegrityAction` flags the mismatch with status `CORRUPTED`.<br>4. Execute `correctPublishedMarkAction`, re-evaluate results, and assert that a new snapshot is generated with a valid SHA-256 seal. |
| **Test Cases Required** | `TC-TST-03A`: Cryptographic snapshot checksum verification test (matching data produces valid SHA-256).<br>`TC-TST-03B`: Tamper detection test (altered mark triggers integrity alarm).<br>`TC-TST-03C`: Official mark correction and snapshot resealing pipeline test. |
| **Acceptance Criteria** | Automated test suite validates snapshot integrity checks, tamper alerts, and the full administrative remediation and resealing lifecycle. |
| **Dependencies & Implementation Priority** | **Priority P2.** Examination subsystem quality gate. |

---

### GAP-TST-04: Test Harness Stabilization and Working-Tree Tracked File Debt

| Attribute | Specification Detail |
| :--- | :--- |
| **Issue ID** | `GAP-TST-04` |
| **Issue Title** | Test Harness Stabilization and Working-Tree Tracked File Debt |
| **Actual Problem Description** | In the current working tree of repository `D:\IT\Saas` on branch `staging/exam-stage-43`, two tracked files (`src/app/login/page.tsx` and `tests/exam-management.test.ts`) exhibit uncommitted modifications, and 48 untracked diagnostic files exist across root and temporary test directories (e.g., temporary audit scripts, ad-hoc test logs, and intermediate dumps). These uncommitted modifications reflect **in-flight developer environment state and staging branch stabilization**, rather than proof of test-harness instability. However, leaving modified files uncommitted creates friction for automated CI runs across developer workstations and increases the risk of merge conflicts during release promotion. |
| **Affected Roles** | Platform Developers, DevOps Engineers, CI/CD Maintainers |
| **Affected Modules** | Test Suite Configuration (`vitest.config.ts`, `tests/`), Repository Cleanliness |
| **Source File & Relevant Action/Function** | `tests/exam-management.test.ts`; `src/app/login/page.tsx`; repository root |
| **Supporting Document & Section Reference** | Document 20 (Accuracy Audit, Section 9); Document 18 (Master Journey Checklist, Section 8) |
| **Evidence Classification** | `Documentation-only / Repository hygiene debt` |
| **Business Impact** | **Low / Developer Ergonomics & CI Cleanliness.** Dirty git working tree can lead to accidental file commits or conflicting merges during feature releases; test scripts outside standard directories are skipped by standard CI runners. |
| **Severity** | `Low` (Repository Hygiene & Developer Workflow — Non-Defect) |
| **Reproduction / Validation Procedure** | 1. Run `git status --porcelain`.<br>2. Observe 2 modified tracked files and 48 untracked temporary files.<br>3. Confirm that uncommitted test modifications require formal consolidation into the staging branch. |
| **Recommended Resolution** | 1. Reconcile and commit the verified modifications in `src/app/login/page.tsx` and `tests/exam-management.test.ts` under a dedicated stabilization commit.<br>2. Clean up untracked temporary diagnostic files or add them to `.gitignore`.<br>3. Standardize all integration tests under `tests/integration/` and `tests/unit/` with automated Prisma test database seeding and teardown hooks. |
| **Test Cases Required** | `TC-TST-04A`: Clean execution of `npm test` across entire repository without manual environment overrides.<br>`TC-TST-04B`: Clean git working tree verification in CI build runners. |
| **Acceptance Criteria** | `git status` on staging branch reflects a clean working tree; `npm test` runs all unit and integration tests with deterministic pass rates. |
| **Dependencies & Implementation Priority** | **Priority P3.** Repository hygiene and developer workflow. |

---

## 9. Prioritized Implementation Roadmap

> [!IMPORTANT]
> **Engineering Planning Assumptions:**
> The priority tiers, target milestones (Sprints 44–47), and effort estimates presented in this roadmap represent **engineering planning assumptions** derived from code complexity and architectural dependency analysis. They are intended for engineering backlog grooming and sprint capacity planning, and do not constitute committed or contractually approved delivery dates. Final delivery commitments require confirmation of team velocity, sprint capacity, and product management scheduling.

The 26 identified architectural findings are organized into four prioritized engineering tiers:

```
+------------------------------------------------------------------------------------------------------------------------------------+
|                                      KNOWLETIVE REMEDIATION ROADMAP — PRIORITY TIERS                                              |
+---------------+---------------------+--------------------+------------------------------------+------------------------------------+
| Priority Tier | Finding Scope       | Target Milestone*  | Core Operational Objective         | Blast Radius & Safety Guardrail    |
+---------------+---------------------+--------------------+------------------------------------+------------------------------------+
| Tier 1: P0    | 2 Critical Findings | Sprint 44 (Week 1) | Financial Integrity & Onboarding   | Zero ledger corruption; portal link|
| Tier 2: P1    | 8 High Findings     | Sprint 45 (Week 2) | Production Launch Blockers         | Idempotency, DLT SMS, Storage RBAC |
| Tier 3: P2    | 10 Medium Findings  | Sprint 46 (Weeks 3)| Functional & Operational Upgrades  | Batch atomicity, CRUD, Webhook     |
| Tier 4: P3    | 6 Low Findings      | Sprint 47 (Weeks 4)| Optional Enhancements & Tech Debt  | Thermal print, delegation, cleanup |
+---------------+---------------------+--------------------+------------------------------------+------------------------------------+
*Note: Target milestones and durations reflect architectural planning assumptions.
```

---

### Tier 1: Priority P0 — Critical Financial Integrity & Core Onboarding Blockers (2 Issues)

These two findings represent critical blockers where concurrent operations cause physical data corruption in financial balances, or where the entire consumer portal layer is non-functional. **Implementation is non-negotiable before live production deployment.**

```
+------------+------------------------------------------------------------------+------------------+--------+------------------------+
| Issue ID   | Finding Title                                                    | Affected Domain  | Effort*| Target Milestone*      |
+------------+------------------------------------------------------------------+------------------+--------+------------------------+
| GAP-FIN-01 | Concurrent Payment Settlement & Manual Cash Receipt Race Hazard  | Finance / Cashier| 3 Days | Sprint 44 (Immediate)  |
| GAP-IDN-01 | Unlinked Student Creation Records & Missing User Provisioning    | Identity / Portal| 4 Days | Sprint 44 (Immediate)  |
+------------+------------------------------------------------------------------+------------------+--------+------------------------+
*Engineering planning assumptions.
```

1. **`GAP-FIN-01` — Concurrent Payment Settlement & Manual Cash Receipt Race Hazard**
   - *Primary Action:* Introduce `SELECT ... FOR UPDATE` row-level locking on `model FeeInvoice` inside `recordFeePaymentAction` and `settleFeePaymentLink`. Re-read outstanding balance inside the transaction. Add PostgreSQL `CHECK ("paidAmount" <= "amount")` constraint.
   - *Effort (Assumption):* 3 Engineering Days.
   - *Blast Radius:* Financial ledger mutation paths; requires regression testing of all cashier and link settlement paths.

2. **`GAP-IDN-01` — Unlinked Student Creation Records & Missing User Provisioning**
   - *Primary Action:* Wire automated user account provisioning into `createStudentAction`, `createGuardianAction`, and `importStudentsAction`. Populate `Student.userId` and `Guardian.userId`. Create companion data migration to backfill existing unlinked records.
   - *Effort (Assumption):* 4 Engineering Days.
   - *Blast Radius:* Admissions pipeline and authentication tables (`User`, `Membership`, `Student`, `Guardian`).

---

### Tier 2: Priority P1 — High-Impact Production Blockers & Hardening (8 Issues)

These eight findings represent workflow fractures, data privacy violations, and security test gaps that prevent standard operational rollouts, lead to parent confusion, cause missed absence alerts, leave staff invitations stranded, or expose confidential student and financial records to restricted internal roles.

```
+------------+------------------------------------------------------------------+------------------+--------+------------------------+
| Issue ID   | Finding Title                                                    | Affected Domain  | Effort*| Target Milestone*      |
+------------+------------------------------------------------------------------+------------------+--------+------------------------+
| GAP-FIN-02 | Missing Idempotency Key & Retry Coordination in Settle Action    | Finance / Ledger | 2 Days | Sprint 45              |
| GAP-FIN-03 | Stale Active Payment Links Remaining After Offline Settlement    | Finance / Online | 2 Days | Sprint 45              |
| GAP-SEC-02 | Public Payment Link Stale Lifecycle State & Proof Validation Gaps| Security / Web   | 2 Days | Sprint 45              |
| GAP-SEC-05 | Custom-Role Storage File RBAC Bypass & Coarse Membership Check   | Storage / RBAC   | 2 Days | Sprint 45              |
| GAP-IDN-02 | Absence of Self-Service Parent & Student Activation Workflows    | Onboarding / Auth| 4 Days | Sprint 45              |
| GAP-IDN-03 | Staff Invitation Email Delivery Bound to Mock / Console Logger   | HR / Staff       | 3 Days | Sprint 45              |
| GAP-OPS-03 | Mocked SMS Notification Transport for Absence & Fee Alerts       | Communication    | 3 Days | Sprint 45              |
| GAP-TST-01 | Missing Multi-Actor Concurrency & Row-Locking Test Suites        | Quality / Tests  | 4 Days | Sprint 45              |
+------------+------------------------------------------------------------------+------------------+--------+------------------------+
*Engineering planning assumptions.
```

---

### Tier 3: Priority P2 — Important Functional & Operational Improvements (10 Issues)

These ten findings address batch atomicity in CSV imports, core CRUD completeness, rate-limiting protections, student portal self-access, webhook automation, timetable clash prevention, admit card generation, and regression test suites.

```
+------------+------------------------------------------------------------------+------------------+--------+------------------------+
| Issue ID   | Finding Title                                                    | Affected Domain  | Effort*| Target Milestone*      |
+------------+------------------------------------------------------------------+------------------+--------+------------------------+
| GAP-SEC-01 | Reconciled Admission Quota Enforcement and CSV Import Atomicity  | Operations / CSV | 2 Days | Sprint 46              |
| GAP-SEC-03 | Missing Rate Limiting on Public Token Payment Proof Submissions  | Security / DoS   | 2 Days | Sprint 46              |
| GAP-SEC-04 | File Asset Download Authorization Scope & Student Self-Access Def| Storage / Portal | 2 Days | Sprint 46              |
| GAP-FIN-04 | Absence of Dedicated Webhook Ingestion Route for Student Fees    | Finance / Webhook| 3 Days | Sprint 46              |
| GAP-EXM-01 | Inability to Delete Cancelled Examinations with Zero Mark Records| Examinations     | 2 Days | Sprint 46              |
| GAP-EXM-02 | Absence of Candidate Timetable Examination Conflict Detection    | Examinations     | 3 Days | Sprint 46              |
| GAP-EXM-04 | Lack of Automated Candidate Admit-Card / Hall-Ticket Generation  | Examinations     | 3 Days | Sprint 46              |
| GAP-OPS-01 | Inability to Edit or Delete ClassLevel and Section Entities (CR) | Academics        | 3 Days | Sprint 46              |
| GAP-TST-02 | Missing Automated Integration Tests for Multi-Tenant Switching    | Testing / Auth   | 2 Days | Sprint 46              |
| GAP-TST-03 | Missing Regression Tests for Snapshot Corruption Recovery        | Testing / Audit  | 2 Days | Sprint 46              |
+------------+------------------------------------------------------------------+------------------+--------+------------------------+
*Engineering planning assumptions.
```

---

### Tier 4: Priority P3 — Optional Enhancements & Technical Debt (6 Issues)

These six findings represent operational polish, thermal printing support, administrative delegation, hardware daemon integration, and repository cleanliness.

```
+------------+------------------------------------------------------------------+------------------+--------+------------------------+
| Issue ID   | Finding Title                                                    | Affected Domain  | Effort*| Target Milestone*      |
+------------+------------------------------------------------------------------+------------------+--------+------------------------+
| GAP-FIN-05 | Absence of ESC/POS Thermal Printing & Printable Fee Receipt PDF  | Finance / Cashier| 2 Days | Sprint 47              |
| GAP-IDN-04 | Absence of In-App Operational Delegation Between Admin/Principal | Governance / RBAC| 3 Days | Sprint 47              |
| GAP-EXM-03 | Absence of Historical GPA Recomputation on Retroactive Grade Band| Examinations     | 3 Days | Sprint 47              |
| GAP-OPS-02 | Batch Deletion Guardrails and Clean-up for Un-enrolled Batches   | Batches          | 1 Day  | Sprint 47              |
| GAP-OPS-04 | Absence of Biometric Hardware TCP/IP Daemon Integration          | Attendance       | 4 Days | Sprint 47              |
| GAP-TST-04 | Test Harness Stabilization and Working-Tree Tracked File Debt    | Repo Hygiene     | 1 Day  | Sprint 47              |
+------------+------------------------------------------------------------------+------------------+--------+------------------------+
*Engineering planning assumptions.
```

---

## 10. Recommended Implementation Sequence

> [!NOTE]
> **Implementation Sequence Note:**
> The phased sequence below reflects logical engineering dependencies. Timelines and durations are **engineering planning assumptions** for release planning and sprint sequencing, subject to team capacity, velocity, and backlog grooming.

```
+------------------------------------------------------------------------------------------------------------------------------------+
|                                    KNOWLETIVE REMEDIATION ROLLOUT TIMELINE (4 PHASES)                                              |
+------------------------------------+--------------------------+-----------------------+--------------------------------------------+
| Engineering Phase                  | Target Window (Assumed)  | Target Deliverables   | Core Verification & Gating Checkpoint      |
+------------------------------------+--------------------------+-----------------------+--------------------------------------------+
| Phase 1: Core Integrity & Hotfixes | Sprint 44 (Days 1–10)    | GAP-FIN-01, GAP-IDN-01| Zero ledger race conditions;               |
|                                    |                          |                       | Backfilled User/Membership accounts.       |
+------------------------------------+--------------------------+-----------------------+--------------------------------------------+
| Phase 2: Onboarding & Gateways     | Sprint 45 (Days 11–20)   | GAP-FIN-02, GAP-FIN-03| Idempotency keys enforced;                 |
|                                    |                          | GAP-SEC-02, GAP-SEC-05| Active links cancelled on cash payment;    |
|                                    |                          | GAP-IDN-02, GAP-IDN-03| Storage RBAC enforced; Portal active;      |
|                                    |                          | GAP-OPS-03, GAP-TST-01| DLT SMS active; Concurrency CI running.    |
+------------------------------------+--------------------------+-----------------------+--------------------------------------------+
| Phase 3: Academic & Operations     | Sprint 46 (Days 21–30)   | GAP-SEC-01, GAP-SEC-03| Atomic CSV imports; Rate limiting;         |
|                                    |                          | GAP-SEC-04, GAP-FIN-04| Student self-download active;              |
|                                    |                          | GAP-EXM-01, GAP-EXM-02| Live student fee webhook endpoint active;  |
|                                    |                          | GAP-EXM-04, GAP-OPS-01| Deletion of empty draft/cancelled exams;   |
|                                    |                          | GAP-TST-02, GAP-TST-03| Timetable clash checks; Admit cards;       |
|                                    |                          |                       | Class/Section CRUD; Multi-tenant tests.    |
+------------------------------------+--------------------------+-----------------------+--------------------------------------------+
| Phase 4: Enterprise Hardening      | Sprint 47 (Days 31–40)   | GAP-FIN-05, GAP-IDN-04| ESC/POS thermal receipt printing;          |
|                                    |                          | GAP-EXM-03, GAP-OPS-02| Acting Admin operational delegation;       |
|                                    |                          | GAP-OPS-04, GAP-TST-04| Transcript re-evaluations; Batch cleanup;  |
|                                    |                          |                       | Biometric hardware webhook; Clean repo.    |
+------------------------------------+--------------------------+-----------------------+--------------------------------------------+
```

---

### Detailed Phase Execution Breakdown

```
Phase 1: Critical Core Integrity & Onboarding Unblocking (Sprint 44 — Planning Assumption)
  ├── 1.1 Database Migration: Add FeeInvoice CHECK ("paidAmount" <= "amount") (GAP-FIN-01)
  ├── 1.2 Implement SELECT ... FOR UPDATE on FeeInvoice in recordFeePaymentAction & settleFeePaymentLink (GAP-FIN-01)
  ├── 1.3 Implement automated User & Membership provisioning in createStudentAction & createGuardianAction (GAP-IDN-01)
  └── 1.4 Execute DB Backfill Script: Populate Student.userId & Guardian.userId for all unlinked legacy records (GAP-IDN-01)

Phase 2: Onboarding Portals, Live Gateways & Concurrency Testing (Sprint 45 — Planning Assumption)
  ├── 2.1 Database Migration: Add idempotencyKey to FeePayment (GAP-FIN-02)
  ├── 2.2 Enforce FeePaymentLink cancellation on cash payment & waive actions (GAP-FIN-03 & GAP-SEC-02)
  ├── 2.3 Enforce granular RBAC checks (tenant.students.read, tenant.fees.read) in file route (GAP-SEC-05)
  ├── 2.4 Build /activate self-service claim-account portal with mobile OTP verification (GAP-IDN-02)
  ├── 2.5 Refactor inviteStaffAction to use 72h tokens and provide in-app copy link fallback (GAP-IDN-03)
  ├── 2.6 Implement DLT-compliant Indian SMS gateway adapter (MSG91/Gupshup) in notifications (GAP-OPS-03)
  └── 2.7 Deploy multi-actor concurrency test harness in tests/concurrency/ (GAP-TST-01)

Phase 3: Academic Lifecycle, Webhooks & Protection Gates (Sprint 46 — Planning Assumption)
  ├── 3.1 Wrap importStudentsAction in a single interactive transaction for atomic batch imports (GAP-SEC-01)
  ├── 3.2 Implement sliding-window rate limiting on /pay/[token] and submitPaymentProofAction (GAP-SEC-03)
  ├── 3.3 Update /api/files/[id]/route.ts to allow Student self-download of personal records (GAP-SEC-04)
  ├── 3.4 Deploy dedicated student fee webhook route /api/webhooks/fees/route.ts (GAP-FIN-04)
  ├── 3.5 Enable safe deletion of CANCELLED exams with zero marks in deleteExaminationAction (GAP-EXM-01)
  ├── 3.6 Implement cross-subject candidate timetable clash detection in saveExamSubjectsAction (GAP-EXM-02)
  ├── 3.7 Implement candidate Admit Card / Hall Ticket PDF generator (GAP-EXM-04)
  ├── 3.8 Add updateClassAction, deleteClassAction, updateSectionAction, deleteSectionAction (GAP-OPS-01)
  └── 3.9 Add automated multi-tenant switching & snapshot recovery integration test suites (GAP-TST-02, GAP-TST-03)

Phase 4: Enterprise Hardening & Polish (Sprint 47 — Planning Assumption)
  ├── 4.1 Implement ESC/POS 80mm thermal receipt rendering and official fee receipt PDF (GAP-FIN-05)
  ├── 4.2 Introduce RoleDelegation model for temporary Admin-to-Principal delegation (GAP-IDN-04)
  ├── 4.3 Implement versioned grade scales and batch transcript recalculation pipeline (GAP-EXM-03)
  ├── 4.4 Add deleteBatchAction for un-enrolled coaching batches (GAP-OPS-02)
  ├── 4.5 Deploy biometric punch webhook endpoint /api/v1/attendance/punch (GAP-OPS-04)
  └── 4.6 Reconcile working tree debt and stabilize all tests under unified CI runner (GAP-TST-04)
```

---

## 11. Dependencies and Acceptance Criteria

### Technical Prerequisite Dependency Graph

The remediation roadmap enforces strict architectural dependencies. Upstream database constraints and locking primitives must be deployed before downstream workflow features can safely execute:

```
[Prisma Migration: DB Schema]
  ├── Add FeeInvoice CHECK ("paidAmount" <= "amount") ──► GAP-FIN-01 (FeeInvoice Row Lock)
  ├── Add FeePayment.idempotencyKey ──► GAP-FIN-02 (Idempotency Key) ──► GAP-FIN-04 (Live Fee Webhooks)
  │                                           │
  │                                           └──► GAP-FIN-03 & GAP-SEC-02 (Cancel Links on Cashier Pay)
  │
  ├──► GAP-IDN-01 (User/Membership Provisioning)
  │        │
  │        ├──► GAP-IDN-02 (Self-Service /activate Portal) ◄── GAP-OPS-03 (SMS DLT Gateway)
  │        │
  │        ├──► GAP-SEC-04 (Student Asset Download Self-Access)
  │        │
  │        └──► GAP-SEC-05 (Staff Storage RBAC Permission Enforcement)
  │
  ├──► GAP-SEC-01 (Atomic Batch CSV Imports) ──► GAP-TST-01 (Concurrency Test Harness)
  │
  └──► GAP-OPS-01 (ClassLevel/Section CRUD) ──► GAP-EXM-02 (Timetable Conflict Detection)
```

---

### Database Migration Requirements Tied to Specific Findings

Three planned Prisma schema migrations are required to support this roadmap, each tied to specific verified findings:

1. **Migration 1 (Tied to `GAP-FIN-01` and `GAP-FIN-02`):**
   ```sql
   -- GAP-FIN-01: Add database-level balance invariant
   ALTER TABLE "FeeInvoice" ADD CONSTRAINT "chk_fee_invoice_paid_amount" CHECK ("paidAmount" <= "amount");

   -- GAP-FIN-02: Add idempotency support to FeePayment
   ALTER TABLE "FeePayment" ADD COLUMN "idempotencyKey" VARCHAR(128);
   CREATE UNIQUE INDEX "FeePayment_tenantId_idempotencyKey_key" ON "FeePayment"("tenantId", "idempotencyKey");
   ```

2. **Migration 2 (Tied to `GAP-IDN-02`):**
   ```sql
   -- GAP-IDN-02: Create ActivationToken table for self-service onboarding
   CREATE TABLE "ActivationToken" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "tenantId" TEXT NOT NULL,
     "identifier" TEXT NOT NULL, -- Phone number or Admission No
     "otpHash" TEXT NOT NULL,
     "targetRole" TEXT NOT NULL, -- STUDENT or PARENT
     "targetEntityId" TEXT NOT NULL, -- Student.id or Guardian.id
     "expiresAt" TIMESTAMP(3) NOT NULL,
     "usedAt" TIMESTAMP(3),
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   );
   CREATE INDEX "ActivationToken_tenantId_identifier_idx" ON "ActivationToken"("tenantId", "identifier");
   ```

3. **Migration 3 (Tied to `GAP-IDN-04` — Optional Governance Enhancement):**
   ```sql
   -- GAP-IDN-04: Create RoleDelegation table for time-bounded administrative authority
   CREATE TABLE "RoleDelegation" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "tenantId" TEXT NOT NULL,
     "delegatorUserId" TEXT NOT NULL,
     "delegateeUserId" TEXT NOT NULL,
     "delegatedRoleId" TEXT NOT NULL,
     "validFrom" TIMESTAMP(3) NOT NULL,
     "validUntil" TIMESTAMP(3) NOT NULL,
     "reason" TEXT,
     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   );
   CREATE INDEX "RoleDelegation_tenantId_delegateeUserId_idx" ON "RoleDelegation"("tenantId", "delegateeUserId");
   ```

---

### System-Wide Global Acceptance Criteria

Before signing off on the complete remediation roadmap, the platform must satisfy the following global criteria across all environments:

1. **Zero Double-Credit Financial Invariant:** Under automated concurrent load testing simulating simultaneous cashier payments and online link settlements against the same invoice (`TC-FIN-01-CONCURRENT-SETTLEMENT`), `FeeInvoice.paidAmount` must equal the exact sum of verified `FeePayment` rows, and never exceed `FeeInvoice.amount`.
2. **Deterministic Admission Quota Adherence:** All student creation vectors (`convertLeadAction`, `createStudentAction`, and `importStudentsAction`) strictly enforce `TenantSubscription.plan.maxStudents` under `SELECT ... FOR UPDATE` row locks; CSV imports commit atomically without partial batch fragmentation.
3. **100% Student & Parent Portal Operability:** All student and guardian creation workflows automatically provision or link `User` and `Membership` records with non-null `userId` foreign keys, enabling successful login and full consumer dashboard navigation.
4. **Granular Storage Authorization:** File downloads enforce strict tenant isolation (zero cross-tenant access) and require appropriate RBAC permissions (`tenant.students.read`, `tenant.fees.read`) for internal staff, while permitting students self-download access to their own files.
5. **DLT-Compliant Real-Time Alerts:** Daily student absences and fee payment receipts dispatch via domestic SMS or WhatsApp within 10 seconds of action execution with valid carrier delivery receipts.

---

## 12. Final Evidence Limitations

This remediation roadmap has been constructed primarily upon static source inspection of the application codebase in `D:\IT\Saas` on branch `staging/exam-stage-43` and cross-referenced against Documents 00 through 30. The engineering team must acknowledge the following boundaries of this analysis:

1. **Static Source Inspection vs. Runtime Load Testing:**
   - Concurrency vulnerabilities (`GAP-FIN-01`, `GAP-FIN-02`) were diagnosed through static code analysis of transaction boundaries, Prisma query structures, and the absence of pessimistic row-level locks on `FeeInvoice`.
   - While mathematically certain under PostgreSQL ACID semantics, exact race window timings (in milliseconds) and database deadlock frequencies will vary depending on production PostgreSQL connection pool configurations (e.g., PgBouncer), transaction isolation levels (`READ COMMITTED` vs. `REPEATABLE READ`), and network latency. The two-actor concurrency test (`TC-FIN-01-CONCURRENT-SETTLEMENT`) is specified as a mandatory gating test and must be executed in CI.
2. **Resolution of Previous Quota Bypass Hypothesis:**
   - Previous draft concerns regarding student quota bypass in `createStudentAction` and `importStudentsAction` (`GAP-SEC-01`) have been conclusively resolved through static code verification.
   - All three production creation pathways invoke `assertStudentCapacityTx`, which executes `SELECT id FROM "Tenant" WHERE id = $1 FOR UPDATE`. Quota bypass under concurrent requests is prevented by the database engine.
3. **Student and Guardian Account Linkage Evidence Scope:**
   - The finding in `GAP-IDN-01` establishes that standard administrative UI and CSV creation actions do not automatically create user accounts or link `userId` foreign keys.
   - This analysis does not reflect an empirical query of existing production databases, where legacy records may have been populated via custom migration scripts or demo seeders (`prisma/seed.ts`).
4. **Storage File Access Control Boundaries:**
   - Static inspection confirms that `src/app/api/files/[id]/route.ts` strictly enforces tenant membership boundaries, preventing unauthorized cross-tenant file access.
   - The findings in `GAP-SEC-04` (student self-access defect) and `GAP-SEC-05` (custom-role staff RBAC bypass) reflect intra-tenant access control logic and do not constitute cross-tenant IDOR vulnerabilities.
5. **Third-Party Carrier & Gateway Sandbox Boundaries:**
   - Findings regarding external SMS delivery (`GAP-OPS-03`), email transports (`GAP-IDN-03`), and live webhooks (`GAP-FIN-04`) were derived by analyzing the fallback branches in `src/lib/notifications.ts` and `src/lib/payments.ts`.
   - Live external gateway sandboxes (Twilio, Resend, Razorpay, Stripe, MSG91) were not actively pinged with test credentials during this documentation audit. Actual carrier delivery rates and DLT template registration compliance must be validated during Phase 2 staging deployments.
6. **Working Tree and Diagnostic Artifact Separation:**
   - This audit was performed without modifying application source files, Prisma schemas, migrations, or companion documentation files.
   - Pre-existing working-tree modifications in `src/app/login/page.tsx` and `tests/exam-management.test.ts` reflect in-flight staging branch work, not test harness instability, and have been cataloged in `GAP-TST-04` and preserved untouched.
7. **Scope of Remediation:**
   - This document establishes the engineering specification, architectural blueprints, priority tiers, and test acceptance criteria. It does not execute application code modifications. Full engineering implementation must follow the phased sequence detailed in Section 10.
