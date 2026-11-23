# Knowletive SaaS — Complete QA Test Execution Matrix

**Audit Date:** November 10, 2026  
**Active Branch:** `staging/exam-stage-43`  
**Execution Environment:** PostgreSQL 16 on `localhost:5432`, Next.js 16.4.5, Node.js 24.21.0  
**Test Suite Summary:** 16 Test Suites | 286 Tests Passed | 0 Failed | 0 Skipped | 100% Pass Rate

---

## 1. Role × Module Authorization Matrix

Evaluates whether each role can navigate to and view data within each functional module:

| Module / Route | `PLATFORM_OWNER` | `PLATFORM_SUPPORT` | `INSTITUTE_ADMIN` | `PRINCIPAL` | `TEACHER` | `ACCOUNTANT` | `FRONT_DESK` | `PARENT` | `STUDENT` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Platform Overview** (`/platform`) | **PASS** | **PASS** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Institutes Directory** (`/platform/institutes`) | **PASS** | **PASS** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Plans & Pricing** (`/platform/plans`) | **PASS** | **PASS** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Subscriptions & Billing** (`/platform/subscriptions`)| **PASS** | **PASS** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Platform AI Telemetry** (`/platform/ai`) | **PASS** | **PASS** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Platform Team** (`/platform/team`) | **PASS** | **PASS** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Platform Audit Logs** (`/platform/audit`) | **PASS** | **PASS** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Workspace Overview** (`/app`) | **DENIED** | **DENIED** | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | **DENIED** | **DENIED** |
| **Leads & Admissions CRM** (`/app/leads`) | **DENIED** | **DENIED** | **PASS** | **PASS** | **DENIED** | **PASS** (Read) | **PASS** | **DENIED** | **DENIED** |
| **Students Directory** (`/app/students`) | **DENIED** | **DENIED** | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | **DENIED** | **DENIED** |
| **Parents Directory** (`/app/parents`) | **DENIED** | **DENIED** | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** | **DENIED** | **DENIED** |
| **Faculty & Staff** (`/app/staff`) | **DENIED** | **DENIED** | **PASS** | **PASS** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Academic Setup** (`/app/academics`) | **DENIED** | **DENIED** | **PASS** | **PASS** | **PASS** (Read) | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Batches & Cohorts** (`/app/batches`) | **DENIED** | **DENIED** | **PASS** | **PASS** | **PASS** (Read) | **DENIED** | **PASS** (Enroll)| **DENIED** | **DENIED** |
| **SyllabusTrack** (`/app/syllabus`) | **DENIED** | **DENIED** | **PASS** | **PASS** | **PASS** | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Exams & Grading** (`/app/exams`) | **DENIED** | **DENIED** | **PASS** | **PASS** | **PASS** (Marks) | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Attendance Register** (`/app/attendance`) | **DENIED** | **DENIED** | **PASS** | **PASS** | **PASS** | **DENIED** | **PASS** (Read) | **DENIED** | **DENIED** |
| **Fees & Invoices** (`/app/fees`) | **DENIED** | **DENIED** | **PASS** | **PASS** (Read) | **DENIED** | **PASS** | **PASS** (Read) | **DENIED** | **DENIED** |
| **Announcements** (`/app/announcements`) | **DENIED** | **DENIED** | **PASS** | **PASS** | **PASS** (Read) | **PASS** (Read) | **PASS** (Read) | **PASS** (Read) | **PASS** (Read) |
| **AI Studio** (`/app/ai`) | **DENIED** | **DENIED** | **PASS** | **PASS** | **PASS** | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Tenant Subscription** (`/app/billing`) | **DENIED** | **DENIED** | **PASS** | **PASS** (Read) | **DENIED** | **PASS** (Read) | **DENIED** | **DENIED** | **DENIED** |
| **Roles & Permissions** (`/app/roles`) | **DENIED** | **DENIED** | **PASS** | **PASS** (Read) | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Institute Settings** (`/app/settings`) | **DENIED** | **DENIED** | **PASS** | **PASS** (Read) | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** |
| **Family Portal Overview** (`/portal`) | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **PASS** | **PASS** |
| **Report Cards & Results** (`/portal/results/[id]`)| **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **PASS** | **PASS** |

---

## 2. Operation-Level Functional Test Matrix

### 2.1 Admissions & Leads Module (`/app/leads`)

| Operation / Feature | Tested By | Backend Action / API | Assertions / Verification | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Create Lead Enquiry** | `FRONT_DESK`, `ADMIN` | `createLeadAction` | Inserts `Lead` with status `NEW`, phone validation, audit logged | **PASS** |
| **Update Lead Status** | `FRONT_DESK`, `ADMIN` | `updateLeadAction` | Transitions status (`CONTACTED`, `INTERESTED`), logs `LeadActivity` | **PASS** |
| **Convert to Student** | `FRONT_DESK`, `ADMIN` | `convertLeadAction` | Atomic transaction: student quota check, student creation, guardian link, lead marked `CONVERTED` | **PASS** |
| **Conversion Idempotency**| Any | `convertLeadAction` | Rejects re-conversion of already converted lead | **PASS** |
| **Export Leads CSV** | Any Permitted | `GET /app/leads/export` | 5000-row cap, filter synchronization, CWE-1236 injection neutralization | **PASS** |
| **Import Leads CSV** | Any Permitted | `importLeadsCsvAction` | RFC-4180 parsing, 300-row limit, duplicate detection, advisory lock concurrency | **PASS** |
| **Delete Lead** | `ADMIN` only | `deleteLeadAction` | Soft/hard delete, audit logged | **PASS** |

