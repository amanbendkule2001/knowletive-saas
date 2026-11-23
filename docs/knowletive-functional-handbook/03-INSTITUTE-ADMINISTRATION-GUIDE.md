# Knowletive SaaS — Institute Administration Guide

## Document Information
- **Title:** Institute Administration & Academic Leadership Guide
- **Document ID:** DOC-03-INSTITUTE-ADMIN
- **Target Audience:** School Directors, Institute Administrators, Principals, Vice Principals, Operations Managers
- **Classification:** Administrative Standard Operating Procedure (SOP)
- **Repository Location:** `docs/knowletive-functional-handbook/03-INSTITUTE-ADMINISTRATION-GUIDE.md`

---

## Table of Contents
1. [Introduction & Institute Workspace Overview](#1-introduction--institute-workspace-overview)
2. [Initial Onboarding & Academic Architecture Setup](#2-initial-onboarding--academic-architecture-setup)
   - [2.1 Academic Year Management (`/app/academics`)](#21-academic-year-management-appacademics)
   - [2.2 Classes, Sections & Subjects Master Setup](#22-classes-sections--subjects-master-setup)
3. [Human Resources & Staff Onboarding (`/app/staff`)](#3-human-resources--staff-onboarding-appstaff)
4. [Role-Based Access Control & Permissions (`/app/roles`)](#4-role-based-access-control--permissions-approles)
5. [Batch Scheduling & Faculty Allocation (`/app/batches`)](#5-batch-scheduling--faculty-allocation-appbatches)
6. [Admissions & Enrollment Supervision (`/app/leads`, `/app/students`)](#6-admissions--enrollment-supervision-appleads-appstudents)
7. [Curriculum & Syllabus Oversight (`/app/syllabus`)](#7-curriculum--syllabus-oversight-appsyllabus)
8. [Examination Cycles & Result Publication (`/app/exams`)](#8-examination-cycles--result-publication-appexams)
9. [Financial & Fee Governance (`/app/fees`, `/app/billing`)](#9-financial--fee-governance-appfees-appbilling)
10. [Institute Settings, Branding & Audit Logs (`/app/settings`)](#10-institute-settings-branding--audit-logs-appsettings)

---

## 1. Introduction & Institute Workspace Overview

The **Institute Workspace** (`/app`) is the operational engine for educational institutions. The **Institute Admin** and **Principal** utilize this environment to manage academic terms, staff, students, classroom batches, examinations, and institutional finances.

### 1.1 Access & Multi-Tenant Boundaries
- All data presented in `/app` is strictly scoped to the active tenant's `tenantId`.
- Administrative privileges require holding the `INSTITUTE_ADMIN` or `PRINCIPAL` role within the school's `Membership` registry.

---

## 2. Initial Onboarding & Academic Architecture Setup

Before any students can be enrolled or classes scheduled, the academic foundation must be established in `/app/academics`.

### 2.1 Academic Year Management (`/app/academics`)
1. **Create Academic Year:** Click **+ New Academic Year**.
   - **Name:** Standard nomenclature (e.g., "Academic Year 2026-2027").
   - **Start Date & End Date:** Operational date range.
   - **Active Toggle:** Mark as active. Only **one** academic year can be active per tenant at any time. Activating a new year automatically sets prior years to inactive via `setActiveAcademicYearAction`.

### 2.2 Classes, Sections & Subjects Master Setup
1. **Classes (Grade Levels):**
   - Define grades or standards (e.g., "Grade 9", "Grade 10", "Foundation Course").
   - Action: `createClassAction`.
2. **Sections:**
   - Define divisions under each class (e.g., "Section A", "Section B").
   - Action: `createSectionAction`.
3. **Subjects:**
   - Define academic subjects per class (e.g., "Mathematics", "Physics", "English Literature").
   - Define subject code and default credit weight.
   - Action: `createSubjectAction`.

---

## 3. Human Resources & Staff Onboarding (`/app/staff`)

### 3.1 Inviting Staff Members
- **Route:** `/app/staff/new`
- **Procedure:**
  1. Enter staff member's Full Name, Work Email, Phone Number, and Staff Designation (e.g., "Senior Mathematics Faculty").
  2. Select Role from the dropdown: `TEACHER`, `ACCOUNTANT`, `FRONT_DESK`, `PRINCIPAL`, or custom roles.
  3. Submit to invoke `inviteStaffAction`. The user receives system login credentials.

### 3.2 Staff Directory & Status Management (`/app/staff`)
- Inspect staff list with active assignments and assigned roles.
- View staff profile (`/app/staff/[id]`) to review assigned batches, teaching subjects, and historical activity.
- Deactivate staff members upon departure, which immediately revokes session access.

---

## 4. Role-Based Access Control & Permissions (`/app/roles`)

Knowletive provides granular security governance via **52 customizable tenant permissions**:

### 4.1 Custom Role Creation
- **Route:** `/app/roles` -> Click **+ Create Role**.
- **Role Name:** Descriptive title (e.g., "Academic Coordinator", "Head of Admissions").
- **Permission Matrix:** Toggle specific access checkboxes across 13 functional groups:
  - *Leads:* read, write, convert, delete.
  - *Batches:* read, write, enroll, transfer, manage_teachers.
  - *Syllabus:* read, write, manage_structure, manage_lessons, update_progress, view_reports.
  - *Exams:* read, write, manage_grading, enroll, enter_marks, verify_marks, publish_results, correct_marks.
  - *Students, Parents, Staff, Attendance, Fees, Announcements, AI, Settings, Reports.*
- **Saving:** Invokes `createRoleAction` in `src/actions/platform.ts` / tenant role manager.

---

## 5. Batch Scheduling & Faculty Allocation (`/app/batches`)

A **Batch** represents the live, scheduled classroom unit where students and teachers interact.

### 5.1 Creating a Batch (`/app/batches/new`)
- **Fields:**
  - **Batch Name:** Clear identifier (e.g., "Grade 10-A Morning 2026").
  - **Class & Section:** Link to academic structure.
  - **Academic Year:** Defaults to active year.
  - **Max Capacity:** Room size or student limit (e.g., 40).
  - **Start & End Time:** Daily class timetable schedule.
- Submitting invokes `createBatchAction` in `src/actions/batches.ts`.

### 5.2 Faculty Allocation (`/app/batches/[id]/settings`)
- Assign one or more teachers to the batch:
  - Select Teacher from staff dropdown.
  - Assign Teaching Subject (e.g., Assign Teacher John Doe to "Mathematics").
  - Invokes `assignBatchTeacherAction`. Assigned teachers immediately see this batch in their personal `/app/batches` dashboard.

### 5.3 Student Enrollment & Inter-Batch Transfers
- **Direct Enrollment:** Select students from the unallocated student pool to enroll in the batch (`enrollStudentInBatchAction`).
- **Batch Transfer:** Seamlessly move a student from Section A to Section B (`transferBatchStudentAction`), preserving historical attendance and marks.

---

## 6. Admissions & Enrollment Supervision (`/app/leads`, `/app/students`)

- **Admissions Pipeline Oversight:** Review weekly lead conversion ratios, lost inquiry reasons, and counselor follow-up cadences in `/app/leads`.
- **Bulk Student CSV Onboarding:** Upload hundreds of student records in one operation via `/app/students/import`.
- **Student Profile Verification:** Inspect 360° student records (`/app/students/[id]`) to verify guardian linkages, enrolled batches, attendance percentage, and fee balances.

---

## 7. Curriculum & Syllabus Oversight (`/app/syllabus`)

- **Curriculum Architecture:** Ensure syllabus hierarchies (Chapters -> Topics -> Lesson Plans) are created for all active subjects.
- **Syllabus Progress Reports (`/app/syllabus/reports`):**
  - Track real-time curriculum completion rates across batches.
  - Identify lagging subjects before term examinations commence.
  - Review teacher lesson logs and completion timestamps.

---

## 8. Examination Cycles & Result Publication (`/app/exams`)

The examination lifecycle is an administrative process requiring strict approval stages:

```
DRAFT -> SCHEDULED -> IN_PROGRESS -> COMPLETED -> EVALUATING -> RESULTS_PUBLISHED -> ARCHIVED
```

### 8.1 Exam Setup & Candidate Enrollment
1. Create exam at `/app/exams/new` (e.g., "Term 1 Final Examination 2026").
2. Define subjects, maximum marks, and passing criteria.
3. Enroll student cohorts directly from active batches.

### 8.2 Mark Verification & Publication
1. Monitor teacher mark entry progress in `/app/exams/[id]`.
2. Review verified marks; verify completeness across all subjects.
3. Click **Publish Results**:
   - Triggers `calculateAndPublishResultsAction`.
   - Freezes all student scores and generates permanent, immutable `ExamResultSnapshot` records.
   - Instantly publishes report cards to the **Student & Parent Portal** (`/portal`).

### 8.3 Post-Publication Mark Correction Governance
- Once published, marks cannot be directly edited.
- Any legitimate scoring correction requires the **Post-Publication Mark Correction Workflow** (`correctPublishedMarkAction`), requiring:
  - Administrative authorization.
  - Mandatory documented reason for change.
  - Creation of a new versioned snapshot while archiving the previous record in the audit log.

---

## 9. Financial & Fee Governance (`/app/fees`, `/app/billing`)

- **Fee Invoicing:** Oversee fee structures, term tuition billing, and transport charges.
- **Collection Monitoring:** Review daily fee collections, bank deposits, and outstanding balances.
- **Overdue Management:** Authorize automated SMS/Email payment reminders to parents with overdue accounts.
- **Institute Subscription (`/app/billing`):** Monitor the school's SaaS subscription, student seat consumption, and invoices issued by Knowletive.

---

## 10. Institute Settings, Branding & Audit Logs (`/app/settings`)

- **Branding & Profile:** Upload institute logo, school crest, official address, and receipt disclaimers.
- **Security Audit Trail:** Inspect internal audit logs to monitor staff logins, grade updates, and administrative deletions.
