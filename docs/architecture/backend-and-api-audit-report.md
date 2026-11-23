# Backend & API Architecture Audit Report

**Author:** Agent 3 (Backend and API)  
**Date:** November 21, 2026  
**Scope:** Application database connection usage across Next.js and FastAPI Copilot, Prisma clients and connection initialization, background jobs, webhook processing, cron jobs, financial consumer attribution, and secret handling review.

---

## 1. Executive Summary

This audit assesses the backend and API tiers of the Knowletive SaaS platform across Next.js 16 and the Python FastAPI Copilot Engine. The audit found strong adherence to architectural boundaries (e.g. Next.js as the sole database gateway, HMAC service tokens, AES-256-GCM encrypted credentials in transit, zero leaked secrets in logs). Key recommendations focus on connection pool tuning, formalizing webhook route handlers, and making concurrent receipt numbering race-free.

---

## 2. Database Connection Usage & Prisma Client Audit

### 2.1 Next.js 16 Application Runtime
- **Client Instantiation & Singleton Pattern:**
  - Instantiation is strictly centralized in `src/lib/db.ts`.
  - Development mode uses the canonical `globalThis.prisma` pattern to prevent connection leaks across Hot Module Reloading (HMR).
  - In the entire application code (`src/`), there are **zero rogue instantiations** of `new PrismaClient()`. All modules import `db` from `@/lib/db`.
- **Connection Pooling & Concurrency Limits:**
  - `prisma/schema.prisma` configures `datasource db { provider = "postgresql", url = env("DATABASE_URL") }` without specifying `directUrl`.
  - Neither `.env.example` nor default `DATABASE_URL` specifies connection pool limits (`connection_limit`) or timeout parameters (`pool_timeout`).
  - By default, Prisma opens `num_physical_cpus * 2 + 1` connections per Node.js process. In multi-worker containerized environments or serverless scaling, total concurrent connections can exhaust PostgreSQL's `max_connections` (typically 100).
- **Recommendation:**
  1. Add `directUrl = env("DIRECT_DATABASE_URL")` in `schema.prisma` for migration runs and administrative scripts.
  2. Append connection pool constraints to `DATABASE_URL` in production (e.g. `?connection_limit=10&pool_timeout=20`).
  3. When transitioning to the non-superuser `knowletive_app` pool (Workstream 3 / Agent 2), use a PgBouncer transaction pooler.

### 2.2 FastAPI Copilot Engine Integration
- **Direct Database Access:** **NONE (0 connections)**.
- **Architectural Boundary:**
  - The Python FastAPI service (`copilot_engine`) is strictly a stateless reasoning and streaming microservice.
  - As verified in `docs/PHASE_3A_PYTHON_COPILOT_INTEGRATION.md` and integration suites (`tests/copilot-engine-integration.test.ts`), the Python service maintains **zero direct PostgreSQL connections** and executes no SQL.
  - All database queries and metric retrievals are delegated back to the Next.js API via `POST /api/copilot/tools/execute`.
- **Inter-Service Security Contract:**
  - Authentication: Next.js signs short-lived HMAC tokens (`X-Copilot-Service-Token`, 60s TTL) using HKDF-derived keys.
  - Authorization & Isolation: Tool callbacks verify token signatures, validate `jti` single-turn nonces (max 10 callbacks per turn), and match `X-Tenant-Id` and `X-User-Id` headers against service token claims before resolving database context.
  - Credential Protection: Provider credentials (Groq API keys) forwarded to the engine are encrypted using HKDF-derived AES-256-GCM (`encryptPayloadForEngine`).

---

## 3. Background Jobs Audit

- **Infrastructure:**
  - No external asynchronous message brokers (e.g., Redis, BullMQ, Celery, RabbitMQ, SQS) are installed in `package.json` or running in production.
