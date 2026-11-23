# Knowletive SaaS — Frontend Architecture Audit

**Document Version:** 1.0.0  
**Audit Date:** November 18, 2026  
**Auditor:** Senior Software Architect, Next.js & Frontend Engineer  
**Repository Working Directory:** `D:\IT\Saas`  
**Application Version:** `0.1.0` (Next.js `16.4.5`, React `19.3.1`, Tailwind CSS `4.3.4`)  

---

## 1. Next.js Version & Architectural Foundations

Knowletive runs on cutting-edge Next.js 16 tooling:

- **Next.js Version:** `16.4.5` (Canary / Next 16 line)
- **React Version:** `19.3.1` (React Server Components, Actions, `useActionState`, async request APIs)
- **TypeScript:** `5.9.3` with strict mode enabled
- **CSS Engine:** Tailwind CSS `4.3.4` with `@tailwindcss/postcss`
- **Routing Engine:** App Router exclusively (`src/app/`). No legacy Pages Router (`pages/`) exists.

### 1.1 Next.js 16 Concurrency Conventions

The application adheres strictly to Next.js 16 breaking architectural changes:
1. **Asynchronous Request APIs:**
   - `params` and `searchParams` in all page components are handled as `Promise<{ [key: string]: string | undefined }>` and explicitly awaited (e.g. `const sp = await searchParams;`).
   - `cookies()` and `headers()` from `next/headers` are asynchronous and awaited (e.g. `const jar = await cookies();`).
2. **Strict Server-Only Enforcement:**
   - Backend utility libraries (`src/lib/auth.ts`, `src/lib/rbac.ts`, `src/lib/db.ts`, `src/lib/ai.ts`) import `"server-only"` to prevent accidental leakage of database secrets or server logic to the client bundle.
3. **Server Actions Convention:**
   - Action files in `src/actions/*.ts` start with the `"use server"` directive and export exclusively asynchronous functions.

---

## 2. Directory Structure & Route Hierarchy

```
src/app/
├── (platform)/                  # PLATFORM GOVERNANCE CONSOLE
│   └── platform/
│       ├── layout.tsx           # Platform layout & requirePlatformPermission guard
│       ├── page.tsx             # Global overview KPIs (tenants, MRR, seats, storage)
│       ├── institutes/          # Tenant institutes directory & provisioning
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   └── [id]/page.tsx    # Tenant details, plan changes, suspension toggle
│       ├── plans/               # SaaS plan definitions & feature flags
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   └── [id]/page.tsx
│       ├── subscriptions/       # Billing subscriptions & invoice management
│       │   └── page.tsx
│       ├── ai/                  # Platform-wide AI usage & credit consumption
│       │   └── page.tsx
│       ├── roles/               # Global platform role templates & permissions
│       │   └── page.tsx
│       ├── team/                # Platform staff roster & invitations
│       │   └── page.tsx
│       ├── audit/               # Immutable system-wide audit trail
│       │   └── page.tsx
│       └── settings/            # Global platform configuration
│           └── page.tsx
│
├── (app)/                       # INSTITUTE OPERATIONAL WORKSPACE
│   └── app/
│       ├── layout.tsx           # Workspace layout, tenant resolution, staff guard
│       ├── page.tsx             # Role-aware institute dashboard (KPIs, attendance, fees)
│       ├── leads/               # Admissions CRM (capture, pipeline, conversion)
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   ├── [id]/page.tsx
│       │   ├── lead-export-button.tsx
│       │   ├── lead-import-button.tsx
│       │   └── export/route.ts  # CSV export Route Handler
│       ├── students/            # Student 360 directory & profiles
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   ├── import/page.tsx
│       │   ├── [id]/page.tsx
│       │   ├── [id]/edit/page.tsx
│       │   └── export/route.ts  # CSV export Route Handler
│       ├── parents/             # Guardian directory & student links
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   └── [id]/page.tsx
│       ├── staff/               # Faculty roster & role assignments
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   └── [id]/page.tsx
│       ├── academics/           # Academic structure (years, classes, sections, subjects)
│       │   └── page.tsx
│       ├── batches/             # Batches & cohorts management
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   ├── [id]/page.tsx
│       │   └── [id]/settings/page.tsx
│       ├── syllabus/            # SyllabusTrack curriculum tracker
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   ├── reports/page.tsx
│       │   └── [id]/page.tsx    # Chapters, topics, lesson plans cockpit
│       ├── exams/               # Exam lifecycle management
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   ├── grading/page.tsx # Grade scales & grade bands
│       │   ├── reports/page.tsx # Performance analytics & rankings
│       │   └── [id]/page.tsx    # Exam cockpit: marks entry, verification, publishing
│       ├── attendance/          # Daily attendance register & summary
│       │   └── page.tsx
│       ├── fees/                # Fee ledger, invoices, collections & receipts
│       │   ├── page.tsx
│       │   ├── new/page.tsx
│       │   └── [id]/page.tsx
│       ├── announcements/       # Noticeboard broadcasts
│       │   └── page.tsx
│       ├── ai/                  # AI Studio (one-shot generative tools)
│       │   └── page.tsx
│       ├── billing/             # Institute subscription & quota utilization
│       │   └── page.tsx
│       ├── roles/               # Institute custom RBAC matrix
│       │   └── page.tsx
│       ├── settings/            # Institute profile & configuration
│       │   └── page.tsx
│       └── forbidden/           # Workspace unauthorized landing
│           └── page.tsx
│
├── (portal)/                    # PARENT & STUDENT UNIFIED PORTAL
│   └── portal/
│       ├── layout.tsx           # Portal layout & guardian/student relationship scoping
│       ├── page.tsx             # Unified portal dashboard (attendance, dues, notices)
│       └── results/
│           └── [id]/page.tsx    # Cryptographic student report card view
│
├── api/                         # STANDALONE HTTP ROUTE HANDLERS
│   ├── cron/renewal-check/route.ts # Subscription renewal automation worker
│   └── files/[id]/route.ts      # Tenant-authorized file download proxy
│
├── login/                       # AUTHENTICATION PORTAL
│   ├── page.tsx                 # Login SSR container & demo accounts
│   └── login-form-client.tsx    # Client interactive login & 2FA entry form
│
├── select-institute/            # MULTI-TENANT SWITCHER
│   └── page.tsx                 # Organization selector for multi-membership users
│
├── pay/                         # PUBLIC PAYMENT CHECKOUT
│   └── [token]/page.tsx         # Public UPI fee settlement & UTR proof submission
│
├── layout.tsx                   # Root HTML document, fonts & theme provider
├── page.tsx                     # Public marketing landing page
├── globals.css                  # Tailwind styles & CSS variable theme tokens
├── manifest.ts                  # PWA web manifest
├── robots.ts                    # SEO robots.txt
└── sitemap.ts                   # Dynamic XML sitemap
```

