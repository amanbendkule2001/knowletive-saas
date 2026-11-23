# Knowletive SaaS — Complete Module-Wise Functional Guide

## Document Information
- **Title:** Comprehensive Functional & Technical Guide for All Modules
- **Document ID:** DOC-09-MODULE-GUIDE
- **Target Audience:** Product Architects, Software Engineers, Functional Analysts, QA Engineers, Support Specialists
- **Classification:** Functional Architecture & Deep Reference Manual
- **Repository Location:** `docs/knowletive-functional-handbook/09-MODULE-WISE-FUNCTIONAL-GUIDE.md`

---

## Table of Contents
1. [Module Architecture Overview](#1-module-architecture-overview)
2. [Module 1: Platform Administration (`/platform`)](#2-module-1-platform-administration-platform)
3. [Module 2: Admissions & CRM (`/app/leads`)](#3-module-2-admissions--crm-appleads)
4. [Module 3: Student Lifecycle & Directory (`/app/students`)](#4-module-3-student-lifecycle--directory-appstudents)
5. [Module 4: Guardian & Family Network (`/app/parents`)](#5-module-4-guardian--family-network-appparents)
6. [Module 5: Staff & Human Resources (`/app/staff`)](#6-module-5-staff--human-resources-appstaff)
7. [Module 6: Academic Master Configuration (`/app/academics`)](#7-module-6-academic-master-configuration-appacademics)
8. [Module 7: Batch & Classroom Operations (`/app/batches`)](#8-module-7-batch--classroom-operations-appbatches)
9. [Module 8: SyllabusTrack Curriculum Engine (`/app/syllabus`)](#9-module-8-syllabustrack-curriculum-engine-appsyllabus)
10. [Module 9: Examination & Grading Lifecycle (`/app/exams`)](#10-module-9-examination--grading-lifecycle-appexams)
11. [Module 10: Daily Attendance Register (`/app/attendance`)](#11-module-10-daily-attendance-register-appattendance)
12. [Module 11: Fee Invoicing & Financial Operations (`/app/fees`)](#12-module-11-fee-invoicing--financial-operations-appfees)
13. [Module 12: Campus Communication & Notices (`/app/announcements`)](#13-module-12-campus-communication--notices-appannouncements)
14. [Module 13: AI Studio (`/app/ai`)](#14-module-13-ai-studio-appai)
15. [Module 14: Institute Subscription & Billing (`/app/billing`)](#15-module-14-institute-subscription--billing-appbilling)
16. [Module 15: Administration, Custom Roles & Settings (`/app/roles`, `/app/settings`)](#16-module-15-administration-custom-roles--settings-approles-appsettings)
17. [Module 16: Unified Student & Parent Portal (`/portal`)](#17-module-16-unified-student--parent-portal-portal)

---

## 1. Module Architecture Overview

Knowletive SaaS is composed of 16 functional modules. Every module adheres to a standardized architecture:
- **Presentation Layer:** Next.js 15 Server Components for fast data rendering, combined with interactive Client Components for forms, filters, and modals.
- **Access Guard Layer:** Route-level and server-action authorization via `src/lib/auth.ts` enforcing tenant boundaries (`tenantId`) and specific granular permissions.
- **Business Logic Layer:** Type-safe Server Actions in `src/actions/*` executing atomic mutations and business rules.
- **Persistence Layer:** PostgreSQL 16 via Prisma ORM 6.4, utilizing foreign keys, unique constraints, and transaction-level concurrency locks.

---

## 2. Module 1: Platform Administration (`/platform`)

### 2.1 Overview
- **Business Purpose:** Centralized SaaS provisioning, global billing governance, and infrastructure telemetry.
- **Primary Users:** Platform Owner, Platform Support engineers.
- **Key Submodules:** Institutes Directory (`/platform/institutes`), Plans (`/platform/plans`), Subscriptions (`/platform/subscriptions`), AI Telemetry (`/platform/ai`), Platform Team (`/platform/team`), Global Audit (`/platform/audit`).

### 2.2 Access & Navigation
- **Base Route:** `/platform`
- **Permission Guard:** `requirePlatform()` in `src/lib/auth.ts`. User must have `isPlatformOwner: true` or platform-scoped role.

### 2.3 Screen Breakdown
- **Console Overview (`/platform`):** Displays aggregate counts of institutes, active subscriptions, estimated MRR, total AI tokens consumed, and recent audit logs.
- **Institute Directory (`/platform/institutes`):** Searchable table showing institute name, slug, tier, student count, and status badge (`ACTIVE`, `SUSPENDED`).
- **New Institute Wizard (`/platform/institutes/new`):** Modal form collecting institute name, slug, contact details, currency, initial plan, and primary administrator credentials.
- **Plan Manager (`/platform/plans`):** Catalog of subscription tiers (Core, Growth, Scale) with monthly/yearly pricing, student limits, and feature toggles.
- **Global Audit Stream (`/platform/audit`):** Chronological log of high-priority administrative events with IP address, user agent, and metadata diffs.

### 2.4 Operations Supported
- **Create Institute:** `createInstituteAction` creates `Tenant`, `User`, `Membership`, and initial `Subscription`.
- **Toggle Status:** `toggleInstituteStatusAction` sets tenant status to `SUSPENDED` or `ACTIVE`.
- **Manage Plans:** `createPlanAction`, `updatePlanAction`.
- **Manage Subscriptions:** `createSubscriptionAction`, `cancelSubscriptionAction`.

---

## 3. Module 2: Admissions & CRM (`/app/leads`)

### 3.1 Overview
- **Business Purpose:** Inbound inquiry capture, prospect qualification, counselor communication logs, and conversion of prospects into enrolled students.
- **Primary Users:** Front Desk Officers, Admissions Counselors, Institute Admin.

### 3.2 Access & Navigation
- **Base Route:** `/app/leads`
- **Required Permission:** `leads.read` (viewing), `leads.write` (creation/updates), `leads.convert` (conversion), `leads.delete` (removal).

### 3.3 Screen Breakdown
- **Leads Directory (`/app/leads`):** Filter by status tabs (`ALL`, `NEW`, `CONTACTED`, `QUALIFIED`, `CONVERTED`, `LOST`). Search input matching student name, guardian email, or guardian phone.
- **Create Lead Form (`/app/leads/new`):** Inputs for Student Name, Guardian Name, Email, Phone, Grade Applied, Source (Walk-in, Website, Referral, Social), and Counselor Notes.
- **Lead Detail Profile (`/app/leads/[id]`):** Complete timeline of interaction notes, qualification status updates, and action button to trigger admission conversion.
- **CSV Bulk Import Modal:** Upload CSV files of inquiries with duplicate detection.
- **CSV Export Endpoint (`/app/leads/export`):** Downloads filtered leads with tenant audit logging.

### 3.4 Key Server Actions & Database Impact
- `createLeadAction`: Persists a `Lead` record under `tenantId`.
- `convertLeadAction`: Atomic transaction that creates a `Student`, a `Guardian`, establishes `GuardianLink`, enrolls student into a `Batch`, and transitions the `Lead` to `CONVERTED`.
- `bulkImportLeadsAction`: Uses `pg_advisory_xact_lock` to safely import up to 300 leads per batch with duplicate collision checks.

---

## 4. Module 3: Student Lifecycle & Directory (`/app/students`)

### 4.1 Overview
- **Business Purpose:** Master repository of all enrolled learners, personal demographics, emergency contacts, admission numbers, and enrollment states.
- **Primary Users:** Institute Admin, Front Desk, Principal, Teachers.

### 4.2 Access & Navigation
- **Base Route:** `/app/students`
- **Permissions:** `students.read`, `students.write`, `students.delete`.

### 4.3 Screen Breakdown
- **Student Master Directory (`/app/students`):** Paginated table displaying Avatar, Student Full Name, Admission Number, Roll Number, Class/Batch, Guardian Name, Status (`ACTIVE`, `INACTIVE`, `ALUMNI`).
- **Student Profile (`/app/students/[id]`):** Comprehensive 360° record including academic history, linked guardians, attendance percentage, fee balance, and examination report cards.
- **Student Form (`/app/students/new`, `/app/students/[id]/edit`):** Form collecting Name, DOB, Gender, Admission Number, Roll Number, Blood Group, Address, and Batch Allocation.
- **Bulk CSV Student Import (`/app/students/import`):** Bulk upload facility for onboarding large cohorts.
- **Student CSV Export (`/app/students/export`):** Export student roster by batch.

---

## 5. Module 4: Guardian & Family Network (`/app/parents`)

### 5.1 Overview
- **Business Purpose:** Directory of parents, emergency contacts, and family units. Supports multi-child linkage (siblings attending the same school).
- **Primary Users:** Front Desk, Institute Admin, Teachers.

### 5.2 Access & Navigation
- **Base Route:** `/app/parents`
- **Permissions:** `parents.read`, `parents.write`.

### 5.3 Screen Breakdown
- **Parent Directory (`/app/parents`):** Table of guardians, phone numbers, email addresses, and count of linked children.
- **Guardian Detail (`/app/parents/[id]`):** List of all linked student profiles (`GuardianLink`), emergency contact numbers, and portal user account status.
- **Add Guardian (`/app/parents/new`):** Form capturing Guardian Name, Relationship (Father, Mother, Legal Guardian), Email, Phone, and Occupation.

---

## 6. Module 5: Staff & Human Resources (`/app/staff`)

### 6.1 Overview
- **Business Purpose:** Employee directory, faculty subject assignments, staff role provisioning, and account lifecycle.
- **Primary Users:** Institute Admin, Principal.

### 6.2 Access & Navigation
- **Base Route:** `/app/staff`
- **Permissions:** `staff.read`, `staff.manage`.

### 6.3 Screen Breakdown
- **Staff Directory (`/app/staff`):** Staff table with Full Name, Work Email, Phone, Designation, Assigned Role, and Active Status.
- **Invite Staff Member (`/app/staff/new`):** Modal collecting staff profile and assigning role (`TEACHER`, `ACCOUNTANT`, `FRONT_DESK`, `PRINCIPAL`, or custom roles).
- **Staff Profile (`/app/staff/[id]`):** Shows assigned teaching batches, subjects, and recent audit activity.

---

## 7. Module 6: Academic Master Configuration (`/app/academics`)

### 7.1 Overview
- **Business Purpose:** The foundational backbone of the educational institution: managing Academic Years, Classes (Grades), Sections, and Subjects.
- **Primary Users:** Institute Admin, Principal.

### 7.2 Access & Navigation
- **Base Route:** `/app/academics`
- **Permissions:** `academics.read`, `academics.manage`.

### 7.3 Screen Breakdown
- **Academic Years Tab:** Manage school years (e.g., "2026-2027"). Toggle active year flag via `setActiveAcademicYearAction`.
- **Classes Tab:** Create and manage grade levels (Grade 1 through 12).
- **Sections Tab:** Create classroom divisions (Section A, B, C).
- **Subjects Tab:** Master catalog of subjects taught, subject codes, and credit hours.

---

## 8. Module 7: Batch & Classroom Operations (`/app/batches`)

### 8.1 Overview
- **Business Purpose:** The live classroom unit. Binds students, assigned faculty, and timetables into an operational cohort for attendance, curriculum delivery, and exams.
- **Primary Users:** Institute Admin, Principal, Teachers.

### 8.2 Access & Navigation
- **Base Route:** `/app/batches`
- **Permissions:** `batches.read`, `batches.write`, `batches.enroll`, `batches.transfer`, `batches.manage_teachers`.

### 8.3 Screen Breakdown
- **Batch Grid (`/app/batches`):** Visual cards for each active batch showing Class, Section, Student Count, and Assigned Teachers.
- **Batch Console (`/app/batches/[id]`):** Tabbed interface with:
  - *Roster:* List of enrolled students with roll numbers.
  - *Timetable:* Scheduled class timings.
  - *Faculty:* Assigned teachers and their respective subjects.
- **Batch Settings (`/app/batches/[id]/settings`):** Allocate faculty (`assignBatchTeacherAction`), transfer students (`transferBatchStudentAction`), or update maximum room capacity.

---

## 9. Module 8: SyllabusTrack Curriculum Engine (`/app/syllabus`)

### 9.1 Overview
- **Business Purpose:** Structured curriculum planning, topic-by-topic tracking, lesson planning, and academic progress transparency.
- **Primary Users:** Teachers, Principal, Institute Admin.

### 9.2 Access & Navigation
- **Base Route:** `/app/syllabus`
- **Permissions:** `syllabus.read`, `syllabus.write`, `syllabus.update_progress`, `syllabus.view_reports`.

### 9.3 Screen Breakdown
- **Curriculum Tree (`/app/syllabus`):** Hierarchical view: Subject -> Chapters -> Topics -> Lesson Plans.
- **Topic Delivery Logger:** Teachers mark topics completed, record class dates, and log teaching notes (`recordTopicProgressAction`).
- **Curriculum Analytics (`/app/syllabus/reports`):** Progress bar gauges showing percentage completion across batches before examinations begin.

---

## 10. Module 9: Examination & Grading Lifecycle (`/app/exams`)

### 10.1 Overview
- **Business Purpose:** Complete governance of the examination cycle: scheduling, candidate enrollment, mark sheets, verification, result snapshot creation, and audited corrections.
- **Primary Users:** Institute Admin, Principal, Teachers.

### 10.2 State Transition Lifecycle
```
DRAFT -> SCHEDULED -> IN_PROGRESS -> COMPLETED -> EVALUATING -> RESULTS_PUBLISHED -> ARCHIVED
```

### 10.3 Screen Breakdown
- **Exam Schedule (`/app/exams`):** List of term exams with status badges.
- **Exam Builder (`/app/exams/new`):** Setup exam title, dates, subjects, maximum marks, passing thresholds.
- **Grading Scale Matrix (`/app/exams/grading`):** Configure letter grades and percentage cutoffs (e.g., A+ = 90-100%).
- **Teacher Mark Entry Sheet (`/app/exams/[id]`):** Grid for teachers to enter raw marks or flag `isAbsent`.
- **Publication Console:** One-click result calculation that writes immutable `ExamResultSnapshot` records visible in `/portal`.
- **Audited Correction Modal:** Allows post-publication score corrections with mandatory audit reasoning (`correctPublishedMarkAction`).

---

## 11. Module 10: Daily Attendance Register (`/app/attendance`)

### 11.1 Overview
- **Business Purpose:** Daily classroom roll call, statutory records, and automatic absence alert triggers to parents.
- **Primary Users:** Teachers, Institute Admin.

### 11.2 Screen Breakdown
- **Date-Based Register (`/app/attendance`):** Select Batch and Date. Student table with toggles for `Present`, `Absent`, `Late`, `Excused`.
- **Submission:** Submitting executes `markAttendanceAction`.
- **Absence Alerts:** Triggered to guardians when students are marked Absent.

---

## 12. Module 11: Fee Invoicing & Financial Operations (`/app/fees`)

### 12.1 Overview
- **Business Purpose:** Student tuition billing, fee head management, multi-channel payment recording, receipt voucher printing, and dues recovery.
- **Primary Users:** Accountant, Institute Admin.

### 12.2 Screen Breakdown
- **Fee Console (`/app/fees`):** Financial summary cards (Invoiced, Collected, Dues), search, and status filters (`ALL`, `PENDING`, `PARTIAL`, `PAID`).
- **Create Invoice Wizard (`/app/fees/new`):** Select single student or batch, add itemized fee heads (Tuition, Lab, Transport), set due date.
- **Invoice Statement (`/app/fees/[id]`):** View invoice, log payments (`recordFeePaymentAction`), and print official receipts.

---

## 13. Module 12: Campus Communication & Notices (`/app/announcements`)

### 13.1 Overview
- **Business Purpose:** Broadcast official announcements to staff, students, and parents.
- **Primary Users:** Institute Admin, Principal, Teachers.

### 13.2 Screen Breakdown
- **Notice Board (`/app/announcements`):** Feed of recent school notices.
- **Composer Modal:** Title, rich text content, attachment support, and target audience selection (`ALL`, `STAFF`, `STUDENTS`, `PARENTS`).

---

## 14. Module 13: AI Studio (`/app/ai`)

### 14.1 Overview
- **Business Purpose:** Generative AI tools (powered by Google Gemini) for lesson planning, exam question generation, and student feedback synthesis.
- **Primary Users:** Teachers, Principal, Institute Admin.

### 14.2 The Six Specialized AI Modules
Knowletive integrates six specialized generative AI modules powered by Google Gemini, cataloged in \`src/lib/catalog.ts\` and executed via \`runAiAction\` in \`src/actions/operations.ts\` and \`draftLeadReplyAction\` in \`src/actions/leads.ts\`:

1. **Lesson Plan Generator (\`lesson_plan\`):** Generates structured, outcome-based 45-minute lesson plans for any topic, complete with learning objectives, teaching activities, and formative exit tickets.
2. **Question Paper Creator (\`question_paper\`):** Formats blueprint-aligned test papers featuring multiple-choice, short-answer, and essay questions along with answer keys.
3. **Report Card Remarks Synthesizer (\`report_card_remarks\`):** Turns student marks, attendance percentages, and teacher observations into balanced, constructive, parent-friendly remarks for term report cards.
4. **Fee Reminder Drafter (\`fee_reminder\`):** Generates polite, firm, customized payment reminders for parents with overdue fee invoices in seconds.
5. **Admission Inquiry Assistant (\`admission_reply\`):** Answers inbound admissions enquiries with accurate, school-specific next steps, fee estimates, and campus visit scheduling info.
6. **Attendance Risk Insights (\`attendance_insight\`):** Analyzes classroom roll-call patterns, spots emerging absenteeism risks, and produces an actionable intervention plan for the week.

### 14.3 Quota Governance & Metering
- Every SaaS plan tier allocates an \`aiCreditsMonthly\` token limit.
- Calls check \`tenant.ai.use\` permission and verify plan inclusion.
- Consumption is recorded in \`AiUsageLog\` and monitored globally in \`/platform/ai\`.

---

## 15. Module 14: Institute Subscription & Billing (`/app/billing`)

### 15.1 Overview
- **Business Purpose:** Manage the school's SaaS subscription plan, seat consumption, and platform billing history.
- **Primary Users:** Institute Admin.

### 15.2 Screen Breakdown
- Displays current plan tier (Core, Growth, Scale), enrolled students vs maximum capacity, monthly renewal date, and past platform invoices.

---

## 16. Module 15: Administration, Custom Roles & Settings (`/app/roles`, `/app/settings`)

### 16.1 Overview
- **Business Purpose:** Institute profile customization, custom role configuration, 52-permission RBAC matrix, and immutable security audit logs.
- **Primary Users:** Institute Admin.

### 16.2 Screen Breakdown
- **Role Manager (`/app/roles`):** Create and edit custom roles with checkbox matrix toggling 52 granular tenant permissions.
- **Settings & Profile (`/app/settings`):** Upload school crest, configure official address, contact details, and inspect the internal tenant audit log.

---

## 17. Module 16: Unified Student & Parent Portal (`/portal`)

### 17.1 Overview
- **Business Purpose:** Secure self-service portal for learners and their families.
- **Primary Users:** Students, Parents / Guardians.

### 17.2 Screen Breakdown
- **Personal Dashboard (`/portal`):** Academic status, attendance percentage gauge, recent exam summaries, campus circulars.
- **Exam Snapshot Viewer (`/portal/results/[id]`):** Official frozen report card showing subject scores, letter grade, teacher remarks, and institute verification stamp.
- **Fee Statement (Parent View):** Itemized breakdown of invoices, payment transaction log, and printable receipts.
