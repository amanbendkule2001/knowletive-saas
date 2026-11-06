# Roadmap

## Shipped in this foundation

### Platform

- Multi-tenant data model with platform/institute scopes.
- Owner console: overview, institutes, plans and entitlements, subscriptions, invoices, AI usage, platform roles, team, audit, settings.
- Support access to any active institute workspace.
- Plan create/edit with feature keys, caps, pricing, trial days and visibility.
- Trial management and manual invoice payment.

### Institute

- Role-aware overview dashboard.
- Students: CRUD, archive, CSV import/export, guardian linking.
- Parents/guardians and staff directories.
- Academics: classes, sections, subjects, capacity.
- Attendance: register upsert, day summary, feature gate.
- Fees: invoices, partial payments, waive, history, overdue tracking.
- Announcements: audiences, pin/unpin, delete, audit.
- AI Studio: six modules, credits, provider abstraction, history.
- Billing: entitlements, usage, invoices, plan changes, blocked-subscription recovery.
- Roles: templates, permission matrix, custom roles, protected admin role.
- Settings: institute profile, personal profile, password, audit trail.
- Responsive shell, dark mode, accessible primitives, empty/error states.

### Foundations

- DB-backed sessions, bcrypt, rate-limited login, session rotation.
- Server-side RBAC on pages and actions, tenant-scoped queries.
- Zod validation, audit logging, plan capacity checks.
- Provider-agnostic billing gateway and AI provider.
- Security headers, CSP, production build and typecheck clean.

---

## Next: production readiness (4–6 weeks)

### 1. Payments that settle themselves

- Implement Razorpay and Stripe adapters behind `BillingGateway`.
- Webhook route with signature verification, replay protection and idempotency keys.
- Map provider events to invoice/payment state; reconcile automatically.
- Dunning: retry schedule, reminders, grace period, downgrade rules.
- Test-mode end-to-end checkout and refunds.

### 2. Automated quality gates

- Unit tests for entitlement math, money conversion and permission helpers.
- Integration tests for tenant isolation and every server action guard.
- Browser tests for login, student create, attendance, fee payment, plan change and RBAC denial.
- CI: typecheck, build, tests, dependency audit and migration check.
- Upgrade Prisma to the next major line and clear the CLI-chain audit advisory.

### 3. Operations hardening

- Redis-backed rate limiting and shared cache.
- Error monitoring, structured logging and alerting.
- Backup/restore drill and documented RPO/RTO.
- Nonce-based CSP and removal of `unsafe-inline`.
- Staging environment with seeded, anonymized data.

### 4. Account lifecycle

- Email verification and password reset.
- Invitations with expiring tokens for staff and platform team.
- Optional MFA for platform owners and institute admins.
- Session management UI ("sign out other devices").

---

## Then: deepen the institute product (6–10 weeks)

### Parent and student portals

- Dedicated routes for `PARENT` and `STUDENT` roles.
- Child switcher, attendance calendar, fee dues and receipts, notices.
- Read-only scope enforced by guardian/student links, not just permissions.

### Examinations and report cards

- Exam terms, subjects, mark entry, grade scales and report card generation.
- AI remarks grounded in actual marks; human approval before publishing.
- Publish to parent portal; PDF export.

### Fees and finance

- Fee heads, fee structures per class, concessions and scholarships.
- Installments, late fees, receipts, ledger and reconciliation.
- Payment gateway for fee collection (separate from platform billing).
- Exportable day book and GST-ready summaries.

### Communication

- Announcement scheduling, drafts and delivery status.
- Email/SMS/WhatsApp adapters with templates and opt-outs.
- Notification preferences per guardian.
- Outbox/queue so delivery failures are retryable.

### Documents and storage

- Private object storage with signed uploads/downloads.
- Student documents, staff contracts, receipts.
- Meter `maxStorageMb` per plan and show real usage.

### Timetable and staff operations

- Period timetable, teacher allocation and substitutions.
- Leave requests and staff attendance.
- Homework/assignments with due dates.

---

## Later: scale and differentiation

- Multi-campus groups and consolidated reporting.
- Custom domains and per-institute branding.
- SSO (Google/Microsoft) for staff.
- Mobile app (React Native) for parents and staff.
- Deeper analytics: cohort retention, collection efficiency, attendance risk.
- AI copilots grounded in institute data with strict retrieval boundaries.
- Data residency options and database-per-tenant for large contracts.
- Marketplace integrations (accounting, SMS, biometric attendance).

---

## Explicit non-goals for now

- Building a full LMS (courses, video, quizzes) — integrate instead.
- Payroll and HR suites.
- Owning payment compliance beyond gateway integration.
- A native mobile app before the parent portal proves demand.

## How to choose the next slice

The highest-risk gap is **money and trust**: real payment settlement, automated tests for isolation, and operational monitoring. Ship those before adding more surface area. Parent/student portals are the highest-value product expansion because they turn the institute workspace into a product families use weekly.
