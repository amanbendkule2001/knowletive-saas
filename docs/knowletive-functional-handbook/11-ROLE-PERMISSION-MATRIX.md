# Knowletive SaaS — Complete Role-Permission Matrix

## Document Information
- **Title:** Definitive Role × Module × Permission Matrix
- **Document ID:** DOC-11-ROLE-PERM-MATRIX
- **Target Audience:** Security Architects, Product Managers, Compliance Auditors, Software Engineers
- **Classification:** Security Governance & RBAC Specification
- **Repository Location:** `docs/knowletive-functional-handbook/11-ROLE-PERMISSION-MATRIX.md`

---

## Table of Contents
1. [RBAC Dual-Scope Architecture](#1-rbac-dual-scope-architecture)
2. [Platform Permissions Master Catalog (14 Keys)](#2-platform-permissions-master-catalog-14-keys)
3. [Tenant Permissions Master Catalog (52 Keys)](#3-tenant-permissions-master-catalog-42-keys)
4. [Master Role × Module × Action Matrix](#4-master-role--module--action-matrix)
5. [Enforcement Architecture & Code Guard Locations](#5-enforcement-architecture--code-guard-locations)

---

## 1. RBAC Dual-Scope Architecture

Knowletive enforces permissions at two discrete layers:
- **Platform Scope:** Checked via `isPlatformOwner` flag or platform-level role memberships (`src/lib/auth.ts` -> `requirePlatform()`).
- **Tenant Scope:** Checked via tenant-level `Membership` records and assigned `Role` permissions (`src/lib/auth.ts` -> `requireTenantPermission()`).

---

## 2. Platform Permissions Master Catalog (14 Keys)

| Key | Label | Group | Scope |
|:---|:---|:---|:---|
| `platform.overview.read` | View platform metrics | Overview | PLATFORM |
| `platform.institutes.read` | View institutes directory | Institutes | PLATFORM |
| `platform.institutes.manage` | Create, edit, suspend institutes | Institutes | PLATFORM |
| `platform.plans.read` | View subscription plans | Plans | PLATFORM |
| `platform.plans.manage` | Create & edit pricing plans | Plans | PLATFORM |
| `platform.subscriptions.read` | View active subscriptions | Subscriptions | PLATFORM |
| `platform.subscriptions.manage` | Manage subscriptions & renewals | Subscriptions | PLATFORM |
| `platform.roles.read` | View platform roles | Security | PLATFORM |
| `platform.roles.manage` | Manage platform roles | Security | PLATFORM |
| `platform.users.read` | View platform team | Team | PLATFORM |
| `platform.users.manage` | Invite & manage platform team | Team | PLATFORM |
| `platform.audit.read` | View global audit log | Security | PLATFORM |
| `platform.ai.read` | View AI telemetry & metering | Telemetry | PLATFORM |
| `platform.settings.manage` | Manage system settings | Settings | PLATFORM |

---

## 3. Tenant Permissions Master Catalog (52 Keys)

| Group | Key | Label |
|:---|:---|:---|
| **Leads & Admissions** | `leads.read` | View leads and admissions inquiries |
| | `leads.write` | Create and update leads |
| | `leads.convert` | Convert leads to enrolled students |
| | `leads.delete` | Delete lead records |
| **Students** | `students.read` | View student directory and profiles |
| | `students.write` | Create and edit student records |
| | `students.delete` | Archive or delete student records |
| **Parents** | `parents.read` | View guardian directory |
| | `parents.write` | Create and edit guardian records |
| **Staff & HR** | `staff.read` | View staff directory |
| | `staff.manage` | Invite staff and assign roles |
| **Academic Master** | `academics.read` | View academic structure |
| | `academics.manage` | Manage academic years, classes, subjects |
| **Batches** | `batches.read` | View batches and timetables |
| | `batches.write` | Create and update batches |
| | `batches.enroll` | Enroll and remove students |
| | `batches.transfer` | Transfer students between batches |
| | `batches.manage_teachers` | Allocate faculty to batches |
| **SyllabusTrack** | `syllabus.read` | View syllabus structure |
| | `syllabus.write` | Create chapters and topics |
| | `syllabus.manage_structure` | Reorganize curriculum tree |
| | `syllabus.manage_lessons` | Create and edit lesson plans |
| | `syllabus.update_progress` | Log topic completion & teaching notes |
| | `syllabus.view_reports` | View curriculum analytics & progress |
| **Examinations** | `exams.read` | View examinations and schedules |
| | `exams.write` | Create and schedule examinations |
| | `exams.manage_grading` | Configure grading scales |
| | `exams.enroll` | Enroll candidates in exams |
| | `exams.enter_marks` | Enter subject marks |
| | `exams.verify_marks` | Verify and review submitted marks |
| | `exams.publish_results` | Publish results & generate snapshots |
| | `exams.correct_marks` | Perform post-publication mark corrections |
| **Attendance** | `attendance.read` | View attendance registers |
| | `attendance.mark` | Mark daily batch roll call |
| **Fees & Finance** | `fees.read` | View fee invoices and statements |
| | `fees.manage` | Create invoices, record payments, issue receipts |
| **Communication** | `announcements.read` | View campus announcements |
| | `announcements.write` | Publish campus announcements |
| | `notifications.read` | View notification delivery log |
| | `notifications.write` | Send payment & attendance alerts |
| **AI Studio** | `ai.use` | Use AI generators |
| | `ai.read` | View AI usage history |
| **Billing** | `billing.read` | View institute subscription |
| | `billing.manage` | Upgrade plan & billing settings |
| **Administration** | `roles.read` | View custom roles |
| | `roles.manage` | Create custom roles & edit permissions |
| | `settings.read` | View institute settings |
| | `settings.manage` | Manage institute settings & profile |
| | `audit.read` | View tenant audit log |
| | `reports.read` | View academic & financial reports |
| **Portal** | `portal.read` | Access student/parent portal |

---

## 4. Master Role × Module × Action Matrix

Legend:
- **ALLOWED:** Full operational authority.
- **RESTRICTED:** Allowed with scope or assignment constraints (e.g. assigned batches only).
- **READ ONLY:** Can view data but cannot create, mutate, or delete.
- **DENIED:** Access blocked; route returns 403 or server action throws AuthorizationError.

| Module | Action | Platform Owner | Institute Admin | Principal | Teacher | Accountant | Front Desk | Student | Parent |
|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Platform Console** | Access / Manage | ALLOWED | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED |
| **Admissions (Leads)** | View Leads | DENIED | ALLOWED | ALLOWED | DENIED | DENIED | ALLOWED | DENIED | DENIED |
| | Create / Edit Lead | DENIED | ALLOWED | ALLOWED | DENIED | DENIED | ALLOWED | DENIED | DENIED |
| | Convert to Student | DENIED | ALLOWED | ALLOWED | DENIED | DENIED | ALLOWED | DENIED | DENIED |
| | Import / Export CSV | DENIED | ALLOWED | ALLOWED | DENIED | DENIED | ALLOWED | DENIED | DENIED |
| **Student Directory** | View Directory | DENIED | ALLOWED | ALLOWED | READ ONLY | READ ONLY | ALLOWED | DENIED | DENIED |
| | Create / Edit Student | DENIED | ALLOWED | ALLOWED | DENIED | DENIED | ALLOWED | DENIED | DENIED |
| | Bulk Import CSV | DENIED | ALLOWED | ALLOWED | DENIED | DENIED | ALLOWED | DENIED | DENIED |
| **Batches** | Create / Edit Batch | DENIED | ALLOWED | ALLOWED | DENIED | DENIED | DENIED | DENIED | DENIED |
| | Allocate Faculty | DENIED | ALLOWED | ALLOWED | DENIED | DENIED | DENIED | DENIED | DENIED |
| | Enroll Students | DENIED | ALLOWED | ALLOWED | DENIED | DENIED | DENIED | DENIED | DENIED |
| | View Assigned Batches| DENIED | ALLOWED | ALLOWED | RESTRICTED| DENIED | DENIED | DENIED | DENIED |
| **SyllabusTrack** | Manage Hierarchy | DENIED | ALLOWED | ALLOWED | DENIED | DENIED | DENIED | DENIED | DENIED |
| | Create Lesson Plans | DENIED | ALLOWED | ALLOWED | ALLOWED | DENIED | DENIED | DENIED | DENIED |
| | Log Progress | DENIED | ALLOWED | ALLOWED | ALLOWED | DENIED | DENIED | DENIED | DENIED |
| | View Reports | DENIED | ALLOWED | ALLOWED | READ ONLY | DENIED | DENIED | DENIED | DENIED |
| **Examinations** | Create Exam | DENIED | ALLOWED | ALLOWED | DENIED | DENIED | DENIED | DENIED | DENIED |
| | Enter Marks | DENIED | ALLOWED | ALLOWED | RESTRICTED| DENIED | DENIED | DENIED | DENIED |
| | Verify Marks | DENIED | ALLOWED | ALLOWED | ALLOWED | DENIED | DENIED | DENIED | DENIED |
| | Publish Results | DENIED | ALLOWED | ALLOWED | DENIED | DENIED | DENIED | DENIED | DENIED |
| | Correct Marks | DENIED | ALLOWED | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED |
| **Attendance** | Mark Attendance | DENIED | ALLOWED | ALLOWED | RESTRICTED| DENIED | DENIED | DENIED | DENIED |
| | View Reports | DENIED | ALLOWED | ALLOWED | READ ONLY | DENIED | DENIED | DENIED | DENIED |
| **Fees & Invoicing** | Create Invoice | DENIED | ALLOWED | DENIED | DENIED | ALLOWED | DENIED | DENIED | DENIED |
| | Record Payment | DENIED | ALLOWED | DENIED | DENIED | ALLOWED | DENIED | DENIED | DENIED |
| | Issue Receipts | DENIED | ALLOWED | DENIED | DENIED | ALLOWED | DENIED | DENIED | DENIED |
| **Announcements** | Publish Notice | DENIED | ALLOWED | ALLOWED | RESTRICTED| DENIED | DENIED | DENIED | DENIED |
| | View Notices | DENIED | ALLOWED | ALLOWED | ALLOWED | ALLOWED | ALLOWED | ALLOWED | ALLOWED |
| **AI Studio** | Use Generators | DENIED | ALLOWED | ALLOWED | ALLOWED | DENIED | DENIED | DENIED | DENIED |
| **Settings & Roles** | Manage Roles & RBAC | DENIED | ALLOWED | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED |
| **Portal** | Self-Service Access | DENIED | DENIED | DENIED | DENIED | DENIED | DENIED | ALLOWED | ALLOWED |

---

## 5. Enforcement Architecture & Code Guard Locations

- **Route Guards:** Server components in `src/app/(app)/*` call `await requireTenantPermission(permissionKey)`.
- **Server Action Guards:** In `src/actions/*`, every mutation verifies permissions prior to executing database queries.
- **Client Menu Filtering:** Sidebar components query `hasTenantPermission()` to hide inaccessible menu links.
