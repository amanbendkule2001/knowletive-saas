# Knowletive Pre-RLS Database & Schema Audit (Phase 2.3.2)

**Prepared by:** Agent 1 (Database & Data Architecture) & Agent 2 (Security & RBAC)  
**Date:** 2026-11-21  
**Status:** COMPLETE — PRE-RLS AUDIT  

---

## 1. Executive Summary

This audit evaluates the database schema, relational constraints, migration status, and runtime security model of Knowletive before PostgreSQL Row-Level Security (RLS) implementation in Phase 3.

Key findings:
1. **`PaymentReceipt_branchId_fkey` Constraint**: Currently defined as `FOREIGN KEY ("branchId") REFERENCES "Branch"(id) ON UPDATE CASCADE ON DELETE SET NULL` (in baseline) or `RESTRICT` (in migration 20261121150000). It is **unary**, referencing `Branch(id)` rather than composite `Branch(tenantId, id)`. Data audit confirms **0 tenant mismatches** across all 1,352 receipts.
2. **Composite Foreign Key Coverage**: Models upgraded in Phase 2 (`MembershipBranch`, `BranchReconciliationAudit`, `FileAsset`, `PaymentAllocation`, `CreditTransferJournal`, `Lead`, `PaymentCollectorRoute`) enforce composite `(tenantId, branchId) REFERENCES Branch(tenantId, id)`. Legacy financial and operational models (`PaymentReceipt`, `FeePayment`, `FeePaymentLink`, `Student`, `FeeInvoice`, `BranchLedgerEntry`, `BranchPayout`) still use unary `Branch(id)`.
3. **`CopilotThread` & `CopilotMessage`**: Active, production-ready models used by `/api/copilot/` and `CopilotPanel.tsx`. Defined in `prisma/schema.prisma` and applied via `prisma/manual/20261118_copilot_conversations_phase3b.sql`, but absent from the canonical `prisma/migrations/` chain.
4. **`WebhookEvent`**: Active model with inbox persistence. Columns `rawPayload`, `status`, `tenantId`, `branchId`, `updatedAt` exist in PostgreSQL and `prisma/schema.prisma`, but were absent from baseline migration `20261101000000`.
5. **Database Roles**: User `knowletive` is currently a superuser (`rolsuper: true`), which bypasses PostgreSQL RLS by default. Runtime non-superuser role `knowletive_app` exists (`rolsuper: false`), but currently lacks public schema grants.

---

## 2. In-Depth Analysis: `PaymentReceipt_branchId_fkey`

### 2.1 Current Catalog Definition
```sql
ALTER TABLE "PaymentReceipt"
  ADD CONSTRAINT "PaymentReceipt_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON UPDATE RESTRICT ON DELETE RESTRICT;
```

### 2.2 Relational Invariant Analysis
- `PaymentReceipt` has composite foreign key `(tenantId, studentId) REFERENCES Student(tenantId, id)`. This strictly ensures that a receipt cannot reference a student from another tenant.
- However, `branchId` is a unary foreign key to `Branch(id)`.
- Because `Branch` has unique composite index `Branch_tenantId_id_key UNIQUE (tenantId, id)`, a composite foreign key `(tenantId, branchId) REFERENCES Branch(tenantId, id)` is technically valid and supported by PostgreSQL.

### 2.3 Empirical Data Audit
A full scan of the active database revealed:
- **Total `PaymentReceipt` rows:** 1,352
- **Historical receipts without branchId (`branchId IS NULL`):** 1,321
- **Receipts with assigned branchId:** 31
- **Cross-tenant branch mismatches (`r.tenantId != b.tenantId`):** **0 (Zero)**

### 2.4 Why the Difference Exists
Historically, `PaymentReceipt` was created in `20261118_core_financial_ledger_stage1.sql` prior to the multi-branch hierarchy. Branch attribution was added in `20261120_branch_isolation_and_ledger.sql` as an optional unary column. In Phase 2, `PaymentAllocation` received composite `(tenantId, branchId)`, while `PaymentReceipt` retained unary `Branch(id)`.

