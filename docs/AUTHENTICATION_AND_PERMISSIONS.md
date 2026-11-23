# Knowletive SaaS — Authentication & Permissions Audit

**Document Version:** 1.0.0  
**Audit Date:** November 18, 2026  
**Auditor:** Senior SaaS Security Auditor & IAM Architect  
**Repository Working Directory:** `D:\IT\Saas`  

---

## 1. Authentication Architecture

Knowletive enforces a centralized identity model with multi-tenant workspace isolation.

### 1.1 Core Identity (`User`)
- A single `User` record represents a human individual across the entire SaaS platform.
- A user can belong to multiple educational institutes simultaneously (e.g. a teacher who teaches at two coaching centers, or a parent with children in different schools).
- **Credentials:** Passwords hashed with `bcryptjs` using 12 salt rounds.
- **Brute-Force Lockout:** Tracked on `User.failedLoginAttempts`. After 5 consecutive invalid attempts, `User.lockedUntil` locks the account for 15 minutes.
- **Two-Factor Authentication (TOTP):** Verified via RFC 6238 TOTP using base32 secrets and an interim signed JWT handshake cookie (`kl_pending`) signed with `SESSION_SECRET` via `jose`.

### 1.2 Session Resolution Flow
```
Browser Request ──► [kl_session Cookie] ──► SHA-256 Hashing ──► DB Query: "Session"
                                                                     │
  ┌──────────────────────────────────────────────────────────────────┴──────┐
  │ Matches: Session row                                                    │
  │ Checks: revokedAt is null, expiresAt > NOW(), User.status === "ACTIVE"   │
  │ Loads: PlatformRole (with permissions), Memberships (with Role & perms) │
  └──────────────────────────────────┬──────────────────────────────────────┘
                                     │
                                     ▼
                    [getSession() returns AuthUser]
```
The session lookup is memoized using React `cache()`, ensuring that multiple layouts and server components on a single route invoke the database query exactly once.

---

## 2. Granular Role Analysis & Authorization Verification

> [!IMPORTANT]
> Role names alone do **not** govern backend access. All page layouts and server actions check explicit, granular permission keys (`platform.*` or `tenant.*`). A user possesses permissions derived from their assigned `Role`, supplemented by `Membership.extraPermissions` and constrained by `Membership.denyPermissions`.

