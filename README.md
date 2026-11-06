# Knowletive

**Knowletive** is a multi-tenant SaaS platform for schools, coaching institutes and colleges. It gives a platform team one console to run every institute, and gives each institute a secure workspace for admissions, people, attendance, fees, announcements and AI-assisted admin work.

The product is a working foundation: every route, permission and write path in this repository is implemented and typechecked, not a static mockup. Payment-gateway keys and an AI key can be added later without changing the UI.

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16 (App Router, server components, server actions) |
| UI | React 19, Tailwind CSS v4, custom design system |
| Data | PostgreSQL 18 + Prisma 6 |
| Auth | Database-backed sessions, `bcryptjs`, HTTP-only cookies |
| Validation | Zod 4 |
| Billing | Provider-agnostic gateway (`manual` today; Razorpay/Stripe adapters later) |
| AI | Provider abstraction with a deterministic demo provider and an OpenAI-compatible adapter |

## Quick start

Requirements: Node.js 20+, npm, and PostgreSQL 16+ (or Docker Desktop).

```powershell
cd D:\IT\Saas
npm install

# Start the bundled Postgres (host port 5544)
npm run db:up

# Create .env from the example and review it
Copy-Item .env.example .env

# Generate Prisma client, push the schema, load demo data
npm run setup

npm run dev
```

Open <http://localhost:3000>.

> If you already run PostgreSQL locally on port 5432, point `DATABASE_URL` at that instance and skip `npm run db:up`. The Docker Compose file publishes Postgres on **5544** to avoid clashing with a local server.

### Demo accounts

All demo accounts use the password **`Admin@123`**.

| Role | Email | Lands on |
| --- | --- | --- |
| Platform owner | `owner@knowletive.com` | `/platform` |
| Platform support | `support@knowletive.com` | `/platform` |
| Institute admin | `admin@sunrise.test` | `/app` (Sunrise Public School) |
| Teacher | `teacher@sunrise.test` | `/app` (limited permissions) |

The seed creates five institutes, four plans, 288 students, attendance, fee invoices and payments, platform invoices, AI jobs and audit history. **`npm run db:seed` is destructive** — it clears the domain tables before rebuilding the demo. Use a separate database for real data.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run typecheck` | TypeScript with `--noEmit` |
| `npm run lint` | ESLint with the Next.js core-web-vitals and TypeScript rules |
| `npm run setup` | Prisma generate + schema push + seed |
| `npm run db:up` / `db:down` | Start/stop the Docker Postgres |
| `npm run db:push` | Push the Prisma schema |
| `npm run db:seed` | Rebuild demo data (destructive) |
| `npm run db:studio` | Open Prisma Studio |

## What is included

### Platform console (`/platform`)

- Overview: institutes, MRR, students, outstanding invoices, plan mix, AI usage.
- Institutes: search, create, detail, suspend/reactivate, open a workspace in support mode.
- Plans and entitlements: create/edit plans, limits, features, pricing, trial days.
- Subscriptions and invoices: filter, extend trials, mark invoices paid.
- AI usage across institutes.
- Platform roles and team management.
- Audit log and platform settings.

### Institute workspace (`/app`)

- Overview dashboard tailored to the signed-in role.
- Students: list, search, filter, create, edit, profile, CSV import and export, archive.
- Parents/guardians and staff directories with linked records.
- Academics: classes, sections, subjects, capacity; gated by plan.
- Attendance: daily register per section, upsert on re-mark, day summary.
- Fees: invoices, partial payments, waive, payment history, overdue tracking.
- Announcements: audience targeting, pin/unpin, delete, read-only fallback.
- AI Studio: six metered modules, credit meter, generation history, copy/delete.
- Billing: plan usage, entitlements, invoices, plan changes, recovery when blocked.
- Roles: templates, permission matrix, custom roles, protected admin role.
- Settings: institute profile, personal profile/avatar, password change, audit trail.

### Cross-cutting

- Server-side tenant isolation on every scoped query and action.
- Permission checks on pages **and** server actions, not only hidden buttons.
- Plan feature gates with an upgrade UI, plus capacity checks on writes.
- Audit logging for sensitive mutations.
- Responsive shell with mobile navigation and dark mode.
- Money stored as integer minor units (paise) and rendered with `Intl.NumberFormat`.

## Configuration

Copy `.env.example` to `.env`. The important values:

```dotenv
DATABASE_URL="postgresql://knowletive:knowletive@localhost:5544/knowletive?schema=public"
SESSION_SECRET="replace-with-64-random-characters"
APP_URL="http://localhost:3000"
BILLING_PROVIDER="manual"        # manual | razorpay | stripe
BILLING_CURRENCY="INR"
AI_PROVIDER="mock"               # mock | openai
```

- **Billing** works with `manual` and no keys. Invoices are raised; the platform team marks them paid. Razorpay/Stripe are selected with `BILLING_PROVIDER` and their keys, behind the same `BillingGateway` interface.
- **AI** works with no keys using a deterministic demo provider. Set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and optionally `OPENAI_BASE_URL`/`OPENAI_MODEL` for live, OpenAI-compatible generation.
- **`SESSION_SECRET`** should be a long random value in every non-local environment. See [SECURITY.md](./SECURITY.md).

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — layers, request flow, tenancy, billing, AI, data model.
- [SECURITY.md](./SECURITY.md) — controls, production checklist, known gaps.
- [docs/ROADMAP.md](./docs/ROADMAP.md) — what is shipped and what comes next.

## Status

This is a production-minded foundation, not a finished commercial product. The core multi-tenant model, RBAC, entitlements, billing abstraction and main institute workflows are implemented. Remaining work is concentrated in payment webhooks, richer parent/student portals, examinations/report cards, document storage and operational hardening. The roadmap tracks it explicitly.
