# Knowletive SaaS — Platform Administration Guide

## Document Information
- **Title:** SaaS Platform Administration & Operations Guide
- **Document ID:** DOC-02-PLATFORM-ADMIN
- **Target Audience:** SaaS Platform Owners, Cloud Operations, Customer Support Engineers, Technical Onboarding Leads
- **Classification:** Administrative Standard Operating Procedure (SOP)
- **Repository Location:** `docs/knowletive-functional-handbook/02-PLATFORM-ADMINISTRATION-GUIDE.md`

---

## Table of Contents
1. [Platform Architecture & Console Access](#1-platform-architecture--console-access)
2. [Institute Lifecycle Management (`/platform/institutes`)](#2-institute-lifecycle-management-platforminstitutes)
3. [Subscription Plans & Tier Architecture (`/platform/plans`)](#3-subscription-plans--tier-architecture-platformplans)
4. [Subscription Operations & Renewals (`/platform/subscriptions`)](#4-subscription-operations--renewals-platformsubscriptions)
5. [AI Telemetry, Metering & Token Governance (`/platform/ai`)](#5-ai-telemetry-metering--token-governance-platformai)
6. [Platform Team & Role Management (`/platform/roles`, `/platform/team`)](#6-platform-team--role-management-platformroles-platformteam)
7. [Platform Security & Global Audit Logging (`/platform/audit`)](#7-platform-security--global-audit-logging-platformaudit)
8. [Platform Settings & System Maintenance (`/platform/settings`)](#8-platform-settings--system-maintenance-platformsettings)
9. [Automated Renewal & Background Cron Infrastructure (`/api/cron/renewal-check`)](#9-automated-renewal--background-cron-infrastructure-apicronrenewal-check)
10. [Troubleshooting & Support Escalation Procedures](#10-troubleshooting--support-escalation-procedures)

---

## 1. Platform Architecture & Console Access

The **Platform Administration Console** (`/platform`) is the mission control center for the SaaS operator. It is strictly segregated from individual school workspaces and provides global visibility over all subscriber institutes.

### 1.1 Access Control & Authentication
- **Access Guard:** Enforced by `requirePlatform()` in `src/lib/auth.ts`.
- **RBAC Rules:** The active user session must have `isPlatformOwner: true` on the `User` record or possess a platform-level membership with `platform.*` permission keys.
- **Unauthorized Handling:** Any non-platform user attempting to access `/platform` is immediately redirected to `/login` with a `403 Forbidden` status.

---

## 2. Institute Lifecycle Management (`/platform/institutes`)

### 2.1 Viewing Institutes Directory
- **Route:** `/platform/institutes`
- **Interface:** Searchable table listing all registered institutes with columns:
  - **Institute Name & Code:** Registered legal or operating name.
  - **Slug:** Unique URL identifier (e.g., `sunrise`).
  - **Status Badge:** `ACTIVE`, `SUSPENDED`, or `PENDING_SETUP`.
  - **Subscription Tier:** Assigned plan (Core, Growth, Scale).
  - **Student Count:** Current active students vs plan capacity limit.
  - **Created Date:** Registration timestamp.

### 2.2 Provisioning a New Institute (`/platform/institutes/new`)
To onboard a new school or academy:
1. Navigate to **Institutes** -> Click **+ Add Institute**.
2. **Form Fields:**
   - **Institute Name:** Full name of the institution (e.g., "Sunrise International Academy").
   - **Slug:** Unique lowercase alphanumeric string (e.g., `sunrise`). Used for URL routing.
   - **Contact Email:** Primary administrative email for communication.
   - **Contact Phone:** Administrative phone number.
   - **Address & Country:** Physical location and jurisdiction.
   - **Currency Code:** Default operating currency (e.g., `USD`, `INR`, `EUR`).
   - **Initial Plan:** Select from available subscription tiers.
   - **Admin User Details:** Name and email of the school's primary `INSTITUTE_ADMIN`.
3. **Execution:** Submitting invokes `createInstituteAction` in `src/actions/platform.ts`.
4. **Database Transaction:**
   - Creates a `Tenant` record.
   - Creates a `User` record for the school administrator.
   - Assigns the default `INSTITUTE_ADMIN` role via a `Membership` record.
   - Creates an initial `Subscription` record tied to the selected plan.
   - Generates an immutable audit event in `AuditLog`.

### 2.3 Managing Institute Status (`/platform/institutes/[id]`)
- **Status Toggle:** Operators can set an institute's status to `SUSPENDED` (e.g., for non-payment or policy violation) using `toggleInstituteStatusAction`.
- **Impact of Suspension:** When an institute is suspended, all staff, teachers, students, and parents under that tenant are immediately blocked from logging in or mutating records; API calls return `403 Tenant Suspended`.

---

## 3. Subscription Plans & Tier Architecture (`/platform/plans`)

Knowletive provides a flexible SaaS plan management engine:

### 3.1 Plan Tiers & Limits
Plans are categorized into standard business tiers:
1. **Core:** Designed for small tuition centres or single-branch coaching institutes (up to 250 students).
2. **Growth:** Designed for mid-sized private schools (up to 1,000 students, includes AI Studio and advanced exams).
3. **Scale:** Designed for large educational institutions or multi-campus networks (unlimited students, dedicated support, custom AI tokens).

### 3.2 Plan Configuration Fields
- **Plan Name & Code:** Identifier (e.g., `plan_growth_annual`).
- **Billing Interval:** `MONTHLY` or `YEARLY`.
- **Price & Currency:** Base subscription fee.
- **Max Student Limit:** Hard ceiling on active student enrollments.
- **Included AI Tokens:** Monthly AI generation token allotment.
- **Feature Flags:** Modular toggles enabling/disabling specific modules (e.g., `feature_exams`, `feature_ai`, `feature_sms`).

---

## 4. Subscription Operations & Renewals (`/platform/subscriptions`)

### 4.1 Viewing Active Subscriptions
- **Route:** `/platform/subscriptions`
- Displays active subscriptions across all tenants with expiration dates, renewal statuses, and pending invoices.

### 4.2 Manual Renewal & Plan Changes
- When a customer upgrades or renews out-of-band (e.g., via direct bank wire), the platform operator opens the tenant's subscription detail:
  - Invokes `createSubscriptionAction` or `updateSubscriptionAction`.
  - Sets the new `currentPeriodEnd` timestamp.
  - Updates plan tier and student limits.

### 4.3 Cancellation Handling
- Invoking `cancelSubscriptionAction` sets `cancelAtPeriodEnd: true` or performs immediate cancellation, transitioning the tenant to read-only status upon period expiration.

---

## 5. AI Telemetry, Metering & Token Governance (`/platform/ai`)

### 5.1 Real-Time AI Utilization Dashboard
- **Route:** `/platform/ai`
- Monitors API calls to the generative AI engine (Gemini API) across modules:
  - Lesson Plan Generation
  - Exam Question Creation
  - Student Feedback Synthesis
- **Metrics Tracked:** Total Tokens Consumed, Cost Estimation, Requests by Module, Institute Leaderboard.

### 5.2 Quota Enforcement
- Each subscription plan includes a designated token quota per billing cycle.
- If an institute exhausts its quota, AI generation actions (`src/actions/ai.ts`) return a friendly error: `"Monthly AI quota exceeded. Please upgrade your plan in Institute Billing."`

---

## 6. Platform Team & Role Management (`/platform/roles`, `/platform/team`)

### 6.1 Platform Team Directory (`/platform/team`)
- Manage internal SaaS staff: DevOps, Customer Support, and Product Operations.
- **Invite Member:** Invokes `invitePlatformUserAction` to dispatch onboarding credentials.

### 6.2 Platform Roles & Permissions (`/platform/roles`)
Platform permissions are distinct from tenant permissions:
- `platform.overview.read`
- `platform.institutes.read` / `platform.institutes.manage`
- `platform.plans.read` / `platform.plans.manage`
- `platform.subscriptions.read` / `platform.subscriptions.manage`
- `platform.roles.read` / `platform.roles.manage`
- `platform.users.read` / `platform.users.manage`
- `platform.audit.read`
- `platform.ai.read`
- `platform.settings.manage`

---

## 7. Platform Security & Global Audit Logging (`/platform/audit`)

### 7.1 Security Audit Trail
- **Route:** `/platform/audit`
- Every sensitive platform action is immutably written to the `AuditLog` table.
- **Captured Attributes:**
  - Timestamp (UTC)
  - Operator User ID & Email
  - Action Category (e.g., `TENANT_SUSPENDED`, `PLAN_UPDATED`)
  - Target Entity ID
  - Client IP Address & User Agent
  - Metadata Diff (Previous State vs New State)

---

## 8. Platform Settings & System Maintenance (`/platform/settings`)

- **System Maintenance Mode:** Toggle global maintenance banner for planned infrastructure upgrades.
- **Default System Parameters:** Global session timeouts, password complexity rules, and default localized date formats.

---

## 9. Automated Renewal & Background Cron Infrastructure (`/api/cron/renewal-check`)

### 9.1 Cron Architecture
- **Endpoint:** `/api/cron/renewal-check`
- **Execution Frequency:** Scheduled daily at `00:00 UTC` via external task scheduler or cloud cron.
- **Authentication:** Protected via secret bearer header `Authorization: Bearer <CRON_SECRET>`.

### 9.2 Renewal Check Algorithm
1. Queries all active subscriptions where `currentPeriodEnd <= NOW()`.
2. For each expired subscription:
   - If auto-renew is enabled and payment provider confirms renewal, advances `currentPeriodEnd` by the plan interval.
   - If expired without renewal, transitions subscription status to `PAST_DUE`.
   - If past due beyond grace period (e.g., 7 days), sets status to `EXPIRED` and suspends tenant write access.
3. Records all automated state transitions in the platform audit log.

---

## 10. Troubleshooting & Support Escalation Procedures

| Issue | Diagnostic Step | Resolution Action |
|:---|:---|:---|
| **Institute cannot log in** | Check `/platform/institutes` status. | If `SUSPENDED`, verify billing with finance; toggle back to `ACTIVE` via UI. |
| **"Student Capacity Exceeded" error** | Check student count on tenant profile. | Tenant has hit plan max limit. Advise upgrade to Growth/Scale plan or adjust limit. |
| **AI Generation failing** | Inspect `/platform/ai` token consumption. | Quota exhausted. Grant bonus token top-up or upgrade subscription plan. |
| **Suspicious login activity** | Query `/platform/audit` for client IP. | Terminate user sessions and trigger password reset via `resetPasswordAction`. |

---

