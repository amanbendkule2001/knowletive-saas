# Architecture

## 1. Shape of the system

Knowletive is a single Next.js deployment backed by one PostgreSQL database. There is no separate API service; pages and writes run on the server through React Server Components and server actions.

```
Browser
  │  HTML / RSC payloads, server-action POSTs
  ▼
Next.js 16 (App Router)
  ├─ src/app/(platform)  → platform owner console
  ├─ src/app/(app)       → institute workspace
  ├─ src/actions/*        → authenticated write paths
  ├─ src/lib/*            → auth, RBAC, entitlements, billing, AI, audit
  └─ Prisma
        ▼
   PostgreSQL
```

Two route groups share one design system but have separate layouts and guards:

- `/platform/*` — platform owner/support console.
- `/app/*` — institute workspace, scoped to the active tenant.

## 2. Request lifecycle

1. **Session resolution.** `getSession()` reads the `kl_session` HTTP-only cookie, hashes the token, and loads the session, user, platform permissions and tenant memberships. It is wrapped in React `cache()` so a request resolves it once.
2. **Tenant resolution.** `getTenantContext()` reads `kl_tenant` (or falls back to the user's first membership), loads the tenant with its subscription and plan, and returns a `TenantContext` containing the permission set and subscription state.
3. **Authorization.** Pages call `requireTenantPermission("tenant.x.read")` or `requirePlatformPermission("platform.x.read")`. Actions call the same guards plus `requireTenantWrite()` where a blocked subscription must prevent writes.
4. **Data access.** Queries are scoped by `tenantId` in the `where` clause. The active tenant is never taken from a request body.
5. **Mutation.** Server actions validate with Zod, enforce permissions and plan limits, write in a transaction where multiple rows change, append an audit entry, and revalidate affected paths.
6. **Render.** Server components render the page; small client islands are used only where interaction requires state (account menu, theme, AI composer, data-table filters, confirm buttons).

Next.js 16 specifics used here: `params`/`searchParams` are promises, and `cookies()`/`headers()` are async. Server action modules (`"use server"`) export only async functions.

## 3. Folder map

```
src/
  actions/          server actions grouped by domain
    auth.ts         login, logout, switch tenant, password
    platform.ts     institutes, plans, subscriptions, platform team/roles
    admin.ts        tenant roles, settings, profile, plan changes
    students.ts     student CRUD and CSV import
    operations.ts   attendance, fees, announcements, AI
  app/
    (platform)/     platform console layout + pages
    (app)/          institute workspace layout + pages
    login/          shared sign-in
    page.tsx        marketing landing page
  components/
    app/            feature islands (AI composer, student fields)
    ui/             design system: primitives, forms, tables, charts, shell
  lib/
    db.ts           Prisma singleton
    auth.ts         sessions, tenant context, support access
    rbac.ts         page/action guards
    catalog.ts      permissions, role templates, plans, features, AI modules
    entitlements.ts plan feature checks, capacity checks, usage
    billing.ts      BillingGateway, quotes, invoice creation
    ai.ts           provider abstraction, metering, job lifecycle
    audit.ts        audit writer
    rate-limit.ts   fixed-window limiter
    validation.ts   Zod schemas + FormState helpers
    format.ts       currency, dates, percentages
prisma/
  schema.prisma     data model
  seed.ts           destructive demo data
```

## 4. Data model

The Prisma schema is organized around a few clusters.

**Identity and access**

- `User` — one login identity, optionally a platform owner.
- `Session` — hashed session token, expiry, revocation, IP/user agent.
- `Membership` — joins a user to a tenant with a role.
- `Role`, `Permission`, `RolePermission` — scoped to `PLATFORM` or `TENANT`.
- `Tenant` — institute profile, status, type, branding.

**Commercial**

- `Plan` — limits, feature keys, prices, trial days.
- `TenantSubscription` — plan, cycle, period, seats, status.
- `Invoice`, `Payment` — platform subscription invoices and their payments.
- `TenantUsage` — reserved for usage metering beyond live counts.

**Institute operations**

- `AcademicYear`, `ClassLevel`, `Section`, `Subject`.
- `Student`, `Guardian`, `StudentGuardian`.
- `Attendance` — unique per `(studentId, date)`.
- `FeeInvoice`, `FeePayment`.
- `Announcement`.
- `AiJob`.
- `AuditLog`, `Setting`.

All money is stored as **integer minor units** (paise for INR). Plans, platform invoices, fee invoices and fee payments follow this rule. `src/lib/format.ts` formats with `Intl.NumberFormat("en-IN")`.

## 5. Tenancy and isolation

There is one database and a shared schema. Isolation is enforced in application code:

- Every institute-scoped model has a `tenantId`.
- Every query and action obtains `tenantId` from `getTenantContext()`.
- Record lookups by id always include `tenantId` in the filter, e.g. `where: { id, tenantId: ctx.tenant.id }`.
- Mutations re-check permissions server-side; hiding a button is never the control.
- Platform owners get support access to a tenant only by explicitly selecting it (`kl_tenant` cookie), and only when the institute is not churned.

This is deliberately simple. If the product later needs database-level isolation, the `tenantId` column on every model is the migration seam.

## 6. RBAC

`src/lib/catalog.ts` is the single source of truth for permissions, role templates and feature keys. The database stores roles and their permissions so institutes can create custom roles.

- Platform roles: owner, support and any custom platform roles. The `PLATFORM_OWNER` role is locked.
- Tenant roles: `INSTITUTE_ADMIN` is locked and always has full access so an institute cannot lock itself out. Other templates: Principal, Teacher, Accountant, Front Desk, Parent, Student.
- Pages use `requireTenantPermission` / `requirePlatformPermission`.
- Actions use the same guards. `requireTenantWrite` also blocks writes when the subscription is `PAST_DUE`, `PAUSED`, `EXPIRED` or `CANCELED`, redirecting to billing so the admin can recover.
- Unauthorized pages redirect to `/app/forbidden?p=<permission>`, which explains what was required.

## 7. Entitlements and plan limits

A plan carries a list of feature keys and numeric caps.

- `hasFeature(plan, key)` gates pages such as attendance, academics, fees, announcements and AI. `FeatureLocked` renders an upgrade path.
- `assertStudentCapacity` / `assertStaffCapacity` run inside create flows and fail closed before a record is written.
- `usageSnapshot()` counts live usage for the billing page.
- Changing a plan updates the subscription immediately, sets the tenant active, and raises an open invoice for the new period.

## 8. Billing

`BillingGateway` is the provider seam:

```ts
interface BillingGateway {
  id: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  verifyWebhook(rawBody: string, signature: string | null): Promise<boolean>;
}
```

- `manual` is implemented: create an invoice, pay by transfer, platform marks it paid.
- `razorpay` and `stripe` currently throw a clear "keys not configured" error until adapters are added. The UI and invoice logic do not change when they are.
- Quotes apply 18% GST for INR and zero tax for other currencies.
- Platform invoices are numbered `INV-<year>-<sequence>`; fee invoices use an institute prefix.

Adding a real provider means implementing the two methods, verifying signatures in a webhook route, and marking the invoice paid with the provider reference. The rest of the product is already keyed off invoice state.

## 9. AI

`src/lib/ai.ts` exposes one `runAiJob()` path.

1. Check the `ai` feature and the monthly credit cap from the plan.
2. Create an `AiJob` row with module, prompt, credit cost and status.
3. Call the configured provider:
   - **mock** — deterministic, useful output with no keys (default).
   - **openai** — OpenAI-compatible chat completions via `AI_PROVIDER`/`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL`.
4. Persist output, token counts, provider/model and status.
5. On failure, mark the job failed and release credits.

Credits used are computed from successful jobs in the current billing month. The AI Studio page is server-rendered; only the module picker and prompt form are a client island (`AiComposer`).

## 10. UI and performance

- Tailwind v4 with CSS variables for light/dark themes.
- The shell is a server component; only the mobile drawer, account menu, theme toggle and confirm dialogs ship client JavaScript.
- Tables are server-paginated. Search and filters are URL state, so pages stay linkable and cache-friendly.
- `lucide-react` is listed in `optimizePackageImports`; icons are tree-shaken.
- Charts are lightweight CSS/SVG components rather than a charting library.
- Fonts and assets are self-hosted or framework-managed; no blocking third-party scripts.
- The marketing and auth pages are static or lightly dynamic; institute pages are dynamic because they depend on session and tenant state.

For low-end devices, the main levers are already in place: server rendering, small client islands, no heavy table/grid dependency, and no external UI kit. See [SECURITY.md](./SECURITY.md) for the production hardening checklist.

## 11. Extension points

| Need | Where to extend |
| --- | --- |
| Real payments | `src/lib/billing.ts` + a webhook route |
| Real AI provider | `src/lib/ai.ts` (`generateWithProvider`) |
| Parent/student portal | New route group guarded by existing roles/permissions |
| Exams and report cards | New models + actions; reuse students/academics |
| File storage | `TenantUsage`, a storage adapter, signed uploads |
| Notifications | A queue/outbox table; announcements already model audiences |
| Horizontal scaling | Move rate limiting to Redis; add a shared cache |
| Database-per-tenant | Migrate on the existing `tenantId` seam |

## 12. Testing and verification

- `npm run typecheck` — TypeScript across app, actions and Prisma types.
- `npm run lint` — ESLint core-web-vitals + TypeScript rules.
- `npm run build` — production build and route compilation.
- The seed is the fixture set for manual smoke tests. Key flows exercised during development: login/logout, role-based forbidden redirects, student creation, attendance upsert, partial fee payment, AI generation, plan change, platform invoice payment, announcement publish/pin/delete, custom role create/delete, CSV export.

Automated unit/integration tests are a roadmap item; the current verification is typecheck, production build and browser smoke tests.
