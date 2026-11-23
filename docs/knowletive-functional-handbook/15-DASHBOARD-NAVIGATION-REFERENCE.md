# Knowletive SaaS — Dashboard & Navigation Reference

## Document Information
- **Title:** Complete Application Route, Screen & UI Navigation Reference
- **Document ID:** DOC-15-NAV-REFERENCE
- **Target Audience:** UI/UX Designers, Frontend Developers, QA Automation Engineers, User Support
- **Classification:** UI/UX & Routing Specification
- **Repository Location:** `docs/knowletive-functional-handbook/15-DASHBOARD-NAVIGATION-REFERENCE.md`

---

## Table of Contents
1. [Routing Architecture & Environments](#1-routing-architecture--environments)
2. [Public & Authentication Routes](#2-public--authentication-routes)
3. [Platform Administration Console (`/platform`) Routes](#3-platform-administration-console-platform-routes)
4. [Tenant / Institute Workspace (`/app`) Routes](#4-tenant--institute-workspace-app-routes)
5. [Student & Parent Portal (`/portal`) Routes](#5-student--parent-portal-portal-routes)
6. [API & Background Route Handlers](#6-api--background-route-handlers)
7. [Comprehensive Route × Role Access Matrix](#7-comprehensive-route--role-access-matrix)

---

## 1. Routing Architecture & Environments

Knowletive SaaS employs the **Next.js 15 App Router** architecture structured into distinct route groups:
- **Public & Auth:** `src/app/(auth)/*` and marketing landing `src/app/page.tsx`.
- **Platform Console:** `src/app/platform/*` protected by `requirePlatform()`.
- **Institute Workspace:** `src/app/(app)/app/*` protected by `getTenantContext()` and granular permissions.
- **Consumer Portal:** `src/app/(portal)/portal/*` protected by consumer profile verification.

---

## 2. Public & Authentication Routes

| Route | Page Component | Access | Purpose | Key UI Controls |
|:---|:---|:---|:---|:---|
| `/` | `src/app/page.tsx` | Public | Marketing landing page | Feature showcase, pricing calculator, "Sign In" CTA. |
| `/login` | `src/app/login/page.tsx` | Public | Single sign-on login portal | Email input, password input, responsive demo account quick-fill buttons. |
| `/pay/[token]` | `src/app/pay/[token]/page.tsx` | Public (Signed Token) | Public QR fee payment & proof submission portal | Dynamic QR code, invoice breakdown, transaction proof upload form. |
| `/select-institute` | `src/app/select-institute/page.tsx` | Authenticated (Multi-Tenant) | Multi-institute workspace selector | Institute cards, active membership selector, switch tenant button. |

---

## 3. Platform Administration Console (`/platform`) Routes

| Route | Guard | Description | Key UI Controls |
|:---|:---|:---|:---|
| `/platform` | `requirePlatform` | Global executive overview | Metric cards (Total Institutes, MRR, Active Subscriptions), audit feed. |
| `/platform/institutes` | `platform.institutes.read` | Directory of subscriber institutes | Search bar, status filter, "+ Add Institute" button. |
| `/platform/institutes/new` | `platform.institutes.manage` | Institute provisioning wizard | Form inputs for name, slug, contact, plan, and initial admin credentials. |
| `/platform/institutes/[id]` | `platform.institutes.read` | Institute detail & control | Tenant details, status toggle (Active/Suspended), assigned plan. |
| `/platform/plans` | `platform.plans.read` | SaaS subscription tiers | Plan cards (Core, Growth, Scale), price and capacity badges. |
| `/platform/plans/new` | `platform.plans.manage` | Plan creator wizard | Tier title, pricing, interval, student limits, feature flags. |
| `/platform/plans/[id]` | `platform.plans.manage` | Plan configuration editor | Update pricing and student thresholds. |
| `/platform/subscriptions` | `platform.subscriptions.read` | Tenant subscriptions directory | Active subscriptions table, renewal dates, status tags. |
| `/platform/ai` | `platform.ai.read` | Global AI telemetry | Token consumption charts, model usage breakdown, top tenant consumers. |
| `/platform/roles` | `platform.roles.read` | Platform RBAC configuration | Custom platform roles and permission assignment. |
| `/platform/team` | `platform.users.read` | Platform personnel directory | Internal team list, "+ Invite Member" modal. |
| `/platform/audit` | `platform.audit.read` | Global security audit log | Filterable audit event table with actor email, IP address, and metadata diff. |
| `/platform/settings` | `platform.settings.manage` | Platform maintenance settings | Maintenance mode toggle, global session settings. |

---

## 4. Tenant / Institute Workspace (`/app`) Routes

| Route | Guard | Description | Key UI Controls |
|:---|:---|:---|:---|
| `/app` | Active Membership | Institute executive dashboard | Operational metrics (Students, Staff, Attendance %, Fees Collected). |
| `/app/leads` | `leads.read` | Admissions CRM pipeline | Status tabs (New, Contacted, Qualified, Converted, Lost), CSV Import/Export. |
| `/app/leads/new` | `leads.write` | Lead intake form | Form inputs for student and guardian contact details. |
| `/app/leads/[id]` | `leads.read` | Lead detail & interaction timeline | Timeline feed, follow-up logger, "Convert to Admission" button. |
| `/app/students` | `students.read` | Student master directory | Search input, batch filter, "+ New Student", CSV import. |
| `/app/students/new` | `students.write` | Student enrollment form | Demographics, roll number, admission number, batch selector. |
| `/app/students/[id]` | `students.read` | Student 360° profile | Tabbed view (Academic history, attendance record, fees ledger, guardians). |
| `/app/students/[id]/edit` | `students.write` | Student profile editor | Update contact details, emergency contacts, medical notes. |
| `/app/students/import` | `students.write` | Bulk student CSV import | File dropzone, CSV column mapping preview, validation report. |
| `/app/parents` | `parents.read` | Guardian master directory | Searchable list of parents, linked wards count, contact numbers. |
| `/app/parents/new` | `parents.write` | Guardian registration form | Name, relationship, email, phone, occupation. |
| `/app/parents/[id]` | `parents.read` | Guardian detail profile | Linked student profiles, portal user account status. |
| `/app/staff` | `staff.read` | Staff and faculty directory | Table of staff members, designations, assigned roles. |
| `/app/staff/new` | `staff.manage` | Staff invitation wizard | Name, work email, phone, role selector. |
| `/app/staff/[id]` | `staff.read` | Staff profile & assignments | Assigned teaching batches, subjects, audit log. |
| `/app/academics` | `academics.read` | Academic master configuration | Tabs for Academic Years, Classes, Sections, and Subjects. |
| `/app/batches` | `batches.read` | Classroom batches directory | Visual grid of active batches, student counts, teacher avatars. |
| `/app/batches/new` | `batches.write` | Batch creation form | Batch title, class, section, room capacity, timetable hours. |
| `/app/batches/[id]` | `batches.read` | Batch classroom console | Student roster, faculty list, timetable schedule. |
| `/app/batches/[id]/settings` | `batches.write` | Batch settings & allocations | Allocate teachers, transfer students, update capacity. |
| `/app/syllabus` | `syllabus.read` | SyllabusTrack curriculum view | Subject selector, chapter tree, topic completion status. |
| `/app/syllabus/new` | `syllabus.write` | Curriculum builder | Create chapters, units, and learning topics. |
| `/app/syllabus/[id]` | `syllabus.read` | Topic detail & lesson plans | Lesson plan editor, resource links, teaching logs. |
| `/app/syllabus/reports` | `syllabus.view_reports` | Curriculum progress analytics | Progress bars showing percentage completion across batches. |
| `/app/exams` | `exams.read` | Examination schedule | Term exam cards with status badges (Draft, Scheduled, Published). |
| `/app/exams/new` | `exams.write` | Exam creation wizard | Exam title, dates, subjects, max marks, passing criteria. |
| `/app/exams/[id]` | `exams.read` | Exam mark sheet console | Marks entry table, verify marks, "Publish Results" button. |
| `/app/exams/grading` | `exams.manage_grading` | Grading scale matrix builder | Configure letter grades and percentage cutoffs. |
| `/app/exams/reports` | `exams.read` | Academic exam analytics | Class-wide score distribution charts and pass/fail ratios. |
| `/app/attendance` | `attendance.read` | Daily roll call register | Batch selector, date picker, roll call table (P, A, L, E). |
| `/app/fees` | `fees.read` | Fee management console | Financial metrics, status filters (Pending, Partial, Paid), search. |
| `/app/fees/new` | `fees.manage` | Fee invoicing wizard | Student or batch selector, itemized fee heads, due date. |
| `/app/fees/[id]` | `fees.read` | Invoice detail & statement | Itemized statement, "Record Payment" modal, "Print Receipt". |
| `/app/forbidden` | Active Session | Permission access denial screen | Detailed alert displaying missing required permission key, back to safety CTA. |
| `/app/announcements` | `announcements.read` | Campus announcements board | Notice feed, "+ New Announcement" modal with target audience. |
| `/app/ai` | `ai.use` | AI Studio workspace | Lesson plan generator, quiz creator, student feedback assistant. |
| `/app/billing` | `billing.read` | Institute subscription status | Current plan tier, seat capacity, invoices issued by Knowletive. |
| `/app/roles` | `roles.read` | Custom roles & RBAC matrix | Custom role builder with 52-permission toggle matrix. |
| `/app/settings` | `settings.read` | Institute settings & branding | School logo upload, address, receipt disclaimers, audit trail. |

---

## 5. Student & Parent Portal (`/portal`) Routes

| Route | Guard | Description | Key UI Controls |
|:---|:---|:---|:---|
| `/portal` | Consumer Session | Learner & Guardian dashboard | Attendance percentage gauge, exam summaries, notices, ward switcher. |
| `/portal/results/[id]` | Consumer Session | Official frozen result viewer | Certified report card snapshot, subject scores, grades, print button. |

---

## 6. API & Background Route Handlers

| Endpoint | Method | Guard | Description |
|:---|:---|:---|:---|
| `/app/leads/export` | GET | `leads.read` | Generates downloadable CSV export of filtered admissions leads. |
| `/app/students/export` | GET | `students.read` | Generates downloadable CSV export of student directory by batch. |
| `/api/files/[id]` | GET | Authenticated | Serves secured attachments and uploaded student documents. |
| `/api/cron/renewal-check`| GET / POST | Bearer Secret | Automated cron job verifying subscription expirations and renewals. |
