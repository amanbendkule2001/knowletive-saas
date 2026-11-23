# Knowletive SaaS — Complete Use-Case Catalogue

## Document Information
- **Title:** Master Use-Case & Edge-Case Functional Catalogue
- **Document ID:** DOC-12-USE-CASES
- **Target Audience:** QA Engineers, Product Managers, System Testers, Business Analysts
- **Classification:** Functional Testing & Use-Case Specification
- **Repository Location:** `docs/knowletive-functional-handbook/12-COMPLETE-USE-CASE-CATALOGUE.md`

---

## Table of Contents
1. [Catalogue Structure & Taxonomy](#1-catalogue-structure--taxonomy)
2. [Section 1: SaaS Provisioning & Tenant Operations (UC-01 to UC-03)](#2-section-1-saas-provisioning--tenant-operations-uc-01-to-uc-03)
3. [Section 2: Admissions & CRM Workflows (UC-04 to UC-07)](#3-section-2-admissions--crm-workflows-uc-04-to-uc-07)
4. [Section 3: Student & Guardian Lifecycle (UC-08 to UC-10)](#4-section-3-student--guardian-lifecycle-uc-08-to-uc-10)
5. [Section 4: Academic & Batch Scheduling (UC-11 to UC-13)](#5-section-4-academic--batch-scheduling-uc-11-to-uc-13)
6. [Section 5: SyllabusTrack Delivery (UC-14 to UC-16)](#6-section-5-syllabustrack-delivery-uc-14-to-uc-16)
7. [Section 6: Examination Lifecycle & Snapshots (UC-17 to UC-21)](#7-section-6-examination-lifecycle--snapshots-uc-17-to-uc-21)
8. [Section 7: Attendance Operations (UC-22 to UC-24)](#8-section-7-attendance-operations-uc-22-to-uc-24)
9. [Section 8: Fee Invoicing & Receipts (UC-25 to UC-28)](#9-section-8-fee-invoicing--receipts-uc-25-to-uc-28)
10. [Section 9: Security, RBAC & Portal Access (UC-29 to UC-32)](#10-section-9-security-rbac--portal-access-uc-29-to-uc-32)

---

## 1. Catalogue Structure & Taxonomy

Every use case is documented with:
- **Use Case ID & Title**
- **Module & Primary Role**
- **Preconditions & Trigger**
- **Normal Flow (Happy Path)**
- **Alternative & Exception Flows**
- **Expected Final State & Database Changes**
- **Relevant Server Actions**

---

## 2. Section 1: SaaS Provisioning & Tenant Operations

### UC-01: Provision New Client Institute
- **Module:** Platform Management
- **Role:** `PLATFORM_OWNER`
- **Preconditions:** Valid platform owner session at `/platform`.
- **Trigger:** Submitting "Add Institute" form.
- **Normal Flow:**
  1. Operator enters Institute Name ("Sunrise Academy"), Slug ("sunrise"), Contact Email, and initial Plan Tier.
  2. Submits form.
  3. System creates `Tenant`, `User`, `Membership`, and `Subscription`.
  4. Operator sees success notification; institute appears in directory.
- **Exception Flow (Duplicate Slug):**
  - If slug already exists, system displays: "An institute with this slug already exists." Transaction rolls back cleanly.
- **Database Changes:** Records inserted into `Tenant`, `User`, `Membership`, `Subscription`, `AuditLog`.
- **Server Action:** `createInstituteAction` in `src/actions/platform.ts`.

### UC-02: Suspend Institute Due to Non-Payment
- **Module:** Platform Management
- **Role:** `PLATFORM_OWNER`
- **Trigger:** Clicking "Suspend Institute" on tenant profile.
- **Normal Flow:** Status changes to `SUSPENDED`. All user sessions for that tenant are locked.
- **Database Changes:** `Tenant.status = "SUSPENDED"`.
- **Server Action:** `toggleInstituteStatusAction`.

---

## 3. Section 2: Admissions & CRM Workflows

### UC-04: Manual Lead Capture
- **Module:** Admissions & Leads
- **Role:** `FRONT_DESK`
- **Trigger:** Submitting lead form at `/app/leads/new`.
- **Normal Flow:** Enters student name, parent phone, email, and grade. System creates `Lead` with status `NEW`.
- **Server Action:** `createLeadAction` in `src/actions/leads.ts`.

### UC-05: Bulk CSV Lead Import with Duplicate Detection
- **Module:** Admissions & Leads
- **Role:** `FRONT_DESK`
- **Trigger:** Uploading CSV file in lead import modal.
- **Normal Flow:** 200 clean leads imported. Success summary displays: "200 leads imported successfully."
- **Alternative Flow (Duplicate Detection):**
  - If CSV contains phone/email matching an existing lead in the tenant, the row is flagged as duplicate and skipped or merged per user selection.
- **Concurrency Guard:** Protected by `pg_advisory_xact_lock` to prevent race conditions during parallel bulk uploads.
- **Server Action:** `bulkImportLeadsAction` in `src/actions/leads.ts`.

### UC-06: One-Click Lead to Admission Conversion
- **Module:** Admissions & Leads
- **Role:** `FRONT_DESK` / `INSTITUTE_ADMIN`
- **Trigger:** Clicking "Convert to Admission" in `/app/leads/[id]`.
- **Normal Flow:**
  1. Enters Admission Number and selects initial Batch.
  2. Clicks Confirm.
  3. Single atomic database transaction creates `Student`, `Guardian`, `GuardianLink`, and `BatchEnrollment`.
  4. `Lead.status` is updated to `CONVERTED`.
- **Server Action:** `convertLeadAction`.

---

## 4. Section 6: Examination Lifecycle & Snapshots

### UC-17: Create Term Examination
- **Module:** Exams
- **Role:** `PRINCIPAL` / `INSTITUTE_ADMIN`
- **Trigger:** Submitting form at `/app/exams/new`.
- **Normal Flow:** Defines exam title, start/end dates, subjects, maximum marks. Status set to `DRAFT`.
- **Server Action:** `createExaminationAction`.

### UC-18: Teacher Mark Entry & Draft Save
- **Module:** Exams
- **Role:** `TEACHER`
- **Trigger:** Entering marks in `/app/exams/[id]`.
- **Normal Flow:** Teacher enters scores between 0 and `maxMarks` or checks `isAbsent`. Clicks Save Draft.
- **Exception Flow (Score Exceeds Maximum):**
  - Teacher inputs 105 on a 100-mark paper.
  - Form validation blocks submission: "Mark cannot exceed maximum marks (100)."
- **Server Action:** `enterMarksBulkAction`.

### UC-19: Result Calculation & Snapshot Publication
- **Module:** Exams
- **Role:** `INSTITUTE_ADMIN` / `PRINCIPAL`
- **Trigger:** Clicking "Publish Results".
- **Normal Flow:**
  1. Validates that all mandatory subject marks are entered and verified.
  2. Calculates percentage, total score, and assigns letter grade per `GradingScale`.
  3. Creates immutable, frozen `ExamResultSnapshot` records.
  4. Sets `Examination.status = "RESULTS_PUBLISHED"`.
  5. Report cards become visible in `/portal`.
- **Server Action:** `calculateAndPublishResultsAction`.

### UC-20: Post-Publication Mark Correction
- **Module:** Exams
- **Role:** `INSTITUTE_ADMIN`
- **Trigger:** Submitting mark correction modal on published exam.
- **Normal Flow:**
  1. Admin selects student, subject, enters revised score and mandatory explanation note.
  2. System recalculates totals and creates a new versioned `ExamResultSnapshot` (version 2).
  3. Archives previous snapshot and logs event to `AuditLog`.
- **Server Action:** `correctPublishedMarkAction`.

---

## 5. Section 8: Fee Invoicing & Receipts

### UC-25: Generate Batch Fee Invoices
- **Module:** Fees & Finance
- **Role:** `ACCOUNTANT`
- **Trigger:** Generating term invoice for entire batch in `/app/fees/new`.
- **Normal Flow:** System generates individual `FeeInvoice` records with itemized line items for all active students in the batch.
- **Server Action:** `createFeeInvoiceAction`.

### UC-26: Record Partial Fee Payment
- **Module:** Fees & Finance
- **Role:** `ACCOUNTANT`
- **Trigger:** Recording $400 payment against $1,000 invoice.
- **Normal Flow:**
  - Creates `FeePayment` record.
  - Updates `FeeInvoice.paidAmount` to $400.
  - Status updates to `PARTIAL`.
  - Generates receipt voucher.
- **Server Action:** `recordFeePaymentAction`.

---

## 6. Section 9: Security, RBAC & Portal Access

### UC-29: Unauthorized Route Access Attempt
- **Role:** `TEACHER`
- **Trigger:** Manually typing `/app/billing` or `/platform` into browser.
- **Normal Flow:** System checks permissions via `requireTenantPermission("billing.read")`. Permission check fails. User is redirected to `/app` with a 403 Forbidden alert.

### UC-30: Student Portal Isolation
- **Role:** `STUDENT`
- **Trigger:** Attempting to view another student's report card via URL manipulation (`/portal/results/[other_id]`).
- **Normal Flow:** System verifies that `ExamResultSnapshot.studentId == activeSession.studentId`. Access is denied; displays 404/403.