---

## 3. Dashboard Experience by User Role

### 3.1 Platform Owner Dashboard (`/platform`)
- **File:** [`src/app/(platform)/platform/page.tsx`](file:///D:/IT/Saas/src/app/(platform)/platform/page.tsx)
- **Target Audience:** SaaS super-administrators and platform operators.
- **Data Displayed:**
  - Aggregated global metrics: Total Active Institutes, Monthly Recurring Revenue (MRR in ₹), Total Enrolled Students across all tenants, Storage capacity utilized in MB.
  - Recent tenant registrations with status badges (`TRIAL`, `ACTIVE`, `SUSPENDED`).
  - Quick action links to provision institutes, create SaaS plans, and inspect global audit logs.
- **Authorization Guard:** [`requirePlatformPermission("platform.overview.read")`](file:///D:/IT/Saas/src/app/(platform)/platform/layout.tsx#L10).

### 3.2 Institute Owner / Institute Admin Dashboard (`/app`)
- **File:** [`src/app/(app)/app/page.tsx`](file:///D:/IT/Saas/src/app/(app)/app/page.tsx)
- **Target Audience:** School Principals, Founders, and Super-Admin staff.
- **Data Displayed:**
  - Executive KPI Cards: Active Students, Staff Strength, Daily Attendance %, Total Fee Collections this month, Overdue Dues.
  - 14-Day Attendance Trend bar chart (Present vs Absent).
  - Recent admissions and recent fee collection feed.
  - Quick actions: Register Student, Issue Fee Invoice, Mark Attendance, Open AI Studio.
- **Authorization Guard:** Checked by [`isStaffMember(ctx)`](file:///D:/IT/Saas/src/app/(app)/app/layout.tsx#L50). Non-staff users are immediately redirected to `/portal`.

### 3.3 Teacher Dashboard (`/app`)
- **File:** [`src/app/(app)/app/page.tsx`](file:///D:/IT/Saas/src/app/(app)/app/page.tsx) & specialized sub-pages:
  - Attendance: [`/app/attendance`](file:///D:/IT/Saas/src/app/(app)/app/attendance/page.tsx)
  - SyllabusTrack: [`/app/syllabus`](file:///D:/IT/Saas/src/app/(app)/app/syllabus/page.tsx)
  - Examination Marks: [`/app/exams`](file:///D:/IT/Saas/src/app/(app)/app/exams/page.tsx)
  - Batches: [`/app/batches`](file:///D:/IT/Saas/src/app/(app)/app/batches/page.tsx)
- **Experience:** Teachers see the same layout shell, but sidebar navigation filters out administrative options (e.g. Billing, Custom Roles, Platform Settings) via `nav.permission` checks against `ctx.permissions`. Teachers interact primarily with classroom rosters, topic progress logging, lesson plan creation, and student mark entry.

### 3.4 Student Dashboard (`/portal`)
- **File:** [`src/app/(portal)/portal/page.tsx`](file:///D:/IT/Saas/src/app/(portal)/portal/page.tsx)
- **Target Audience:** Enrolled students.
- **Data Displayed:**
  - Personal student profile and section details.
  - 30-day attendance percentage with status indicators (Present, Absent, Late).
  - Upcoming timetable and enrolled subject schedules.
  - Published official report cards with cryptographic integrity verification link (`/portal/results/[id]`).
  - School announcements published to `ALL` or `STUDENTS`.
- **Data Isolation:** Strictly scoped by `where: { tenantId, userId: ctx.user.id }`.

### 3.5 Parent Dashboard (`/portal`)
- **File:** [`src/app/(portal)/portal/page.tsx`](file:///D:/IT/Saas/src/app/(portal)/portal/page.tsx)
- **Target Audience:** Mothers, fathers, and legal guardians.
- **Data Displayed:**
  - Multi-child switcher: If a parent has multiple children enrolled in the same institute, they can toggle between wards.
  - Linked child attendance calendar with absence alerts.
  - Outstanding fee invoices, payment receipts, and one-click UPI payment links.
  - Published examination report cards with subject-wise marks breakdown.
  - School broadcast announcements published to `ALL` or `PARENTS`.
- **Data Isolation:** Strictly scoped by:
  ```typescript
  guardians: { some: { guardian: { userId: ctx.user.id } } }
  ```

---

## 4. UI Framework, Design System & Shared Components

### 4.1 Design System Foundations
- **Styling Architecture:** Utility-first CSS using Tailwind CSS v4.
- **Color Palette & Theme System:** Controlled via semantic CSS custom variables in [`src/app/globals.css`](file:///D:/IT/Saas/src/app/globals.css):
  - `--background`, `--foreground`
  - `--surface`, `--surface-2`, `--surface-sunken`
  - `--border`, `--border-strong`
  - `--brand`, `--brand-soft`, `--brand-foreground`
  - `--success`, `--warning`, `--danger`, `--info`
- **Dark Mode Support:** Fully responsive Dark/Light mode implemented via [`src/components/ui/theme-toggle.tsx`](file:///D:/IT/Saas/src/components/ui/theme-toggle.tsx), persisting selection in `localStorage` and applying `.dark` class to `document.documentElement`.
- **Icons:** Standardized on `lucide-react` (version `0.545.0`).

### 4.2 Shared Primitives Component Library (`src/components/ui/`)
- **`primitives.tsx`:** Atomic building blocks:
  - `Card`, `CardHeader`: Styled container cards with header and action slots.
  - `StatCard`: KPI presentation tile with value, label, subtext, and icon slot.
  - `Badge`: Status and tag chips supporting semantic tones (`brand`, `neutral`, `success`, `warning`, `danger`, `info`).
  - `PageHeader`: Standardized top-of-page breadcrumb, title, description, and action button bar.
  - `Avatar`: Circular user initials avatar with deterministic background color.
  - `EmptyState`: Standardized empty data illustration with title, message, and call-to-action button.
  - `Callout`: Contextual alerts (info, warning, danger).
  - `Progress`: Accessible HTML progress bars.
- **`form-field.tsx`:** Standardized form controls:
  - `Field`: Accessible wrapper binding labels, inputs, helper text, and validation errors.
  - Inputs: Text input, select dropdown, textarea, radio group, checkbox.
- **`action-form.tsx`:** Accessible `<ActionForm>` wrapper for server actions with automatic pending state, disabled buttons, and inline error banners.
- **`data-table.tsx`:** Responsive tabular data grid with sorting, pagination, empty states, and custom cell formatters.
- **`charts.tsx`:** Pure SVG and CSS bar and area charts for zero-bundle-overhead dashboard analytics.
- **`feature-gate.tsx`:** `<FeatureLocked>` component rendered when a tenant attempts to view a feature disabled on their SaaS plan (e.g. AI Studio or SMS notifications).
- **`client-bits.tsx`:** Client interactive micro-components: `CopyButton`, `ConfirmButton`, `PrintButton`.

### 4.3 Shell & Navigation Architecture (`src/components/shell/`)
- **`shell.tsx`:** Responsive container rendering:
  - Collapsible desktop sidebar and mobile drawer.
  - Area branding and current institute selector.
  - Area navigation links filtered by active user permissions.
  - Top utility bar with theme switcher, notification center, and user account menu.
- **`nav.ts`:** Single declarative navigation definition for `platformNav` and `appNav`, mapping route paths to required permission keys.

---

## 5. API Client Implementation & Data Flow

### 5.1 No Client-Side REST API Client
A key finding of this audit is that **Knowletive does not use a client-side API client** (such as Axios, Redux Toolkit Query, or TanStack Query):
- No `axios` or `@tanstack/react-query` package is installed in `package.json`.
- Frontend pages do not perform `fetch('/api/v1/...')` to retrieve data.
- All data retrieval occurs during Server Component execution via Prisma ORM on Node.js.

### 5.2 End-to-End Data Flow

```
[User Browser]
      │
      │ 1. Navigates to /app/students
      │    HTTP GET (Cookies: kl_session, kl_tenant)
      ▼
[Next.js Server Runtime]
      │
      │ 2. Layout & Page Server Components execute
      │    - getSession() reads and verifies kl_session (cached in React cache)
      │    - getTenantContext() validates active tenant & permissions
      │    - requireTenantPermission("tenant.students.read") passes
      │
      │ 3. Direct DB Query via Prisma singleton
      │    db.student.findMany({ where: { tenantId: ctx.tenant.id } })
      │
      │ 4. Generates HTML & React Server Component payload
      ▼
[User Browser]
      │
      │ 5. Browser renders Student Directory with interactive Client Islands
      │
      │ 6. User submits "New Student" form
      │    Invokes createStudentAction(formData) via <form action={...}>
      ▼
[Next.js Server Runtime (Server Action)]
      │
      │ 7. authorizeTenantWrite("tenant.students.write", "create")
      │    - Verifies user has active membership and valid subscription
      │
      │ 8. Zod Schema Validation
      │    studentSchema.safeParse(formData)
      │
      │ 9. Plan Capacity Check
      │    assertStudentCapacity(ctx.tenant.id, plan.maxStudents)
      │
      │ 10. Database Transaction
      │     tx.student.create({ data: { tenantId: ctx.tenant.id, ... } })
      │
      │ 11. Immutable Audit Logging
      │     writeAudit({ action: "student.create", ... })
      │
      │ 12. Cache Revalidation & Response
      │     revalidatePath("/app/students")
      │     redirect("/app/students/" + newStudent.id)
      ▼
[User Browser]
      │
      │ 13. Browser follows redirect to new student 360 profile
```

---

## 6. Authentication State Management & Route Protection

### 6.1 State Management
- Authentication state is **strictly server-side and stateless on the client**.
- There is no global client-side store (Redux, Zustand, Pinia).
- When a page or layout renders, `getSession()` retrieves the user entity and passes the required user attributes (name, email, avatarColor, permissions) as props to server components and client shells.

### 6.2 Route Protection Mechanisms
Route protection is enforced hierarchically at three layers:

1. **Layout-Level Route Group Protection:**
   - [`src/app/(platform)/platform/layout.tsx`](file:///D:/IT/Saas/src/app/(platform)/platform/layout.tsx#L10): Executes `requirePlatformPermission("platform.overview.read")`. Non-platform users are redirected to `/app` or `/portal`.
   - [`src/app/(app)/app/layout.tsx`](file:///D:/IT/Saas/src/app/(app)/app/layout.tsx#L16): Executes `getTenantContext()`. If no tenant context exists, redirects to `/login` or `/select-institute`. If user is not staff (`!isStaffMember(ctx)`), redirects to `/portal`.
   - [`src/app/(portal)/portal/layout.tsx`](file:///D:/IT/Saas/src/app/(portal)/portal/layout.tsx#L16): Executes `getTenantContext()`. Redirects unauthenticated users to `/login`.

2. **Page-Level Permission Guards:**
   - Every operational page executes `requireTenantPermission("tenant.<module>.read")`:
     - `/app/exams/page.tsx` -> `requireTenantPermission("tenant.exams.read")`
     - `/app/fees/page.tsx` -> `requireTenantPermission("tenant.fees.read")`
     - `/app/attendance/page.tsx` -> `requireTenantPermission("tenant.attendance.read")`
   - If unauthorized, `requireTenantPermission` immediately redirects to `/app/forbidden?p=<permission>&denied=page`.

3. **Action-Level Mutation Authorizers:**
   - Every server action executes `authorizeTenantWrite("tenant.<module>.write")`. If unauthorized, it returns `{ ok: false, error: "Access denied..." }` without executing any database mutation.

### 6.3 Absence of Next.js `middleware.ts`
- **Verification:** An explicit scan confirmed that neither `src/middleware.ts` nor `middleware.ts` exists in the repository.
- **Architectural Analysis:** In Next.js Edge Middleware, database lookups with full ORMs (like Prisma with TCP engines) are constrained. Knowletive intentionally avoids Edge Middleware, choosing to resolve sessions and RBAC inside React Server Component layouts using React's `cache()` function. This guarantees that `getSession()` and `getTenantContext()` execute exactly once per request, even when shared across root layouts, nested layouts, and page components.