### 2.5 Risk Assessment Under PostgreSQL RLS
1. **Cross-Tenant Attribution Risk:** Under standard application queries, `tenantId` is always passed from session context. However, without a composite foreign key, an administrative raw insert or buggy batch migration could insert a receipt for Tenant A pointing to Branch B of Tenant C.
2. **RLS Join Masking:** Under RLS, if Tenant A attempts to join `PaymentReceipt` to `Branch`, PostgreSQL evaluates the RLS policy on `Branch`. If the branch belongs to Tenant C, the join returns `NULL` for the branch, resulting in silent data masking rather than a constraint violation.
3. **Null Branch Semantics:** Under PostgreSQL and ANSI SQL (MATCH SIMPLE), a composite foreign key `(tenantId, branchId) REFERENCES Branch(tenantId, id)` succeeds automatically if `branchId` is `NULL`. When `branchId` is non-null, both columns must match `Branch(tenantId, id)`.

### 2.6 Recommendation
Prior to enabling RLS in Phase 3, add composite foreign key:
```sql
ALTER TABLE "PaymentReceipt"
  ADD CONSTRAINT "PaymentReceipt_tenantId_branchId_fkey"
  FOREIGN KEY ("tenantId", "branchId") REFERENCES "Branch"("tenantId", "id")
  ON UPDATE RESTRICT ON DELETE RESTRICT;
```
The same corrective composite constraint should be applied to `FeePayment`.

---

## 3. Schema Drift & Canonical Migration Analysis

| Entity / Object | In `prisma/schema.prisma` | In Canonical Migrations | In Live Database | Status / Remediation |
|---|---|---|---|---|
| `CopilotThread` | Yes | No (Manual script only) | Yes | Formalize into canonical migration `20261122000000_copilot_conversations` |
| `CopilotMessage` | Yes | No (Manual script only) | Yes | Formalize into canonical migration `20261122000000_copilot_conversations` |
| `WebhookEvent` columns | Yes | Partial (Missing in baseline) | Yes | Formalize into canonical migration `20261122010000_webhook_inbox_hardening` |
| `v_effective_fee_payment` | N/A (Native View) | Yes (Phase 2.3 & 2.3.1) | Yes (`security_invoker = true`) | Verified clean |
| `v_effective_payment_receipt` | N/A (Native View) | Yes (Phase 2.3 & 2.3.1) | Yes (`security_invoker = true`) | Verified clean |
| `v_effective_payment_allocation` | N/A (Native View) | Yes (Phase 2.3 & 2.3.1) | Yes (`security_invoker = true`) | Verified clean |
| `fn_get_effective_branch_id` | N/A (Native Func) | Yes (Phase 2.3.1) | Yes (SECURITY INVOKER, fixed search_path) | Verified clean |
| `uq_pcr_branch_route_identity` | N/A (Native Index) | Yes (Phase 2.3) | Yes (NULLS NOT DISTINCT) | Verified clean |

---

## 4. Database Role & RLS Privilege Architecture

### 4.1 Current Role Inspection
```
rolname          | rolsuper | rolcanlogin | rolbypassrls
-----------------+----------+-------------+-------------
postgres         | true     | true        | true
knowletive       | true     | true        | false
knowletive_app   | false    | true        | false
```

### 4.2 Critical Pre-RLS Finding
In PostgreSQL:
- **Superuser roles (`rolsuper = true`) bypass Row-Level Security unconditionally**, even if `ENABLE ROW LEVEL SECURITY` or `FORCE ROW LEVEL SECURITY` is set on the table.
- User `knowletive` is currently a superuser. Connecting the application with `knowletive` completely disables RLS enforcement.
- Role `knowletive_app` is non-superuser (`rolsuper = false`, `rolbypassrls = false`).
- However, `knowletive_app` currently only has table permissions on `SyllabusProgressEvent`.

### 4.3 Required Database Privilege Setup for Phase 3
1. Grant schema and table access to `knowletive_app`:
   ```sql
   GRANT USAGE ON SCHEMA public TO knowletive_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO knowletive_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO knowletive_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO knowletive_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO knowletive_app;
   ```
2. Reconfigure application `DATABASE_URL` to connect as `knowletive_app`.
3. Reserve `knowletive` / `postgres` exclusively for Prisma migrations and administrative DDL operations.
