# Knowletive SaaS — Master User Journey & Verification Checklist

## Document Information
- **Title:** Master Verification Checklist & Step-by-Step User Journey Guide
- **Document ID:** DOC-18-USER-JOURNEY-CHECKLIST
- **Target Audience:** QA Testers, Onboarding Engineers, Functional Auditors, New System Users
- **Classification:** Standard Operating Verification Checklist
- **Repository Location:** `docs/knowletive-functional-handbook/18-MASTER-USER-JOURNEY-CHECKLIST.md`

---

## Table of Contents
1. [Overview & How to Use This Checklist](#1-overview--how-to-use-this-checklist)
2. [Journey 1: Platform Owner Setup Journey](#2-journey-1-platform-owner-setup-journey)
3. [Journey 2: Institute Administrator Launch Journey](#3-journey-2-institute-administrator-launch-journey)
4. [Journey 3: Front Desk Admissions & Intake Journey](#4-journey-3-front-desk-admissions--intake-journey)
5. [Journey 4: Faculty Classroom, Attendance & Syllabus Journey](#5-journey-4-faculty-classroom-attendance--syllabus-journey)
6. [Journey 5: Examination Lifecycle & Publication Journey](#6-journey-5-examination-lifecycle--publication-journey)
7. [Journey 6: Bursar Fee Invoicing & Payment Journey](#7-journey-6-bursar-fee-invoicing--payment-journey)
8. [Journey 7: Student Self-Service Journey](#8-journey-7-student-self-service-journey)
9. [Journey 8: Parent Multi-Ward Oversight Journey](#9-journey-8-parent-multi-ward-oversight-journey)
10. [Journey 9: Security, RBAC & Isolation Verification Journey](#10-journey-9-security-rbac--isolation-verification-journey)

---

## 1. Overview & How to Use This Checklist

This master checklist provides a sequence of manual verification steps. A tester or new employee can follow these steps sequentially to verify every major operational workflow across all 9 roles.

---

## 2. Journey 1: Platform Owner Setup Journey
- [ ] 1. Open `/login`. Click demo button **Platform Owner** (`owner@knowletive.com`).
- [ ] 2. Verify redirect to `/platform`. Confirm metrics display Total Institutes, MRR, and Subscriptions.
- [ ] 3. Navigate to `/platform/institutes`. Confirm directory displays registered institutes.
- [ ] 4. Click **+ Add Institute**. Fill name, slug (`test-school`), and submit. Confirm new tenant appears.
- [ ] 5. Navigate to `/platform/plans`. Review pricing tiers (Core, Growth, Scale).
- [ ] 6. Navigate to `/platform/subscriptions`. Verify active subscriptions and expiration dates.
- [ ] 7. Navigate to `/platform/ai`. Verify global token telemetry meters.
- [ ] 8. Navigate to `/platform/audit`. Confirm your recent institute creation is logged.
- [ ] 9. Click **Sign Out**. Confirm redirection to `/login`.

---

## 3. Journey 2: Institute Administrator Launch Journey
- [ ] 1. Log in as **Institute Admin** (`admin@sunrise.test`). Verify landing at `/app`.
- [ ] 2. Navigate to `/app/academics`. Verify active academic year ("2026-2027").
- [ ] 3. Create a new Section under Grade 10 (e.g. "Section C").
- [ ] 4. Navigate to `/app/batches`. Click **+ Create Batch**. Create "Grade 10 - Section C - Morning".
- [ ] 5. Navigate to `/app/staff`. Click **+ Invite Staff**. Invite a new teacher.
- [ ] 6. Navigate to `/app/roles`. Inspect the 52-permission matrix.
- [ ] 7. Navigate to `/app/settings`. Review institute profile details and audit log.

---

## 4. Journey 3: Front Desk Admissions & Intake Journey
- [ ] 1. Log in as **Front Desk** (`frontdesk@sunrise.test`). Verify landing at `/app/leads`.
- [ ] 2. Click **+ Add Lead**. Enter student "Rohan Verma", parent phone, email, and grade. Submit.
- [ ] 3. Verify lead appears in status tab **NEW**.
- [ ] 4. Open lead detail (`/app/leads/[id]`). Log interaction notes. Advance status to **QUALIFIED**.
- [ ] 5. Click **Convert to Admission**. Enter Admission Number and assign batch. Confirm.
- [ ] 6. Navigate to `/app/students`. Verify "Rohan Verma" is now an active student.
- [ ] 7. Navigate to `/app/parents`. Verify linked guardian record exists.

---

## 5. Journey 4: Faculty Classroom, Attendance & Syllabus Journey
- [ ] 1. Log in as **Teacher** (`teacher@sunrise.test`). Verify landing at `/app/batches`.
- [ ] 2. Open assigned batch. Verify student roster.
- [ ] 3. Navigate to `/app/attendance`. Select batch and date.
- [ ] 4. Mark one student as **Absent** (`A`) and all others as **Present** (`P`). Save register.
- [ ] 5. Navigate to `/app/syllabus`. Open assigned subject.
- [ ] 6. Locate current topic. Click **Mark Completed**, enter class date and notes. Save.
- [ ] 7. Navigate to `/app/ai`. Open **Lesson Plan Generator**, generate a 45-minute lesson plan.

---

## 6. Journey 5: Examination Lifecycle & Publication Journey
- [ ] 1. Log in as **Principal** (`principal@sunrise.test`).
- [ ] 2. Navigate to `/app/exams`. Click **+ New Exam**. Create "Mid-Term Exam". Status is **DRAFT**.
- [ ] 3. Add Mathematics subject (Max Marks: 100, Passing: 40). Enroll candidate batch.
- [ ] 4. Advance status to **IN_PROGRESS** and then **EVALUATING**.
- [ ] 5. Log in as **Teacher**. Open exam mark sheet. Enter marks for students. Save draft. Click **Verify Marks**.
- [ ] 6. Log back in as **Institute Admin**. Open verified exam. Click **Publish Results**.
- [ ] 7. Confirm examination status updates to **RESULTS_PUBLISHED** and result snapshots are generated.

---

## 7. Journey 6: Bursar Fee Invoicing & Payment Journey
- [ ] 1. Log in as **Accountant** (`accountant@sunrise.test`). Verify landing at `/app/fees`.
- [ ] 2. Click **+ Create Invoice**. Select student, add "Tuition Fee" ($800) and "Lab Fee" ($200). Submit.
- [ ] 3. Verify invoice is created with status **PENDING** and balance $1,000.
- [ ] 4. Open invoice detail (`/app/fees/[id]`). Click **Record Payment**.
- [ ] 5. Enter $500 payment via Cash. Confirm.
- [ ] 6. Verify invoice status updates to **PARTIAL** with remaining balance $500.
- [ ] 7. Click **Generate Receipt**. Verify official printable receipt is rendered.

---

## 8. Journey 7: Student Self-Service Journey
- [ ] 1. Log in as **Student** (`student@sunrise.test`). Verify auto-redirect to `/portal`.
- [ ] 2. Verify academic header displays student name, roll number, and enrolled batch.
- [ ] 3. Review Attendance Gauge. Confirm absence marked by teacher is accurately reflected.
- [ ] 4. Scroll to **Examinations**. Verify published Mid-Term Exam card appears.
- [ ] 5. Click **View Official Result** (`/portal/results/[id]`).
- [ ] 6. Verify certified report card snapshot displays subject marks, percentage, letter grade, and institute seal.

---

## 9. Journey 8: Parent Multi-Ward Oversight Journey
- [ ] 1. Log in as **Parent** (`parent@sunrise.test`). Verify landing at `/portal`.
- [ ] 2. Test the **Ward Switcher** dropdown. Switch between enrolled children.
- [ ] 3. Confirm student data, attendance rates, and exam results update instantly for the selected child.
- [ ] 4. Check **Fees & Invoices**. Verify open fee invoices and past receipts are accessible.

---

## 10. Journey 9: Security, RBAC & Isolation Verification Journey
- [ ] 1. While logged in as **Teacher**, attempt to navigate to `/app/billing`. Verify 403 Forbidden rejection.
- [ ] 2. While logged in as **Student**, attempt to navigate to `/app`. Verify unauthorized redirection.
- [ ] 3. Verify that student A cannot view student B's exam snapshot URL.
- [ ] 4. Check `/app/settings` audit log to confirm all testing actions are captured.
