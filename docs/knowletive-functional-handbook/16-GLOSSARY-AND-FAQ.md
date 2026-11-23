# Knowletive SaaS — Glossary & Frequently Asked Questions (FAQ)

## Document Information
- **Title:** Educational SaaS Glossary & Master FAQ Guide
- **Document ID:** DOC-16-GLOSSARY-FAQ
- **Target Audience:** All Users, System Onboarders, Product Managers, Customer Support
- **Classification:** Educational & Reference Guide
- **Repository Location:** `docs/knowletive-functional-handbook/16-GLOSSARY-AND-FAQ.md`

---

## Table of Contents
1. [Educational & SaaS Domain Glossary](#1-educational--saas-domain-glossary)
2. [General Platform & Account FAQs](#2-general-platform--account-faqs)
3. [Admissions & CRM FAQs](#3-admissions--crm-faqs)
4. [Academic & Batch Management FAQs](#4-academic--batch-management-faqs)
5. [SyllabusTrack Curriculum FAQs](#5-syllabustrack-curriculum-faqs)
6. [Examination & Report Card FAQs](#6-examination--report-card-faqs)
7. [Attendance & Roll Call FAQs](#7-attendance--roll-call-faqs)
8. [Fee Billing & Payment FAQs](#8-fee-billing--payment-faqs)
9. [Student & Parent Portal FAQs](#9-student--parent-portal-faqs)
10. [Technical, Security & Billing FAQs](#10-technical-security--billing-faqs)

---

## 1. Educational & SaaS Domain Glossary

- **Tenant:** A subscriber educational institution (e.g. "Sunrise Academy") operating within an isolated logical partition of the SaaS database.
- **Academic Year:** The formal operating term of an educational institution (e.g. "2026-2027"). Only one academic year is active per tenant at any given time.
- **Class (Grade):** The standard academic level (e.g. "Grade 10").
- **Section:** A division within a grade level (e.g. "Section A").
- **Batch:** The scheduled classroom operational unit binding a Class, Section, Academic Year, enrolled students, and assigned faculty.
- **SyllabusTrack:** Knowletive's curriculum delivery module organizing subject syllabi into Chapters, Topics, and Lesson Plans with progress tracking.
- **Exam Result Snapshot:** A certified, immutable data record frozen at the moment an administrator publishes examination results, preventing subsequent edits from altering official transcripts.
- **Grading Scale:** A configurable matrix of percentage ranges mapped to letter grades (e.g. 90-100% = A+).
- **Lead Pipeline:** Inbound prospective student inquiries categorized into stages (`NEW`, `CONTACTED`, `QUALIFIED`, `CONVERTED`, `LOST`).
- **One-Click Admission Conversion:** The atomic database workflow transforming a CRM lead into a permanent student record, guardian record, and batch enrollment.
- **RBAC (Role-Based Access Control):** Security mechanism granting permissions based on user roles across Platform and Tenant scopes.

---

## 2. General Platform & Account FAQs

### Q1: How do I sign in to Knowletive?
Visit `/login`, enter your registered work or school email and password, and click **Sign in**. The system automatically detects your role and directs you to the appropriate environment (`/platform`, `/app`, or `/portal`).

### Q2: What happens if I forget my password?
Click **Need help?** on the login page to initiate password recovery. You will receive an email containing a secure, single-use password reset link.

### Q3: What is the difference between Platform Owner and Institute Admin?
- **Platform Owner:** SaaS superuser managing all subscriber institutes, subscription pricing, and global platform infrastructure.
- **Institute Admin:** School manager managing day-to-day operations, faculty, students, and finances for a single institution.

---

## 3. Admissions & CRM FAQs

### Q4: How does the system prevent duplicate leads during CSV import?
Knowletive validates inbound rows against existing leads in the tenant using student name, guardian phone, and email, utilizing PostgreSQL transaction-level locks to prevent collisions.

### Q5: What happens when a lead is converted?
The system creates a `Student` record, a `Guardian` record, establishes a `GuardianLink`, enrolls the student in a `Batch`, and transitions the lead status to `CONVERTED` in a single atomic transaction.

---

## 4. Academic & Batch Management FAQs

### Q6: Can a student belong to more than one batch simultaneously?
By default, a student is enrolled in one primary classroom batch per academic year, but the architecture supports multiple subject-specific batch enrollments if configured.

### Q7: What happens when I transfer a student between batches?
Using the **Transfer Student** action moves the student from Section A to Section B while preserving their historical attendance records and examination marks.

---

## 5. Examination & Report Card FAQs

### Q8: Can a teacher edit marks after an exam is published?
No. Once results are published, the examination is locked. Any corrections require the administrator to execute the audited **Mark Correction Workflow**, which generates a new versioned snapshot and logs the change reason.

### Q9: Can an examination with published results be deleted?
No. Knowletive enforces strict academic transcript preservation; exams with published snapshots cannot be deleted.

---

## 6. Fee Billing & Payment FAQs

### Q10: Does the system support partial fee payments?
Yes. An accountant can record partial payments (e.g. $400 against a $1,000 invoice). The invoice status updates to `PARTIAL` and reflects the remaining balance.

### Q11: Can a parent pay fees online?
Parents can view invoices and receipts in `/portal`. If digital payment gateways are enabled, parents can settle balances online directly.