### 2.2 Students & Guardians Module (`/app/students`, `/app/parents`)

| Operation / Feature | Tested By | Backend Action / API | Assertions / Verification | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Create Student** | `FRONT_DESK`, `ADMIN` | `createStudentAction` | Quota enforced, unique admission number, class/section assigned | **PASS** |
| **Update Student Profile**| `FRONT_DESK`, `ADMIN` | `updateStudentAction` | Updates demographics, status validation | **PASS** |
| **Bulk Import Students** | `ADMIN`, `FRONT_DESK`| `importStudentsAction` | Validates CSV columns, detects existing admission numbers, batch creation | **PASS** |
| **Export Students CSV** | `ADMIN`, `FRONT_DESK`| `GET /app/students/export` | Filter sync, formula injection neutralization | **PASS** |
| **Upload Document** | `ADMIN`, `FRONT_DESK`| `uploadStudentDocumentAction` | Storage isolation, file size limits, mime-type verification | **PASS** |
| **Link Guardian** | `FRONT_DESK`, `ADMIN` | `createGuardianAction` | Creates guardian, links with `isPrimary` flag | **PASS** |
| **Unlink / Delete Guardian**| `ADMIN` | `unlinkGuardianAction` | Unlinks relationship without cascading delete to student | **PASS** |

### 2.3 Batches & Cohorts Module (`/app/batches`)

| Operation / Feature | Tested By | Backend Action / API | Assertions / Verification | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Create Batch** | `ADMIN`, `PRINCIPAL` | `createBatchAction` | Code uniqueness, capacity limits, academic year binding | **PASS** |
| **Assign Teachers** | `ADMIN`, `PRINCIPAL` | `assignTeachersAction` | Faculty allocation, deduplicated IDs | **PASS** |
| **Enroll Students** | `ADMIN`, `FRONT_DESK`| `enrollStudentsAction` | Row-level locking on Batch, capacity enforcement, audit event emitted | **PASS** |
| **Transfer Student** | `ADMIN`, `PRINCIPAL` | `transferStudentAction` | Cross-batch lock ordering (ascending ID ASC), atomic transfer | **PASS** |
| **Drop Student** | `ADMIN`, `PRINCIPAL` | `dropStudentAction` | Status updated to `DROPPED`, enrollment event emitted | **PASS** |
| **Complete Batch** | `ADMIN` | `completeBatchAction` | Status set to `COMPLETED`, blocks subsequent enrollments | **PASS** |

### 2.4 SyllabusTrack Module (`/app/syllabus`)

| Operation / Feature | Tested By | Backend Action / API | Assertions / Verification | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Create Track** | `ADMIN`, `PRINCIPAL` | `createSyllabusAction` | Validates XOR target (`CLASS_SECTION` or `BATCH`), subject binding | **PASS** |
| **Add Chapter** | `ADMIN`, `PRINCIPAL` | `createChapterAction` | Unique chapter order within syllabus, title validation | **PASS** |
| **Add Topic** | `ADMIN`, `PRINCIPAL` | `createTopicAction` | Unique topic order within chapter, estimated hours | **PASS** |
| **Lesson Plan CRUD** | `TEACHER`, `PRINCIPAL`| `createLessonPlanAction`| Objectives, activities, homework, teacher assignment | **PASS** |
| **Update Topic Progress**| `TEACHER` | `updateTopicProgressAction`| Progress percentage, actual teaching hours, progress event emitted | **PASS** |
| **Event Immutability** | Database Trigger | `SyllabusProgressEvent` | PostgreSQL trigger blocks UPDATE/DELETE/TRUNCATE (P0001) | **PASS** |

### 2.5 Examinations & Results Module (`/app/exams`)

