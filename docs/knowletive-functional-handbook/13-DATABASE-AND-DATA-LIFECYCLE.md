# Knowletive SaaS — Database Architecture & Data Lifecycle

## Document Information
- **Title:** Comprehensive Database Architecture, Model Dictionary & Lifecycle Manual
- **Document ID:** DOC-13-DATA-LIFECYCLE
- **Target Audience:** Database Administrators, Backend Engineers, System Architects, Compliance Auditors
- **Classification:** Data Architecture & Persistence Specification
- **Repository Location:** `docs/knowletive-functional-handbook/13-DATABASE-AND-DATA-LIFECYCLE.md`

---

## Table of Contents
1. [Database Engine & Architectural Principles](#1-database-engine--architectural-principles)
2. [Multi-Tenant Data Partitioning & Isolation](#2-multi-tenant-data-partitioning--isolation)
3. [Prisma Schema Model Dictionary (54 Models)](#3-prisma-schema-model-dictionary-54-models)
   - [3.1 Multi-Tenancy & Platform Domain](#31-multi-tenancy--platform-domain)
   - [3.2 Identity, Authentication & RBAC Domain](#32-identity-authentication--rbac-domain)
   - [3.3 Academic Master Domain](#33-academic-master-domain)
   - [3.4 Student, Guardian & CRM Domain](#34-student-guardian--crm-domain)
   - [3.5 Batch & Classroom Operations Domain](#35-batch--classroom-operations-domain)
   - [3.6 SyllabusTrack Curriculum Domain](#36-syllabustrack-curriculum-domain)
   - [3.7 Examination & Evaluation Lifecycle Domain](#37-examination--evaluation-lifecycle-domain)
   - [3.8 Attendance & Daily Operations Domain](#38-attendance--daily-operations-domain)
   - [3.9 Fee Collection & Financial Domain](#39-fee-collection--financial-domain)
   - [3.10 AI Telemetry & Metering Domain](#310-ai-telemetry--metering-domain)
4. [Entity Relationship Topography](#4-entity-relationship-topography)
5. [State Transitions & Lifecycle Rules](#5-state-transitions--lifecycle-rules)
6. [PostgreSQL Concurrency Controls & Advisory Locks](#6-postgresql-concurrency-controls--advisory-locks)
7. [Referential Integrity, Cascade Deletes & Archival Safeguards](#7-referential-integrity-cascade-deletes--archival-safeguards)

---

## 1. Database Engine & Architectural Principles

Knowletive SaaS utilizes **PostgreSQL 16** managed via **Prisma ORM 6.4**. The database schema is designed around core architectural tenets:
1. **Strict Logical Isolation:** Every business entity belongs to a `Tenant` via a mandatory foreign key `tenantId`.
2. **ACID Transactions:** High-stakes operations (such as lead-to-student conversions, exam result snapshotting, and fee payments) execute inside atomic database transactions (`prisma.$transaction`).
3. **Immutability of Historical Snapshots:** Certified term examination results are permanently frozen in `ExamResultSnapshot` records, insulating historical report cards from subsequent class, batch, or mark edits.
4. **Audit Immutability:** Sensitive operational changes write append-only records to `AuditLog` and `PlatformAuditLog`.

---

## 2. Multi-Tenant Data Partitioning & Isolation

In Knowletive's shared-database, shared-schema multi-tenancy model:
- All tenant tables include indexed `tenantId` columns: `@@index([tenantId])`.
- Composite indexes enforce tenant-scoped uniqueness:
  - `@@unique([tenantId, admissionNumber])` on `Student`.
  - `@@unique([tenantId, studentName, guardianPhone])` on `Lead`.
  - `@@unique([tenantId, name])` on `Class`, `Batch`, and `AcademicYear`.
- All Prisma query invocations in server actions and API handlers bind `where: { tenantId }`, guaranteeing zero cross-tenant leakage.

---

## 3. Prisma Schema Model Dictionary (54 Models)

### 3.1 Multi-Tenancy & Platform Domain
1. **`Tenant`**: Represents an educational institute subscriber. Holds institute name, slug, domain, contact details, currency, and operational status (`ACTIVE`, `SUSPENDED`).
2. **`TenantDomain`**: Custom domain mapping records for white-label access.
3. **`Plan`**: SaaS subscription tiers (Core, Growth, Scale) with billing intervals, student limits, and pricing.
4. **`PlanFeature`**: Modular feature toggles tied to plans.
5. **`Subscription`**: Active SaaS subscription linking a `Tenant` to a `Plan` with billing period timestamps and status (`ACTIVE`, `PAST_DUE`, `CANCELLED`).
6. **`Invoice`**: Platform-level SaaS invoices billed to institutes.
7. **`InvoiceLineItem`**: Line items on SaaS invoices.
8. **`Payment`**: Platform subscription payment transaction records.
9. **`RateLimitBucket`**: Sliding-window rate limiting tracking client IPs and login attempts to prevent brute-force attacks.
10. **`PlatformRole`**: Custom roles defined at the SaaS platform level.
11. **`PlatformRolePermission`**: Granular permission bindings for platform roles.
12. **`PlatformAuditLog`**: System-wide audit stream for platform owner operations.

### 3.2 Identity, Authentication & RBAC Domain
13. **`User`**: Master credential account holding email, password hash, `isPlatformOwner` flag, and account status.
14. **`Membership`**: Binds a `User` to a `Tenant` with a specific `Role`.
15. **`Role`**: Tenant-level role entity (`INSTITUTE_ADMIN`, `TEACHER`, `ACCOUNTANT`, `FRONT_DESK`, `PRINCIPAL`, or custom).
16. **`RolePermission`**: Permission strings mapped to tenant roles.
17. **`Session`**: Active HTTP session tokens with expiration timestamps.
18. **`PasswordResetToken`**: Expiring one-time cryptographic tokens for password recovery.
19. **`AuditLog`**: Tenant-scoped immutable audit trail recording user, action, target entity, and state changes.

### 3.3 Academic Master Domain
20. **`AcademicYear`**: Academic term periods (e.g. 2026-2027) with an active flag.
21. **`Class`**: Grade level or standard (e.g. Grade 10).
22. **`Section`**: Classroom division (e.g. Section A).
23. **`Subject`**: Academic subjects taught within a class.

### 3.4 Student, Guardian & CRM Domain
24. **`Student`**: Enrolled learner master record (Admission number, roll number, DOB, gender).
25. **`Guardian`**: Parent or legal guardian profile (Name, phone, email, address).
26. **`GuardianLink`**: Pivot table linking students to guardians with relationship type (Father, Mother, Legal Guardian) and primary contact flag.
27. **`Lead`**: Prospective student inquiry in admissions CRM (Pipeline status: `NEW`, `CONTACTED`, `QUALIFIED`, `CONVERTED`, `LOST`).
28. **`LeadTimeline`**: Interaction history and counselor follow-up notes.

### 3.5 Batch & Classroom Operations Domain
29. **`Batch`**: Scheduled classroom group combining Class, Section, Academic Year, and room capacity.
30. **`BatchEnrollment`**: Junction table linking students to batches.
31. **`BatchTeacher`**: Junction table allocating faculty members to batches by subject.
32. **`BatchTimetable`**: Weekly scheduling matrix for batches.

### 3.6 SyllabusTrack Curriculum Domain
33. **`Chapter`**: Major curriculum unit under a subject.
34. **`Topic`**: Individual lesson topic within a chapter.
35. **`LessonPlan`**: Pedagogical guide containing learning objectives and homework.
36. **`SyllabusProgress`**: Teacher delivery logs recording topic completion dates and batch teaching notes.

### 3.7 Examination & Evaluation Lifecycle Domain
37. **`Examination`**: Formal term exam entity (Status: `DRAFT`, `SCHEDULED`, `IN_PROGRESS`, `EVALUATING`, `RESULTS_PUBLISHED`, `ARCHIVED`).
38. **`ExamSubject`**: Subject paper under an exam with maximum marks, passing marks, and exam date.
39. **`ExamEnrollment`**: Eligible candidate students registered for an exam.
40. **`ExamMark`**: Raw marks entered by teachers per student per subject, with verification flags.
41. **`GradingScale`**: Grading system definition (e.g. Standard CBSE, Percentage 10-point scale).
42. **`GradingScaleTier`**: Grade cutoffs (e.g. A+: 90-100%, A: 80-89%).
43. **`ExamResultSnapshot`**: Certified, immutable published report card snapshot frozen at publication time, including total marks, percentage, letter grade, and version number.
44. **`ExamResultSnapshotSubject`**: Itemized subject score rows frozen within a result snapshot.

### 3.8 Attendance & Daily Operations Domain
45. **`AttendanceRecord`**: Daily student roll call entry (Date, Student, Batch, Status: `PRESENT`, `ABSENT`, `LATE`, `EXCUSED`, Remarks).
46. **`Announcement`**: Campus circular broadcasted by staff.
47. **`AnnouncementTarget`**: Target audience bindings (All, Staff, Students, Parents, or specific batch).

### 3.9 Fee Collection & Financial Domain
48. **`FeeInvoice`**: Financial bill issued to a student (Total amount, paid amount, due date, status: `PENDING`, `PARTIAL`, `PAID`, `CANCELLED`).
49. **`FeeLineItem`**: Itemized billing components (Tuition, Lab, Transport).
50. **`FeePayment`**: Payment transaction record (Amount, method: Cash, Card, Bank, UPI, receipt voucher number).
51. **`FeeDiscount`**: Approved fee concessions or scholarship adjustments.

### 3.10 AI Telemetry & Metering Domain
52. **`AiUsageLog`**: Records every generative AI call (Gemini API tokens consumed, model, prompt category, caller ID).
53. **`NotificationLog`**: Audit records of outbound SMS and email notifications.
54. **`SystemConfig`**: Global platform environment variables and runtime settings.

---

## 4. Entity Relationship Topography

```
Tenant
  ├── AcademicYear ── Class ── Section ── Batch
  │                                         ├── BatchEnrollment ── Student
  │                                         └── BatchTeacher ──── User (Teacher)
  ├── Subject ── Chapter ── Topic ── LessonPlan
  │               └── SyllabusProgress
  ├── Examination ── ExamSubject ── ExamMark
  │     ├── ExamEnrollment
  │     └── ExamResultSnapshot ── ExamResultSnapshotSubject
  ├── Student ── GuardianLink ── Guardian
  │     ├── FeeInvoice ── FeeLineItem
  │     │     └── FeePayment
  │     └── AttendanceRecord
  └── Lead ── LeadTimeline
```

---

## 5. State Transitions & Lifecycle Rules

### Examination Lifecycle State Machine
```
[DRAFT] ──> [SCHEDULED] ──> [IN_PROGRESS] ──> [EVALUATING] ──> [RESULTS_PUBLISHED] ──> [ARCHIVED]
```
- **DRAFT:** Exam structure and subjects defined. Cannot enter marks.
- **SCHEDULED:** Dates and candidate enrollment locked.
- **IN_PROGRESS:** Examination currently being administered.
- **EVALUATING:** Teachers entering marks; verified by academic lead.
- **RESULTS_PUBLISHED:** Results calculated; immutable snapshots written; visible in student/parent portal. Permanent deletion is strictly prohibited once snapshots exist.

### Fee Invoice State Machine
```
[PENDING] ──(partial payment)──> [PARTIAL] ──(full payment)──> [PAID]
    │
    └──(no payments received)──> [CANCELLED]
```

---

## 6. PostgreSQL Concurrency Controls & Advisory Locks

To guarantee database integrity under heavy concurrent load:
- **Leads Bulk CSV Import:** Evaluates duplicate checks inside a transaction protected by `pg_advisory_xact_lock(hashtext('leads_import_' || tenantId))`. Concurrent import requests on the same tenant queue sequentially, preventing duplicate lead insertions.
- **Result Publication:** Runs within a repeatable-read transaction, preventing race conditions if a teacher attempts to edit marks while an administrator is publishing snapshots.

---

## 7. Referential Integrity, Cascade Deletes & Archival Safeguards

- **Restricted Deletions:** Deleting an `AcademicYear`, `Class`, or `Batch` is rejected if active student enrollments exist.
- **Exam Protection Guard:** In `deleteExaminationAction`, deletion is rejected if historical `ExamResult` or `ExamResultSnapshot` records exist, preserving academic transcripts.