- **In-Process Background Operations:**
  - **Audit Logging (`src/lib/audit.ts`):** Operates either atomically within a passed `tx` interactive transaction or as a best-effort asynchronous promise on the global `db` client (`client.auditLog.create(...)`).
  - **Notifications (`src/lib/notifications.ts`):** In `sendNotification`, messages are logged to `NotificationLog` with status `"QUEUED"`, but provider delivery (SMTP via Nodemailer, Resend, or Twilio/WhatsApp) is awaited **synchronously within the request thread**, then updated to `"SENT"` or `"FAILED"`.
- **Operational Risks:**
  - If third-party SMTP or notification APIs experience network latency (up to 15s timeout), the active HTTP request and its database connection stay occupied.
- **Recommendation:**
  - For long-term scale, decouple outbound notification delivery into a durable background worker or dedicated queue process reading pending rows from `NotificationLog`.

---

## 4. Webhook Processing Audit

### 4.1 Ingested Gateways
- **Jodo Payment Gateway (`src/app/api/webhooks/jodo/route.ts` & `src/lib/payment-gateway/webhook-inbox.ts`):**
  - **Security:** Validates `x-jodo-signature` using HMAC-SHA256. Unsigned webhooks are rejected in production (`401`).
  - **Durable Inbox & Idempotency:** Implemented via `WebhookEvent`. Computes a SHA-256 fingerprint hash of `rawBody`. If an identical event arrives, returns `DUPLICATE` without re-processing. If payload fingerprint differs, flags `PAYLOAD_TAMPER_DETECTED` and fails closed.
  - **Branch Attribution & Quarantine:** Resolves branch via `collectorCode`. If ambiguous across multiple branches, quarantines event (`QUARANTINED`) rather than guessing.
  - **Atomic Mutations:** Financial changes (invoice balance update, `FeePayment`, `PaymentReceipt`, `PaymentReceiptBalance`, `PaymentAllocation`) are wrapped in an interactive `db.$transaction`.
  - **Concurrency Defect Identified:** Line 243 calculates receipt number via `const count = await tx.paymentReceipt.count({ where: { tenantId } })`. Under concurrent webhook delivery, this can cause duplicate receipt numbering. A PostgreSQL sequence or unique constraint retry is recommended.

### 4.2 Razorpay & Stripe Webhooks (`src/lib/payments.ts`)
- **Signature Verification:** `verifyRazorpayWebhook` and `verifyStripeWebhook` implement constant-time comparison (`crypto.timingSafeEqual`) with 300-second timestamp freshness validation.
- **Pessimistic Row Locking:** `settleFeePaymentLink` explicitly acquires row locks:
  `SELECT id FROM "FeeInvoice" WHERE id = ... AND "tenantId" = ... FOR UPDATE`
  guaranteeing clean serialization across concurrent payment confirmations.
- **Routing Gap:** `processRazorpayWebhook` and `processStripeWebhook` are defined in `src/lib/payments.ts`, but there are currently **no dedicated Next.js route handlers** exposing `/api/webhooks/razorpay` or `/api/webhooks/stripe` (only `/api/webhooks/jodo` exists).

---

## 5. Cron Jobs Audit

- **Endpoint:** `src/app/api/cron/renewal-check/route.ts` (GET / POST).
- **Authentication:**
  - Enforces `CRON_SECRET` validation via `Authorization: Bearer <secret>` or `?key=<secret>`.
  - In production, if `CRON_SECRET` is unset, it attempts loopback restriction via `x-forwarded-for`. (Note: loopback IP checking should be secondary to mandatory `CRON_SECRET`).
- **Idempotency:** Checks `NotificationLog` for templates sent within the last 48 hours to avoid repeated notifications.
- **Connection Lifecycle & Performance:**
  - Iterates sequentially through expiring subscriptions and associated administrators, performing sequential DB queries and email dispatches.
  - At high tenant counts, this risks hitting serverless execution timeouts (15s–60s). Batching and concurrency limits (`p-limit` / `Promise.allSettled` chunks) should be applied.