### 2.1 Role 1: Platform Owner
- **Identification:** `user.isPlatformOwner === true` on the `User` table.
- **Authentication:** Standard credentials + optional 2FA (`kl_session`).
- **Platform Authorization:** Automatically granted **all 14 platform permissions** (`PLATFORM_PERMISSION_KEYS`) via [`src/lib/auth.ts`](file:///D:/IT/Saas/src/lib/auth.ts#L277), bypassing role table lookups.
- **Tenant Authorization (Support Impersonation):** When a Platform Owner visits `/app/*` with `kl_tenant` set to any tenant ID:
  - `getTenantContext()` detects `user.isPlatformOwner === true`.
  - Sets `ctx.isOwnerView = true`.
  - Grants synthetic tenant membership with role `"Platform Owner"` and **all 36 tenant permissions** (`TENANT_PERMISSION_KEYS`).
  - This allows platform owners to troubleshoot and support any active school without requiring an explicit invite.
- **Restrictions:** Cannot mutate a suspended institute workspace unless deliberately activating it.

### 2.2 Role 2: Institute Owner
- **Identification:** `Membership.isOwner === true` or membership with role key `INSTITUTE_ADMIN`.
- **Authentication:** `kl_session` cookie + active institute ID in `kl_tenant` cookie.
- **Tenant Authorization:**
  - Full operational authority across the tenant institute: all 36 `tenant.*` permissions.
  - Can manage SaaS plan changes, subscription billing, payment receipts, institute branding, and custom roles.
- **Restrictions:**
  - Cannot access `/platform/*` governance pages (redirected to `/app`).
  - Cannot access other tenant data (strictly blocked by `tenantId` query filters and advisory locks).
  - Operational write mutations are blocked if the institute subscription enters `PAST_DUE`, `PAUSED`, `EXPIRED`, or `CANCELED`.

### 2.3 Role 3: Institute Admin
- **Identification:** `Membership.role.key === "INSTITUTE_ADMIN"` where `Membership.isOwner === false`.
- **Authentication:** `kl_session` cookie + active institute ID in `kl_tenant` cookie.
- **Tenant Authorization:**
  - Full operational permissions (`TENANT_PERMISSION_KEYS`).
  - Can manage academic years, classes, sections, batches, syllabus tracks, examinations, student admissions, fee collections, staff rosters, and announcements.
- **Restrictions:**
  - Cannot modify platform-level settings or view global SaaS metrics.
  - Subject to subscription write blocking if subscription is delinquent.

### 2.4 Role 4: Teacher
- **Identification:** `Membership.role.key === "TEACHER"`.
- **Authentication:** `kl_session` cookie + `kl_tenant` cookie.
- **Verified Permitted Capabilities:**
  - `tenant.batches.read`: View assigned cohorts and student rosters.
  - `tenant.syllabus.read`, `tenant.syllabus.manage_lessons`, `tenant.syllabus.update_progress`, `tenant.syllabus.view_reports`: Create lesson plans, log completed teaching hours, view curriculum delay analytics.
  - `tenant.exams.read`, `tenant.exams.enter_marks`, `tenant.exams.view_reports`: Enter student marks for assigned subjects, view performance analytics.
  - `tenant.students.read`, `tenant.parents.read`: View student directory and parent contacts.
  - `tenant.attendance.read`, `tenant.attendance.write`: Mark daily attendance registers.
  - `tenant.announcements.read`: View broadcast announcements.
  - `tenant.ai.use`: Access AI Studio modules (Lesson Plan generator, Report Card remarks, Question Paper generator).
  - `tenant.reports.read`: View academic reports.
- **Strictly Prohibited & Blocked Operations:**
  - Cannot create, schedule, or delete examinations (`tenant.exams.write` blocked).
  - Cannot publish official exam report cards (`tenant.exams.publish_results` blocked).
  - Cannot issue fee invoices or record payments (`tenant.fees.write` blocked).
  - Cannot invite or remove staff members (`tenant.staff.write` blocked).
  - Cannot modify SaaS plan, billing, or custom roles (`tenant.billing.*`, `tenant.roles.*` blocked).

### 2.5 Role 5: Student
- **Identification:** `Membership.role.key === "STUDENT"` or `Student.userId === user.id`.
- **Authentication:** `kl_session` cookie + `kl_tenant` cookie.
- **Portal Routing:**
  - Attempting to access staff workspace (`/app/*`) triggers an immediate redirect to `/portal` via [`src/app/(app)/app/layout.tsx`](file:///D:/IT/Saas/src/app/(app)/app/layout.tsx#L50).
- **Verified Permitted Capabilities:**
  - `tenant.portal.read`: Access the unified portal (`/portal`).
  - View personal attendance records, class schedules, enrolled subjects, and fee invoices.
  - View published official report cards with cryptographic integrity verification (`/portal/results/[id]`).
  - `tenant.announcements.read`: Read notices targeted to `ALL` or `STUDENTS`.
- **Data Scoping Guard:** Strictly restricted to records where `Student.userId === ctx.user.id`.

### 2.6 Role 6: Parent / Guardian
- **Identification:** `Membership.role.key === "PARENT"` or `Guardian.userId === user.id`.
- **Authentication:** `kl_session` cookie + `kl_tenant` cookie.
- **Portal Routing:**
  - Attempting to access `/app/*` triggers an immediate redirect to `/portal`.
- **Verified Permitted Capabilities:**
  - `tenant.portal.read`: Access the unified portal (`/portal`).
  - Multi-child switcher: Toggle between linked wards.
  - View children's daily attendance records and absence flags.
  - View pending fee invoices, payment receipts, and one-click UPI checkout links (`/pay/[token]`).
  - View published examination results and academic remarks.
  - `tenant.announcements.read`: Read notices targeted to `ALL` or `PARENTS`.
- **Data Scoping Guard:** Strictly restricted to records where:
  ```typescript
  guardians: { some: { guardian: { userId: ctx.user.id } } }
  ```

---

## 3. Privilege Escalation & Defect Prevention Matrix

| Attack Vector / Scenario | Target Role | Mechanism Enforced | Result | Proof Reference |
| :--- | :--- | :--- | :---: | :--- |
| **Tenant User Platform Escalation** | `INSTITUTE_ADMIN` | `authorizePlatformWrite("platform.institutes.manage")` | **BLOCKED** | Rejection: User lacks `platformPermissions`. |
| **Teacher Exam Publishing Escalation**| `TEACHER` | `authorizeTenantWrite("tenant.exams.publish_results")` | **BLOCKED** | Rejection: Missing permission key. |
| **Teacher Fee Manipulation** | `TEACHER` | `authorizeTenantWrite("tenant.fees.write")` | **BLOCKED** | Rejection: Missing permission key. |
| **Accountant Grade Modification** | `ACCOUNTANT` | `authorizeTenantWrite("tenant.exams.enter_marks")` | **BLOCKED** | Rejection: Missing permission key. |
| **Parent/Student Admin Escalation** | `PARENT` / `STUDENT` | `isStaffMember(ctx)` in `/app/layout.tsx` | **BLOCKED** | Redirects to `/portal`. |
| **Cross-Tenant IDOR Attack** | `INSTITUTE_ADMIN` (Tenant A) | Bounded queries: `where: { id: targetId, tenantId: ctx.tenant.id }` | **BLOCKED** | Zero records returned; yields 404 / error. |
| **Delinquent Subscription Write** | `INSTITUTE_ADMIN` | `authorizeTenantWrite()` checks `ctx.subscriptionBlocked` | **BLOCKED** | Rejection: Subscription writes paused. |

---

## 4. Permission Catalog Inventory

### 4.1 Platform Permissions (14 Keys)
- `platform.overview.read`: View global platform dashboard KPIs.
- `platform.institutes.read`: View tenant institutes directory.
- `platform.institutes.manage`: Provision, suspend, and configure tenant institutes.
- `platform.plans.read`: View SaaS pricing plans.
- `platform.plans.manage`: Create and modify SaaS tiers and limits.
- `platform.subscriptions.read`: View billing subscriptions and invoices.
- `platform.subscriptions.manage`: Extend trials, change plans, mark invoices paid.
- `platform.roles.read`: View platform role templates.
- `platform.roles.manage`: Edit platform role permissions.
- `platform.users.read`: View platform team members.
- `platform.users.manage`: Invite and deactivate platform staff.
- `platform.audit.read`: Inspect global audit logs.
- `platform.ai.read`: Inspect global AI credit telemetry and model usage.
- `platform.settings.manage`: Edit global SaaS settings.

### 4.2 Tenant Operational Permissions (36 Keys)
- **Leads (4):** `leads.read`, `leads.write`, `leads.convert`, `leads.delete`
- **Batches (5):** `batches.read`, `batches.write`, `batches.enroll`, `batches.transfer`, `batches.manage_teachers`
- **Syllabus (6):** `syllabus.read`, `syllabus.write`, `syllabus.manage_structure`, `syllabus.manage_lessons`, `syllabus.update_progress`, `syllabus.view_reports`
- **Exams (9):** `exams.read`, `exams.write`, `exams.manage_grading`, `exams.enroll`, `exams.enter_marks`, `exams.verify_marks`, `exams.publish_results`, `exams.correct_published_marks`, `exams.view_reports`
- **Students & Parents (5):** `students.read`, `students.write`, `students.delete`, `parents.read`, `parents.write`
- **Staff & Academics (4):** `staff.read`, `staff.write`, `academics.read`, `academics.write`
- **Attendance & Fees (4):** `attendance.read`, `attendance.write`, `fees.read`, `fees.write`
- **Communication (4):** `announcements.read`, `announcements.write`, `notifications.read`, `notifications.write`
- **AI Studio (2):** `ai.use`, `ai.read`
- **Billing & Administration (6):** `billing.read`, `billing.manage`, `roles.read`, `roles.manage`, `settings.read`, `settings.manage`, `audit.read`, `reports.read`
- **Portal (1):** `portal.read`
