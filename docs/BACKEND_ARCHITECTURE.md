# Knowletive SaaS — Backend Architecture Audit

**Document Version:** 1.0.0  
**Audit Date:** November 18, 2026  
**Auditor:** Senior Software Architect, FastAPI & Next.js Backend Engineer, SaaS Security Auditor  
**Repository Working Directory:** `D:\IT\Saas`  
**Application Version:** `0.1.0`  

---

## 1. Backend Runtime & Framework Architecture

Knowletive is implemented using **Next.js 16 full-stack server runtime** executed on Node.js (TypeScript 5.9.3, ES2024 target).

### 1.1 Architectural Distinction: Server Actions vs Standalone REST API
The system does not maintain a detached Python (FastAPI/Django) or Node (Express/NestJS) backend service for its primary operations. Instead:
- **Server Actions Layer:** 11 dedicated server action modules in `src/actions/*.ts` serve as the mutation API layer.
- **Server Components Layer:** React Server Components serve as the data-reading API layer.
- **Route Handlers Layer:** Specialized REST endpoints in `src/app/api/` handle non-UI concerns (file asset streaming, cron automation, CSV data export).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        NEXT.JS BACKEND RUNTIME                         │
│                                                                        │
│  HTTP Request ──► [Cookie Parser & TLS Termination]                   │
│                          │                                             │
│                          ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 1. Identity & Session Resolution (src/lib/auth.ts)               │  │
│  │    - Reads kl_session HTTP-only cookie                           │  │
│  │    - Computes SHA-256 tokenHash                                  │  │
│  │    - Looks up User, PlatformRole, Memberships                    │  │
│  │    - Wrapped in React cache() for request memoization            │  │
│  └───────────────────────┬──────────────────────────────────────────┘  │
│                          │                                             │
│                          ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 2. Tenant Context Resolution (src/lib/auth.ts)                   │  │
│  │    - Reads kl_tenant cookie                                      │  │
│  │    - Validates User's active Membership in Tenant                │  │
│  │    - Loads TenantSubscription & Plan entitlements                │  │
│  │    - Resolves effective permissions (Base + Extra - Deny)        │  │
│  └───────────────────────┬──────────────────────────────────────────┘  │
│                          │                                             │
│                          ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 3. RBAC & Subscription Write Guard (src/lib/rbac.ts)             │  │
│  │    - authorizeTenantWrite(permissionKey, actionType)             │  │
│  │    - Blocks writes if subscription is PAST_DUE / PAUSED          │  │
│  └───────────────────────┬──────────────────────────────────────────┘  │
│                          │                                             │
│                          ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 4. Validation & Capacity Guard (src/lib/validation.ts)           │  │
│  │    - Zod schema validation (safeParse)                           │  │
│  │    - Plan capacity assertions (assertStudentCapacity, etc.)      │  │
│  └───────────────────────┬──────────────────────────────────────────┘  │
│                          │                                             │
│                          ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 5. Domain Service & Transaction (src/actions/*, src/lib/*)       │  │
│  │    - Advisory locks / Row locks (FOR UPDATE)                     │  │
│  │    - Prisma ORM db.$transaction()                                │  │
│  │    - Immutability trigger checks & check constraints             │  │
│  │    - Double-entry ledger postings                                │  │
│  └───────────────────────┬──────────────────────────────────────────┘  │
│                          │                                             │
│                          ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 6. Audit & Cache Invalidation                                    │  │
│  │    - writeAudit(actor, action, entity, entityId, meta)           │  │
│  │    - revalidatePath(path)                                        │  │
│  │    - Returns FormState { ok: true, success: "..." }              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. API Structure & Inventory of Backend Services

The backend functionality is divided into 11 Server Action modules in `src/actions/` and 4 Route Handlers:

### 2.1 Server Action Modules

| Action File | Operations Exported | Key Business Logic & Guards |
| :--- | :--- | :--- |
| [`src/actions/auth.ts`](file:///D:/IT/Saas/src/actions/auth.ts) | `loginAction`, `verifyTwoFactorLoginAction`, `logoutAction`, `switchTenantAction`, `changePasswordAction`, `requestPasswordResetAction`, `resetPasswordAction`, `revokeSessionAction`, `revokeOtherSessionsAction`, `beginTwoFactorAction`, `confirmTwoFactorAction`, `disableTwoFactorAction` | Hashed session tokens, bcrypt verification, brute-force lockout (5 failed attempts), TOTP 2FA verification with temporary JWT cookie. |
| [`src/actions/platform.ts`](file:///D:/IT/Saas/src/actions/platform.ts) | `createTenantAction`, `suspendTenantAction`, `activateTenantAction`, `openWorkspaceAction`, `extendTrialAction`, `changeTenantPlanAction`, `markInvoicePaidAction`, `createTenantInvoiceAction`, `createPlanAction`, `savePlanAction`, `savePlatformRoleAction`, `invitePlatformUserAction`, `updatePlatformUserStatusAction`, `savePlatformSettingsAction` | Multi-tenant provisioning, plan definition, platform team RBAC, manual subscription invoice creation. |
| [`src/actions/admin.ts`](file:///D:/IT/Saas/src/actions/admin.ts) | `createTenantRoleAction`, `saveTenantRoleAction`, `deleteTenantRoleAction`, `saveInstitutionSettingsAction`, `updateProfileAction`, `changeTenantPlanAction` | Custom tenant roles creation, institute branding settings, admin profile updates. |
| [`src/actions/students.ts`](file:///D:/IT/Saas/src/actions/students.ts) | `createStudentAction`, `updateStudentAction`, `setStudentStatusAction`, `importStudentsAction`, `createGuardianAction`, `updateGuardianAction`, `unlinkGuardianAction`, `deleteGuardianAction`, `inviteStaffAction`, `updateStaffAction`, `removeStaffAction`, `createClassAction`, `createSectionAction`, `createSubjectAction`, `deleteSubjectAction` | Student demographics CRUD, guardian relationship binding, academic structure management, CSV bulk student import. |
| [`src/actions/leads.ts`](file:///D:/IT/Saas/src/actions/leads.ts) | `createLeadAction`, `updateLeadAction`, `logLeadActivityAction`, `deleteLeadAction`, `draftLeadReplyAction`, `convertLeadAction`, `exportLeadsCsvAction`, `importLeadsCsvAction` | Admissions CRM pipeline, activity logging, lead-to-student atomic conversion, bounded duplicate detection, CWE-1236 sanitized CSV. |
| [`src/actions/batches.ts`](file:///D:/IT/Saas/src/actions/batches.ts) | `createBatchAction`, `updateBatchAction`, `assignTeachersAction`, `enrollStudentsAction`, `dropStudentAction`, `transferStudentAction`, `completeBatchAction` | Cohort lifecycle, teacher assignment, student transfers, capacity checks, immutable `BatchEnrollmentEvent` logging. |
| [`src/actions/syllabus.ts`](file:///D:/IT/Saas/src/actions/syllabus.ts) | `createSyllabusAction`, `updateSyllabusAction`, `archiveSyllabusAction`, `deleteSyllabusAction`, `createChapterAction`, `updateChapterAction`, `deleteChapterAction`, `reorderChaptersAction`, `createTopicAction`, `updateTopicAction`, `deleteTopicAction`, `reorderTopicsAction`, `createLessonPlanAction`, `updateLessonPlanAction`, `deleteLessonPlanAction`, `updateTopicProgressAction`, `getSyllabusDashboardMetrics` | Curriculum hierarchy (Tracks, Chapters, Topics, Lesson Plans), teaching hours tracking, immutable progress events. |
| [`src/actions/exams.ts`](file:///D:/IT/Saas/src/actions/exams.ts) | `createExaminationAction`, `updateExaminationAction`, `deleteExaminationAction`, `transitionExamStatusAction`, `cancelExaminationAction`, `reopenEvaluatedExamAction`, `archiveExaminationAction`, `saveExamSubjectsAction`, `autoEnrollEligibleStudentsAction`, `enrollStudentsAction`, `updateEnrollmentStatusAction`, `enterMarksBulkAction`, `verifyExamSubjectMarksAction`, `calculateAndPublishResultsAction`, `correctPublishedMarkAction`, `exportExamResultsCsvAction`, `verifyResultSnapshotIntegrityAction`, `createGradeScaleAction`, `deleteGradeScaleAction`, `getExamCompletenessAction` | Exam state machine (`DRAFT` -> `SCHEDULED` -> `IN_PROGRESS` -> `COMPLETED` -> `EVALUATED` -> `PUBLISHED`), marks entry, Cartesian completeness checks, SHA-256 snapshot hashing, immutable mark revision events. |
| [`src/actions/operations.ts`](file:///D:/IT/Saas/src/actions/operations.ts) | `markAttendanceAction`, `saveAttendanceRegisterAction`, `createFeeInvoiceAction`, `recordFeePaymentAction`, `waiveFeeInvoiceAction`, `createAnnouncementAction`, `toggleAnnouncementPinAction`, `deleteAnnouncementAction`, `runAiAction`, `deleteAiJobAction`, `submitPaymentProofAction`, `verifyPaymentLinkProofAction`, `rejectPaymentLinkProofAction`, `createFeePaymentLinkAction` | Attendance upsert, fee invoice billing, UPI payment link generation, payment proof verification, AI Studio synchronous execution. |
| [`src/actions/storage.ts`](file:///D:/IT/Saas/src/actions/storage.ts) | `uploadStudentDocumentAction`, `deleteStudentDocumentAction`, `uploadSchoolLogoAction`, `deleteSchoolLogoAction` | Tenant-isolated disk storage upload/delete, mime-type verification, storage quota accounting. |
| [`src/actions/notifications.ts`](file:///D:/IT/Saas/src/actions/notifications.ts) | `markNotificationsReadAction`, `markAllNotificationsReadAction` | In-app notification status toggling. |

### 2.2 HTTP Route Handlers

1. **`GET /app/leads/export`:**
   - **File:** [`src/app/(app)/app/leads/export/route.ts`](file:///D:/IT/Saas/src/app/(app)/app/leads/export/route.ts)
   - **Function:** Streams a CSV export of filtered tenant leads. Applies CWE-1236 injection neutralization (`'`).
2. **`GET /app/students/export`:**
   - **File:** [`src/app/(app)/app/students/export/route.ts`](file:///D:/IT/Saas/src/app/(app)/app/students/export/route.ts)
   - **Function:** Streams a CSV export of active student records.
3. **`GET /api/files/[id]`:**
   - **File:** [`src/app/api/files/[id]/route.ts`](file:///D:/IT/Saas/src/app/api/files/[id]/route.ts)
   - **Function:** Authorizes and streams file assets. School logos are public; student photos and documents require tenant session authentication and guardian/student ownership verification.
4. **`POST /api/cron/renewal-check`:**
   - **File:** [`src/app/api/cron/renewal-check/route.ts`](file:///D:/IT/Saas/src/app/api/cron/renewal-check/route.ts)
   - **Function:** Evaluates expiring subscriptions and trials within 7 days, dispatches email notifications, and transitions churned accounts. Protected by `CRON_SECRET` Bearer token.

---

## 3. Authentication Implementation & Session Security

Knowletive implements an **enterprise-hardened, database-backed stateful session architecture**.

### 3.1 Session Creation & Lifecycle
- **Password Security:** Passwords are hashed with `bcryptjs` using 12 salt rounds via `hashPassword(password)` in [`src/lib/auth.ts`](file:///D:/IT/Saas/src/lib/auth.ts#L66).
- **Session Tokens:** 32-byte cryptographically secure random bytes generated via `randomBytes(32).toString("base64url")`.
- **Database Storage:** The raw session token is never stored in plaintext. The backend hashes the token using `crypto.createHash("sha256")` and stores it in the `Session.tokenHash` column.
- **Cookie Security:** The raw token is sent to the browser via the `kl_session` cookie with flags:
  ```typescript
  {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt // 7-day TTL
  }
  ```
- **Session Revocation:** Supported at single-device (`revokeSessionAction`) and all-other-devices (`revokeOtherSessionsAction`) levels by marking `revokedAt = NOW()` or deleting the matching `Session` row.

### 3.2 Two-Factor Authentication (TOTP)
- **Secret Generation & Storage:** TOTP secret generated via base32 encoding and stored encrypted or keyed on `User.twoFactorSecret`.
- **QR Code Provisioning:** Base64 QR code rendered via `qrcode` package for authenticator apps (Google Authenticator, Microsoft Authenticator).
- **Pending Handshake (JWT):** During login, if `user.twoFactorEnabled` is true, the primary session is deferred. The server issues a short-lived (10-minute) signed JWT in the `kl_pending` cookie signed with `SESSION_SECRET` via `jose.SignJWT`. Upon entering the valid 6-digit TOTP code, the pending cookie is cleared and the real `kl_session` is issued.

### 3.3 Brute-Force Protection & Lockout
- **Account Lockout:** Failed login attempts increment `User.failedLoginAttempts`. When attempts reach 5, `User.lockedUntil` is set to 15 minutes in the future.
- **Rate Limiting:** IP and endpoint rate-limiting enforced via [`src/lib/rate-limit.ts`](file:///D:/IT/Saas/src/lib/rate-limit.ts), storing fixed-window hit counts in the `RateLimitBucket` database table.

---

## 4. Authorization & Role-Based Access Control (RBAC)

### 4.1 Dual-Scope Architecture
The authorization system segregates permissions into two non-overlapping scopes:
1. **`PLATFORM` Scope (14 Permissions):**
   - Global SaaS governance (`platform.overview.read`, `platform.institutes.manage`, `platform.plans.manage`, `platform.subscriptions.manage`, `platform.roles.manage`, `platform.users.manage`, `platform.audit.read`, `platform.ai.read`, `platform.settings.manage`).
   - Attached to `User.platformRoleId` or implicitly granted to `User.isPlatformOwner`.
2. **`TENANT` Scope (36 Permissions):**
   - Institute operations (`tenant.leads.*`, `tenant.batches.*`, `tenant.syllabus.*`, `tenant.exams.*`, `tenant.students.*`, `tenant.parents.*`, `tenant.staff.*`, `tenant.academics.*`, `tenant.attendance.*`, `tenant.fees.*`, `tenant.announcements.*`, `tenant.notifications.*`, `tenant.ai.*`, `tenant.billing.*`, `tenant.roles.*`, `tenant.settings.*`, `tenant.audit.*`, `tenant.portal.read`).
   - Attached to `Membership.roleId` joining a user to a specific institute.

### 4.2 Permission Resolution Algorithm
In [`src/lib/auth.ts`](file:///D:/IT/Saas/src/lib/auth.ts#L283), effective tenant permissions for a user are computed dynamically:
```typescript
const permissions = new Set(membership.role.permissions.map(p => p.permissionKey));
// Apply individual overrides
for (const extra of membership.extraPermissions) permissions.add(extra);
for (const denied of membership.denyPermissions) permissions.delete(denied);
```

### 4.3 Action-Level Authorization Enforcement
Every server action begins with an explicit authorization check:
```typescript
const auth = await authorizeTenantWrite("tenant.exams.write", "create");
if (!auth.ok) return { error: auth.error };
const ctx = auth.ctx;
```
`authorizeTenantWrite` validates:
1. Session existence and validity.
2. Active user status (`UserStatus === ACTIVE`).
3. Active tenant membership.
4. Possession of the specified permission key.
5. Subscription status (blocks writes if subscription is `PAST_DUE`, `PAUSED`, `EXPIRED`, or `CANCELED`).

---

## 5. Service Layer & Repository Layer Implementation

The application organizes domain business logic into specialized service libraries located in `src/lib/`:

| Service Library | File Path | Core Responsibilities |
| :--- | :--- | :--- |
| **Database Singleton** | [`src/lib/db.ts`](file:///D:/IT/Saas/src/lib/db.ts) | Global `PrismaClient` singleton with development caching to prevent connection exhaustion. |
| **Authentication & Context** | [`src/lib/auth.ts`](file:///D:/IT/Saas/src/lib/auth.ts) | Password hashing, session creation/destruction, `getSession()`, `getTenantContext()`. |
| **RBAC Policy Guard** | [`src/lib/rbac.ts`](file:///D:/IT/Saas/src/lib/rbac.ts) | Page and action permission authorizers (`authorizeTenantWrite`, `requirePlatformPermission`). |
| **Catalog & Registries** | [`src/lib/catalog.ts`](file:///D:/IT/Saas/src/lib/catalog.ts) | Immutable definition of all roles, permissions, SaaS plans, features, and AI modules. |
| **Entitlements & Metering** | [`src/lib/entitlements.ts`](file:///D:/IT/Saas/src/lib/entitlements.ts) | Quota limits checks (`assertStudentCapacity`, `assertStaffCapacity`, `hasFeature`). |
| **Exam State Machine** | [`src/lib/exam-lifecycle.ts`](file:///D:/IT/Saas/src/lib/exam-lifecycle.ts) | Lifecycle state transitions, Cartesian completeness evaluation, pessimistic row locking. |
| **Exam Hashing & Snapshots** | [`src/lib/exam-snapshot.ts`](file:///D:/IT/Saas/src/lib/exam-snapshot.ts) | Deterministic SHA-256 payload canonicalization and checksum verification for published report cards. |
| **Financial Ledger Core** | [`src/lib/payments.ts`](file:///D:/IT/Saas/src/lib/payments.ts) | Core double-entry payment receipts, partial allocations, allocation reversals, and student credit sibling transfers. |
| **AI Studio Engine** | [`src/lib/ai.ts`](file:///D:/IT/Saas/src/lib/ai.ts) | Synchronous AI execution, OpenAI API client, mock generation, optimistic credit reservation and failure refunds. |
| **Audit Dispatcher** | [`src/lib/audit.ts`](file:///D:/IT/Saas/src/lib/audit.ts) | Writes structured, immutable audit log entries to the `AuditLog` table. |
| **Storage Subsystem** | [`src/lib/storage.ts`](file:///D:/IT/Saas/src/lib/storage.ts) | Local filesystem object storage, disk directory creation, streaming file retrieval, mime-type validation. |
| **Notification Dispatcher** | [`src/lib/notifications.ts`](file:///D:/IT/Saas/src/lib/notifications.ts) | Email dispatcher using Nodemailer SMTP with queued fallback logging in `NotificationLog`. |
| **Rate Limiter** | [`src/lib/rate-limit.ts`](file:///D:/IT/Saas/src/lib/rate-limit.ts) | Database-backed fixed-window rate limiter for brute-force mitigation. |
| **CSV Engine** | [`src/lib/csv.ts`](file:///D:/IT/Saas/src/lib/csv.ts) | Streaming CSV encoder with automatic CWE-1236 spreadsheet injection protection. |

---

## 6. Business Logic Deep Dives

### 6.1 Examination Lifecycle & Cryptographic Snapshots
- **Lifecycle Graph:** `DRAFT` ──► `SCHEDULED` ──► `IN_PROGRESS` ──► `COMPLETED` ──► `EVALUATED` ──► `PUBLISHED` (with `ARCHIVED` and `CANCELED` terminals).
- **Cartesian Completeness:** Before moving to `EVALUATED`, the system executes Cartesian verification in [`assertEvaluationCompleteness`](file:///D:/IT/Saas/src/lib/exam-lifecycle.ts#L330):
  $$\text{Required Marks} = |\text{Eligible Candidates}| \times |\text{Configured Subjects}|$$
  If any candidate mark is unrecorded or pending, transition to `EVALUATED` is rejected.
- **Cryptographic Report Cards:** When results are published (`calculateAndPublishResultsAction`), an immutable snapshot is written to `ExamResultSnapshot` containing the student's exact marks, grades, and ranks, accompanied by a canonical SHA-256 checksum. If a published mark is subsequently corrected, an `ExamMarksRevisionEvent` is recorded with mandatory reason and actor metadata.

### 6.2 Core Financial Ledger (Double-Entry & Concurrency)
- **Immutable Receipts:** Payments create an immutable `PaymentReceipt` record representing gross money received.
- **Mutable Projections:** A 1:1 `PaymentReceiptBalance` tracks `allocatedAmount`, `transferredOutAmount`, and `unappliedAmount`.
- **Payment Allocations:** Money is applied to fee invoices through `PaymentAllocation` rows. If a fee is waived or refunded, a `PaymentAllocationReversal` record reverses the allocation without deleting historical records.
- **Student Credit Transfers:** Cross-sibling fee transfers create a balanced `CreditTransferJournal` entry with exactly two `CreditTransferPosting` records (one `DEBIT` and one `CREDIT`).

---

## 7. Existing Integrations & Background Processing

### 7.1 Existing Integrations
1. **OpenAI API:** Synchronous generation via `https://api.openai.com/v1/chat/completions` using model `gpt-4o-mini`.
2. **Nodemailer SMTP:** Configurable SMTP mailer for account invites, password resets, and subscription expiration notices.
3. **Billing Stubs:** Abstract `BillingGateway` configured for `"manual"` provider, with stub fields for Razorpay and Stripe webhooks.
4. **Local VPS Storage:** Files saved locally to `.data/uploads/<tenantId>/<kind>/`.

### 7.2 Background Processing Architecture
- **Current State:** **There is no asynchronous worker queue** (e.g. Redis, Celery, BullMQ, RabbitMQ).
- **Automation Execution:** Subscription renewal checks execute via HTTP Route Handler `POST /api/cron/renewal-check` which is expected to be triggered by an external scheduler (cron job, Cloudflare worker, or cloud cron).
- **Implication for AI Copilot:** Heavy AI workloads, agentic search, and multi-turn conversational processing cannot run synchronously inside server actions without risking browser HTTP gateway timeouts (typically 30–60 seconds). A dedicated asynchronous/streaming architecture is required.

---

## 8. Error Handling & Request/Response Flow

### 8.1 Server Action Error Handling Standard
Server Actions follow a unified error pattern:
```typescript
export type FormState = {
  error?: string;
  success?: string;
  fields?: Record<string, string>;
  issues?: string[];
};
```
1. Input is validated against a Zod schema. If invalid, `fieldErrors(parsed.error)` returns structured error strings keyed by field name.
2. Business rule violations return `{ error: "Descriptive message" }`.
3. Unexpected exceptions are caught, logged to `console.error`, and returned as clean user-facing error messages without exposing SQL error traces or stack traces.
4. Successful operations revalidate cache paths (`revalidatePath(...)`) and return `{ success: "Operation completed successfully." }` or redirect via Next.js `redirect()`.
