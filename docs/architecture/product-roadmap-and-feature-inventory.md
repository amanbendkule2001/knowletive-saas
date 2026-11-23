# Knowletive Product Roadmap & Feature Inventory (Phase 2.3.2)

**Author:** Agent 10 (Product & Business Workflow) & Agent 0 (Chief Architect)  
**Date:** 2026-11-21  
**Repository:** `D:\IT\Saas` (`staging/exam-stage-43`)  

---

## 1. Executive Summary

Knowletive is a multi-tenant SaaS platform tailored for educational institutions, academies, and multi-branch school networks. This document inventories all 9 functional workstreams and their active implementation statuses.

---

## 2. Workstream Status & Feature Inventory

### Workstream 1: Core Multi-Tenant Platform & Institute Management
- **Status:** COMPLETED / HARDENED
- **Capabilities:**
  - Multi-tenant tenant separation (`Tenant`, `Membership`, `User`).
  - Institute profile and subscription management.
  - Multi-membership switching and institute selector (`/select-institute`).
  - Tenant-level permission configuration and role management (`/app/roles`).

### Workstream 2: Student & Academic Management
- **Status:** COMPLETED / HARDENED
- **Capabilities:**
  - Student directory, admission lifecycle, and student profile (`/app/students`).
  - Class levels, sections, subjects, and academic year tracking (`/app/academics`).
  - Student CSV bulk import with column mapping and validation (`/app/students/import`).
  - Secure student data export with branch scoping (`/app/students/export`).

### Workstream 3: Staff, Attendance & Batch Operations
- **Status:** COMPLETED / HARDENED
- **Capabilities:**
  - Staff management, invitations, and multi-branch assignment (`/app/staff`).
  - Batch creation, scheduling, and student enrollment (`/app/batches`).
  - Daily attendance tracking with status auditing (`/app/attendance`).
  - Batch enrollment immutability triggers (`20261106_batch_event_immutability.sql`).

### Workstream 4: Examination, Grading & Academic Analytics
- **Status:** COMPLETED / HARDENED
- **Capabilities:**
  - Examination setup, schedules, and subject allocations (`/app/exams`).
  - Grade scales, grade bands, and automated calculation (`src/lib/grade-scales.ts`).
  - Marks entry, teacher grading, and marks revision audit trail (`/app/exams/grading`).
  - Exam result snapshot versioning (`20261107_snapshot_versioning.sql`).
  - Student report card generation and analytics (`/app/exams/reports`).

### Workstream 5: Financial Ledger, Fee Invoicing & Payment Processing
- **Status:** COMPLETED / HARDENED (Pre-RLS Stage)
- **Capabilities:**
  - Immutable core financial ledger (`PaymentReceipt`, `PaymentAllocation`, `BranchLedgerEntry`).
  - Double-entry student credit accounts and transfer journal (`CreditTransferJournal`).
  - Fee invoice generation, student installment schedules, and overdue tracking (`/app/fees`).
  - Payment collection routes with NULLS NOT DISTINCT unique identity (`uq_pcr_branch_route_identity`).
  - Effective collection views (`v_effective_fee_payment`, `v_effective_payment_receipt`, `v_effective_payment_allocation`).
  - Demo payment gateway adapter and mock session simulation (`src/app/pay/demo/`).
  - Jodo payment adapter architecture and webhook inbox (`src/lib/payment-gateway/`).
- **Pending:**
  - Live Jodo merchant integration (deferred until production deployment).
  - PostgreSQL RLS policies on financial ledger (Phase 3).

### Workstream 6: Multi-Branch Operations & Hierarchical Authorization
- **Status:** COMPLETED / HARDENED (Pre-RLS Stage)
- **Capabilities:**
  - Branch hierarchy: MAIN branches, SUB_BRANCHES, and recursive descendant traversal.
  - Multi-branch staff assignment with `EXACT_BRANCH` and `BRANCH_AND_DESCENDANTS` modes (`MembershipBranch`).
  - Historical branch attribution and branch reconciliation audit log (`BranchReconciliationAudit`).
  - Ambiguous collector routing quarantine (`AMBIGUOUS_MULTIPLE_CONFIGS`, `AMBIGUOUS_SHARED_CODE`).
  - Safe branch resolver function `fn_get_effective_branch_id` with `SECURITY INVOKER` and fixed search path.

### Workstream 7: AI Copilot, Tool Registry & FastAPI Integration
- **Status:** IN PROGRESS / VERIFIED (Phase 3B/3C baseline)
- **Capabilities:**
  - Multi-turn AI chat interface (`/app/ai`, `CopilotPanel.tsx`).
  - Conversation persistence via `CopilotThread` and `CopilotMessage`.
  - Tool execution registry with permission and branch checks (`src/lib/ai-tools.ts`).
  - FastAPI Copilot backend service integration (`COPILOT_ENGINE_URL`).
  - Encrypted AI credential vault with provider rotation (`src/lib/ai-credential-vault.ts`).
- **Pending:**
  - Canonical migration formalization for `CopilotThread` / `CopilotMessage`.

### Workstream 8: Parent/Student Portal & Communications
- **Status:** COMPLETED / FUNCTIONAL
- **Capabilities:**
  - Student and parent portal dashboard (`/portal`).
  - Online fee payment links (`/pay/[token]`).
  - Exam result viewing and download (`/portal/results/[id]`).
  - School announcements and notice board (`/app/announcements`).

### Workstream 9: Platform Administration, Billing & Subscription
- **Status:** COMPLETED / FUNCTIONAL
- **Capabilities:**
  - Platform super-admin dashboard (`/platform`).
  - Institute provisioning, lifecycle management, and suspension (`/platform/institutes`).
  - SaaS subscription plans, feature flags, and tenant usage metrics (`/platform/plans`).
  - Platform audit log and AI provider configuration (`/platform/settings/ai`).
