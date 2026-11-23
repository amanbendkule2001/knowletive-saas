# Knowletive SaaS — Database Schema & Data Architecture Audit

**Document Version:** 1.0.0  
**Audit Date:** November 18, 2026  
**Auditor:** Senior PostgreSQL Database Architect & SaaS Security Auditor  
**Repository Working Directory:** `D:\IT\Saas`  
**Schema Definition File:** [`prisma/schema.prisma`](file:///D:/IT/Saas/prisma/schema.prisma) (1,743 lines)  
**Database Engine:** PostgreSQL 18-alpine  

---

## 1. Schema Overview & Relational Topology

The database architecture is designed with **61 normalized relational models** and **19 PostgreSQL enums**. It enforces strong referential integrity, optimistic concurrency versioning, row-level multi-tenant foreign keys, and immutable audit trails backed by PostgreSQL database engine triggers.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CORE IDENTITY & TENANCY                         │
│  User ──────1:N─────► Session                                          │
│   │                                                                    │
│   ├─────────1:N─────► Membership ◄──────1:N────── Tenant               │
│   │                        │                         │                 │
│   │                        ▼                         ▼                 │
│   │                      Role ◄──── RolePermission ── Permission       │
│   │                                                                    │
│   ├─────────1:1─────► Student (optional userId link)                   │
│   └─────────1:1─────► Guardian (optional userId link)                  │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      TENANT OPERATIONAL DOMAINS                        │
│                                                                        │
│  [Admissions CRM]                                                      │
│  Tenant ────1:N───► Lead ───1:N───► LeadActivity                       │
│                       │                                                │
│                       └──── 1:1 (Conversion) ────► Student             │
│                                                      │                 │
│  [Academics & Batches]                               │                 │
│  Tenant ────1:N───► AcademicYear                     │                 │
│  Tenant ────1:N───► ClassLevel ──1:N──► Section      │                 │
│  Tenant ────1:N───► Subject                          │                 │
│  Tenant ────1:N───► Batch ────1:N──► BatchStudent ───┘                 │
│                       │                                                │
│                       ├───────1:N──► BatchTeacher                      │
│                       └───────1:N──► BatchEnrollmentEvent (Immutable)  │
│                                                                        │
│  [Curriculum Tracking]                                                 │
│  Tenant ────1:N───► SyllabusTrack                                      │
│                       ├──1:N──► SyllabusChapter ──1:N──► SyllabusTopic │
│                       ├──1:N──► LessonPlan                             │
│                       ├──1:N──► TopicProgress                          │
│                       └──1:N──► SyllabusProgressEvent (Immutable)      │
│                                                                        │
│  [Examinations]                                                        │
│  Tenant ────1:N───► Examination ──1:N──► ExamSubject                   │
│                       ├──1:N──► ExamEnrollment                         │
│                       ├──1:N──► ExamMark ──1:N──► ExamMarksRevision    │
│                       └──1:N──► ExamResult ──1:N──► ExamResultSnapshot │
│                                                                        │
│  [Daily Attendance]                                                    │
│  Tenant ────1:N───► Attendance (Unique on studentId + date)            │
│                                                                        │
│  [Financial Accounting Ledger]                                         │
│  Tenant ────1:N───► FeeInvoice ───1:N──► PaymentAllocation             │
│                       ▲                         │                      │
│                       │                         ▼                      │
│  Tenant ────1:N───► PaymentReceipt ──1:1──► PaymentReceiptBalance      │
│                       │                         │                      │
│                       ├───────1:N──► CreditTransferJournal             │
│                       └───────1:N──► CreditTransferPosting             │
│                                                                        │
│  [Commercial SaaS & Platform]                                          │
│  Tenant ────1:1───► TenantSubscription ◄──1:N── Plan                   │
│  Tenant ────1:N───► Invoice ──1:N──► Payment                           │
│  Tenant ────1:N───► TenantUsage                                        │
│  Tenant ────1:N───► AiJob                                              │
│  Tenant ────1:N───► AuditLog (Immutable)                               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Comprehensive Model & Table Inventory

### 2.1 Identity & Access Control (8 Models)

| Model Name | Table Name | Key Fields & Constraints | Description |
| :--- | :--- | :--- | :--- |
| `User` | `"User"` | `id` (PK, cuid), `email` (Unique), `passwordHash`, `status` (`ACTIVE`, `INVITED`, `SUSPENDED`), `isPlatformOwner` (Boolean), `platformRoleId` (FK), `twoFactorEnabled`, `twoFactorSecret`, `failedLoginAttempts`, `lockedUntil` | Central authentication identity across the platform. |
| `Session` | `"Session"` | `id` (PK), `tokenHash` (Unique, SHA-256), `userId` (FK), `expiresAt`, `revokedAt`, `ip`, `userAgent` | DB-backed active user sessions with token hashing. |
| `PasswordResetToken` | `"PasswordResetToken"` | `id` (PK), `tokenHash` (Unique), `userId` (FK), `expiresAt`, `usedAt` | Password reset tokens with 1-hour expiration. |
| `Tenant` | `"Tenant"` | `id` (PK), `name`, `slug` (Unique), `type` (`SCHOOL`, `COLLEGE`, `COACHING`), `status` (`TRIAL`, `ACTIVE`, `SUSPENDED`, `CHURNED`), `timezone`, `currency`, `trialEndsAt` | Customer organization workspace root. |
| `Membership` | `"Membership"` | `id` (PK), `tenantId` (FK), `userId` (FK), `roleId` (FK), `isOwner` (Boolean), `extraPermissions` (String[]), `denyPermissions` (String[]), `@@unique([tenantId, userId])` | User affiliation to an institute with role and overrides. |
| `Role` | `"Role"` | `id` (PK), `scope` (`PLATFORM`, `TENANT`), `tenantId` (FK, nullable), `key`, `name`, `isSystem` (Boolean), `@@unique([tenantId, key])` | RBAC role definitions (system templates and custom roles). |
| `Permission` | `"Permission"` | `key` (PK, e.g. `tenant.exams.write`), `group`, `label`, `scope` | Canonical dictionary of all platform and tenant permissions. |
| `RolePermission` | `"RolePermission"` | `roleId` (FK), `permissionKey` (FK), `@@id([roleId, permissionKey])` | Join table binding permissions to roles. |

### 2.2 Commercial SaaS & Platform Billing (5 Models)

| Model Name | Table Name | Key Fields & Constraints | Description |
| :--- | :--- | :--- | :--- |
| `Plan` | `"Plan"` | `id` (PK), `key` (Unique), `name`, `priceMonthly`, `priceYearly`, `maxStudents`, `maxStaff`, `maxStorageMb`, `aiCreditsMonthly`, `features` (String[]), `trialDays` | SaaS subscription plans and entitlement thresholds. |
| `TenantSubscription` | `"TenantSubscription"` | `id` (PK), `tenantId` (FK, Unique), `planId` (FK), `status` (`TRIALING`, `ACTIVE`, `PAST_DUE`, `PAUSED`, `CANCELED`, `EXPIRED`), `billingCycle`, `currentPeriodEnd`, `trialEndsAt` | Tenant's current commercial subscription state. |
| `Invoice` | `"Invoice"` | `id` (PK), `number` (Unique), `tenantId` (FK), `subscriptionId` (FK), `status` (`DRAFT`, `OPEN`, `PAID`, `VOID`), `subtotal`, `tax`, `total`, `dueAt`, `paidAt` | Platform billing invoices issued to tenants. |
| `Payment` | `"Payment"` | `id` (PK), `tenantId` (FK), `invoiceId` (FK), `amount`, `status` (`PENDING`, `SUCCEEDED`, `FAILED`, `REFUNDED`), `provider`, `providerRef` | Tenant subscription payment transactions. |
| `TenantUsage` | `"TenantUsage"` | `id` (PK), `tenantId` (FK), `periodStart`, `aiCreditsUsed`, `aiCreditsLimit`, `storageBytes`, `@@unique([tenantId, periodStart])` | Monthly tenant resource and AI credit consumption meter. |

### 2.3 Students, Guardians & Stakeholders (3 Models)

| Model Name | Table Name | Key Fields & Constraints | Description |
| :--- | :--- | :--- | :--- |
| `Student` | `"Student"` | `id` (PK), `tenantId` (FK), `userId` (FK, Unique, Nullable), `admissionNo`, `firstName`, `lastName`, `email`, `phone`, `dob`, `gender`, `bloodGroup`, `status` (`ACTIVE`, `INACTIVE`, `ALUMNI`), `classId` (FK), `sectionId` (FK), `@@unique([tenantId, id])`, `@@unique([tenantId, admissionNo])` | Enrolled student record. May link to User for student portal. |
| `Guardian` | `"Guardian"` | `id` (PK), `tenantId` (FK), `userId` (FK, Nullable), `name`, `email`, `phone`, `relation`, `occupation` | Parent/guardian record. May link to User for parent portal. |
| `StudentGuardian` | `"StudentGuardian"` | `studentId` (FK), `guardianId` (FK), `isPrimary` (Boolean), `@@id([studentId, guardianId])` | Many-to-many link between students and guardians. |

### 2.4 Academics & Attendance (5 Models)

| Model Name | Table Name | Key Fields & Constraints | Description |
| :--- | :--- | :--- | :--- |
| `AcademicYear` | `"AcademicYear"` | `id` (PK), `tenantId` (FK), `name`, `startDate`, `endDate`, `isActive`, `@@unique([tenantId, name])` | Institutional calendar sessions. |
| `ClassLevel` | `"ClassLevel"` | `id` (PK), `tenantId` (FK), `name`, `order`, `@@unique([tenantId, name])` | Grades/standards (e.g. "Grade 10"). |
| `Section` | `"Section"` | `id` (PK), `tenantId` (FK), `classId` (FK), `name`, `capacity`, `classTeacherId` (FK), `@@unique([classId, name])` | Classroom divisions (e.g. "Section A"). |
| `Subject` | `"Subject"` | `id` (PK), `tenantId` (FK), `classId` (FK, Nullable), `name`, `code`, `teacherId` (FK) | Academic curriculum subjects. |
| `Attendance` | `"Attendance"` | `id` (PK), `tenantId` (FK), `studentId` (FK), `date` (Date), `status` (`PRESENT`, `ABSENT`, `LATE`, `EXCUSED`), `note`, `markedById` (FK), `@@unique([studentId, date])` | Daily attendance register entries. |

### 2.5 Batches & Cohorts (4 Models)

| Model Name | Table Name | Key Fields & Constraints | Description |
| :--- | :--- | :--- | :--- |
| `Batch` | `"Batch"` | `id` (PK), `tenantId` (FK), `academicYearId` (FK), `subjectId` (FK, Nullable), `name`, `code`, `capacity`, `status` (`DRAFT`, `ACTIVE`, `COMPLETED`, `ARCHIVED`), `@@unique([tenantId, code])` | Special cohorts and coaching batches. |
| `BatchTeacher` | `"BatchTeacher"` | `id` (PK), `batchId` (FK), `teacherId` (FK), `isPrimary`, `@@unique([batchId, teacherId])` | Faculty assigned to batches. |
| `BatchStudent` | `"BatchStudent"` | `id` (PK), `batchId` (FK), `studentId` (FK), `status` (`ACTIVE`, `DROPPED`, `COMPLETED`, `TRANSFERRED`), `enrolledAt`, `droppedAt`, `dropReason`, `@@unique([batchId, studentId])` | Student batch enrollment state. |
| `BatchEnrollmentEvent` | `"BatchEnrollmentEvent"` | `id` (PK), `batchId` (FK), `studentId` (FK), `eventType` (`ENROLLED`, `DROPPED`, `RE_ENROLLED`, `TRANSFERRED`, `COMPLETED`), `fromBatchId`, `toBatchId`, `effectiveDate`, `reason`, `createdAt` | Immutable log of batch enrollment changes (guarded by DB trigger). |

### 2.6 SyllabusTrack Curriculum System (7 Models)

| Model Name | Table Name | Key Fields & Constraints | Description |
| :--- | :--- | :--- | :--- |
| `SyllabusTrack` | `"SyllabusTrack"` | `id` (PK), `tenantId` (FK), `academicYearId` (FK), `subjectId` (FK), `targetType` (`CLASS_SECTION`, `BATCH`), `classId`, `sectionId`, `batchId`, `name`, `code`, `status` (`DRAFT`, `ACTIVE`, `COMPLETED`, `ARCHIVED`), `@@unique([tenantId, code])` | Curriculum progress tracking header. |
| `SyllabusTeacher` | `"SyllabusTeacher"` | `id` (PK), `syllabusId` (FK), `teacherId` (FK), `isPrimary`, `@@unique([syllabusId, teacherId])` | Teachers responsible for track delivery. |
| `SyllabusChapter` | `"SyllabusChapter"` | `id` (PK), `tenantId` (FK), `syllabusId` (FK), `title`, `order`, `estimatedHours`, `@@unique([syllabusId, order])` | Chapters within a syllabus track. |
| `SyllabusTopic` | `"SyllabusTopic"` | `id` (PK), `tenantId` (FK), `syllabusId` (FK), `chapterId` (FK), `title`, `order`, `status` (`NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED`), `@@unique([chapterId, order])` | Granular curriculum topics. |
| `LessonPlan` | `"LessonPlan"` | `id` (PK), `tenantId` (FK), `syllabusId` (FK), `chapterId` (FK), `topicId` (FK), `teacherId` (FK), `title`, `objectives`, `methodology`, `plannedDate`, `status` (`DRAFT`, `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`) | Teacher pedagogical lesson plans. |
| `TopicProgress` | `"TopicProgress"` | `id` (PK), `tenantId` (FK), `syllabusId` (FK), `topicId` (FK, Unique), `status`, `completedHours`, `notes`, `@@unique([syllabusId, topicId])` | Live topic completion state. |
| `SyllabusProgressEvent`| `"SyllabusProgressEvent"` | `id` (PK), `tenantId` (FK), `syllabusId` (FK), `topicId` (FK), `previousStatus`, `newStatus`, `remarks`, `createdAt` | Immutable progress modification log (guarded by DB trigger). |

### 2.7 Examination & Evaluation System (9 Models)

| Model Name | Table Name | Key Fields & Constraints | Description |
| :--- | :--- | :--- | :--- |
| `GradeScale` | `"GradeScale"` | `id` (PK), `tenantId` (FK), `name`, `code`, `isDefault`, `isSystem`, `@@unique([tenantId, code])` | Institutional grading frameworks (e.g. CBSE 10-point, GPA 4.0). |
| `GradeBand` | `"GradeBand"` | `id` (PK), `tenantId` (FK), `scaleId` (FK), `letterGrade`, `gradePoint`, `minPercentage`, `maxPercentage`, `isPassing`, `@@unique([scaleId, letterGrade])` | Percentage boundaries and grade letters. |
| `Examination` | `"Examination"` | `id` (PK), `tenantId` (FK), `academicYearId` (FK), `gradeScaleId` (FK), `syllabusTrackId` (FK, Nullable), `targetType` (`CLASS_SECTION`, `BATCH`), `classId`, `sectionId`, `batchId`, `title`, `code`, `examType` (`UNIT_TEST`, `MID_TERM`, `FINAL`, `MOCK_TEST`, `PRACTICAL`, `ASSIGNMENT`, `CUSTOM`), `status` (`DRAFT`, `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `EVALUATED`, `PUBLISHED`, `ARCHIVED`), `isPublished`, `publishedAt`, `createdById` (FK), `@@unique([tenantId, code])` | Exam lifecycle management header. |
| `ExamSubject` | `"ExamSubject"` | `id` (PK), `tenantId` (FK), `examId` (FK), `subjectId` (FK), `examDate`, `maxMarks`, `passingMarks`, `weightage`, `order`, `@@unique([examId, subjectId])` | Papers/subjects evaluated in an exam. |
| `ExamEnrollment` | `"ExamEnrollment"` | `id` (PK), `tenantId` (FK), `examId` (FK), `studentId` (FK), `rollNumber`, `status` (`REGISTERED`, `ELIGIBLE`, `ABSENT`, `EXEMPTED`, `WITHDRAWN`), `preservedMarks` (Json), `@@unique([examId, studentId])` | Candidate registration in an exam. |
| `ExamMark` | `"ExamMark"` | `id` (PK), `tenantId` (FK), `examId` (FK), `examSubjectId` (FK), `studentId` (FK), `enrollmentId` (FK), `marksObtained` (Float), `isAbsent`, `isExempted`, `evaluationStatus` (`PENDING`, `DRAFT`, `SUBMITTED`, `VERIFIED`), `version` (Int), `enteredById` (FK), `verifiedById` (FK), `@@unique([examSubjectId, studentId])` | Raw evaluated subject marks per candidate. |
| `ExamResult` | `"ExamResult"` | `id` (PK), `tenantId` (FK), `examId` (FK), `studentId` (FK), `enrollmentId` (FK, Unique), `totalMaxMarks`, `totalMarksObtained`, `percentage`, `grade`, `gradePoint`, `rank`, `processingStatus` (`DRAFT`, `COMPUTED`, `VERIFIED`, `PUBLISHED`), `resultStatus` (`PASS`, `FAIL`, `WITHHELD`, `EXPELLED`), `passedSubjectsCount`, `failedSubjectsCount`, `@@unique([examId, studentId])` | Authoritative consolidated student results. |
| `ExamResultSnapshot`| `"ExamResultSnapshot"`| `id` (PK), `tenantId` (FK), `examId` (FK), `studentId` (FK), `resultId` (FK), `version` (Int), `snapshotData` (Json), `checksum` (String, SHA-256), `generatedAt`, `@@unique([resultId, version])` | Cryptographic SHA-256 report card snapshots (guarded by DB trigger). |
| `ExamMarksRevisionEvent` | `"ExamMarksRevisionEvent"` | `id` (PK), `tenantId` (FK), `examId` (FK), `examSubjectId` (FK), `studentId` (FK), `markId` (FK), `oldMarks`, `newMarks`, `reason`, `createdAt` | Immutable revision log for marks modified post-evaluation (guarded by DB trigger). |

### 2.8 Core Financial Ledger & Fees (10 Models)

| Model Name | Table Name | Key Fields & Constraints | Description |
| :--- | :--- | :--- | :--- |
| `FeeInvoice` | `"FeeInvoice"` | `id` (PK), `tenantId` (FK), `studentId` (FK), `number`, `title`, `amount` (paise), `paidAmount` (paise), `status` (`PENDING`, `PARTIAL`, `PAID`, `OVERDUE`, `WAIVED`), `dueDate`, `@@unique([tenantId, id])`, `@@unique([tenantId, number])` | Student institutional fee bills. |
| `FeePayment` | `"FeePayment"` | `id` (PK), `tenantId` (FK), `feeInvoiceId` (FK), `amount` (paise), `method`, `reference`, `paidAt` | Traditional payment transaction records. |
| `FeePaymentLink` | `"FeePaymentLink"` | `id` (PK), `tenantId` (FK), `feeInvoiceId` (FK), `token` (Unique), `amount`, `status` (`OPEN`, `PAID`, `EXPIRED`, `CANCELED`), `utrReference`, `submittedAt`, `expiresAt` | Public UPI payment link for parent fee settlements. |
| `PaymentReceipt` | `"PaymentReceipt"` | `id` (PK), `tenantId` (FK), `studentId` (FK), `receiptNumber`, `amount` (paise, immutable), `method`, `reference`, `provider`, `idempotencyKey`, `receivedAt`, `@@unique([tenantId, id])`, `@@unique([tenantId, receiptNumber])` | Core double-entry immutable gross payment receipt. |
| `PaymentReceiptBalance` | `"PaymentReceiptBalance"` | `id` (PK), `tenantId` (FK), `receiptId` (FK, Unique), `allocatedAmount`, `transferredOutAmount`, `unappliedAmount`, `refundedAmount`, `status` (`CAPTURED`, `PARTIALLY_ALLOCATED`, `FULLY_ALLOCATED`, `OVERPAID_UNALLOCATED`, `REFUND_PENDING`, `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED`, `VOIDED`), `version`, `@@unique([tenantId, receiptId])` | Mutable ledger balance projection for receipts. |
| `PaymentAllocation` | `"PaymentAllocation"` | `id` (PK), `tenantId` (FK), `receiptId` (FK), `creditTransferId` (FK, Nullable), `studentId` (FK), `feeInvoiceId` (FK), `amount` (paise, immutable), `allocatedAt`, `@@unique([tenantId, id])` | Application of receipt funds to specific fee invoices. |
| `PaymentAllocationReversal` | `"PaymentAllocationReversal"` | `id` (PK), `tenantId` (FK), `originalAllocationId` (FK), `amount` (paise), `reason`, `destination` (`UNAPPLIED_CREDIT`, `REFUND_RESERVATION`), `reversedAt` | Immutable reversal record for canceled or refunded fee allocations. |
| `StudentCreditAccount` | `"StudentCreditAccount"` | `id` (PK), `tenantId` (FK), `studentId` (FK, Unique), `balance` (paise), `transferredIn`, `transferredOut`, `allocatedIn`, `status`, `version`, `@@unique([tenantId, id])`, `@@unique([tenantId, studentId])` | Student unapplied credit balance account. |
| `CreditTransferJournal` | `"CreditTransferJournal"` | `id` (PK), `tenantId` (FK), `transferNumber`, `idempotencyKey`, `sourceStudentId` (FK), `targetStudentId` (FK), `sourceReceiptId` (FK), `amount` (paise), `status` (`PENDING_APPROVAL`, `COMPLETED`, `REJECTED`), `@@unique([tenantId, id])`, `@@unique([tenantId, transferNumber])` | Cross-sibling double-entry transfer header. |
| `CreditTransferPosting` | `"CreditTransferPosting"` | `id` (PK), `tenantId` (FK), `journalId` (FK), `entryType` (`DEBIT`, `CREDIT`), `studentId` (FK), `counterpartyStudentId` (FK), `receiptId` (FK), `amount`, `@@unique([tenantId, id])` | Balanced DEBIT/CREDIT ledger lines (2 per transfer). |

### 2.9 Admissions CRM, Communications & AI (6 Models)

| Model Name | Table Name | Key Fields & Constraints | Description |
| :--- | :--- | :--- | :--- |
| `Lead` | `"Lead"` | `id` (PK), `tenantId` (FK), `studentName`, `dob`, `classInterested`, `academicYearId` (FK), `guardianName`, `guardianPhone`, `guardianEmail`, `source`, `status` (`NEW`, `CONTACTED`, `FOLLOW_UP`, `INTERESTED`, `CONVERTED`, `LOST`), `assignedToId` (FK), `convertedStudentId` (FK, Unique) | Prospective student admissions enquiry pipeline. |
| `LeadActivity` | `"LeadActivity"` | `id` (PK), `tenantId` (FK), `leadId` (FK), `actorId` (FK), `action`, `notes`, `createdAt` | Admissions CRM interaction timeline. |
| `Announcement` | `"Announcement"` | `id` (PK), `tenantId` (FK), `title`, `body`, `audience` (`ALL`, `STAFF`, `PARENTS`, `STUDENTS`), `pinned`, `publishedAt` | Institutional broadcast notices. |
| `NotificationLog` | `"NotificationLog"` | `id` (PK), `tenantId` (FK), `recipientUserId` (FK), `channel` (`EMAIL`, `SMS`, `WHATSAPP`, `IN_APP`), `status` (`QUEUED`, `SENT`, `FAILED`, `SKIPPED`), `to`, `subject`, `body`, `attempts`, `error`, `isRead` | Dispatched notification audit and inbox feed. |
| `AiJob` | `"AiJob"` | `id` (PK), `tenantId` (FK), `userId` (FK), `feature`, `prompt`, `output`, `credits`, `status` (`SUCCEEDED`, `FAILED`), `provider`, `model`, `tokensIn`, `tokensOut`, `durationMs`, `error`, `createdAt` | Log of generative AI executions and token telemetry. |
| `AuditLog` | `"AuditLog"` | `id` (PK), `tenantId` (FK, Nullable), `actorId`, `actorType` (`PLATFORM`, `TENANT`, `SYSTEM`), `actorName`, `action`, `entity`, `entityId`, `meta` (Json), `ip`, `createdAt` | Immutable system and business operation audit trail. |

### 2.10 System Infrastructure (3 Models)

| Model Name | Table Name | Key Fields & Constraints | Description |
| :--- | :--- | :--- | :--- |
| `FileAsset` | `"FileAsset"` | `id` (PK), `tenantId` (FK), `studentId` (FK, Nullable), `kind` (`LOGO`, `STUDENT_PHOTO`, `DOCUMENT`, `RECEIPT`), `name`, `mime`, `size`, `storageKey` (Unique), `provider` (`local`) | Metadata tracking files stored in object storage. |
| `RateLimitBucket` | `"RateLimitBucket"` | `key` (PK), `count`, `resetAt` | Fixed-window rate limiting buckets. |
| `Setting` | `"Setting"` | `key` (PK), `value` (Json), `updatedAt` | Key-value store for global platform settings. |

---

## 3. Database Constraints, Triggers & Hardening

### 3.1 Immutability Triggers (`prisma/manual/`)
The database employs PostgreSQL trigger function `fn_prevent_record_tampering()` across 4 critical tables:
1. `ExamResultSnapshot` (`trg_exam_snapshot_protect`)
2. `ExamMarksRevisionEvent` (`trg_exam_revision_event_protect`)
3. `BatchEnrollmentEvent` (`trg_prevent_batch_event_tampering`)
4. `SyllabusProgressEvent` (`trg_protect_syllabustrack_event`)

```sql
CREATE OR REPLACE FUNCTION fn_prevent_record_tampering()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable and cannot be updated or deleted.', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
```
Any `UPDATE`, `DELETE`, or `TRUNCATE` issued by application code or manual DBA SQL queries is rejected with code `P0001`.

### 3.2 XOR State Target Check Constraints
To prevent corrupt dual-target states where an academic structure targets both a class and a batch simultaneously, PostgreSQL check constraints enforce strict mutual exclusion:
- **`chk_examination_target_integrity` on `"Examination"`:**
  ```sql
  ("targetType" = 'CLASS_SECTION' AND "classId" IS NOT NULL AND "batchId" IS NULL) OR
  ("targetType" = 'BATCH' AND "batchId" IS NOT NULL AND "classId" IS NULL AND "sectionId" IS NULL)
  ```
- **`chk_syllabustrack_target_integrity` on `"SyllabusTrack"`:** Identical XOR verification.
- **`chk_fee_invoice_positive_amount` on `"FeeInvoice"`:** Enforces `amount > 0`.

### 3.3 Composite Foreign Keys for Strict Tenant Scoping
In the financial ledger, composite foreign keys enforce that related child rows belong strictly to the same tenant as the parent entity:
```sql
ALTER TABLE "PaymentAllocation"
ADD CONSTRAINT "PaymentAllocation_tenant_receipt_fkey"
FOREIGN KEY ("tenantId", "receiptId")
REFERENCES "PaymentReceipt" ("tenantId", "id")
ON DELETE RESTRICT;
```
This guarantees cross-tenant allocation leakage is impossible even if an attacker guesses valid IDs.
