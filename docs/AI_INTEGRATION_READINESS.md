# Knowletive SaaS — AI Integration Readiness & API Data Mapping

**Document Version:** 1.0.0  
**Audit Date:** November 18, 2026  
**Auditor:** Senior Software Architect, AI Systems Engineer, FastAPI Engineer & SaaS Security Auditor  
**Repository Working Directory:** `D:\IT\Saas`  

---

## 1. Domain-to-Architecture Master Mapping (Audit 6)

This matrix maps each business domain to its underlying PostgreSQL database tables, backend server actions/services, frontend routes, and identifies the exact read APIs and data models that the external AI service can safely reuse.

| Business Domain | Database Tables Involved | Backend Services & Action Modules | Frontend Pages & Components | AI Service Reuse Potential & Tools |
| :--- | :--- | :--- | :--- | :--- |
| **Student Management** | `Student`, `Guardian`, `StudentGuardian`, `FileAsset` | [`src/actions/students.ts`](file:///D:/IT/Saas/src/actions/students.ts), [`src/lib/storage.ts`](file:///D:/IT/Saas/src/lib/storage.ts) | `/app/students`, `/app/students/[id]`, `/app/students/new`, `/portal` | **High:** AI tool `lookup_student_profile(student_id)` can fetch student demographics, guardian emergency contacts, enrolled class, and status. |
| **Attendance Management** | `Attendance`, `AcademicYear`, `Section` | [`src/actions/operations.ts`](file:///D:/IT/Saas/src/actions/operations.ts#L36) (`markAttendanceAction`) | `/app/attendance`, `/app` (trend chart), `/portal` | **High:** AI tool `get_attendance_summary(section_id, date_range)` can compute absenteeism trends, identify chronic absentees, and generate intervention briefs. |
| **Fee Management & Ledger** | `FeeInvoice`, `FeePayment`, `FeePaymentLink`, `PaymentReceipt`, `PaymentAllocation`, `StudentCreditAccount` | [`src/actions/operations.ts`](file:///D:/IT/Saas/src/actions/operations.ts), [`src/lib/payments.ts`](file:///D:/IT/Saas/src/lib/payments.ts) | `/app/fees`, `/app/fees/[id]`, `/portal`, `/pay/[token]` | **High:** AI tool `get_student_fee_dues(student_id)` can parse overdue balances and draft personalized, polite fee reminder notices. |
| **Admissions (Leads CRM)** | `Lead`, `LeadActivity`, `AcademicYear` | [`src/actions/leads.ts`](file:///D:/IT/Saas/src/actions/leads.ts), [`src/lib/leads-import.ts`](file:///D:/IT/Saas/src/lib/leads-import.ts) | `/app/leads`, `/app/leads/[id]`, `/app/leads/new` | **High:** AI tool `analyze_lead_enquiry(lead_id)` can draft context-grounded admission replies addressing transport, fee structures, and document requirements. |
| **Examinations & Grading** | `Examination`, `ExamSubject`, `ExamEnrollment`, `ExamMark`, `ExamResult`, `ExamResultSnapshot`, `GradeScale`, `GradeBand` | [`src/actions/exams.ts`](file:///D:/IT/Saas/src/actions/exams.ts), [`src/lib/exam-lifecycle.ts`](file:///D:/IT/Saas/src/lib/exam-lifecycle.ts), [`src/lib/exam-snapshot.ts`](file:///D:/IT/Saas/src/lib/exam-snapshot.ts) | `/app/exams`, `/app/exams/[id]`, `/app/exams/reports`, `/portal/results/[id]` | **Very High:** AI tool `generate_report_card_remark(student_id, exam_id)` can ground remarks directly in verified marks rather than relying on manual teacher input. AI tool `get_exam_performance_analytics(exam_id)` can analyze grade band distributions. |
| **Batch Management** | `Batch`, `BatchTeacher`, `BatchStudent`, `BatchEnrollmentEvent` | [`src/actions/batches.ts`](file:///D:/IT/Saas/src/actions/batches.ts), [`src/lib/batch-locking.ts`](file:///D:/IT/Saas/src/lib/batch-locking.ts) | `/app/batches`, `/app/batches/[id]`, `/app/batches/new` | **Medium:** AI tool `check_batch_capacity(batch_id)` can assist administrators during admissions by recommending open cohorts with available seating. |
| **Curriculum (SyllabusTrack)**| `SyllabusTrack`, `SyllabusChapter`, `SyllabusTopic`, `LessonPlan`, `TopicProgress`, `SyllabusProgressEvent` | [`src/actions/syllabus.ts`](file:///D:/IT/Saas/src/actions/syllabus.ts) | `/app/syllabus`, `/app/syllabus/[id]`, `/app/syllabus/reports` | **Very High:** AI tool `generate_lesson_plan(topic_id)` can read learning objectives and generate structured 45-minute lesson plans. AI tool `get_curriculum_delay_analysis()` can highlight lagging chapters. |
| **Institute Analytics & Reports** | `AuditLog`, `TenantUsage`, operational aggregates | [`src/app/(app)/app/page.tsx`](file:///D:/IT/Saas/src/app/(app)/app/page.tsx), [`src/app/(platform)/platform/page.tsx`](file:///D:/IT/Saas/src/app/(platform)/platform/page.tsx) | `/app`, `/platform`, `/platform/audit`, `/platform/ai` | **High:** AI tool `get_institute_kpi_brief()` can synthesize total student enrollment, daily attendance percentage, fee recovery rates, and faculty workloads into an executive morning brief for Principals. |

---

## 2. AI Integration Readiness Assessment (Audit 7)

### 2.1 Where the AI Engine Should Connect

Because Knowletive is a Next.js full-stack monolithic deployment and the incoming AI Copilot Engine (`copilot_engine.zip`) is a Python/FastAPI service:

1. **Topological Placement:**
   The AI Copilot Engine should run as a **dedicated private sidecar service** (e.g. running on an internal Docker network or `localhost:8000`).
2. **Gateway Architecture (Next.js as Reverse Proxy):**
   - The browser should **never** communicate directly with the FastAPI service. Direct browser-to-FastAPI access would bypass Next.js HTTP-only session cookies (`kl_session`), break tenant resolution, and create Cross-Origin Resource Sharing (CORS) and token leakage vulnerabilities.
   - Instead, Next.js implements Route Handlers (e.g. `/api/copilot/chat`) that:
     1. Authenticate the user session via `getSession()`.
     2. Verify tenant context and subscription status via `getTenantContext()`.
     3. Check AI entitlements and credit limits via `hasFeature(plan, "ai")` and `TenantUsage`.
     4. Mint a cryptographically signed, short-lived service token (or HMAC signature) embedding `{ userId, tenantId, roleKey, permissions }`.
     5. Forward the request via HTTP/2 streaming or WebSocket to the internal FastAPI service.
     6. Stream Server-Sent Events (SSE) back to the user's browser.

```
┌─────────────────┐       HTTPS (kl_session, kl_tenant)      ┌─────────────────────────┐
│                 ├─────────────────────────────────────────►│                         │
│  User Browser   │                                          │  Next.js Gateway Route  │
│  (Chat Widget)  │◄─────────────────────────────────────────┤  (/api/copilot/chat)    │
└─────────────────┘       Server-Sent Events (SSE Stream)    └────────────┬────────────┘
                                                                          │
                                           Internal Mutual Auth / HMAC    │
                                           Payload: { tenantId, userId, } │
                                           Streaming HTTP/2 POST          ▼
                                                             ┌─────────────────────────┐
                                                             │   FastAPI AI Copilot    │
                                                             │   Engine (Sidecar)      │
                                                             │   - Agent State Graph   │
                                                             │   - Tool Registry       │
                                                             │   - Streaming LLM Core  │
                                                             └────────────┬────────────┘
                                                                          │
                                           Read-Only Scoped SQL / Pool    │
                                           "tenantId" = :tenant_id        ▼
                                                             ┌─────────────────────────┐
                                                             │   PostgreSQL Database   │
                                                             └─────────────────────────┘
```

---

### 2.2 Reusable Existing Backend Services

The new AI Copilot Engine integration can directly reuse existing core services in `src/lib/`:

1. **`src/lib/auth.ts`:**
   - Reuse `getSession()` and `getTenantContext()` to resolve the caller's identity, active tenant, role key, and permission set without writing new authentication logic.
2. **`src/lib/rbac.ts`:**
   - Reuse `authorizeTenantWrite()` and `hasTenantPermission()` to enforce role and subscription gates.
3. **`src/lib/catalog.ts`:**
   - Reuse `STAFF_ROLE_KEYS`, `PLAN_SEEDS`, and `AI_FEATURES` definitions.
4. **`src/lib/entitlements.ts`:**
   - Reuse `hasFeature(plan, "ai")` to ensure the tenant's plan allows AI capabilities.
5. **`src/lib/billing.ts`:**
   - Reuse `getAiUsage(tenantId, creditLimit)` to track credit consumption.
6. **`src/lib/audit.ts`:**
   - Reuse `writeAudit()` to record immutable audit logs of copilot queries, tool executions, and data access.
7. **`src/lib/db.ts`:**
   - Reuse the Prisma client singleton for Next.js gateway data verification.

---

### 2.3 Required Database Repositories & Models

To support conversational chat, multi-turn memory, and agent tool execution, the database schema will require additional models in a future implementation phase:

1. **`CopilotThread`:**
   - `id` (PK, cuid)
   - `tenantId` (FK referencing `Tenant`, indexed)
   - `userId` (FK referencing `User`, indexed)
   - `title` (String, e.g. "Fee dues analysis for Class 10")
   - `contextType` (Nullable string: `GENERAL`, `STUDENT`, `EXAM`, `FINANCE`)
   - `contextId` (Nullable string: ID of specific entity discussed)
   - `createdAt`, `updatedAt`
   - Constraints: `@@index([tenantId, userId, createdAt])`

2. **`CopilotMessage`:**
   - `id` (PK, cuid)
   - `tenantId` (FK referencing `Tenant`, indexed)
   - `threadId` (FK referencing `CopilotThread`, onDelete: Cascade)
   - `role` (`user`, `assistant`, `system`, `tool`)
   - `content` (Text)
   - `tokensIn`, `tokensOut` (Int)
   - `model` (String)
   - `toolCalls` (Json nullable)
   - `createdAt`

3. **`CopilotToolExecution`:**
   - `id` (PK, cuid)
   - `tenantId` (FK referencing `Tenant`, indexed)
   - `messageId` (FK referencing `CopilotMessage`)
   - `toolName` (String, e.g. `get_student_fee_dues`)
   - `parameters` (Json)
   - `result` (Json)
   - `executionMs` (Int)
   - `status` (`SUCCESS`, `ERROR`)
   - `createdAt`

---

### 2.4 Appropriate AI Endpoints

To provide a secure, high-performance conversational experience:

#### Next.js Gateway Endpoints (Client Facing)
- **`POST /api/copilot/chat`:** Initiates or continues a conversational thread. Returns a streaming response (`text/event-stream`).
- **`GET /api/copilot/threads`:** Retrieves recent chat threads for the active user in the active tenant.
- **`GET /api/copilot/threads/[id]`:** Retrieves message history for a specific thread.
- **`DELETE /api/copilot/threads/[id]`:** Deletes a thread and its messages.

#### FastAPI Internal Endpoints (Sidecar Facing)
- **`POST /v1/copilot/chat`:** Accepts `{ threadId, tenantId, userId, roleKey, permissions, messages }` and yields streaming Server-Sent Events containing token chunks and tool status updates.
- **`GET /v1/health`:** Liveness and readiness probe for container orchestrator.

---

### 2.5 Streaming Architecture Integration

In Next.js 16 App Router, streaming is natively supported in Route Handlers using standard Web APIs (`ReadableStream` and `Response`):

```typescript
// Proposed Next.js Route Handler Pattern (Inspection Reference Only)
export async function POST(req: NextRequest) {
  const ctx = await getTenantContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  // 1. Check permissions & entitlements
  if (!hasFeature(ctx.tenant.subscription?.plan, "ai")) {
    return new Response("AI not enabled", { status: 403 });
  }

  // 2. Open HTTP/2 streaming proxy to FastAPI sidecar
  const fastApiResponse = await fetch("http://localhost:8000/v1/copilot/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Token": mintServiceToken(ctx),
    },
    body: JSON.stringify(await req.json()),
  });

  // 3. Pipe downstream to browser with SSE headers
  return new Response(fastApiResponse.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

---

### 2.6 Restricting AI Access to Platform Owner and Institute Owner by Default

To comply with the requirement that AI access be restricted strictly to **Platform Owner** and **Institute Owner** by default:

1. **Permission Definition:**
   Introduce a dedicated permission key: `tenant.ai.copilot` (distinct from standard one-shot `tenant.ai.use`).
2. **Default Role Templates:**
   - In [`src/lib/catalog.ts`](file:///D:/IT/Saas/src/lib/catalog.ts#L213):
     - `PLATFORM_OWNER`: Granted automatically (has all permissions).
     - `INSTITUTE_ADMIN` with `Membership.isOwner === true`: Granted `tenant.ai.copilot`.
     - Standard `TEACHER`, `ACCOUNTANT`, `FRONT_DESK`, `PARENT`, `STUDENT`: **Omitted by default**.
3. **Gateway Verification:**
   ```typescript
   const isAllowed =
     ctx.isOwnerView ||
     ctx.membership?.isOwner ||
     ctx.permissions.has("tenant.ai.copilot");

   if (!isAllowed) {
     return new Response("Forbidden: Copilot access is restricted to Institute Owners.", { status: 403 });
   }
   ```

---

### 2.7 Granting Explicit Access to Selected Users

The application already possesses the exact infrastructure needed to grant granular overrides without database schema modifications:

- The `Membership` model features an array column: `extraPermissions: String[] @default([])`.
- When an Institute Owner wishes to grant AI Copilot access to a specific Senior Teacher or Vice Principal:
  1. The Owner visits `/app/staff/[id]`.
  2. The Owner adds `"tenant.ai.copilot"` to that staff member's `extraPermissions`.
  3. During `getSession()`, [`src/lib/auth.ts`](file:///D:/IT/Saas/src/lib/auth.ts#L285) iterates `m.extraPermissions` and injects `"tenant.ai.copilot"` into that user's effective permission set.
  4. The user immediately gains access without changing their underlying base role!

---

### 2.8 Enforcing Multi-Tenant Isolation & Module Permissions

Any tool calls or autonomous SQL lookups executed by the AI Copilot must adhere to strict tenant isolation:

1. **Mandatory Query Parameterization:**
   The AI Engine must never execute unparameterized raw SQL. Every query must bind `:tenant_id` matching `ctx.tenant.id`.
2. **Read-Only Database Credentials:**
   If the AI Copilot Engine queries PostgreSQL directly, it should connect using a **dedicated read-only PostgreSQL user** (`knowletive_copilot_ro`) granted `SELECT` privileges only on business domain tables, with zero `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` privileges.
3. **Module-Level Permission Validation on Tools:**
   Before executing an agent tool (e.g. `lookup_fee_invoices`), the engine must verify that the caller's permission set includes the required module permission (e.g. `tenant.fees.read`). If a user has `tenant.ai.copilot` but lacks `tenant.fees.read`, the tool must refuse to execute.

---

## 3. Phase 2 Implementation & Security Hardening Status (November 18, 2026)

All security findings and preliminary designs from Phase 1 have been actively addressed and verified in Phase 2. Refer to [`docs/PHASE_2_IMPLEMENTATION.md`](file:///D:/IT/Saas/docs/PHASE_2_IMPLEMENTATION.md) for full engineering specifications and automated test results.

### 3.1 Security Hardening Resolutions

| Vulnerability / Finding | Phase 1 Status | Phase 2 Resolution |
| :--- | :--- | :--- |
| **SESSION_SECRET Insecure Fallback** | Hardcoded dev fallback tolerated in production. | **Resolved:** [`src/lib/auth.ts`](file:///D:/IT/Saas/src/lib/auth.ts) throws a fatal startup error in production if `SESSION_SECRET` is missing, shorter than 32 chars, or contains dev placeholders. |
| **Owner Identity Ambiguity** | `INSTITUTE_ADMIN` role confused with ownership. | **Resolved:** [`src/lib/ai-permissions.ts`](file:///D:/IT/Saas/src/lib/ai-permissions.ts) enforces `Membership.isOwner === true`. Role strings alone never grant ownership. |
| **Support Impersonation Bypass** | Support view granted broad permissions. | **Resolved:** Support sessions receive `roleKey: "PLATFORM_SUPPORT"` and are strictly denied AI access (`SUPPORT_DENIED`). |
| **Prompt Injection Vulnerability** | No guardrails on user-submitted briefs. | **Resolved:** [`src/lib/ai-security.ts`](file:///D:/IT/Saas/src/lib/ai-security.ts) detects instruction overrides, DAN jailbreaks, system leaks, and delimiter escapes. |
| **PII Exposure to Third-Party LLMs** | Raw phone numbers & emails sent to LLM. | **Resolved:** `scrubPii()` automatically redacts 10-digit Indian phone numbers, emails, and 12-digit Aadhaar/national IDs. |
| **Missing AI Rate Limiting** | Unlimited rapid-fire AI execution possible. | **Resolved:** Atomic PostgreSQL-backed rate limiters: 10 req/min for AI Studio, 15 req/min for Copilot chat. |
| **Inter-Service Security** | Direct or unauthenticated HTTP to Python. | **Resolved:** Short-lived HMAC-SHA256 service tokens (`mintServiceToken`, TTL 60s) in `X-Copilot-Service-Token`. |

### 3.2 Implemented Core AI Tools & Gateway

- **Gateway Route Handler:** [`src/app/api/copilot/chat/route.ts`](file:///D:/IT/Saas/src/app/api/copilot/chat/route.ts) with Server-Sent Events (SSE) streaming and JSON support.
- **Approved Tool Registry:** [`src/lib/ai-tools.ts`](file:///D:/IT/Saas/src/lib/ai-tools.ts) with `get_student_count`, `get_attendance_summary`, and `get_outstanding_fee_summary`.
- **Automated Verification:** 25/25 automated unit and integration tests passing in [`tests/ai-authorization-and-tools.test.ts`](file:///D:/IT/Saas/tests/ai-authorization-and-tools.test.ts).

