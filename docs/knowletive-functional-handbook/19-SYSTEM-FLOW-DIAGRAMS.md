# Knowletive SaaS — System Architecture & Workflow Diagrams

## Document Information
- **Title:** Master System Architecture, Flowcharts & Sequence Diagrams
- **Document ID:** DOC-19-DIAGRAMS
- **Target Audience:** Software Architects, Developers, Technical Project Managers, System Integrators
- **Classification:** Architecture & Visual Specification
- **Repository Location:** `docs/knowletive-functional-handbook/19-SYSTEM-FLOW-DIAGRAMS.md`

---

## Table of Contents
1. [Platform Topography & Multi-Tenancy Architecture](#1-platform-topography--multi-tenancy-architecture)
2. [Dual-Scope RBAC Authorization Flow](#2-dual-scope-rbac-authorization-flow)
3. [Admissions CRM & Student Conversion Lifecycle](#3-admissions-crm--student-conversion-lifecycle)
4. [Academic Structure & Batch Formation Flowchart](#4-academic-structure--batch-formation-flowchart)
5. [SyllabusTrack Curriculum Delivery Sequence](#5-syllabustrack-curriculum-delivery-sequence)
6. [Complete Examination Lifecycle State Machine](#6-complete-examination-lifecycle-state-machine)
7. [Daily Roll Call & Parental Absence Alert Sequence](#7-daily-roll-call--parental-absence-alert-sequence)
8. [Fee Invoicing & Payment Collection Sequence](#8-fee-invoicing--payment-collection-sequence)
9. [Student & Parent Portal Self-Service Flow](#9-student--parent-portal-self-service-flow)

---

## 1. Platform Topography & Multi-Tenancy Architecture

```mermaid
flowchart TD
    Client["User Browser (Desktop / Tablet / Mobile)"] --> AuthGuard["Unified Login (/login)"]
    
    AuthGuard -->|isPlatformOwner = true| PlatformConsole["Platform Admin Console (/platform)"]
    AuthGuard -->|Staff Role (Admin/Teacher/Acc/FrontDesk)| TenantWorkspace["Institute Workspace (/app)"]
    AuthGuard -->|Consumer Role (Student/Parent)| PortalWorkspace["Unified Portal (/portal)"]
    
    subgraph MultiTenantDataLayer ["Isolated Data Partition (PostgreSQL 16)"]
        Tenant1["Tenant A (tenantId = 'sunrise')"]
        Tenant2["Tenant B (tenantId = 'oakridge')"]
        PlatformData["Global SaaS Data (Plans, Subscriptions, AI)"]
    end
    
    PlatformConsole --> PlatformData
    TenantWorkspace -->|where: tenantId = session.tenantId| Tenant1
    PortalWorkspace -->|where: studentId = session.studentId| Tenant1
```

---

## 2. Dual-Scope RBAC Authorization Flow

```mermaid
flowchart TD
    Request["Incoming User Request"] --> CookieVerify["Verify httpOnly Session Cookie"]
    CookieVerify -->|Invalid / Expired| RedirectLogin["Redirect to /login"]
    CookieVerify -->|Valid Session| ScopeCheck{"Target Route Scope?"}
    
    ScopeCheck -->|/platform/*| PlatCheck{"User has platform scope?"}
    PlatCheck -->|No| Block403["403 Forbidden"]
    PlatCheck -->|Yes| AllowPlatform["Execute Platform Route"]
    
    ScopeCheck -->|/app/*| TenantCheck{"Active Tenant Membership?"}
    TenantCheck -->|No| Block403
    TenantCheck -->|Yes| PermCheck{"Has Granular Tenant Permission?"}
    PermCheck -->|No| Block403
    PermCheck -->|Yes| AllowTenant["Execute Tenant Route & Bound Query"]
    
    ScopeCheck -->|/portal/*| ConsumerCheck{"Linked Student or Guardian Profile?"}
    ConsumerCheck -->|No| Block403
    ConsumerCheck -->|Yes| AllowPortal["Render Isolated Self-Service Portal"]
```

---

## 3. Admissions CRM & Student Conversion Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor Parent as Prospective Parent
    actor FrontDesk as Front Desk Officer
    participant CRM as CRM Module (/app/leads)
    participant DB as PostgreSQL Database
    
    Parent->>FrontDesk: Inquires via Phone / Walk-in
    FrontDesk->>CRM: Enter Student & Guardian details (/app/leads/new)
    CRM->>DB: createLeadAction (Status: NEW)
    FrontDesk->>CRM: Log Counseling Call & Tour (/app/leads/[id])
    CRM->>DB: Update Status -> QUALIFIED
    FrontDesk->>CRM: Click "Convert to Admission"
    CRM->>DB: convertLeadAction (Atomic Transaction)
    Note over DB: Creates Student, Guardian, GuardianLink & BatchEnrollment; Updates Lead -> CONVERTED
    DB-->>CRM: Conversion Confirmed
    CRM-->>FrontDesk: Display Admission Number & Printable Receipt
```

---

## 4. Academic Structure & Batch Formation Flowchart

```mermaid
flowchart LR
    AY["Academic Year (e.g. 2026-2027)"] --> Class["Class / Grade Level (Grade 10)"]
    Class --> Section["Section (Section A)"]
    Section --> Batch["Classroom Batch (Grade 10-A-Morning)"]
    
    Batch --> StudentRoster["Enrolled Students (BatchEnrollment)"]
    Batch --> FacultyRoster["Allocated Teachers (BatchTeacher)"]
    Batch --> Timetable["Weekly Timetable Hours"]
```

---

## 5. SyllabusTrack Curriculum Delivery Sequence

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Academic Lead
    actor Teacher as Faculty Member
    participant Syllabus as Syllabus Module (/app/syllabus)
    participant DB as PostgreSQL Database
    
    Admin->>Syllabus: Build Curriculum (Chapters -> Topics)
    Syllabus->>DB: createChapterAction & createTopicAction
    Teacher->>Syllabus: Create Lesson Plan (or AI Generator)
    Syllabus->>DB: createLessonPlanAction
    Teacher->>Syllabus: Deliver Class -> Click "Mark Completed"
    Syllabus->>DB: recordTopicProgressAction (Batch, Date, Notes)
    DB-->>Syllabus: Progress Analytics Recalculated
    Admin->>Syllabus: Inspect Curriculum Progress (/app/syllabus/reports)
```

---

## 6. Complete Examination Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> DRAFT: createExaminationAction
    DRAFT --> SCHEDULED: Dates & Candidates Locked
    SCHEDULED --> IN_PROGRESS: Exam Administered
    IN_PROGRESS --> EVALUATING: Exam Completed
    EVALUATING --> RESULTS_PUBLISHED: calculateAndPublishResultsAction
    RESULTS_PUBLISHED --> ARCHIVED: Term Complete
    
    state EVALUATING {
        [*] --> MarkEntry: enterMarksBulkAction
        MarkEntry --> MarkVerified: verifyExamMarksAction
    }
    
    state RESULTS_PUBLISHED {
        [*] --> ImmutableSnapshotCreated: Frozen ExamResultSnapshot
        ImmutableSnapshotCreated --> MarkCorrection: correctPublishedMarkAction (Admin Only)
        MarkCorrection --> NewSnapshotVersion: Creates Version 2 & Logs Reason
    }
```

---

## 7. Daily Roll Call & Parental Absence Alert Sequence

```mermaid
sequenceDiagram
    autonumber
    actor Teacher as Batch Teacher
    participant Attendance as Attendance Module (/app/attendance)
    participant DB as PostgreSQL Database
    actor Parent as Parent / Guardian
    
    Teacher->>Attendance: Select Batch & Date
    Attendance->>Teacher: Render Roll Call Table (P, A, L, E)
    Teacher->>Attendance: Toggle Student to Absent (A) & Save
    Attendance->>DB: markAttendanceAction (Persist AttendanceRecord)
    Attendance->>DB: sendAttendanceAlertNotificationAction
    DB-->>Parent: Electronic Absence Notification Dispatched
    Parent->>Attendance: Parent checks Portal (/portal)
    Attendance-->>Parent: Attendance gauge updated & alert displayed
```

---

## 8. Fee Invoicing & Payment Collection Sequence

```mermaid
sequenceDiagram
    autonumber
    actor Bursar as Accountant
    participant Fees as Fees Module (/app/fees)
    participant DB as PostgreSQL Database
    actor Parent as Parent
    
    Bursar->>Fees: Create Invoice with Line Items (/app/fees/new)
    Fees->>DB: createFeeInvoiceAction (Status: PENDING)
    Parent->>Fees: Reviews invoice in Parent Portal (/portal)
    Parent->>Bursar: Pays $500 Partial Amount
    Bursar->>Fees: Record Payment ($500 via Cash/Card)
    Fees->>DB: recordFeePaymentAction
    Note over DB: Updates paidAmount, status -> PARTIAL, creates FeePayment
    Fees-->>Bursar: Generate Stamped Receipt Voucher
    Bursar-->>Parent: Issues Physical / Digital Receipt
```

---

## 9. Student & Parent Portal Self-Service Flow

```mermaid
flowchart TD
    Login["User Logs In (/login)"] --> AutoDetect["Detect Linked Consumer Profile"]
    AutoDetect --> PortalDashboard["Portal Dashboard (/portal)"]
    
    PortalDashboard --> WardSelect{"Parent with Multiple Wards?"}
    WardSelect -->|Yes| WardSwitcher["Switch Active Ward Dropdown"]
    WardSelect -->|No| SingleStudent["Display Student Record"]
    
    WardSwitcher --> RefreshData["Reload Student Academic Context"]
    SingleStudent --> Features
    RefreshData --> Features
    
    subgraph Features ["Portal Self-Service Capabilities"]
        AttGauge["Attendance Percentage Gauge"]
        ExamCards["Published Examination Cards"]
        FeeSummary["Fee Dues & Paid Receipts"]
        NoticesFeed["Campus Announcements Feed"]
    end
    
    ExamCards --> ResultDetail["Open Official Frozen Snapshot (/portal/results/[id])"]
    ResultDetail --> PrintCard["Print / Save Certified Report Card"]
```
