# Knowletive PostgreSQL Row-Level Security (RLS) Readiness Design Review

**Collaboratively Formulated By:**
- Agent 0: Chief Software Architect & Swarm Orchestrator
- Agent 1: Database & Data Architecture
- Agent 2: Security & RBAC
- Agent 3: Backend & API
- Agent 6: QA & Test Automation

**Date:** 2026-11-21  
**Milestone:** Phase 2.3.2 Pre-RLS Architecture Specification  
**Status:** COMPLETE DESIGN SPECIFICATION (Implementation deferred to Phase 3)

---

## 1. Session Variable Strategy

PostgreSQL RLS policies evaluate against runtime session variables set via `set_config(...)`.
- **Variables:**
  - `app.current_tenant_id`: Mandatory for all tenant-scoped queries.
  - `app.current_branch_ids`: Comma-separated list or JSON array of authorized branch IDs.
  - `app.current_user_id`: Authenticated user ID for audit and user-scoped data.
  - `app.is_tenant_wide`: Boolean (`'true'` or `'false'`) indicating whether user has institute-wide authority.
  - `app.is_platform_admin`: Boolean indicating platform super-admin access.
- **Scope & Scope Cleanup:** Variables MUST be set using `set_config('var', val, true)` with `is_local = true`, binding them strictly to the active transaction. If a transaction commits or rolls back, PostgreSQL automatically resets the variables.

---

## 2. Connection Pooling Architecture

Knowletive uses connection pooling (PgBouncer in transaction mode or Prisma connection pool).
- **Session State Bleed Prevention:** Because connections are reused across different web requests, setting session-level variables without `is_local = true` risks state leakage between tenants.
- **Rule:** ALL session context configuration must be set inside an explicit database transaction (`BEGIN ... COMMIT`) using local parameters:
  ```sql
  SELECT set_config('app.current_tenant_id', $1, true);
  ```
- Additionally, connection checkout wrappers should execute `DISCARD TEMP; RESET ALL;` if a connection is recycled outside a clean transaction boundary.

---

## 3. Transaction Wrapper Pattern

In Next.js server actions and API routes, database access requiring RLS will pass through a typed transaction wrapper:
```typescript
export async function withTenantContext<T>(
  ctx: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return await db.$transaction(async (tx) => {
    const branchScope = await resolveUserBranchScope(ctx);
    const branchIds = branchScope.allowedBranchIds.join(",");

    await tx.$executeRaw`
      SELECT 
        set_config('app.current_tenant_id', ${ctx.tenant.id}, true),
        set_config('app.current_branch_ids', ${branchIds}, true),
        set_config('app.is_tenant_wide', ${branchScope.mode === 'TENANT_WIDE' ? 'true' : 'false'}, true),
        set_config('app.current_user_id', ${ctx.user?.id ?? ''}, true);
    `;

    return await fn(tx);
  });
}
```

---

## 4. Bypass Prevention

1. **Role Separation:** Database runtime user `knowletive_app` is created with `NOSUPERUSER NOBYPASSRLS`.
2. **Table Level Force:** Every tenant-scoped table executes:
   ```sql
   ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "Student" FORCE ROW LEVEL SECURITY;
   ```
   `FORCE ROW LEVEL SECURITY` ensures that even the table owner (if connected as non-superuser) is subjected to RLS policies.
3. **Fail-Closed Semantics:** If `app.current_tenant_id` is unset or null, `NULLIF(current_setting('app.current_tenant_id', true), '')` evaluates to NULL, and the condition `"tenantId" = NULL` evaluates to `UNKNOWN` (falsy), returning zero rows.

---

## 5. Table Classification Matrix