---

## 6. Financial Consumer Attribution Audit

### 6.1 Database Artifacts
- Function: `fn_get_effective_branch_id(p_tenant_id, p_record_type, p_record_id, p_raw_branch_id)` (SECURITY INVOKER, search_path locked).
- Views: `v_effective_fee_payment`, `v_effective_payment_receipt`, `v_effective_payment_allocation` (with `security_invoker = true`).

### 6.2 Consumer Query Analysis
1. **Dashboard & Fees Pages (`src/app/(app)/app/page.tsx`, `src/app/(app)/app/fees/page.tsx`):**
   - When branch-scoped, accurately invoke `getEffectiveFeeCollectedSum` (`src/lib/branch-reconciliation.ts`), which queries `v_effective_fee_payment` using `effectiveBranchId = ANY(...)`. This correctly accounts for historical branch reconciliations.
   - When not branch-scoped (tenant-wide owner view), queries `db.feePayment` directly.
2. **Fee Invoice Details (`src/app/(app)/app/fees/[id]/page.tsx`):**
   - Enforces branch access control via `invoice.branchId || invoice.student.branchId`.
   - Displays payments and allocations tied to the specific invoice. Masks payment references (UTR) unless user has `tenant.fees.utr.view`.
3. **Credit Transfers (`src/lib/credit-transfers.ts`):**
   - Operates strictly with tenant isolation and sibling guardian verification.
   - Double-entry ledger postings (`CreditTransferJournal`, `CreditTransferPosting`) and allocations (`PaymentAllocation`) maintain atomic debit/credit invariants under row locks.
4. **Online Link Settlement (`src/lib/payments.ts`):**
   - `settleFeePaymentLink` creates `FeePayment` without setting `branchId`. If the parent invoice was branch-tagged, `branchId` should be inherited from the invoice to avoid creating unallocated historical records.

---

## 7. Secret Handling Review

- **Log Scanning Audit:**
  - Audited all `console.error`, `console.warn`, and `console.info` statements across `src/`. Zero instances of `console.log` exist in production application code.
  - No environment secrets, session tokens, JWTs, API keys, passwords, or hashes are logged.
- **Logging Controls:**
  - `src/lib/notifications.ts`: `deliverToConsole` explicitly throws an error in production rather than printing message payloads or recipient PII to standard out.
  - `src/lib/ai-credential-vault.ts`: API keys are decrypted in memory only when executing calls; status queries return `SafeAiProviderStatus` containing `keyMask` (e.g. `gsk_...3a`) and never raw secrets. Decryption failures log the error message, never the ciphertext or key.
  - `src/lib/ai-gateway.ts`: Transit encryption uses HKDF-derived keys; engine communication errors log generic status codes without echoing request authorization tokens.
- **Frontend Masking:**
  - Banking references and UTRs are masked (`••••••••1234`) on client displays unless the viewing role has been granted `tenant.fees.utr.view`.

---

## 8. Summary of Action Items

| Priority | Area | Issue | Recommended Action |
| :--- | :--- | :--- | :--- |
| **High** | Database | Missing pool limits on `DATABASE_URL` | Add `connection_limit=10&pool_timeout=20` to default DB configuration. |
| **High** | Webhooks | Razorpay / Stripe handlers not exposed | Add route handlers `/api/webhooks/razorpay` and `/api/webhooks/stripe`. |
| **Medium** | Webhooks | Non-atomic receipt numbering in Jodo webhook | Replace `tx.paymentReceipt.count() + 1` with a PostgreSQL sequence or atomic counter. |
| **Medium** | Payments | `FeePayment` branch attribution on online links | In `settleFeePaymentLink`, set `branchId = invoice.branchId`. |
| **Low** | Cron | Sequential execution in `renewal-check` | Batch tenant notifications with concurrency controls to avoid route timeouts. |
