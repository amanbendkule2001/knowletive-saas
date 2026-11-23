# Knowletive SaaS — Complete QA Module & Role Inventory

**Generated Date:** November 10, 2026  
**Repository:** `D:\IT\Saas`  
**Branch:** `staging/exam-stage-43`  
**Application Version:** `0.1.0` (Next.js 16.4.5, React 19.3.1, Prisma 6.19.3)

---

## 1. Discovered Roles Inventory

From [`src/lib/catalog.ts`](file:///D:/IT/Saas/src/lib/catalog.ts) and Prisma schema (`RoleScope`):

### 1.1 Platform-Level Roles (Global Scope)
1. **`PLATFORM_OWNER` (Platform Owner):**
   - Full global control over all platform institutes, subscription plans, billing, AI credit pools, governance, and system-wide audit trails.
   - Permissions: All `platform.*` permission keys.
2. **`PLATFORM_SUPPORT` (Platform Support):**
   - Read-only operational and troubleshooting access across institutes, plans, subscriptions, platform users, AI telemetry, and audit logs.
   - Permissions: `platform.overview.read`, `platform.institutes.read`, `platform.plans.read`, `platform.subscriptions.read`, `platform.users.read`, `platform.audit.read`, `platform.ai.read`.

### 1.2 Tenant-Level Roles (Institute Scope)
3. **`INSTITUTE_ADMIN` (Institute Admin):**
   - Superuser within the tenant institute. Full control over academic structure, admissions, staff, students, exams, fees, billing, roles, and settings.
   - Permissions: All `tenant.*` permission keys (`TENANT_PERMISSION_KEYS`).
4. **`PRINCIPAL` (Principal):**
   - Academic and operational leadership. Access to leads, batches, syllabus, exams, students, parents, staff, academics, attendance, fees (read-only), announcements, notifications, AI tools, and reports.
5. **`TEACHER` (Teacher):**
   - Classroom teacher. Access to assigned batches, syllabus tracks (lessons, progress updates), exams (marks entry, reports), student directory, parent contacts, attendance recording, announcements, and AI teaching tools.
6. **`ACCOUNTANT` (Accountant):**
   - Bursar and accounts officer. Access to fees (invoices, collections, waivers, receipts, payment links), student billing profiles, financial reports, announcements, notifications, and subscription visibility.
7. **`FRONT_DESK` (Front Desk / Admissions Officer):**
   - Front office and admissions coordinator. Access to leads CRM (capture, qualification, conversion, CSV import/export), batch enrollment, student registration, parent communications, announcements, and basic fee read.
8. **`PARENT` (Parent / Guardian):**
   - Family portal access. Restricted strictly to linked children's attendance, report cards, fee invoices, and institution announcements.
   - Permissions: `tenant.portal.read`, `tenant.announcements.read`.
9. **`STUDENT` (Student Candidate):**
   - Student portal access. Restricted strictly to self attendance, batch schedules, published exam report cards, and announcements.
   - Permissions: `tenant.portal.read`, `tenant.announcements.read`.

---

## 2. Discovered Routes & Module Hierarchy

### 2.1 Public & Authentication Routes
- `/` — Marketing landing page & product showcase
- `/login` — Unified login portal (Credentials & TOTP Two-Factor)
- `/select-institute` — Multi-tenant organization switcher for multi-membership users
- `/pay/[token]` — Public student fee payment & UTR proof submission page
- `/forbidden` — Unauthorized access and RBAC error landing page
- `/_not-found` — 404 handler

### 2.2 Platform Administration (`src/app/(platform)/platform/*`)
- `/platform` — Platform KPI overview (active tenants, MRR, student count, storage metrics)
- `/platform/institutes` — Tenant institutes directory, status filtering (TRIAL, ACTIVE, SUSPENDED)
- `/platform/institutes/new` — Provision new institute workspace
- `/platform/institutes/[id]` — Tenant details, plan management, trial extension, suspension toggle
- `/platform/plans` — SaaS subscription plans and feature toggles
- `/platform/plans/new` — Create SaaS tier
- `/platform/plans/[id]` — Edit tier pricing, AI limits, feature flags
- `/platform/subscriptions` — Subscription billing ledger, payment receipts, manual invoice creation
- `/platform/ai` — Global AI telemetry, model usage, credit consumption
- `/platform/roles` — Platform role templates and permission matrix
- `/platform/team` — Platform operations team, user invites, status toggle
- `/platform/audit` — System-wide immutable audit trail
- `/platform/settings` — Global SaaS platform configuration

### 2.3 Tenant Workspace Modules (`src/app/(app)/app/*`)
- `/app` — Institute Dashboard (KPI cards, attendance graphs, fee collection summaries, recent activity)
- `/app/leads` — Admissions CRM (Kanban/table views, filter by source/status, search)
- `/app/leads/new` — Manual enquiry creation
- `/app/leads/[id]` — Lead detail, conversion to enrolled student, activity audit history
- `/app/students` — Student directory (filter by class, section, status, search)
- `/app/students/new` — Student registration form
- `/app/students/import` — Bulk student CSV import
- `/app/students/[id]` — Student 360 profile (academics, guardians, attendance, fees, files)
- `/app/students/[id]/edit` — Edit student demographics
- `/app/parents` — Guardian directory, linked wards
- `/app/parents/new` — Create guardian record
- `/app/parents/[id]` — Guardian profile & student associations
- `/app/staff` — Faculty & staff roster
- `/app/staff/new` — Invite staff member with tenant role
- `/app/staff/[id]` — Staff member profile and role reassignment
- `/app/academics` — Academic structure (Academic Years, Classes, Sections, Subjects)
- `/app/batches` — Batches & cohorts management (capacity, teacher assignment)
- `/app/batches/new` — Create batch (conventional class or specialized coaching)
- `/app/batches/[id]` — Batch cockpit: enrolled students, assigned faculty, enrollment logs
- `/app/batches/[id]/settings` — Batch configuration, capacity updates, completion
- `/app/syllabus` — SyllabusTrack curriculum progress dashboard
- `/app/syllabus/new` — Create syllabus track (Class or Batch target)
- `/app/syllabus/reports` — Curriculum completion analytics
- `/app/syllabus/[id]` — Hierarchical track cockpit: chapters, topics, lesson plans, progress logging
- `/app/exams` — Exam lifecycle cockpit (DRAFT, SCHEDULED, IN_PROGRESS, EVALUATED, PUBLISHED, ARCHIVED)
- `/app/exams/new` — Create examination (Target: CLASS_SECTION or BATCH)
- `/app/exams/grading` — Grading scales & percentage boundary definitions
- `/app/exams/reports` — Examination performance analytics & rank summaries
- `/app/exams/[id]` — Exam management cockpit: subjects, candidates, marks entry, verification, results publishing
- `/app/attendance` — Daily attendance register (Present, Absent, Late, Excused)
- `/app/fees` — Financial fee ledger (Pending, Partial, Paid, Overdue, Waived)
- `/app/fees/new` — Generate fee invoice
- `/app/fees/[id]` — Invoice cockpit, manual payment recording, receipt print, payment links
- `/app/announcements` — Broadcast noticeboard (Audience: ALL, STAFF, PARENTS, STUDENTS)
- `/app/ai` — AI Studio (generative lesson plans, quiz generator, communication drafting)
- `/app/billing` — Tenant SaaS subscription, quota utilization, feature access
- `/app/roles` — Tenant RBAC roles & custom permission matrix
- `/app/settings` — Institute profile, logo upload, time zone, academic year

### 2.4 Portal Experience (`src/app/(portal)/portal/*`)
- `/portal` — Student & Parent unified portal (attendance rate, fee dues, notices, enrolled subjects)
- `/portal/results/[id]` — Published official student report card with SHA-256 integrity verification

### 2.5 API & Route Handlers
- `GET /app/leads/export` — Streamed CSV export of leads with CWE-1236 neutralization
- `GET /app/students/export` — Streamed CSV export of students with CWE-1236 neutralization
- `GET /api/files/[id]` — Tenant-isolated file download and authorization proxy
- `POST /api/cron/renewal-check` — Automated subscription renewal & trial expiration cron worker

---

## 3. Discovered Database Models & Relationships

All 54 Prisma models discovered from [`prisma/schema.prisma`](file:///D:/IT/Saas/prisma/schema.prisma):

| Model Category | Models |
| :--- | :--- |
| **Identity & Security (8)** | `User`, `Session`, `PasswordResetToken`, `Membership`, `Role`, `Permission`, `RolePermission`, `RateLimitBucket` |
| **Platform & Billing (7)** | `Tenant`, `Plan`, `TenantSubscription`, `Invoice`, `Payment`, `TenantUsage`, `Setting` |
| **System & Auditing (4)** | `FileAsset`, `NotificationLog`, `AuditLog`, `WebhookEvent` |
| **Academic Core (5)** | `AcademicYear`, `ClassLevel`, `Section`, `Subject`, `Attendance` |
| **People & Stakeholders (3)** | `Student`, `Guardian`, `StudentGuardian` |
| **Fees & Revenue (3)** | `FeeInvoice`, `FeePayment`, `FeePaymentLink` |
| **Communications & AI (2)** | `Announcement`, `AiJob` |
| **Admissions CRM (2)** | `Lead`, `LeadActivity` |
| **Batches & Cohorts (4)** | `Batch`, `BatchTeacher`, `BatchStudent`, `BatchEnrollmentEvent` |
| **SyllabusTrack (5)** | `SyllabusTrack`, `SyllabusTeacher`, `SyllabusChapter`, `SyllabusTopic`, `LessonPlan`, `TopicProgress`, `SyllabusProgressEvent` |
| **Examinations & Results (7)** | `GradeScale`, `GradeBand`, `Examination`, `ExamSubject`, `ExamEnrollment`, `ExamMark`, `ExamResult`, `ExamResultSnapshot`, `ExamMarksRevisionEvent` |

---

## 4. Discovered CRUD Operations & Server Actions

| Action File | Exported Server Actions | Core Operations |
| :--- | :--- | :--- |
| [`src/actions/auth.ts`](file:///D:/IT/Saas/src/actions/auth.ts) | `loginAction`, `verifyTwoFactorLoginAction`, `logoutAction`, `switchTenantAction`, `changePasswordAction`, `requestPasswordResetAction`, `resetPasswordAction`, `revokeSessionAction`, `revokeOtherSessionsAction`, `beginTwoFactorAction`, `confirmTwoFactorAction`, `disableTwoFactorAction` | Authentication, 2FA, session revocation |
| [`src/actions/platform.ts`](file:///D:/IT/Saas/src/actions/platform.ts) | `createTenantAction`, `suspendTenantAction`, `activateTenantAction`, `openWorkspaceAction`, `extendTrialAction`, `changeTenantPlanAction`, `markInvoicePaidAction`, `createTenantInvoiceAction`, `createPlanAction`, `savePlanAction`, `savePlatformRoleAction`, `invitePlatformUserAction`, `updatePlatformUserStatusAction`, `savePlatformSettingsAction` | Platform tenant provisioning, plans, billing, team |
| [`src/actions/admin.ts`](file:///D:/IT/Saas/src/actions/admin.ts) | `createTenantRoleAction`, `saveTenantRoleAction`, `deleteTenantRoleAction`, `saveInstitutionSettingsAction`, `updateProfileAction`, `changeTenantPlanAction` | Tenant settings, custom roles, plans |
| [`src/actions/students.ts`](file:///D:/IT/Saas/src/actions/students.ts) | `createStudentAction`, `updateStudentAction`, `setStudentStatusAction`, `importStudentsAction`, `createGuardianAction`, `updateGuardianAction`, `unlinkGuardianAction`, `deleteGuardianAction`, `inviteStaffAction`, `updateStaffAction`, `removeStaffAction`, `createClassAction`, `createSectionAction`, `createSubjectAction`, `deleteSubjectAction` | Students, Guardians, Staff, Academics CRUD |
| [`src/actions/leads.ts`](file:///D:/IT/Saas/src/actions/leads.ts) | `createLeadAction`, `updateLeadAction`, `logLeadActivityAction`, `deleteLeadAction`, `draftLeadReplyAction`, `convertLeadAction`, `exportLeadsCsvAction`, `importLeadsCsvAction` | Admissions CRM, conversion, CSV import/export |
| [`src/actions/batches.ts`](file:///D:/IT/Saas/src/actions/batches.ts) | `createBatchAction`, `updateBatchAction`, `assignTeachersAction`, `enrollStudentsAction`, `dropStudentAction`, `transferStudentAction`, `completeBatchAction` | Cohorts lifecycle, faculty assignment, student transfers |
| [`src/actions/syllabus.ts`](file:///D:/IT/Saas/src/actions/syllabus.ts) | `createSyllabusAction`, `updateSyllabusAction`, `archiveSyllabusAction`, `deleteSyllabusAction`, `createChapterAction`, `updateChapterAction`, `deleteChapterAction`, `reorderChaptersAction`, `createTopicAction`, `updateTopicAction`, `deleteTopicAction`, `reorderTopicsAction`, `createLessonPlanAction`, `updateLessonPlanAction`, `deleteLessonPlanAction`, `updateTopicProgressAction`, `getSyllabusDashboardMetrics` | Curriculum hierarchy, lesson plans, progress tracking |
| [`src/actions/exams.ts`](file:///D:/IT/Saas/src/actions/exams.ts) | `createExaminationAction`, `updateExaminationAction`, `deleteExaminationAction`, `transitionExamStatusAction`, `cancelExaminationAction`, `reopenEvaluatedExamAction`, `archiveExaminationAction`, `saveExamSubjectsAction`, `autoEnrollEligibleStudentsAction`, `enrollStudentsAction`, `updateEnrollmentStatusAction`, `enterMarksBulkAction`, `verifyExamSubjectMarksAction`, `calculateAndPublishResultsAction`, `correctPublishedMarkAction`, `exportExamResultsCsvAction`, `verifyResultSnapshotIntegrityAction`, `createGradeScaleAction`, `deleteGradeScaleAction`, `getExamCompletenessAction` | Exam lifecycle, grading, Cartesian completeness, results, snapshots |
| [`src/actions/operations.ts`](file:///D:/IT/Saas/src/actions/operations.ts) | `markAttendanceAction`, `saveAttendanceRegisterAction`, `createFeeInvoiceAction`, `recordFeePaymentAction`, `waiveFeeInvoiceAction`, `createAnnouncementAction`, `toggleAnnouncementPinAction`, `deleteAnnouncementAction`, `runAiAction`, `deleteAiJobAction`, `submitPaymentProofAction`, `verifyPaymentLinkProofAction`, `rejectPaymentLinkProofAction`, `createFeePaymentLinkAction` | Attendance, Fees, Announcements, AI Studio, Payment links |
| [`src/actions/storage.ts`](file:///D:/IT/Saas/src/actions/storage.ts) | `uploadStudentDocumentAction`, `deleteStudentDocumentAction`, `uploadSchoolLogoAction`, `deleteSchoolLogoAction` | Tenant-isolated file storage |
| [`src/actions/notifications.ts`](file:///D:/IT/Saas/src/actions/notifications.ts) | `markNotificationsReadAction`, `markAllNotificationsReadAction` | In-app notification management |

---

## 5. Security & Isolation Architecture

1. **Authentication:**
   - Multi-membership User records.
   - HTTP-only secure cookie sessions with JWT signature (`SESSION_COOKIE_NAME`).
   - Brute-force account lockouts (`failedAttempts`, `lockedUntil`).
   - TOTP 2FA via authenticator apps (`totpSecret`, `totpEnabled`).
2. **Authorization & RBAC:**
   - Dual-scope permission catalog (`PLATFORM` vs `TENANT`).
   - [`authorizeTenantWrite(permissionKey, action)`](file:///D:/IT/Saas/src/lib/rbac.ts): Validates tenant membership, role permissions, active status, and tenant subscription active state before allowing execution.
   - [`authorizePlatformWrite(permissionKey, action)`](file:///D:/IT/Saas/src/lib/rbac.ts): Validates platform role permissions.
3. **Multi-Tenant Isolation:**
   - Row-level `tenantId` foreign keys enforced across 42 operational database tables.
   - Pessimistic locking queries explicitly incorporate `AND "tenantId" = ${tenantId}`.
   - Sub-aggregate queries explicitly filter by `tenantId: ctx.tenant.id`.
4. **Data Tampering Defense:**
   - PostgreSQL database triggers block `UPDATE`, `DELETE`, and `TRUNCATE` on immutable tables: `ExamResultSnapshot`, `ExamMarksRevisionEvent`, `BatchEnrollmentEvent`, `SyllabusProgressEvent`.
   - PostgreSQL check constraints block invalid XOR state targets: `chk_examination_target_integrity`, `chk_syllabustrack_target_integrity`.
   - CSV exports enforce CWE-1236 spreadsheet injection mitigation (single quote prefix on `=,+,-,@,\t,\r`).
   - Candidate duplicate detection bounded queries serialize with PostgreSQL advisory transaction locks (`pg_advisory_xact_lock`).