| Table Category | Tables Included | Isolation Strategy | Policies Required |
|---|---|---|---|
| **Tenant-Only Tables** | `TenantSubscription`, `Role`, `Permission`, `AcademicYear`, `ClassLevel`, `Subject`, `GradeScale`, `GradeBand`, `CopilotThread` | Strict Tenant Isolation | `tenantId = current_setting('app.current_tenant_id')` |
| **Branch-Attributed Tables** | `Student`, `FeeInvoice`, `FeePayment`, `PaymentReceipt`, `PaymentAllocation`, `CreditTransferJournal`, `Lead`, `BranchLedgerEntry`, `BranchPayout`, `Attendance`, `ExamEnrollment` | Tenant + Branch Hierarchy Isolation | `tenantId = current_tenant` AND (`is_tenant_wide = true` OR `branchId IS NULL` OR `branchId = ANY(current_branches)`) |
| **Shared / Platform Tables** | `Tenant`, `User`, `Plan`, `Setting`, `RateLimitBucket`, `PasswordResetToken` | Platform Admin / Self Only | Public / Auth / Restricted |
| **Audit & Event Tables** | `AuditLog`, `BatchEnrollmentEvent`, `ExamMarksRevisionEvent`, `SyllabusProgressEvent`, `CreditTransferApprovalEvent`, `BranchReconciliationAudit` | Immutable Append-Only Tenant-Scoped | `tenantId = current_tenant` for SELECT; INSERT allowed; UPDATE/DELETE denied |

---

## 6. Migration Strategy

- Migrations run sequentially via `prisma migrate deploy`.
- Phase 3 RLS migration will be broken into 3 safe stages:
  1. `20261122000000_phase3_role_and_grants`: Provision `knowletive_app` role and grants.
  2. `20261122010000_phase3_composite_fk_closure`: Add composite `(tenantId, branchId)` FKs to `PaymentReceipt` and `FeePayment`.
  3. `20261122020000_phase3_enable_rls_and_policies`: Apply `ENABLE/FORCE ROW LEVEL SECURITY` and policies across all tables.

---

## 7. Shared Table Isolation

For tables spanning tenants (e.g. `User`, `Membership`):
- `Membership`: Isolated strictly by `"tenantId" = current_setting('app.current_tenant_id')`.
- `User`: Isolated such that a tenant user can only see user profiles linked via active `Membership` in that same tenant:
  ```sql
  CREATE POLICY rls_user_tenant ON "User" FOR SELECT USING (
    id = current_setting('app.current_user_id', true) OR
    EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."userId" = "User".id AND m."tenantId" = current_setting('app.current_tenant_id', true)
    )
  );
  ```

---

## 8. Global / Platform Tables

- `Plan`, `Setting`: Read-only for tenant sessions (`FOR SELECT USING (true)`).
- `PlatformOwner` mutations: Restricted to sessions where `current_setting('app.is_platform_admin', true) = 'true'`.

---

## 9. Policy Design Patterns

```sql
-- Standard Tenant Policy (SELECT, UPDATE, DELETE)
CREATE POLICY rls_tenant_isolation ON "Student"
  AS RESTRICTIVE
  FOR ALL
  USING (
    "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  )
  WITH CHECK (
    "tenantId" = NULLIF(current_setting('app.current_tenant_id', true), '')
  );

-- Branch Hierarchy Policy (SELECT)
CREATE POLICY rls_branch_access ON "Student"
  AS RESTRICTIVE
  FOR SELECT
  USING (
    current_setting('app.is_tenant_wide', true) = 'true'
    OR "branchId" IS NULL
    OR "branchId" = ANY(string_to_array(NULLIF(current_setting('app.current_branch_ids', true), ''), ','))
  );
```

---

## 10. Performance Impact & Index Support

- **Index Requirements:** Every table with an RLS policy checking `tenantId` and `branchId` MUST have composite indexing:
  - `CREATE INDEX idx_tbl_tenant_branch ON "Table"("tenantId", "branchId");`
- **EXPLAIN ANALYZE Benchmarking:** Must be conducted on `Student`, `FeePayment`, `FeeInvoice`, and `PaymentReceipt` with 100,000 synthetic rows to verify that index scans (Bitmap Index Scan / Index Scan) are chosen instead of Seq Scan.

