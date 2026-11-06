# Security

Knowletive handles student records, guardian contact details, staff accounts and money. This document describes the controls that are implemented, the assumptions behind them, and the work required before a public production launch.

## 1. Authentication

- **Passwords** are hashed with `bcrypt` (cost 12) in `src/lib/auth.ts`. The plaintext password is never stored or logged.
- **Login is generic.** Invalid email and invalid password return the same "Incorrect email or password" message. A dummy hash is verified when the email does not exist so response timing does not disclose account existence.
- **Rate limiting.** Login attempts are limited to 8 per 10 minutes per IP + email combination (`src/lib/rate-limit.ts`). The limiter is in-memory and process-local.
- **Sessions** are random 256-bit tokens. Only a SHA-256 hash of the token is stored in `Session`; the raw token exists only in the `kl_session` cookie.
- **Cookie flags.** Session and tenant cookies are `httpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production.
- **Session lifetime.** 7 days. Expired sessions are pruned on new logins. Logout deletes the session row and both cookies.
- **Password changes** require the current password, enforce 8+ characters with a letter and a number, and delete every session for that user (all devices signed out).
- **Account state.** A user whose status is not `ACTIVE` cannot resolve a session.

## 2. Authorization and tenant isolation

- Every page calls a server guard: `requireTenantPermission`, `requirePlatformPermission`, `requireTenant`, or `requireTenantWrite`.
- Every server action performs its own guard. UI hiding is never treated as authorization.
- The active institute is resolved server-side from the session and the `kl_tenant` cookie. Actions never accept a tenant id from the client.
- Tenant-scoped lookups include `tenantId` in the query filter, including by-id reads. A record from another institute resolves as not found.
- Platform owners can open a tenant workspace in support mode only by explicitly selecting a tenant; `CHURNED` tenants are excluded.
- `INSTITUTE_ADMIN` is locked and always has full tenant access, preventing an institute from accidentally removing its own administration. `PLATFORM_OWNER` is locked for the same reason.
- Unauthorized workspace requests redirect to `/app/forbidden?p=<permission>`, which names the missing permission.
- Writes are blocked while a subscription is `PAST_DUE`, `PAUSED`, `EXPIRED` or `CANCELED`; billing stays readable so the institute can recover.

**Residual risk:** isolation is application-enforced in a shared schema. Any new query that omits `tenantId` is a cross-tenant bug. Code review and integration tests should treat this as a release-blocking check.

## 3. Input and mutation safety

- Request bodies from server actions are validated with Zod schemas in `src/lib/validation.ts` before use.
- Enumerations (statuses, methods, audiences, cycles) are parsed against allowed values rather than trusted.
- Monetary inputs are converted to integer minor units and bounded.
- Prisma parameterizes queries; no raw SQL is used.
- Multi-row changes (attendance registers, role permissions, password changes) use transactions.
- Destructive UI actions (delete announcement, delete role, archive student) require explicit confirmation and are audited where applicable.

## 4. CSRF and browser security

- Next.js server actions verify the request origin against the deployment origin.
- Cookies are `SameSite=Lax`, which blocks cross-site cookie attachment for non-top-level requests.
- `next.config.ts` sends:
  - `Content-Security-Policy` with `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy` disabling camera, microphone and geolocation
  - `Strict-Transport-Security` (2 years, include subdomains, preload)
- `poweredByHeader` is disabled; compression is on.

**CSP note:** the current policy allows inline scripts/styles and adds `unsafe-eval` in development only (the Next.js dev overlay needs it). Production does not send `unsafe-eval`. Before a high-assurance launch, move to a nonce-based CSP and remove `unsafe-inline` from `script-src`; that requires wiring a nonce through the App Router.

## 5. Secrets and configuration

- Secrets live in `.env`, which is git-ignored. `.env.example` contains placeholders only.
- `SESSION_SECRET` must be a unique 64-character random value per environment. Treat a leaked value as a full auth incident.
- Payment and AI keys are optional. With no keys, billing runs in `manual` mode and AI runs on the deterministic demo provider, so the app never fails closed on a missing third-party key.
- Never log request bodies, passwords, cookies, API keys or full student records. The existing audit entries store ids, counts and business metadata, not secrets.

## 6. Auditability

`writeAudit()` records actor, actor type, tenant, action, entity, entity id, metadata and timestamp. Audited events include login, logout, password change, student create/update/archive, attendance marking, fee invoice/payment/waive, announcement changes, AI generations, role changes, plan changes, platform institute changes and invoice payment.

Audit history is visible to platform owners and to institute users with `tenant.audit.read` / `platform.audit.read`.

## 7. Data handling

- Money is stored as integer minor units; no floating-point arithmetic is used for balances.
- Student records include minors' names, dates of birth and guardian contact details. Treat the database and backups as sensitive personal data.
- CSV export is permission-gated and tenant-scoped. Import is validated row by row and capped by plan capacity.
- No document uploads are implemented yet; when storage is added, use signed URLs, private buckets, content-type validation and per-tenant key prefixes.

## 8. Production checklist

Before exposing a real institute's data:

- [ ] Set a strong, unique `SESSION_SECRET`; rotate it if it was ever shared.
- [ ] Serve exclusively over HTTPS; verify HSTS and secure cookies.
- [ ] Set `NODE_ENV=production` and confirm `unsafe-eval` is absent from the CSP.
- [ ] Replace the in-memory rate limiter with Redis/Upstash when running more than one instance.
- [ ] Add nonce-based CSP and remove `unsafe-inline` from `script-src`.
- [ ] Use a managed PostgreSQL instance with TLS, automated backups, point-in-time recovery and least-privilege credentials.
- [ ] Restrict database network access to the app; never expose Postgres publicly.
- [ ] Add error monitoring (Sentry or equivalent) with PII scrubbing, and structured request logs without bodies.
- [ ] Add uptime checks and alerts for 5xx rate, login failures and invoice/payment failures.
- [ ] Run `npm audit` and a dependency-update process; pin and review upgrades.
- [ ] Upgrade Prisma beyond the current 6.x line to clear the `deepmerge-ts` advisory in its CLI chain (breaking-change review required).
- [ ] Add automated tests for tenant isolation, permission checks and every money path.
- [ ] Verify payment webhook signatures and idempotency before enabling Razorpay/Stripe.
- [ ] Define retention and deletion policies for student/guardian data and audit logs.
- [ ] Complete a privacy review (DPDP Act in India, GDPR where applicable) and publish a privacy policy.
- [ ] Penetration-test the auth, tenant-switching and export paths.

## 9. Known gaps

These are deliberate boundaries of the current foundation, not hidden assumptions:

- No email verification, password reset, MFA or SSO yet.
- No per-tenant custom domains or database-level row security.
- Rate limiting is in-memory and only applied to login.
- No background job runner; AI calls run inline.
- No webhook route yet for real payment providers.
- No file upload/storage layer, so storage limits are modelled but not metered.
- No automated test suite yet; verification is typecheck, lint, production build and browser smoke tests.
- `npm audit` reports a high-severity advisory in Prisma's CLI dependency chain (`deepmerge-ts`); upgrading Prisma 6 → 7 is a tracked breaking change.

See [docs/ROADMAP.md](./docs/ROADMAP.md) for sequencing.
