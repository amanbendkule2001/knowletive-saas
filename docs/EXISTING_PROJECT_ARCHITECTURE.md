# Knowletive SaaS — Existing Project Architecture Audit

**Document Version:** 1.0.0  
**Audit Date:** November 18, 2026  
**Auditor:** Senior Software Architect, Next.js & FastAPI Engineer, PostgreSQL Database Architect & SaaS Security Auditor  
**Repository Working Directory:** `D:\IT\Saas`  
**Active Git Branch:** `staging/exam-stage-43`  
**Application Version:** `0.1.0`  

---

## 1. Executive System Overview

Knowletive is a multi-tenant SaaS operating system designed for schools, colleges, and coaching institutes in India and emerging markets. The platform manages the complete educational lifecycle: admissions CRM (leads), batch and classroom scheduling, curriculum progress tracking (SyllabusTrack), examination scheduling and cryptographic report card generation, daily attendance registers, fee management with a double-entry financial ledger and UPI payment links, broadcast announcements, and an integrated generative AI Studio.

### 1.1 Structural Topology

Unlike traditional decoupled architectures that deploy a standalone React Single-Page Application (SPA) against a standalone Python/Node REST backend, Knowletive is built as a **unified Next.js 16 full-stack server-driven application**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT BROWSER (EDGE)                           │
│  - React 19 RSC Payloads & HTML Streaming                             │
│  - Small Interactive Client Islands (Forms, Modals, Action Buttons)    │
│  - Public Payment Link Portal (/pay/[token])                           │
│  - Unified Login Portal (/login)                                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP Requests (Cookies: kl_session, kl_tenant)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                NEXT.JS 16 FULL-STACK SERVER RUNTIME                    │
│                                                                        │
│  ┌────────────────────────┐  ┌───────────────────────┐  ┌───────────┐  │
│  │ Platform Console       │  │ Institute Workspace   │  │ Portal    │  │
│  │ /platform/*            │  │ /app/*                │  │ /portal/* │  │
│  │ (Platform Owner/Staff) │  │ (Admins, Teachers)    │  │ (Parents, │  │
│  │                        │  │                       │  │  Students)│  │
│  └───────────┬────────────┘  └───────────┬───────────┘  └─────┬─────┘  │
│              │                           │                    │        │
│              ▼                           ▼                    ▼        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Security, Auth & RBAC Pipeline (src/lib/auth.ts, src/lib/rbac.ts) │  │
│  │ - Session Resolution: getSession() (React cache-wrapped)         │  │
│  │ - Tenant Context: getTenantContext() (React cache-wrapped)       │  │
│  │ - Write Authorizers: authorizeTenantWrite(), authorizePlatform() │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│  ┌──────────────────────────────────┴───────────────────────────────┐  │
│  │ Domain Service & Mutation Layer (src/actions/*.ts)               │  │
│  │ - Next.js Server Actions ("use server")                          │  │
│  │ - Zod Validation & CWE-1236 Sanitization                         │  │
│  │ - Plan Entitlements & Capacity Metering (src/lib/entitlements.ts)│  │
│  │ - Optimistic Credit Locks & AI Orchestration (src/lib/ai.ts)     │  │
│  │ - Financial Double-Entry Accounting Ledger (src/lib/payments.ts) │  │
│  │ - Examination State Machine & Cryptographic Snapshots            │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │ Parameterized Queries            │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Prisma ORM 6.19.3 Singleton Client (src/lib/db.ts)               │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      │ TCP/IP Connection Pool
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        POSTGRESQL DATABASE                             │
│  - Docker Service: postgres:18-alpine on localhost:5544                │
│  - 61 Normalized Relational Models                                     │
│  - Logical Multi-Tenant Row Isolation (tenantId on 42 operational tabs)│
│  - Immutability Triggers (fn_prevent_record_tampering)                 │
│  - XOR Check Constraints (chk_examination_target_integrity, etc.)      │
│  - Advisory Locks (pg_advisory_xact_lock) for Concurrency Control      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Layout & Architecture Map

| Directory / File | Architectural Role | Description |
| :--- | :--- | :--- |
| [`package.json`](file:///D:/IT/Saas/package.json) | Package Configuration | Defines dependencies: Next.js `16.4.5`, React `19.3.1`, Prisma `6.19.3`, Tailwind CSS `4.3.4`, Lucide React `0.545.0`, Zod `4.1.12`, Jose `6.1.0`. |
| [`prisma/schema.prisma`](file:///D:/IT/Saas/prisma/schema.prisma) | Master Data Model | 61 models covering Identity, Multi-Tenancy, Commercial SaaS, Academics, Batches, Syllabus, Exams, Financial Ledger, and AI. |
| [`prisma/migrations/`](file:///D:/IT/Saas/prisma/migrations) | SQL Migrations | Database migration version history, including core financial ledger and double-entry credit transfers. |
| [`prisma/manual/`](file:///D:/IT/Saas/prisma/manual) | Database Hardening | Manual SQL patches containing triggers, immutability functions, and check constraints. |
| [`src/app/`](file:///D:/IT/Saas/src/app) | Routing & Layouts | Next.js App Router containing 3 core route groups: `(platform)`, `(app)`, and `(portal)`, plus `/login`, `/pay/[token]`, and `/api`. |
| [`src/actions/`](file:///D:/IT/Saas/src/actions) | Server Mutation Layer | 11 Server Action modules exporting 110+ strongly-typed transactional operations (`"use server"`). |
| [`src/lib/`](file:///D:/IT/Saas/src/lib) | Domain Services | 27 service libraries implementing RBAC, authentication, rate limiting, billing, AI execution, cryptographic snapshots, and validations. |
| [`src/components/ui/`](file:///D:/IT/Saas/src/components/ui) | Design System | Atomic design primitives, form fields, action forms, data tables, SVG charts, feature gates, and theme toggles. |
| [`src/components/shell/`](file:///D:/IT/Saas/src/components/shell) | Application Shell | Responsive navigation layout, tenant switcher, user profile dropdown, and area sidebar navigation. |
| [`src/components/app/`](file:///D:/IT/Saas/src/components/app) | Interactive Client Islands | AI Studio composer, student dynamic fields, and CRM lead AI reply modal. |
| [`tests/`](file:///D:/IT/Saas/tests) | Quality & Security Gates | 27 integration, RBAC security, financial concurrency, and browser Playwright suites. |

---

## 3. Communication Paradigm: Frontend to Backend

Knowletive eliminates the traditional overhead of building and synchronizing duplicate client-side API models. Instead, it leverages Next.js 16 App Router primitives:

1. **Read Operations (Zero Client-Side Fetch):**
   - Pages are `async` React Server Components (RSC).
   - Pages directly query PostgreSQL through the Prisma client singleton (`import { db } from "@/lib/db"`).
   - No REST `fetch()` or GraphQL queries are emitted by the browser for page loading.
   - Database queries are automatically executed on the server, generating HTML and RSC JSON payloads streamed directly to the browser.

2. **Write Operations (Server Actions):**
   - Client interactive elements (forms, buttons) invoke Server Actions (`"use server"`) via React 19's `useActionState` hook or `<form action={...}>`.
   - The browser sends an HTTP `POST` request containing serialized form data or JSON parameters with Next.js internal action IDs.
   - The server resolves the session cookie, executes permission and capacity validation, runs transactional database writes, writes an immutable audit record, and executes Next.js `revalidatePath()` to refresh server caches before returning a typed `FormState` to the client.

3. **Restricted HTTP Endpoints (Route Handlers):**
   - Dedicated `route.ts` handlers are implemented exclusively for non-HTML HTTP interactions:
     - `GET /app/leads/export`: Streamed CSV download.
     - `GET /app/students/export`: Streamed CSV download.
     - `GET /api/files/[id]`: Tenant-authorized file asset proxy.
     - `POST /api/cron/renewal-check`: Automated subscription check invoked by external schedulers.

---

## 4. Multi-Tenancy & Data Isolation Model

Knowletive operates a **shared-database, shared-schema logical multi-tenancy model**.

- **Row Scoping:** 42 operational database tables feature an indexed `tenantId` foreign key referencing the `Tenant` table.
- **Tenant Context Resolution:** On every incoming request, `getTenantContext()` in [`src/lib/auth.ts`](file:///D:/IT/Saas/src/lib/auth.ts#L336) reads the `kl_tenant` cookie, matches it against the authenticated user's active memberships, and attaches the validated `TenantContext`.
- **Query Scoping:** Every Prisma query and raw SQL query explicitly scopes by `tenantId: ctx.tenant.id`.
- **Pessimistic Row Locking:** Cross-row mutation workflows (such as exam mark revisions or fee settlement) execute SQL row locks with explicit tenant scoping:
  ```sql
  SELECT id, status, "isPublished"
  FROM "Examination"
  WHERE id = $1 AND "tenantId" = $2
  FOR UPDATE
  ```
- **Database Triggers:** Critical operational tables (`ExamResultSnapshot`, `ExamMarksRevisionEvent`, `BatchEnrollmentEvent`, `SyllabusProgressEvent`) are guarded by PostgreSQL database triggers (`fn_prevent_record_tampering()`) that block `UPDATE`, `DELETE`, and `TRUNCATE` operations at the database engine level.

---

## 5. Commercial Architecture & Entitlements

Knowletive implements a commercial metering model defined in [`src/lib/catalog.ts`](file:///D:/IT/Saas/src/lib/catalog.ts#L305) and [`src/lib/entitlements.ts`](file:///D:/IT/Saas/src/lib/entitlements.ts):

- **Plans:** Four predefined tiers (`starter`, `growth`, `scale`, `enterprise`).
- **Feature Flags:** 16 feature flags (e.g., `core`, `attendance`, `fees`, `academics`, `staff`, `ai`, `sms`, `whatsapp`, `api_access`, `white_label`).
- **Capacity Caps:** Every plan enforces limits on `maxStudents`, `maxStaff`, `maxStorageMb`, and `aiCreditsMonthly`.
- **Subscription Lifecycle:** Subscriptions cycle through `TRIALING`, `ACTIVE`, `PAST_DUE`, `PAUSED`, `CANCELED`, and `EXPIRED`.
- **Blocked State Behavior:** When a tenant's subscription enters `PAST_DUE` or `PAUSED`, `requireTenantWrite` and `authorizeTenantWrite` intercept mutations, allowing read-only access to billing ground truth while blocking operational writes.

---

## 6. Implementation Status Matrix

| Module / Component | Implementation Status | Verification Evidence / Location |
| :--- | :---: | :--- |
| **Authentication & Sessions** | **Verified Working** | `src/lib/auth.ts`, `src/actions/auth.ts`, DB-backed hashed sessions, bcrypt, TOTP 2FA. |
| **RBAC Authorization** | **Verified Working** | `src/lib/rbac.ts`, `src/lib/catalog.ts`, dual-scope permission matrix, tested in `tests/qa-security-rbac.test.ts`. |
| **Multi-Tenant Isolation** | **Verified Working** | `tenantId` foreign keys across 42 tables, IDOR tests verified in `tests/cross-tenant-isolation.test.ts`. |
| **Platform Console** | **Verified Working** | `src/app/(platform)/platform/*`, tenant provisioning, plans, subscription invoicing, audit logs. |
| **Institute Administration** | **Verified Working** | `src/app/(app)/app/*`, institute settings, custom roles, staff invitation. |
| **Admissions CRM (Leads)** | **Verified Working** | `src/app/(app)/app/leads/*`, `src/actions/leads.ts`, lead conversion, bounded duplicate check, CSV import/export. |
| **Student & Guardian Management** | **Verified Working** | `src/app/(app)/app/students/*`, `src/app/(app)/app/parents/*`, `src/actions/students.ts`, CSV import. |
| **Batch Management** | **Verified Working** | `src/app/(app)/app/batches/*`, `src/actions/batches.ts`, teacher assignment, student transfers, capacity checks. |
| **SyllabusTrack Curriculum** | **Verified Working** | `src/app/(app)/app/syllabus/*`, `src/actions/syllabus.ts`, chapters, topics, lesson plans, progress events. |
| **Examination Management** | **Verified Working** | `src/app/(app)/app/exams/*`, `src/actions/exams.ts`, `src/lib/exam-lifecycle.ts`, results publishing, SHA-256 snapshots. |
| **Attendance Management** | **Verified Working** | `src/app/(app)/app/attendance/*`, `src/actions/operations.ts`, upsert register, absence alerts. |
| **Fees & UPI Payment Links** | **Verified Working** | `src/app/(app)/app/fees/*`, `src/actions/operations.ts`, `src/app/pay/[token]/*`, public QR generation, UTR verification. |
| **Core Financial Ledger (Stage 1-2)**| **Verified Working** | `PaymentReceipt`, `PaymentAllocation`, `PaymentAllocationReversal`, `StudentCreditAccount`, `CreditTransferJournal`. |
| **Parent & Student Portal** | **Verified Working** | `src/app/(portal)/portal/*`, guardian-student row-filtered attendance, invoices, published report cards. |
| **Existing AI Studio** | **Present (Synchronous)** | `src/lib/ai.ts`, `src/actions/operations.ts`, 6 modules, credit metering, OpenAI / Mock provider. |
| **Background Job Processing** | **Incomplete / Missing** | Relies on synchronous actions or HTTP cron (`/api/cron/renewal-check`). No persistent worker queue (Redis / Celery). |
| **AI Streaming / Copilot Chat** | **Missing** | Existing AI module is one-shot synchronous form generation; no streaming chat, no multi-turn thread persistence. |
| **Supplied `copilot_engine.zip`** | **Not Present in Workspace** | Referenced in requirements as external engine; not found in local workspace filesystem. |

---

## 7. High-Level Architectural Summary

The existing Knowletive platform is a monolithic, enterprise-grade Next.js 16 full-stack application with strict multi-tenant row isolation and robust PostgreSQL database protections. The architecture cleanly separates platform administration, institute workspace, and stakeholder portals. Because it does not use a separate REST API backend, any external service — such as an AI Copilot engine — must integrate via a dedicated, secure Next.js API Gateway layer (Route Handlers) using authenticated service-to-service communication.
