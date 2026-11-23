# Knowletive SaaS — Complete Platform Overview

## Document Information
- **Title:** Complete Platform Functional Overview & Architecture
- **Document ID:** DOC-00-PLATFORM-OVERVIEW
- **Target Audience:** System Architects, Product Managers, Institute Executives, Technical Support, Onboarding Specialists
- **Classification:** Functional Architecture Reference
- **Repository Location:** `docs/knowletive-functional-handbook/00-COMPLETE-PLATFORM-OVERVIEW.md`

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Platform Topography & Environments](#2-platform-topography--environments)
3. [The Three Dashboard Environments](#3-the-three-dashboard-environments)
   - [3.1 Platform Administration Console (`/platform`)](#31-platform-administration-console-platform)
   - [3.2 Tenant / Institute Workspace (`/app`)](#32-tenant--institute-workspace-app)
   - [3.3 Unified Student & Parent Portal (`/portal`)](#33-unified-student--parent-portal-portal)
   - [3.4 Public & Authentication Layer (`/`, `/login`)](#34-public--authentication-layer-login)
4. [Role Inventory & Scopes](#4-role-inventory--scopes)
5. [Complete Module & Submodule Map](#5-complete-module--submodule-map)
6. [Multi-Tenancy & Data Isolation Architecture](#6-multi-tenancy--data-isolation-architecture)
7. [Technology Stack & Runtime Infrastructure](#7-technology-stack--runtime-infrastructure)
8. [Core Entity Hierarchy & Conceptual Data Flow](#8-core-entity-hierarchy--conceptual-data-flow)
9. [Cross-Module Functional Connections](#9-cross-module-functional-connections)
10. [Document Map of the Handbook](#10-document-map-of-the-handbook)

---

## 1. Executive Summary

**Knowletive** is a modern, enterprise-grade, multi-tenant Software-as-a-Service (SaaS) Educational Operating System designed to manage the entire lifecycle of educational institutions, coaching institutes, schools, and academic academies.

The platform provides complete digital operations for:
- **Platform Operators (SaaS Vendor):** Multi-tenant provisioning, subscription tiers, plan entitlements, automated renewal enforcement, and platform-wide security audit logging.
- **Institutes (Tenants):** Academic administration, student and staff directories, batch scheduling, admissions CRM, syllabus tracking, examination cycles, fee collection, attendance tracking, announcements, and AI-powered educational tools.
- **End-User Consumers (Students & Parents):** Self-service academic tracking, attendance registers, examination results, report card downloads, and fee dues visibility.

The system is built on a **zero-trust multi-tenant architecture** where every tenant's data is strictly partitioned by a unique database `tenantId`, enforced both in the data access layer via Prisma ORM and the HTTP session layer via secure, signed `httpOnly` cookie tokens.

---

## 2. Platform Topography & Environments

Knowletive structures its application into four clear operational zones:

```
+---------------------------------------------------------------------------------------+
|                                    KNOWLETIVE SaaS                                    |
+---------------------------------------------------------------------------------------+
                                           |
    +-------------------+------------------+-------------------+--------------------+
    |                   |                                      |                    |
+---v-------------+ +---v-------------------------------+ +----v---------------+ +--v---------------+
|  Public & Auth  | | Platform Administration Console   | | Institute Workspace | | Student/Parent    |
|  - Marketing (/) | | Route: /platform                  | | Route: /app         | | Portal (/portal)  |
|  - Login (/login)| | Scope: Platform Owner & Support   | | Scope: Institute    | | Scope: Learners & |
|  - File Delivery| | Tenancy: Cross-tenant management  | | Staff (Admin, Teach,| | Guardians         |
|    (/api/files) | | Billing: Stripe/Razorpay tiers    | | Acc, Front Desk)    | | Read-only portal  |
+-----------------+ +-----------------------------------+ +---------------------+ +-------------------+
```

---

## 3. The Three Dashboard Environments

### 3.1 Platform Administration Console (`/platform`)
- **Base Route:** `/platform`
- **Access Guard:** `requirePlatform()` in `src/lib/auth.ts`. The user must either have `isPlatformOwner: true` or possess platform-scoped role permissions.
- **Audience:** SaaS super-administrators, technical support engineers, customer success staff.
- **Capabilities:**
  - Create and configure client institutes (`/platform/institutes`).
  - Manage subscription plans, pricing tiers, and student capacity limits (`/platform/plans`).
  - Activate, renew, suspend, or cancel tenant subscriptions (`/platform/subscriptions`).
  - Monitor AI token consumption and metering across institutes (`/platform/ai`).
  - Configure platform team access and custom platform roles (`/platform/roles`, `/platform/team`).
  - Inspect global security audit trails (`/platform/audit`).
  - Maintain system-wide feature flags and maintenance modes (`/platform/settings`).

### 3.2 Tenant / Institute Workspace (`/app`)
- **Base Route:** `/app`
- **Access Guard:** `getTenantContext()` and `requireTenantPermission()` in `src/lib/auth.ts`. The user must have an active `Membership` linked to a valid `Tenant`.
- **Audience:** School principals, administrators, teachers, accountants, front-desk admission executives.
- **Capabilities:**
  - **Admissions & CRM (`/app/leads`):** Inbound inquiries, lead scoring, follow-ups, CSV import/export, one-click admission conversion.
  - **Student Directory (`/app/students`):** Master records, guardian relationships, bulk CSV imports, active/inactive lifecycle states.
  - **Guardian Network (`/app/parents`):** Parent directory, emergency contacts, child linkage.
  - **Staff Management (`/app/staff`):** Employee directory, designation, role assignment.
  - **Academic Structure (`/app/academics`):** Academic years, classes, sections, subjects.
  - **Batch Management (`/app/batches`):** Classroom batches, student enrollments, teacher assignments.
  - **SyllabusTrack (`/app/syllabus`):** Curriculum hierarchy (chapters, topics, lesson plans), real-time delivery tracking, AI lesson generation.
  - **Examination Lifecycle (`/app/exams`):** Multi-subject exams, student enrollment, marks entry, verification, publication, and immutable result snapshots.
  - **Daily Attendance (`/app/attendance`):** Date-based student roll calls, absence alerts.
  - **Fee Management (`/app/fees`):** Invoicing, partial payments, receipts, overdue tracking.
  - **Communication (`/app/announcements`):** Campus-wide and batch-specific notices.
  - **AI Studio (`/app/ai`):** AI exam generator, lesson planning, student performance feedback.
  - **Settings & RBAC (`/app/roles`, `/app/settings`):** Custom tenant roles, 52 granular tenant permissions (66 total system permissions), audit log.

### 3.3 Unified Student & Parent Portal (`/portal`)
- **Base Route:** `/portal`
- **Access Guard:** Authenticated session linked to a `Student` or `Guardian` database record. Non-staff members are automatically redirected here upon login.
- **Audience:** Enrolled students and their verified parents/guardians.
- **Capabilities:**
  - **Personal Dashboard:** Greeting, enrolled batch, active academic year, attendance percentage gauge.
  - **Exam Results:** Published report cards, subject breakdowns, marks vs maximums, percentage, grade, and publication dates.
  - **Detailed Result Viewer (`/portal/results/[id]`):** View official frozen snapshot results.
  - **Attendance Register:** Present, absent, late, and excused records.
  - **Fee Overview:** Invoiced amounts, paid receipts, and outstanding dues.
  - **Campus Notices:** Announcements published by teachers or administrators.

### 3.4 Public & Authentication Layer (`/`, `/login`)
- **Marketing Homepage (`/`):** SaaS value proposition, product feature showcase, pricing tiers, and call-to-actions.
- **Unified Login (`/login`):** Single sign-on portal for all 9 roles. Automatically detects account scope (Platform, Tenant Staff, or Portal Consumer) and redirects to the appropriate landing environment. Includes responsive demo credentials switcher for rapid onboarding and functional testing.
- **File Server (`/api/files/[id]`):** Secure asset delivery with tenant permission checks.
- **Background Cron Endpoint (`/api/cron/renewal-check`):** Automated daily verification of tenant subscription expiration and renewal states.
- **Public Fee Payment Portal (`/pay/[token]`):** Public QR-code payment and payment proof submission portal for parents and students.
- **Multi-Tenant Institute Switcher (`/select-institute`):** Seamless tenant switching when a user holds memberships in multiple institutes.
- **Access Denial Handler (`/app/forbidden`):** Dedicated permission failure screen explaining exact missing permission keys.

---

## 4. Role Inventory & Scopes

Knowletive provides 9 first-class operational roles structured across three RBAC scopes:

| Role Name | Internal Code | Scope | Primary Landing | Description |
|:---|:---|:---|:---|:---|
| **Platform Owner** | `PLATFORM_OWNER` | Platform | `/platform` | SaaS superuser. Owns tenant provisioning, subscription billing, and system settings. |
| **Platform Support** | `PLATFORM_SUPPORT` | Platform | `/platform` | Customer support engineer. Assists institutes, monitors telemetry, reads audit logs. |
| **Institute Admin** | `INSTITUTE_ADMIN` | Tenant Staff | `/app` | School manager / administrator. Full operational control over the institute workspace. |
| **Principal** | `PRINCIPAL` | Tenant Staff | `/app` | Academic director. Approves exams, reviews syllabus progress, monitors performance. |
| **Teacher** | `TEACHER` | Tenant Staff | `/app/batches` | Faculty member. Enters marks, records daily attendance, updates syllabus progress. |
| **Accountant** | `ACCOUNTANT` | Tenant Staff | `/app/fees` | Financial officer. Creates fee invoices, records payments, issues receipts. |
| **Front Desk** | `FRONT_DESK` | Tenant Staff | `/app/leads` | Admissions coordinator. Captures leads, logs follow-ups, converts inquiries to students. |
| **Student** | `STUDENT` | Portal Consumer | `/portal` | Enrolled learner. Views personal attendance, exam report cards, and notices. |
| **Parent** | `PARENT` | Portal Consumer | `/portal` | Guardian. Tracks child's academic performance, attendance, and pays pending fees. |

---

## 5. Complete Module & Submodule Map

The platform is partitioned into 16 cohesive operational modules:

```
1. PLATFORM MANAGEMENT (/platform)
   ├── 1.1 Institutes Directory (/platform/institutes)
   ├── 1.2 Subscription Plans (/platform/plans)
   ├── 1.3 Active Subscriptions (/platform/subscriptions)
   ├── 1.4 AI Telemetry & Metering (/platform/ai)
   ├── 1.5 Platform Roles & RBAC (/platform/roles)
   ├── 1.6 Platform Team (/platform/team)
   ├── 1.7 Platform Audit Log (/platform/audit)
   └── 1.8 System Settings (/platform/settings)

2. ADMISSIONS & CRM (/app/leads)
   ├── 2.1 Lead List & Status Filter (/app/leads)
   ├── 2.2 Lead Entry Form (/app/leads/new)
   ├── 2.3 Lead Detail & Timeline (/app/leads/[id])
   ├── 2.4 CSV Bulk Import Modal
   ├── 2.5 CSV Data Export (/app/leads/export)
   └── 2.6 One-Click Student Conversion

3. STUDENT LIFECYCLE (/app/students)
   ├── 3.1 Student Directory (/app/students)
   ├── 3.2 Student Enrollment Form (/app/students/new)
   ├── 3.3 Student 360° Profile (/app/students/[id])
   ├── 3.4 Student Profile Editor (/app/students/[id]/edit)
   ├── 3.5 CSV Bulk Student Import (/app/students/import)
   └── 3.6 CSV Student Export (/app/students/export)

4. GUARDIAN & FAMILY (/app/parents)
   ├── 4.1 Parent Directory (/app/parents)
   ├── 4.2 Guardian Creation Form (/app/parents/new)
   ├── 4.3 Guardian Detail & Linked Wards (/app/parents/[id])
   └── 4.4 Student-Guardian Relationship Mapping

5. STAFF & HUMAN RESOURCES (/app/staff)
   ├── 5.1 Staff Directory (/app/staff)
   ├── 5.2 Staff Invitation Form (/app/staff/new)
   └── 5.3 Staff Profile & Role Assignment (/app/staff/[id])

6. ACADEMIC STRUCTURE (/app/academics)
   ├── 6.1 Academic Years & Active Term Toggle
   ├── 6.2 Classes (Grades) Management
   ├── 6.3 Sections Management
   └── 6.4 Subject Master Catalog

7. BATCH & CLASSROOM MANAGEMENT (/app/batches)
   ├── 7.1 Batch Directory (/app/batches)
   ├── 7.2 Batch Creation (/app/batches/new)
   ├── 7.3 Batch Classroom Console (/app/batches/[id])
   ├── 7.4 Student Enrollment & Removal
   ├── 7.5 Inter-Batch Student Transfer
   └── 7.6 Teacher Allocation & Settings (/app/batches/[id]/settings)

8. SYLLABUSTRACK CURRICULUM (/app/syllabus)
   ├── 8.1 Curriculum Overview (/app/syllabus)
   ├── 8.2 Chapter & Topic Hierarchy Builder (/app/syllabus/new, /app/syllabus/[id])
   ├── 8.3 Lesson Planning & Resource Attachment
   ├── 8.4 Teacher Daily Topic Completion Logging
   └── 8.5 Curriculum Progress Analytics (/app/syllabus/reports)

9. EXAMINATION & GRADING LIFECYCLE (/app/exams)
   ├── 9.1 Exam Schedule & Catalog (/app/exams)
   ├── 9.2 Exam Creator (/app/exams/new)
   ├── 9.3 Grading Scale Matrix Builder (/app/exams/grading)
   ├── 9.4 Candidate Enrollment Console
   ├── 9.5 Teacher Mark Entry Sheet (/app/exams/[id])
   ├── 9.6 Mark Verification & Review
   ├── 9.7 Result Calculation & Snapshot Publication
   ├── 9.8 Post-Publication Mark Correction Audit Workflow
   └── 9.9 Academic Result Reports (/app/exams/reports)

10. ATTENDANCE OPERATIONS (/app/attendance)
    ├── 10.1 Date-Based Roll Call Register (/app/attendance)
    ├── 10.2 Batch Attendance Marking
    ├── 10.3 Absence Alert Generation
    └── 10.4 Student Attendance History

11. FEES & FINANCIAL OPERATIONS (/app/fees)
    ├── 11.1 Fee Invoices Directory (/app/fees)
    ├── 11.2 Invoicing Wizard (/app/fees/new)
    ├── 11.3 Invoice Detail & Statement (/app/fees/[id])
    ├── 11.4 Payment Collection Modal (Cash, Card, Bank, Online)
    └── 11.5 Official Receipt Generation

12. CAMPUS COMMUNICATION (/app/announcements)
    ├── 12.1 Notice Board (/app/announcements)
    ├── 12.2 Notice Composer (Target Audience: Staff, Students, Parents)
    └── 12.3 Notification Delivery Audit

13. AI STUDIO (/app/ai)
    ├── 13.1 AI Curriculum & Lesson Plan Generator
    ├── 13.2 AI Exam Question Paper Formatter
    ├── 13.3 AI Student Performance Feedback Assistant
    └── 13.4 Institute AI Token Consumption Meter

14. SUBSCRIPTION & BILLING (/app/billing)
    ├── 14.1 Current Plan Status & Entitlements
    ├── 14.2 Plan Upgrade & Tier Comparison
    └── 14.3 Platform Invoice History

15. ADMINISTRATION & SECURITY (/app/roles, /app/settings)
    ├── 15.1 Custom Role Creator (/app/roles)
    ├── 15.2 52-Permission RBAC Matrix Toggle
    ├── 15.3 Institute Profile & Brand Settings (/app/settings)
    └── 15.4 Tenant Audit Trail

16. CONSUMER SELF-SERVICE PORTAL (/portal)
    ├── 16.1 Learner Academic Dashboard (/portal)
    ├── 16.2 Official Exam Snapshot Viewer (/portal/results/[id])
    ├── 16.3 Personal Attendance Register
    └── 16.4 Family Fee Statement
```

---

## 6. Multi-Tenancy & Data Isolation Architecture

Knowletive guarantees absolute multi-tenant security through three defensive rings:

1. **Foreign Key Tenancy Partitioning:** Every tenant-bound database table includes a mandatory, indexed `tenantId` column foreign-keyed to `Tenant.id`.
2. **Context-Aware Request Guard:** In `src/lib/auth.ts`, `getTenantContext()` verifies that the caller's session token belongs to an active `Membership` associated with the current institute.
3. **Database Query Isolation:** Every Prisma query executed across server actions and route handlers binds `where: { tenantId }`. No tenant can query or mutate records belonging to another institute.
4. **Advisory Lock Concurrency:** High-concurrency operations (such as Leads CSV imports and Exam Mark recording) use PostgreSQL session-level advisory locks (`pg_advisory_xact_lock`) keyed by `tenantId` hash to prevent race conditions during bulk operations.

---

## 7. Technology Stack & Runtime Infrastructure

- **Framework:** Next.js 15 (App Router, React Server Components, Server Actions)
- **Programming Language:** TypeScript 5.x (Strict Type Checking, 0 errors)
- **Database & ORM:** PostgreSQL 16 + Prisma ORM 6.4 (54 schema models, full referential integrity)
- **Styling & UI:** Tailwind CSS, Lucide React Iconography, Radix UI primitives
- **Testing Suites:** Vitest (286 automated tests), Playwright (Complete browser automation across all 9 roles and viewports)
- **Security:** `httpOnly`, `SameSite=Lax` signed session cookies, PBKDF2 / bcrypt-derived cryptographic password hashing, sliding rate-limit buckets (`RateLimitBucket` model).

---

## 8. Core Entity Hierarchy & Conceptual Data Flow

The educational structure follows an intuitive, hierarchical model:

```
TENANT (Institute)
  │
  ├── AcademicYear (e.g., "2026-2027" - Active Flag)
  │     │
  │     ├── Class (Grade level, e.g., "Grade 10")
  │     │     │
  │     │     ├── Section (e.g., "Section A")
  │     │     │     │
  │     │     │     └── Batch (Classroom Unit, e.g., "Grade 10 - A - Morning")
  │     │     │           ├── Enrolled Students (BatchEnrollment)
  │     │     │           ├── Assigned Teachers (BatchTeacher)
  │     │     │           ├── Daily Attendance Records (AttendanceRecord)
  │     │     │           └── Syllabus Delivery Track (SyllabusProgress)
  │     │     │
  │     │     └── Subject (e.g., "Mathematics", "Physics")
  │     │           │
  │     │           ├── Syllabus (Chapters -> Topics -> LessonPlans)
  │     │           └── Examination Subject (ExamSubject -> ExamMark)
  │     │
  │     └── Examination (Term Exam, e.g., "Mid-Term Examination 2026")
  │           ├── ExamEnrollment (Eligible candidates)
  │           ├── ExamSubject (Max marks, Passing marks)
  │           ├── ExamMark (Raw scores, entered & verified)
  │           └── ExamResultSnapshot (Immutable final published result)
  │
  ├── Student (Personal profile, admission number, roll number)
  │     ├── GuardianLink (Relationship: Father, Mother, Guardian)
  │     ├── FeeInvoice (Billed fees, line items, status: PENDING / PARTIAL / PAID)
  │     └── FeePayment (Payment transactions, receipts)
  │
  └── Lead (Admissions CRM)
        └── Converted to Student (One-click atomic transition)
```

---

## 9. Cross-Module Functional Connections

Knowletive does not operate as disconnected silos; data flows seamlessly between modules:

1. **Lead to Student Conversion:** Inbound leads in `/app/leads` are converted to permanent `Student` and `Guardian` profiles in a single atomic transaction, auto-linking the guardian.
2. **Academic Structure to Batch Assembly:** `Class` and `Section` form the blueprint for `Batch` entities, which connect `Students` and `Teachers`.
3. **Batch to Attendance & Syllabus:** Marking attendance requires an active `Batch`. Tracking syllabus progress logs lessons against specific batches.
4. **Batches to Examinations:** Candidates are enrolled into `Examination` records directly from active batches.
5. **Mark Entry to Snapshot Publication:** Marks entered by teachers undergo verification before the administrator triggers the creation of immutable `ExamResultSnapshot` records visible in `/portal`.
6. **Student to Fee Billing:** Creating a `FeeInvoice` pulls student enrollment data. Recording payments generates receipts and updates student ledger balances instantly.

---

## 10. Document Map of the Handbook

This functional handbook consists of 20 exhaustive, cross-referenced documents:

- `00-COMPLETE-PLATFORM-OVERVIEW.md`: High-level architecture, environments, and data flow.
- `01-ROLE-WISE-USER-MANUAL.md`: Role-by-role operational guide for all 9 roles.
- `02-PLATFORM-ADMINISTRATION-GUIDE.md`: Platform Owner and Support procedures.
- `03-INSTITUTE-ADMINISTRATION-GUIDE.md`: Institute Admin and Principal workspace operations.
- `04-TEACHER-GUIDE.md`: Classroom management, attendance, syllabus, and exams.
- `05-ACCOUNTANT-GUIDE.md`: Invoicing, payments, dues recovery, and receipts.
- `06-FRONT-DESK-AND-ADMISSIONS-GUIDE.md`: CRM inquiries, lead qualification, and admissions.
- `07-STUDENT-PORTAL-GUIDE.md`: Learner self-service navigation and result verification.
- `08-PARENT-PORTAL-GUIDE.md`: Guardian oversight, academic tracking, and payments.
- `09-MODULE-WISE-FUNCTIONAL-GUIDE.md`: Deep screen-by-screen breakdown of all 16 modules.
- `10-END-TO-END-BUSINESS-WORKFLOWS.md`: 15 complete business lifecycles mapped end-to-end.
- `11-ROLE-PERMISSION-MATRIX.md`: 9 roles × 16 modules × 52 tenant permissions (66 total platform & tenant permissions) mapping.
- `12-COMPLETE-USE-CASE-CATALOGUE.md`: Catalog of standard, alternate, and exception use cases.
- `13-DATABASE-AND-DATA-LIFECYCLE.md`: 54 Prisma models, state transitions, and concurrency locks.
- `14-SECURITY-AND-ACCESS-EXPLANATION.md`: RBAC mechanics, tenant isolation, and session audits.
- `15-DASHBOARD-NAVIGATION-REFERENCE.md`: Complete route dictionary and UI button directory.
- `16-GLOSSARY-AND-FAQ.md`: Domain terminology and frequently asked operational questions.
- `17-FEATURE-COVERAGE-AND-GAPS.md`: Implemented capabilities vs roadmap gaps.
- `18-MASTER-USER-JOURNEY-CHECKLIST.md`: Step-by-step verification and QA audit checklist.
- `19-SYSTEM-FLOW-DIAGRAMS.md`: Mermaid sequence and flow diagrams covering all major operations.
