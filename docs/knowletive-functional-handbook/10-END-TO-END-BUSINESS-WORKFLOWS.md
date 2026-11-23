# Knowletive SaaS — Complete End-to-End Business Workflows

## Document Information
- **Title:** Master End-to-End Business Workflows & Cross-Module Lifecycle Manual
- **Document ID:** DOC-10-WORKFLOWS
- **Target Audience:** Enterprise Implementers, Product Architects, Business Analysts, QA Leads, Systems Integrators
- **Classification:** Business Process & Technical Architecture Specification
- **Repository Location:** `docs/knowletive-functional-handbook/10-END-TO-END-BUSINESS-WORKFLOWS.md`

---

## Table of Contents
1. [Overview of Institutional Lifecycles](#1-overview-of-institutional-lifecycles)
2. [Workflow 1: SaaS Tenant Provisioning & Plan Subscription](#2-workflow-1-saas-tenant-provisioning--plan-subscription)
3. [Workflow 2: Academic Year Inception & Curriculum Setup](#3-workflow-2-academic-year-inception--curriculum-setup)
4. [Workflow 3: Staff Recruitment, RBAC & Role Provisioning](#4-workflow-3-staff-recruitment-rbac--role-provisioning)
5. [Workflow 4: Inbound Lead Capture & Admissions Pipeline](#5-workflow-4-inbound-lead-capture--admissions-pipeline)
6. [Workflow 5: One-Click Lead to Student Admission Conversion](#6-workflow-5-one-click-lead-to-student-admission-conversion)
7. [Workflow 6: Batch Assembly, Student Enrollment & Faculty Allocation](#7-workflow-6-batch-assembly-student-enrollment--faculty-allocation)
8. [Workflow 7: SyllabusTrack Curriculum Delivery & Daily Lesson Logging](#8-workflow-7-syllabustrack-curriculum-delivery--daily-lesson-logging)
9. [Workflow 8: Daily Roll Call, Absence Alerting & Parental Notification](#9-workflow-8-daily-roll-call-absence-alerting--parental-notification)
10. [Workflow 9: Complete Examination Lifecycle & Snapshot Publication](#10-workflow-9-complete-examination-lifecycle--snapshot-publication)
11. [Workflow 10: Post-Publication Exam Mark Correction & Versioning](#11-workflow-10-post-publication-exam-mark-correction--versioning)
12. [Workflow 11: Fee Invoicing, Partial Payments & Receipt Generation](#12-workflow-11-fee-invoicing-partial-payments--receipt-generation)
13. [Workflow 12: Overdue Fee Recovery & Reminder Automation](#13-workflow-12-overdue-fee-recovery--reminder-automation)
14. [Workflow 13: Campus-Wide & Cohort Announcements](#14-workflow-13-campus-wide--cohort-announcements)
15. [Workflow 14: AI Studio Educational Generation Workflows](#15-workflow-14-ai-studio-educational-generation-workflows)
16. [Workflow 15: Student & Parent Self-Service Journey](#16-workflow-15-student--parent-self-service-journey)

---

## 1. Overview of Institutional Lifecycles

In Knowletive SaaS, an educational institution evolves through predictable, interlinked phases:
1. **Onboarding:** Platform operator creates the tenant and assigns a SaaS plan.
2. **Configuration:** School administrator sets up academic years, classes, and invites staff.
3. **Intake:** Front desk captures leads and converts qualified applicants into students.
4. **Operation:** Teachers take attendance, deliver syllabus lessons, and conduct exams.
5. **Evaluation & Finance:** Exams are verified and published into immutable snapshots; accountants bill tuition fees and collect payments.
6. **Self-Service:** Students and parents monitor progress and view official transcripts in the portal.

---

## 2. Workflow 1: SaaS Tenant Provisioning & Plan Subscription

### Purpose
To establish a new educational institution on the Knowletive platform with an active subscription and isolated database partition.

### Actors
- **Initiator:** Platform Owner (`PLATFORM_OWNER`)
- **Recipient:** New School Administrator (`INSTITUTE_ADMIN`)

### Process Steps
1. Platform Owner logs in at `/login` and opens `/platform/institutes/new`.
2. Fills out institute details: Legal Name, Unique URL Slug (`sunrise`), Country, Currency, and Initial Plan Tier (e.g., Growth Tier).
3. Enters the primary administrator's name and work email.
4. Clicks **Provision Institute**:
   - Invokes `createInstituteAction` in `src/actions/platform.ts`.
   - **Database Mutations:**
     - Creates `Tenant` record with `slug: "sunrise"`.
     - Creates `User` record with encrypted password hash.
     - Creates `Membership` record linking User to Tenant with role `INSTITUTE_ADMIN`.
     - Creates `Subscription` record tied to selected `Plan`.
     - Logs event in platform `AuditLog`.
5. An automated welcome email is dispatched to the school administrator with login instructions.

---

## 3. Workflow 2: Academic Year Inception & Curriculum Setup

### Process Steps
1. School Administrator signs in at `/login` and lands on `/app`.
2. Navigates to **Academics** (`/app/academics`).
3. Creates the active school year (e.g., "Academic Year 2026-2027") via `createAcademicYearAction`. Sets it as Active via `setActiveAcademicYearAction`.
4. Creates Class standards (Grade 9, Grade 10) via `createClassAction`.
5. Creates classroom sections (Section A, Section B) via `createSectionAction`.
6. Configures Subjects (Mathematics, Physics, Chemistry, English) via `createSubjectAction`.

---

## 4. Workflow 3: Staff Recruitment, RBAC & Role Provisioning

### Process Steps
1. Admin navigates to **Staff** (`/app/staff/new`).
2. Enters staff member details and selects role: `TEACHER`, `ACCOUNTANT`, `FRONT_DESK`, or `PRINCIPAL`.
3. Submitting triggers `inviteStaffAction`. The employee receives an invitation to activate their account.
4. If special permissions are required, Admin navigates to `/app/roles`, clones or creates a custom role, toggles specific permissions out of the 52 tenant permissions, and assigns the custom role to the staff member.

---

## 5. Workflow 4: Inbound Lead Capture & Admissions Pipeline

### Process Steps
1. Prospective parent calls or visits the school campus.
2. Front Desk officer opens `/app/leads/new`.
3. Fills in Student Name, Guardian Name, Guardian Email, Guardian Phone, Grade Applied, and Source.
4. Submitting executes `createLeadAction`. Status is set to `NEW`.
5. Admissions counselor reviews the lead, conducts campus tour, and logs notes in `/app/leads/[id]`, advancing status from `NEW` -> `CONTACTED` -> `QUALIFIED`.

---

## 6. Workflow 5: One-Click Lead to Student Admission Conversion

### Process Steps
1. In `/app/leads/[id]`, counselor clicks **Convert to Admission**.
2. Modal prompts for Admission Number (`ADM-2026-101`) and initial Batch assignment.
3. Clicking **Confirm Admission** executes `convertLeadAction` in `src/actions/leads.ts`:
   - Runs inside a single PostgreSQL atomic transaction:
     - Creates `Student` record.
     - Creates `Guardian` record.
     - Establishes `GuardianLink`.
     - Creates `BatchEnrollment`.
     - Sets `Lead.status = "CONVERTED"`.
4. Front desk prints welcome letter and issues student credentials.

---

## 7. Workflow 6: Batch Assembly, Student Enrollment & Faculty Allocation

### Process Steps
1. Admin creates a classroom batch in `/app/batches/new` (e.g., "Grade 10 - Section A - Morning").
2. Sets room capacity (e.g., 35 students).
3. Allocates faculty in `/app/batches/[id]/settings` using `assignBatchTeacherAction`.
4. Enrolls admitted students into the batch using `enrollStudentInBatchAction`.

---

## 8. Workflow 7: SyllabusTrack Curriculum Delivery & Daily Lesson Logging

### Process Steps
1. Curriculum coordinator creates Chapter and Topic tree in `/app/syllabus`.
2. Faculty prepares lesson plans manually or using **AI Studio** (`/app/ai`).
3. After conducting class, the Teacher opens the topic in `/app/syllabus`, clicks **Mark Completed**, enters delivery date, and records instructional notes.
4. Executing `recordTopicProgressAction` increments the progress bar on administrative analytics.

---

## 9. Workflow 8: Daily Roll Call, Absence Alerting & Parental Notification

### Process Steps
1. Teacher signs in and navigates to `/app/attendance`.
2. Selects assigned batch and date.
3. System displays the roll call list with default status `P` (Present).
4. Teacher toggles absent students to `A` (Absent) or `L` (Late) and clicks **Save Attendance Register** (`markAttendanceAction`).
5. The system identifies all `A` records and triggers `sendAttendanceAlertNotificationAction`, notifying parents via email/SMS and displaying an alert in the Parent Portal.

---

## 10. Workflow 9: Complete Examination Lifecycle & Snapshot Publication

### Detailed State Transitions
```
DRAFT -> SCHEDULED -> IN_PROGRESS -> EVALUATING -> RESULTS_PUBLISHED
```
1. **Creation:** Principal creates exam at `/app/exams/new`, sets date ranges, adds subjects with max marks and passing criteria.
2. **Enrollment:** Cohorts from active batches are enrolled into `ExamEnrollment`.
3. **Examination Execution:** Exam status transitions to `IN_PROGRESS`.
4. **Mark Entry:** Teachers enter raw marks per student per subject in `/app/exams/[id]` (`enterMarksBulkAction`).
5. **Verification:** Teachers verify and lock marks (`verifyExamMarksAction`).
6. **Publication:** Admin clicks **Publish Results**:
   - Triggers `calculateAndPublishResultsAction` in `src/actions/exams.ts`.
   - Iterates through all enrolled students.
   - Calculates total score, percentage, and assigns letter grade based on the configured `GradingScale`.
   - Writes immutable, frozen `ExamResultSnapshot` records.
   - Transitions examination status to `RESULTS_PUBLISHED`.
   - Report cards become immediately visible in the **Student & Parent Portal** (`/portal`).

---

## 11. Workflow 10: Post-Publication Exam Mark Correction & Versioning

### Process Steps
1. In the event of a legitimate re-evaluation or scoring error, published marks cannot be directly edited.
2. Admin opens the published exam and initiates the **Mark Correction Workflow**:
   - Enters student, subject, revised mark, and **Mandatory Reason for Correction**.
3. Submitting executes `correctPublishedMarkAction`:
   - Validates that `newMark <= maxMarks`.
   - Recalculates total score, percentage, and letter grade.
   - Creates a new versioned `ExamResultSnapshot` (e.g. `version: 2`).
   - Archives the previous snapshot and logs an immutable entry in `AuditLog`.

---

## 12. Workflow 11: Fee Invoicing, Partial Payments & Receipt Generation

### Process Steps
1. Accountant opens `/app/fees/new`. Selects student or whole batch.
2. Enters fee line items (Tuition, Lab, Transport) and sets payment due date.
3. Executes `createFeeInvoiceAction`. Status is set to `PENDING`.
4. When parent pays, Accountant opens `/app/fees/[id]`, clicks **Record Payment**:
   - Enters amount received (supports partial payments), payment method (Cash, Card, UPI, Bank Transfer), and reference number.
5. Executes `recordFeePaymentAction`. System recalculates `paidAmount` and updates status to `PARTIAL` or `PAID`.
6. Generates a signed, printable fee receipt voucher.

---

## 13. Workflow 12: Overdue Fee Recovery & Reminder Automation

### Process Steps
1. Accountant filters invoices by status `PENDING` / `PARTIAL` and flags overdue bills.
2. Selects candidate invoices and clicks **Send Reminders**.
3. Executes `sendFeeReminderNotificationAction`, dispatching payment reminder notices to parents.

---

## 14. Workflow 13: Campus-Wide & Cohort Announcements

### Process Steps
1. Administrator or Teacher opens `/app/announcements`.
2. Enters announcement title, body, and selects target audience: `ALL`, `STAFF`, `STUDENTS`, or `PARENTS`.
3. Executes `publishAnnouncementAction`. The announcement instantly appears on target users' portal dashboards.

---

## 15. Workflow 14: AI Studio Educational Generation Workflows

### Process Steps
1. Teacher opens `/app/ai`.
2. Chooses **Lesson Plan Generator**, selects subject, grade, topic, and duration.
3. Executes `generateLessonPlanAIAction`. Gemini AI produces a pedagogy-backed lesson plan.
4. Teacher reviews and saves the plan directly into SyllabusTrack.

---

## 16. Workflow 15: Student & Parent Self-Service Journey

### Process Steps
1. Student or Parent logs in at `/login`. System automatically redirects to `/portal`.
2. Parents with multiple enrolled children use the **Ward Switcher** to select between siblings.
3. Users review the attendance gauge, inspect open fee invoices, and click **View Result** on published examinations.
4. Detailed result viewer (`/portal/results/[id]`) displays official certified report cards.
