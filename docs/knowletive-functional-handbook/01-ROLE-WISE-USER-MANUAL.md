# Knowletive SaaS — Complete Role-Wise User Manual

## Document Information
- **Title:** Comprehensive User Manual for All Application Roles
- **Document ID:** DOC-01-ROLE-MANUAL
- **Target Audience:** School Administrators, Faculty, Financial Staff, Admissions Teams, Learners, Parents, System Administrators
- **Classification:** Standard Operating Procedure (SOP) & Functional Manual
- **Repository Location:** `docs/knowletive-functional-handbook/01-ROLE-WISE-USER-MANUAL.md`

---

## Table of Contents
1. [Introduction to Knowletive Roles & Access Architecture](#1-introduction-to-knowletive-roles--access-architecture)
2. [Role 1: Platform Owner (`PLATFORM_OWNER`)](#2-role-1-platform-owner-platform_owner)
3. [Role 2: Platform Support (`PLATFORM_SUPPORT`)](#3-role-2-platform-support-platform_support)
4. [Role 3: Institute Admin (`INSTITUTE_ADMIN`)](#4-role-3-institute-admin-institute_admin)
5. [Role 4: Principal / Academic Director (`PRINCIPAL`)](#5-role-4-principal--academic-director-principal)
6. [Role 5: Teacher / Faculty Member (`TEACHER`)](#6-role-5-teacher--faculty-member-teacher)
7. [Role 6: Accountant / Bursar (`ACCOUNTANT`)](#7-role-6-accountant--bursar-accountant)
8. [Role 7: Front Desk & Admissions Officer (`FRONT_DESK`)](#8-role-7-front-desk--admissions-officer-front_desk)
9. [Role 8: Student (`STUDENT`)](#9-role-8-student-student)
10. [Role 9: Parent / Guardian (`PARENT`)](#10-role-9-parent--guardian-parent)
11. [Cross-Role Collaboration Matrix](#11-cross-role-collaboration-matrix)
12. [Session Management, Inactivity & Security Rules](#12-session-management-inactivity--security-rules)

---

## 1. Introduction to Knowletive Roles & Access Architecture

Knowletive SaaS employs a strict **Dual-Scope Role-Based Access Control (RBAC)** architecture:
- **Platform Scope:** Super-administrative users managing the SaaS infrastructure across multiple institutes.
- **Tenant Scope:** Staff members managing educational operations within a specific school or institute.
- **Portal Scope:** End-user consumers (students and guardians) accessing self-service educational records.

Every role is governed by database memberships, cryptographic session tokens, and route middleware guards.

---

## 2. Role 1: Platform Owner (`PLATFORM_OWNER`)

### 2.1 Real-World Identity & Purpose
The **Platform Owner** represents the SaaS executive or system administrator operating the entire Knowletive commercial platform. This role exists to provision new client institutes, define subscription pricing models, oversee recurring billing, monitor AI resource allocation, and enforce global security compliance.

### 2.2 Login & Authentication
- **Login URL:** `/login`
- **Demo Credential:** `owner@knowletive.com` / `Admin@123`
- **Authentication Mechanism:** Password verified against salted PBKDF2/bcrypt hash. Session cookie issued with `isPlatformOwner: true`.
- **Primary Landing Route:** `/platform`

### 2.3 Post-Login Landing & Dashboard
Upon signing in, the Platform Owner lands at `/platform`, which presents a global overview of the SaaS ecosystem:
- **Total Registered Institutes:** Total tenant count, active vs suspended.
- **Active Subscriptions:** Count of institutes on paid plans.
- **Global MRR/ARR:** Revenue metrics derived from plan prices.
- **AI Token Utilization:** Aggregate token usage across all institutes.
- **Recent Platform Audit Events:** High-priority system actions.

### 2.4 Available Navigation & Modules
- `/platform` (Overview & Key Metrics)
- `/platform/institutes` (Institute Provisioning & Directory)
- `/platform/plans` (SaaS Tier & Pricing Management)
- `/platform/subscriptions` (Subscription Lifecycle & Renewal Controls)
- `/platform/ai` (AI Consumption Telemetry)
- `/platform/roles` (Platform-Level Roles)
- `/platform/team` (Internal Platform Personnel)
- `/platform/audit` (Global Security & Access Log)
- `/platform/settings` (Platform Maintenance & Configuration)

### 2.5 Permitted Operations
- Provision new educational institutes (`createInstituteAction`).
- Update tenant details, slug, custom domain, and status (`updateInstituteAction`, `toggleInstituteStatusAction`).
- Create and modify SaaS subscription plans (`createPlanAction`, `updatePlanAction`).
- Assign plans, extend subscriptions, or manually cancel tenant plans (`createSubscriptionAction`, `cancelSubscriptionAction`).
- Invite platform engineers and assign platform permissions.
- View and export immutable audit trails across all platform operations.

### 2.6 Prohibited / Restricted Operations
- The Platform Owner is intentionally segregated from day-to-day school data (e.g., student grades, medical records, teacher personal notes) unless explicitly entering an institute context via authorized administrative proxy.
- Cannot mutate marks or alter classroom attendance directly from the `/platform` console.

### 2.7 Daily, Weekly & Monthly Cadence
- **Daily:** Review new institute registrations, check subscription renewal cron status (`/api/cron/renewal-check`), and monitor error logs.
- **Weekly:** Review AI token consumption and institute support escalations.
- **Monthly:** Generate SaaS revenue reports, reconcile subscription billing, and audit platform security logs.

---

## 3. Role 2: Platform Support (`PLATFORM_SUPPORT`)

### 3.1 Real-World Identity & Purpose
The **Platform Support** role represents technical customer support engineers and client onboarding specialists employed by the SaaS vendor. This role exists to assist school administrators, diagnose configuration issues, and monitor operational telemetry without having financial or subscription-destructive authority.

### 3.2 Login & Authentication
- **Login URL:** `/login`
- **Demo Credential:** `support@knowletive.com` / `Admin@123`
- **Primary Landing Route:** `/platform`

### 3.3 Dashboard & Navigation
- Has read-only access to `/platform/institutes`, `/platform/plans`, `/platform/subscriptions`, `/platform/ai`, and `/platform/audit`.
- Navigation displays support metrics: open tenant inquiries, failed sync alerts, and audit streams.

### 3.4 Permitted Operations
- Inspect institute configuration (e.g. checking if an institute has hit its student capacity or AI quota).
- View audit records to help an institute administrator trace who performed an action.
- Verify subscription validity and entitlements.

### 3.5 Restricted Operations
- **DENIED:** Creating or modifying pricing plans (`platform.plans.manage`).
- **DENIED:** Cancelling subscriptions or modifying billing details (`platform.subscriptions.manage`).
- **DENIED:** Inviting new platform administrators or modifying platform roles (`platform.roles.manage`, `platform.users.manage`).

---

## 4. Role 3: Institute Admin (`INSTITUTE_ADMIN`)

### 4.1 Real-World Identity & Purpose
The **Institute Admin** represents the School Director, General Manager, or Chief Operations Officer of a subscriber institution. This user possesses complete managerial authority over the school's operational workspace (`/app`), configuring academic years, managing human resources, assigning roles, and overseeing all academic and financial workflows.

### 4.2 Login & Authentication
- **Login URL:** `/login`
- **Demo Credential:** `admin@sunrise.test` / `Admin@123`
- **Primary Landing Route:** `/app`

### 4.3 Dashboard Overview (`/app`)
- **Key Metric Tiles:** Total Enrolled Students, Total Staff, Daily Attendance Percentage, Monthly Fee Collection, Active Batches.
- **Quick Action Bar:** New Admission, New Batch, Record Fee, Publish Announcement.
- **Recent Activity Feed:** Latest admissions, mark submissions, and fee payments.

### 4.4 Navigation & Module Access
The Institute Admin has access to all 16 tenant modules:
- `/app/leads` (Admissions CRM)
- `/app/students` (Student Directory)
- `/app/parents` (Parent / Guardian Directory)
- `/app/staff` (Staff Management)
- `/app/academics` (Academic Years, Classes, Sections, Subjects)
- `/app/batches` (Batch Scheduling & Allocations)
- `/app/syllabus` (Curriculum & Lesson Planning)
- `/app/exams` (Exams, Grading Scales & Results)
- `/app/attendance` (Campus Attendance)
- `/app/fees` (Fee Invoices & Receipts)
- `/app/announcements` (Campus Notices)
- `/app/ai` (AI Studio)
- `/app/billing` (Institute Subscription & Quotas)
- `/app/roles` (Custom Roles & Permission Matrix)
- `/app/settings` (Institute Profile & Audit Log)

### 4.5 Permitted Operations (Full Superuser in Tenant Scope)
Holds all 52 tenant permissions:
- Setup and activate academic years (`createAcademicYearAction`, `setActiveAcademicYearAction`).
- Create and assign staff members to roles (`staff.manage`).
- Configure custom roles and toggle any of the 52 tenant permissions (`roles.manage`).
- Enroll students, transfer students between batches, and manage teacher allocations.
- Publish exam results, creating immutable `ExamResultSnapshot` records.
- Authorize post-publication exam mark corrections with mandatory audit reasons.
- Generate fee structures, invoice batches, and record payments.

### 4.6 Restrictions
- Cannot access or modify other tenant institutes (strictly blocked by `tenantId` isolation).
- Cannot modify SaaS plan pricing, platform subscriptions, or platform settings.

---

## 5. Role 4: Principal / Academic Director (`PRINCIPAL`)

### 5.1 Real-World Identity & Purpose
The **Principal** represents the head of academics, curriculum director, or vice-principal. This role focuses on educational quality, faculty oversight, examination schedules, curriculum progress, and student conduct, without handling technical billing or database settings.

### 5.2 Login & Authentication
- **Login URL:** `/login`
- **Demo Credential:** `principal@sunrise.test` / `Admin@123`
- **Primary Landing Route:** `/app`

### 5.3 Daily & Monthly Academic Workflows
- **Daily:** Review daily student attendance summary across all classes. Inspect `/app/syllabus/reports` to ensure teachers are adhering to the curriculum timeline.
- **Weekly:** Review upcoming exam timetables and lesson plans created by faculty.
- **Monthly:** Approve verified exam mark sheets prior to final publication. Review academic performance trends.

### 5.4 Key Permissions
- **ALLOWED:** `academics.read`, `academics.manage`, `syllabus.read`, `syllabus.view_reports`, `exams.read`, `exams.verify_marks`, `exams.publish_results`, `attendance.read`, `announcements.write`.
- **RESTRICTED / DENIED:** `billing.manage` (cannot alter SaaS subscriptions), `roles.manage` (cannot alter system security permissions).

---

## 6. Role 5: Teacher / Faculty Member (`TEACHER`)

### 6.1 Real-World Identity & Purpose
The **Teacher** represents subject teachers, class tutors, and lecturers. The primary responsibility of this role is direct educational delivery: recording daily batch attendance, updating syllabus progress, drafting lesson plans, and entering student examination marks.

### 6.2 Login & Authentication
- **Login URL:** `/login`
- **Demo Credential:** `teacher@sunrise.test` / `Admin@123`
- **Primary Landing Route:** `/app/batches` (Direct landing into assigned classroom batches)

### 6.3 Dashboard & Navigation
- Streamlined navigation containing:
  - **My Batches:** `/app/batches`
  - **Syllabus & Lesson Plans:** `/app/syllabus`
  - **Daily Attendance:** `/app/attendance`
  - **Exams & Marks Entry:** `/app/exams`
  - **Notices:** `/app/announcements`
  - **AI Studio:** `/app/ai` (Generates lesson plans and quiz questions)

### 6.4 Permitted Operations
- **Attendance:** Take roll call for assigned batches (`attendance.mark`).
- **Syllabus:** Log completed topics and chapters, record completion dates (`syllabus.update_progress`).
- **Exams:** Enter raw marks for enrolled candidates in assigned subjects (`exams.enter_marks`).
- **AI Studio:** Generate classroom lesson plans and quiz questions tailored to curriculum topics.

### 6.5 Strictly Prohibited Operations
- **DENIED:** Creating or deleting examinations (`exams.manage`).
- **DENIED:** Publishing final exam results (`exams.publish_results`).
- **DENIED:** Post-publication mark corrections (`exams.correct_marks`).
- **DENIED:** Accessing fee invoices, student fee balances, or collection reports (`fees.read`, `fees.manage`).
- **DENIED:** Accessing staff salary data, role configurations, or institute billing.

---

## 7. Role 6: Accountant / Bursar (`ACCOUNTANT`)

### 7.1 Real-World Identity & Purpose
The **Accountant** represents the school bursar, finance officer, or cashier. This role handles all institutional monetary flows: generating fee structures, dispatching fee invoices, collecting payments (cash, card, bank transfer), printing official receipts, and monitoring overdue fee balances.

### 7.2 Login & Authentication
- **Login URL:** `/login`
- **Demo Credential:** `accountant@sunrise.test` / `Admin@123`
- **Primary Landing Route:** `/app/fees`

### 7.3 Dashboard Overview (`/app/fees`)
- **Financial Metrics:** Total Invoiced This Term, Collected Fees, Total Outstanding Dues, Overdue Accounts.
- **Recent Receipts Table:** Chronological log of recent fee transactions.
- **Invoices Table:** Searchable list of invoices with filters for `PAID`, `PARTIAL`, and `PENDING`.

### 7.4 Permitted Operations
- Generate student fee invoices with line items (Tuition, Laboratory, Library, Transport) (`createFeeInvoiceAction`).
- Record fee payments against open invoices (`recordFeePaymentAction`).
- Print and issue official fee receipts with unique voucher numbers.
- Send fee payment reminder notifications to parents (`sendFeeReminderNotificationAction`).

### 7.5 Strictly Prohibited Operations
- **DENIED:** Entering or editing examination marks (`exams.enter_marks`).
- **DENIED:** Altering academic curriculums or syllabus lesson plans.
- **DENIED:** Altering staff roles, permissions, or system security settings.

---

## 8. Role 7: Front Desk & Admissions Officer (`FRONT_DESK`)

### 8.1 Real-World Identity & Purpose
The **Front Desk Officer** represents admissions counselors, receptionists, and public relations executives. This role manages top-of-funnel student intake: capturing walk-in and web inquiries, logging follow-up phone calls, scheduling campus tours, and converting qualified leads into enrolled students.

### 8.2 Login & Authentication
- **Login URL:** `/login`
- **Demo Credential:** `frontdesk@sunrise.test` / `Admin@123`
- **Primary Landing Route:** `/app/leads`

### 8.3 Admissions CRM Workspace (`/app/leads`)
- **Lead Pipeline:** Search and filter inquiries by status (`NEW`, `CONTACTED`, `QUALIFIED`, `CONVERTED`, `LOST`).
- **Lead Intake Form (`/app/leads/new`):** Capture student name, guardian name, email, phone, grade applied for, and notes.
- **Bulk Import:** CSV Lead upload modal supporting duplicate lead detection.
- **Lead Export (`/app/leads/export`):** Export filtered lead lists to CSV.
- **One-Click Admission Conversion:** Converts a `Lead` directly into a permanent `Student` and `Guardian` record in a single atomic transaction.

### 8.4 Permitted Operations
- Create, update, and categorize leads (`leads.write`).
- Execute one-click conversion to student (`leads.convert`).
- Register student basic details and link parent contacts.
- Issue campus visitor announcements.

### 8.5 Strictly Prohibited Operations
- **DENIED:** Publishing or altering exam results.
- **DENIED:** Modifying institute financial settings or discounting fees without administrative approval.
- **DENIED:** Accessing staff performance ratings or system audit logs.

---

## 9. Role 8: Student (`STUDENT`)

### 9.1 Real-World Identity & Purpose
The **Student** represents the enrolled learner. This role is provided with a secure, clean, distraction-free self-service portal to track personal educational progress, inspect daily attendance records, view published examination report cards, and read school announcements.

### 9.2 Login & Authentication
- **Login URL:** `/login`
- **Demo Credential:** `student@sunrise.test` / `Admin@123`
- **Authentication Guard:** Non-staff session automatically detects `Student` linkage via `Student.userId` and redirects to `/portal`.
- **Primary Landing Route:** `/portal`

### 9.3 Student Portal Interface
- **Academic Header:** Displays student name, roll number, admission number, and assigned batch.
- **Attendance Gauge:** Real-time personal attendance percentage with breakdown of Present, Absent, and Late days.
- **Exam Results Gallery:** Published examination report cards. Clicking any card opens the detailed result viewer (`/portal/results/[id]`).
- **Official Result Viewer (`/portal/results/[id]`):** Displays the immutable frozen snapshot showing subject marks, total score, percentage, letter grade, and institute seal.
- **Notice Board:** Campus announcements directed to students.

### 9.4 Access Restrictions
- **READ ONLY:** The student portal is strictly read-only. Students cannot enter marks, alter attendance, or modify records.
- **Isolation:** Students cannot view other students' grades, attendance records, or parent details.

---

## 10. Role 9: Parent / Guardian (`PARENT`)

### 10.1 Real-World Identity & Purpose
The **Parent** represents the mother, father, or legal guardian of one or more enrolled students. This role exists to foster family engagement, allowing parents to monitor their child's academic trajectory, verify daily attendance, review fee dues, and receive urgent school notices.

### 10.2 Login & Authentication
- **Login URL:** `/login`
- **Demo Credential:** `parent@sunrise.test` / `Admin@123`
- **Primary Landing Route:** `/portal`

### 10.3 Guardian Portal Experience
- **Multi-Ward Switcher:** If a parent has multiple children enrolled in the same institute, the portal displays a ward selector to seamlessly switch between children.
- **Child's Academic Report Card:** Direct access to published term exam results and subject score breakdowns.
- **Child's Attendance Record:** Full calendar of attendance history, highlighting unexcused absences.
- **Fee Statement & Invoices:** Complete billing transparency showing invoiced amounts, payment receipts, and outstanding dues.
- **Direct School Notices:** Urgent administrative alerts, holiday schedules, and event invitations.

### 10.4 Access Restrictions
- Strictly restricted to viewing records of children explicitly linked via `GuardianLink` in the database.
- Read-only access to academic and attendance data.

---

## 11. Cross-Role Collaboration Matrix

The following table summarizes how roles collaborate on key institutional workflows:

| Workflow | Initiator | Reviewer / Processor | Approver / Publisher | Consumers |
|:---|:---|:---|:---|:---|
| **Student Admission** | Front Desk (Lead) | Front Desk (Convert) | Institute Admin | Student & Parent |
| **Batch Assignment** | Institute Admin | Admin / Principal | Institute Admin | Teacher & Student |
| **Syllabus Delivery** | Teacher (Lesson Plan) | Teacher (Log Progress) | Principal (Review) | Students |
| **Term Examination** | Principal (Schedule) | Teacher (Enter Marks) | Admin (Publish Snapshot)| Student & Parent |
| **Mark Correction** | Teacher (Request) | Principal (Verify) | Admin (Audit Logged) | Student & Parent |
| **Fee Collection** | Accountant (Invoice) | Parent / Student (Pay)| Accountant (Receipt) | Admin & Parent |
| **Campus Notice** | Teacher / Admin | Admin | Admin (Publish) | Staff, Students, Parents |

---

## 12. Session Management, Inactivity & Security Rules

1. **HttpOnly Cookie Tokens:** Sessions are maintained via encrypted `httpOnly` cookies, immune to client-side XSS extraction.
2. **Rate Limiting:** Login attempts are rate-limited via database sliding windows (`RateLimitBucket`). More than 8 failed attempts within 10 minutes temporarily locks the client IP.
3. **Session Inactivity & Expiry:** Sessions expire automatically after 7 days of inactivity. Users must re-authenticate to refresh cryptographic tokens.
4. **Instant Logout:** Clicking **Sign Out** calls `logoutAction` in `src/actions/auth.ts`, deleting the session cookie and redirecting immediately to `/login`.