---

## 11. View Interaction Strategy

- PostgreSQL views `v_effective_fee_payment`, `v_effective_payment_receipt`, and `v_effective_payment_allocation` are defined with `WITH (security_invoker = true)` (applied in Phase 2.3.1).
- Because `security_invoker = true` is set, queries on the views automatically evaluate the caller's RLS policies on the underlying tables (`FeePayment`, `PaymentReceipt`, `Branch`), guaranteeing complete consistency.

---

## 12. Superuser & Privilege Separation

- DDL operations, migrations, and schema verifiers run as `knowletive` (owner/superuser).
- Application server runs strictly as `knowletive_app` (`NOSUPERUSER NOBYPASSRLS`).
- Integration tests use disposable databases where test runners execute DDL as admin and data operations as `knowletive_app`.

---

## 13. Testing Methodology

Integration test matrix:
1. **Tenant Isolation:** Tenant A attempts to read Tenant B's students, invoices, and receipts (must return 0 rows).
2. **Branch Isolation:** Branch Admin of Sub-Branch 1 attempts to query records of Sub-Branch 2 (must return 0 rows).
3. **Cross-Tenant Insert:** Application attempts to insert row with `tenantId = Tenant B` while session is set to `Tenant A` (must throw RLS check violation).
4. **Unset Session Context:** Application queries without setting session variables (must return 0 rows).

---

## 14. Rollback Strategy

Each RLS migration will have an exact companion rollback script:
```sql
-- Immediate Emergency Disable
ALTER TABLE "Student" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "FeePayment" DISABLE ROW LEVEL SECURITY;
-- ...
DROP POLICY IF EXISTS rls_tenant_isolation ON "Student";
```

---

## 15. Prisma Integration Layer

Prisma Client extensions (`$extends`) will be configured to automatically set the local transaction settings on every interactive transaction or query client created via `withTenantContext`.

---

## 16. Unauthenticated & Webhook Routes

- Webhook routes (e.g. `/api/webhooks/jodo`):
  - Ingest raw payloads into `WebhookEvent` without a tenant context initially.
  - Upon resolving the collector code and tenant ID, the worker enters `withTenantContext(resolvedTenant)` to perform balance updates and receipt allocations.
- Payment page (`/pay/[token]`):
  - Reads `FeePaymentLink` using payment token.
  - Resolves `tenantId` from link, then executes within `withTenantContext(linkTenant)`.

---

## 17. Batch Operations & Bulk Imports

- Student CSV import (`/app/students/import`):
  - Runs in chunks of 100 inside `withTenantContext`.
  - Guarantees all imported rows automatically match the authenticated tenant and branch.

---

## 18. Edge Cases & Boundary Conditions

- **Null Branch Records:** Historical records created before multi-branching (`branchId IS NULL`) must remain visible to institute admins and main branch staff. RLS policy explicitly includes `OR "branchId" IS NULL`.
- **Branch Hierarchy Changes:** When a branch is moved under a new parent, `resolveUserBranchScope` re-computes descendant lists dynamically from `getBranchDescendantIds`.

---

## 19. Phased Rollout Plan

1. **Gate 1:** Non-enforcing audit mode (log policy violations without blocking).
2. **Gate 2:** Enable RLS on low-risk peripheral tables (`ClassLevel`, `AcademicYear`, `Announcement`).
3. **Gate 3:** Enable RLS on core student and academic records (`Student`, `Attendance`, `ExamMark`).
4. **Gate 4:** Enable RLS on core financial ledger (`FeeInvoice`, `FeePayment`, `PaymentReceipt`, `PaymentAllocation`).

---

## 20. Acceptance Criteria for Phase 3

- Zero test failures across 324+ regression tests under `knowletive_app` with RLS enforced.
- Zero data leakage in cross-tenant penetration tests.
- Query execution latency increase under 5% across financial dashboard aggregates.