| Operation / Feature | Tested By | Backend Action / API | Assertions / Verification | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Create Examination** | `ADMIN`, `PRINCIPAL` | `createExaminationAction` | Target XOR integrity (`chk_examination_target_integrity`), dates | **PASS** |
| **Configure Subjects** | `ADMIN`, `PRINCIPAL` | `saveExamSubjectsAction` | Dates, max marks, passing thresholds, moves DRAFT to SCHEDULED | **PASS** |
| **Auto-Enroll Candidates**| `ADMIN`, `PRINCIPAL` | `autoEnrollEligibleStudentsAction`| Reads class/batch roster, creates `ExamEnrollment` rows | **PASS** |
| **Enter Marks (Bulk)** | `TEACHER`, `ADMIN` | `enterMarksBulkAction` | Monotonic version token check, bounds checking (0 to maxMarks) | **PASS** |
| **Subject Verification** | `ADMIN`, `PRINCIPAL` | `verifyExamSubjectMarksAction` | Locks marks to `VERIFIED`, increments version token | **PASS** |
| **Cartesian Completeness**| Automated Engine | `verifyCandidateSubjectCompleteness`| Strict check across (candidate, subject) pairs; missing marks block | **PASS** |
| **Publish Results** | `ADMIN`, `PRINCIPAL` | `calculateAndPublishResultsAction`| Calculates totals, GPA, rank, generates immutable SHA-256 snapshot | **PASS** |
| **Correct Published Mark**| `ADMIN`, `PRINCIPAL` | `correctPublishedMarkAction` | Requires expectedVersion & justification; preserves old snapshot (v1), creates v2 | **PASS** |
| **Safe Deletion Guard** | `ADMIN` | `deleteExaminationAction` | Deletion strictly blocked if enrollments, marks, revisions, or historical results exist | **PASS** |
| **Reopen Evaluated Exam**| `ADMIN`, `PRINCIPAL` | `reopenEvaluatedExamAction`| Status moves to `IN_PROGRESS`, invalidates pre-reopen mark tokens | **PASS** |

### 2.6 Daily Attendance Module (`/app/attendance`)

| Operation / Feature | Tested By | Backend Action / API | Assertions / Verification | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Mark Daily Register** | `TEACHER`, `ADMIN` | `markAttendanceAction` | Upsert daily status (PRESENT, ABSENT, LATE, EXCUSED), future date blocked | **PASS** |
| **Absence Alert Dispatch**| Automated Engine | `sendNotification` | Fires in-app and email notices to primary guardians of absent students | **PASS** |

### 2.7 Fees & Collections Module (`/app/fees`, `/pay/[token]`)

| Operation / Feature | Tested By | Backend Action / API | Assertions / Verification | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Create Fee Invoice** | `ACCOUNTANT`, `ADMIN` | `createFeeInvoiceAction` | Sequential invoice numbering (`SUN-FEE-2026-XXXX`), due dates | **PASS** |
| **Record Payment** | `ACCOUNTANT`, `ADMIN` | `recordFeePaymentAction` | Partial settlements, paidAmount calculation, overpayment rejection | **PASS** |
| **Waive Invoice** | `ACCOUNTANT`, `ADMIN` | `waiveFeeInvoiceAction` | Status updated to `WAIVED`, audit logged | **PASS** |
| **Public Payment Link** | Any Public Payer | `submitPaymentProofAction` | Token resolution, bank UTR submission, status set to `SUBMITTED` | **PASS** |
| **Verify Payment Proof**| `ACCOUNTANT`, `ADMIN` | `verifyPaymentLinkProofAction` | Converts proof to confirmed `FeePayment`, settles invoice | **PASS** |

### 2.8 Announcements & Communications Module (`/app/announcements`)

| Operation / Feature | Tested By | Backend Action / API | Assertions / Verification | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Publish Notice** | `ADMIN`, `PRINCIPAL` | `createAnnouncementAction` | Body, title, audience targeting (`ALL`, `STAFF`, `PARENTS`, `STUDENTS`)| **PASS** |
| **Recipient Delivery** | Automated Engine | `sendNotification` | Targets only active users matching the selected audience scope | **PASS** |
| **Pin / Unpin Notice** | `ADMIN` | `toggleAnnouncementPinAction`| Updates pinned boolean | **PASS** |

---

## 3. Cross-Module Integration Workflow Matrix

| Workflow ID | Business Workflow Scenario | Participating Modules | Status |
| :---: | :--- | :--- | :---: |
| **WF-01** | Lead Capture → Qualification → Admission Conversion → Student & Guardian Records | Leads CRM, Students, Parents, Audit Log | **PASS** |
| **WF-02** | Student Registration → Batch Enrollment → Inter-Batch Transfer → Drop Tracking | Students, Batches, Audit Log | **PASS** |
| **WF-03** | Batch Membership → Examination Candidate Auto-Enrollment Synchronization | Batches, Exams & Grading | **PASS** |
| **WF-04** | Exam Scheduling → Candidate Enrollment → Marks Entry → Subject Verification → Result Publishing & Snapshots | Exams, Academics, Grading, Audit Log | **PASS** |
| **WF-05** | Published Exam Result Correction → Cryptographic Snapshot Versioning (v1 → v2) | Exams, Snapshots, Audit Log | **PASS** |
| **WF-06** | Attendance Marking → Automated Primary Guardian Absence Alert Notification | Attendance, Parents, Notification Logs | **PASS** |
| **WF-07** | Fee Invoice Generation → Partial Collection → Settlement → Receipt Balance Calculation | Fees & Collections, Students, Audit Log | **PASS** |
| **WF-08** | Staff Invitation → Tenant Role Assignment → Multi-Tenant Session Activation | Staff, Roles & Permissions, Authentication | **PASS** |
| **WF-09** | Public Fee Payment Link → UTR Reference Submission → Bursar Verification & Ledger Posting | Public Pay Page, Fees & Collections | **PASS** |

