# Knowletive SaaS — Front Desk & Admissions Guide

## Document Information
- **Title:** Front Desk Inquiries, CRM & Admissions Guide
- **Document ID:** DOC-06-FRONT-DESK-GUIDE
- **Target Audience:** Admissions Counselors, Front Desk Executives, Receptionists, Public Relations Officers
- **Classification:** Standard Operating Procedure (SOP)
- **Repository Location:** `docs/knowletive-functional-handbook/06-FRONT-DESK-AND-ADMISSIONS-GUIDE.md`

---

## Table of Contents
1. [Admissions CRM & Front Desk Role](#1-admissions-crm--front-desk-role)
2. [Login & Admissions Workspace (`/app/leads`)](#2-login--admissions-workspace-appleads)
3. [Capturing Inquiries & Walk-In Leads (`/app/leads/new`)](#3-capturing-inquiries--walk-in-leads-appleadsnew)
4. [Lead Pipeline Management & Follow-Up Lifecycle](#4-lead-pipeline-management--follow-up-lifecycle)
5. [Bulk Lead CSV Import & Duplicate Detection](#5-bulk-lead-csv-import--duplicate-detection)
6. [Lead Exporting (`/app/leads/export`)](#6-lead-exporting-appleadsexport)
7. [One-Click Student Admission Conversion](#7-one-click-student-admission-conversion)
8. [Managing Student & Parent Master Directories](#8-managing-student--parent-master-directories)
9. [Operational Boundaries & Security Controls](#9-operational-boundaries--security-controls)
10. [Admissions Best Practices & Troubleshooting](#10-admissions-best-practices--troubleshooting)

---

## 1. Admissions CRM & Front Desk Role

The **Front Desk Officer** manages the student recruitment pipeline. Responsibilities include handling initial telephone, web, and walk-in inquiries, qualifying prospective families, logging interaction histories, importing outreach lead lists, and converting successful inquiries into admitted students.

---

## 2. Login & Admissions Workspace (`/app/leads`)

- **Login URL:** `/login`
- **Credentials:** `frontdesk@sunrise.test` / `Admin@123`
- **Primary Landing Route:** `/app/leads`
- **Pipeline Status Tabs:**
  - **All Inquiries:** Master directory of all prospective applicants.
  - **New:** Fresh inquiries awaiting initial outreach.
  - **Contacted:** Counselor has reached out via phone/email.
  - **Qualified:** Family visited campus or met academic eligibility.
  - **Converted:** Successfully admitted into the school.
  - **Lost:** Family opted for another institution or declined admission.

---

## 3. Capturing Inquiries & Walk-In Leads (`/app/leads/new`)

When a parent calls or visits the campus:
1. Click **+ Add Lead** (`/app/leads/new`).
2. **Form Fields:**
   - **Student Full Name:** Prospective student's name.
   - **Grade Applied For:** Desired entry level (e.g., "Grade 10").
   - **Guardian Full Name:** Parent or primary contact.
   - **Guardian Phone & Email:** Essential communication channels.
   - **Lead Source:** Walk-in, Website, Referral, Social Media, Advertisement.
   - **Counselor Notes:** Student background, previous school, special interests.
3. Submit form to invoke `createLeadAction` in `src/actions/leads.ts`.

---

## 4. Lead Pipeline Management & Follow-Up Lifecycle

- Open a lead card (`/app/leads/[id]`) to view interaction history.
- **Log Follow-Up:** Record outcomes of counseling phone calls or campus visits.
- **Update Status:** Advance the lead from `NEW` -> `CONTACTED` -> `QUALIFIED`.

---

## 5. Bulk Lead CSV Import & Duplicate Detection

When importing leads from outreach campaigns or entrance exams:
1. Open **Leads** -> Click **Import CSV**.
2. **CSV Schema:**
   ```csv
   studentName,guardianName,guardianPhone,guardianEmail,gradeApplied,source,notes
   ```
3. **Engine Safeguards:**
   - Evaluates records against existing leads to detect duplicates using student name, phone, and email within the tenant.
   - Utilizes PostgreSQL transaction-level advisory locks to prevent concurrent bulk import collisions.
   - Invokes `bulkImportLeadsAction` in `src/actions/leads.ts`.

---

## 6. Lead Exporting (`/app/leads/export`)

- Counselors can export filtered lead lists for marketing analysis.
- Supports filtering by status, date range, or grade.
- Route: `/app/leads/export` (returns formatted CSV download with audit logging).

---

## 7. One-Click Student Admission Conversion

When a qualified lead decides to enroll:
1. Open the lead profile (`/app/leads/[id]`).
2. Click **Convert to Admission**.
3. **Conversion Modal:**
   - Verify student name and date of birth.
   - Assign permanent **Admission Number** (e.g., `ADM-2026-089`).
   - Assign initial **Batch** (e.g., "Grade 10 - Section A").
4. Click **Confirm Admission**:
   - Invokes `convertLeadAction` in `src/actions/leads.ts`.
   - **Atomic Transaction:**
     - Creates a permanent `Student` record.
     - Creates a permanent `Guardian` record.
     - Establishes a `GuardianLink` relationship.
     - Enrolls the student in the designated `Batch`.
     - Updates the `Lead` status to `CONVERTED`.

---

## 8. Managing Student & Parent Master Directories

- Front desk officers have read-write access to `/app/students` and `/app/parents` to update emergency contact details, home addresses, and phone numbers.

---

## 9. Operational Boundaries & Security Controls

- **Cannot Edit Exam Marks:** Strictly denied access to academic grading sheets.
- **Cannot Publish Results:** No exam administrative authority.
- **Cannot Alter Staff or System Settings:** Confined strictly to admissions and basic directory maintenance.

---

## 10. Admissions Best Practices & Troubleshooting

- **Duplicate Lead Alert:** If a lead with matching phone or email already exists, review the existing lead history before creating a duplicate entry.
- **Lost Lead Archival:** Always document the "Reason Lost" (e.g., "Fees too high", "Relocated to another city") to assist marketing intelligence.
