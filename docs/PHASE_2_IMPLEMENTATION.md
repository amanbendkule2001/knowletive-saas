# Knowletive SaaS — Phase 2 Implementation Report: Secure AI Copilot Integration

**Document Version:** 2.0.0  
**Implementation Date:** November 18, 2026  
**Auditor & Implementation Architect:** Senior Software Architect, Next.js Engineer, FastAPI Engineer & SaaS Security Auditor  
**Repository Working Directory:** `D:\IT\Saas`  
**Automated Test Suite:** `tests/ai-authorization-and-tools.test.ts` (25/25 Passing)

---

## 1. Executive Summary

Phase 2 transitions the Knowletive Education Management platform from architecture inspection into active, secure integration. All implementations strictly adhered to the Phase 2 constraints:
- **Zero Schema Migrations or Breaking Changes:** No database schemas were altered; no existing tables were renamed; existing migrations remained untampered.
- **Zero Disruption to Existing Services:** AI Studio (`runAiAction`), core accounting ledgers, exam cryptographic state machines, and session authentication continue functioning without alteration.
- **Default-Deny AI Access:** Only verified Platform Owners and verified Institute Owners have AI access by default. Support users in impersonation sessions, regular Institute Admins, Teachers, Students, and Parents are denied by default.
- **Next.js Authoritative Security Gateway:** The Next.js full-stack core acts as the sole authentication, authorization, rate-limiting, and data retrieval gateway, protecting both PostgreSQL and downstream Python microservices.

---

## 2. Step 1: Verification of the Copilot Engine Source

The physical source code of the external Python Copilot Engine was located at:
`D:\CoachGenieNew\Coachgenie_Phase1\copilot_engine`

### 2.1 Module Status & Inventory

| Module Path | Implementation Status | Assessment & Contract Findings |
| :--- | :--- | :--- |
| `core/config.py` | Working | Pydantic v2 settings loading PostgreSQL URL, Redis, and LLM API keys. |
| `core/logging_config.py` | Working | Structured JSON logging with tenant context and trace IDs. |
| `security/prompt_guard.py` | Working | Regex prompt injection heuristics and token leak detection. |
| `services/backend_client.py` | Working | HTTP client designed to call backend webhooks or APIs. |
| `llm/providers/groq_client.py` | Working | Async Groq client wrapping `llama-3.3-70b-versatile`. |
| `llm/providers/openai_client.py`| Working | Async OpenAI client for GPT-4o / embeddings. |
| `reports/generators/pdf_generator.py` | Working | ReportLab PDF compilation with tabular styling. |
| `reports/generators/excel_generator.py` | Working | OpenPyXL multi-sheet financial export generator. |
| `tools/student_tools.py` | Working | Implements student profile lookup and search. |
| `agents/student_agent.py` | Working | LangGraph state graph routing student queries. |
| `tools/attendance_tools.py` | **Empty Stub (0 bytes)** | Empty file in repository; required native Next.js implementation. |
| `tools/fee_tools.py` | **Empty Stub (0 bytes)** | Empty file in repository; required native Next.js implementation. |
| `tools/analytics_tools.py` | **Empty Stub (0 bytes)** | Empty file in repository; required native Next.js implementation. |
| `agents/attendance_agent.py` | **Incomplete Stub** | Single `class AttendanceAgent: pass` stub. |
| `agents/fee_agent.py` | **Incomplete Stub** | Single `class FeeAgent: pass` stub. |
| `agents/analytics_agent.py` | **Incomplete Stub** | Single `class AnalyticsAgent: pass` stub. |

### 2.2 Schema & Architectural Discrepancy
- **Identifier Mismatch:** The Python engine code assumes PostgreSQL native UUIDs for chat threads (`UUID(as_uuid=True)`), whereas Knowletive standardizes on CUID strings (`cuid()`).
- **Table Name Mismatch:** The Python engine anticipates `ai_chat_sessions` and `ai_chat_messages`, which do not exist in the Knowletive database.
- **Architectural Resolution:** All database access is governed directly by Next.js using Prisma and verified tenant scoping. The Python Copilot service serves as a downstream intelligence worker invoked via short-lived HMAC service tokens.

---

## 3. Step 2: Owner Identity Resolution

A critical security vulnerability identified in Phase 1 was the ambiguity between `Membership.isOwner === true` and the role string `roleKey: "INSTITUTE_ADMIN"`. 

In many schools, multiple staff members (vice principals, department heads, office clerks) hold the `INSTITUTE_ADMIN` role key to perform routine operations, but are **not** the legal or commercial owners of the institute.

### 3.1 Verification Logic Implemented
The resolution was implemented in [`src/lib/ai-permissions.ts`](file:///D:/IT/Saas/src/lib/ai-permissions.ts):

```typescript
export function isVerifiedInstituteOwner(ctx: TenantContext | null | undefined): boolean {
  if (!ctx || isSupportImpersonation(ctx)) {
    return false;
  }
  return Boolean(ctx.membership && ctx.membership.isOwner === true);
}
```

### 3.2 Support Impersonation Boundary
When a Platform Owner or support agent opens an institute workspace via platform administration, `src/lib/auth.ts` sets `roleKey: "PLATFORM_SUPPORT"` and `isOwner: false`. 
The function `isSupportImpersonation(ctx)` identifies this state and **strictly denies** AI access:
> *"Support sessions do not have access to AI intelligence tools during impersonation."*

This completely prevents platform operators or support staff from exfiltrating student data or accessing conversational intelligence merely through support access.

---

## 4. Step 3: Centralized AI Permission System

Rather than creating redundant permission tables, Knowletive's existing RBAC and catalog architecture was extended cleanly.

### 4.1 Master Allowlist of AI Capabilities
In [`src/lib/catalog.ts`](file:///D:/IT/Saas/src/lib/catalog.ts), 9 canonical AI capabilities were added to `AI_PERMISSION_KEYS` and registered in `AI_PERMISSION_ALLOWLIST`:
1. `tenant.ai.copilot` — Conversational AI Copilot interface
2. `tenant.ai.analytics.institute` — Executive KPI & operational summaries
3. `tenant.ai.analytics.student` — Student demographics & enrollment analytics
4. `tenant.ai.analytics.attendance` — Daily attendance aggregates & absenteeism trends
5. `tenant.ai.analytics.fees` — Fee collections, dues, and delinquency summaries
6. `tenant.ai.analytics.admissions` — Lead conversion & inquiry analysis
7. `tenant.ai.analytics.exams` — Exam performance & grade distribution analysis
8. `tenant.ai.reports.generate` — Automated report card & narrative generation
9. `tenant.ai.docs.intelligence` — Document parsing & syllabus intelligence

All AI permissions were deliberately excluded from default role templates (`INSTITUTE_ADMIN`, `TEACHER`, `STUDENT`, `PARENT`, `ACCOUNTANT`).

### 4.2 Unified Evaluation Engine
[`src/lib/ai-permissions.ts`](file:///D:/IT/Saas/src/lib/ai-permissions.ts) exposes `evaluateAiPermission(ctx, permissionKey)` which governs both the existing AI Studio and the new conversational Copilot:
1. **Allowlist Validation:** Rejects any unrecognized permission key with `INVALID_KEY`.
2. **Subscription Settlement Check:** Rejects access if the institute's subscription is `PAST_DUE` or `PAUSED`.
3. **Plan Feature Entitlement:** Rejects access if the subscription plan lacks the `"ai"` feature flag.
4. **Support Impersonation Guard:** Rejects support sessions with `SUPPORT_DENIED`.
5. **Platform Owner Default Grant:** Grants access with `grantedVia: "PLATFORM_OWNER"`.
6. **Institute Owner Default Grant:** Grants access with `grantedVia: "INSTITUTE_OWNER"`.
7. **Explicit User Grant:** Inspects `ctx.membership.extraPermissions` for individual staff members. If present, grants access with `grantedVia: "EXPLICIT_GRANT"`.
8. **Default Deny:** Rejects everyone else with `DENIED`.

### 4.3 Secure Delegation & Audit Trail
Institute Owners can delegate AI capabilities to trusted staff members via `grantAiPermission()` and remove them via `revokeAiPermission()`. Every grant and revocation writes an immutable audit record to `AuditLog` via `writeAudit()`.

---

## 5. Step 4: Security Hardening & Guardrails

### 5.1 SESSION_SECRET Production Enforcement
In [`src/lib/auth.ts`](file:///D:/IT/Saas/src/lib/auth.ts), the hardcoded development secret fallback was patched:
```typescript
function getPendingSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret.length < 32 || secret.includes("dev-only")) {
      throw new Error(
        "FATAL SECURITY VIOLATION: SESSION_SECRET must be configured with at least 32 cryptographically secure characters in production.",
      );
    }
  }
  return new TextEncoder().encode(secret ?? "dev-only-pending-secret-change-before-production");
}
```

### 5.2 AI Rate Limiting
To prevent credit exhaustion and denial-of-wallet attacks, atomic rate limiting was added:
- **AI Studio (`src/lib/ai.ts`):** 10 requests / minute per user.
- **Copilot Chat (`src/app/api/copilot/chat/route.ts`):** 15 requests / minute per user.
Backed by the PostgreSQL `RateLimitBucket` table, surviving worker scaling and container restarts.

### 5.3 Prompt Injection & Jailbreak Defense
In [`src/lib/ai-security.ts`](file:///D:/IT/Saas/src/lib/ai-security.ts), `detectPromptInjection(prompt)` inspects prompts before LLM dispatch, neutralizing:
- Instruction override attempts (`ignore all previous instructions`).
- System prompt and internal rule exfiltration attempts (`reveal the system prompt`).
- Jailbreak personas (`DAN mode`, `unrestricted mode`, `bypass safety`).
- Delimiter escapes (`<system>`, `</instruction>`).

### 5.4 Personally Identifiable Information (PII) Scrubbing
`scrubPii(text)` automatically sanitizes sensitive personal data before prompts leave the application boundary:
- **Phone numbers:** 10-digit Indian numbers (`+91` prefixed or bare) redacted to `[STUDENT_PHONE]`.
- **Email addresses:** Redacted to `[CONTACT_EMAIL]`.
- **National IDs:** 12-digit Aadhaar / national ID numbers redacted to `[NATIONAL_ID]`.

---

## 6. Step 5: Next.js Gateway Architecture & Short-Lived Service Tokens

### 6.1 Private Inter-Service Mutual Authentication
Communication between Next.js and downstream Python microservices uses short-lived HMAC-SHA256 service tokens minted by [`src/lib/ai-gateway.ts`](file:///D:/IT/Saas/src/lib/ai-gateway.ts):
- **Token Type:** Signed JWT using HMAC-SHA256 (`HS256`).
- **Secret Key:** `AI_SERVICE_SECRET` (derived with 32-character production validation).
- **Time-to-Live (TTL):** Exactly 60 seconds (`"60s"`).
- **Claims Bound:** `{ userId, tenantId, roleKey, isOwner, jti, iat, exp }`.
- **Transport Header:** `X-Copilot-Service-Token`.

### 6.2 Gateway Endpoint: `POST /api/copilot/chat`
Implemented in [`src/app/api/copilot/chat/route.ts`](file:///D:/IT/Saas/src/app/api/copilot/chat/route.ts):
- Authenticates session and resolves active tenant.
- Enforces `evaluateAiPermission(ctx, "tenant.ai.copilot")`.
- Enforces rate limiting (15 req/min).
- Enforces prompt injection detection.
- Scrubs PII from user text.
- Dispatches approved tools through `executeApprovedTool()`.
- Supports both Server-Sent Events (SSE) streaming (`Accept: text/event-stream` or `stream: true`) and standard JSON responses.

---

## 7. Step 6: First Three Database-Backed AI Tools

Three tools were created in [`src/lib/ai-tools.ts`](file:///D:/IT/Saas/src/lib/ai-tools.ts), adhering to approved schemas and strict tenant isolation:

### Tool 1: `get_student_count`
- **Required Permission:** `tenant.ai.analytics.student`
- **Output:** Total students, active students, filtered count by status/class, and class-level distribution breakdown.
- **Data Source:** `db.student.count` and `db.student.groupBy` joined with `db.classLevel`.

### Tool 2: `get_attendance_summary`
- **Required Permission:** `tenant.ai.analytics.attendance`
- **Output:** Total marked, present count, absent count, late count, excused count, and computed `attendanceRatePercentage`.
- **Fallback Logic:** Matches the dashboard logic in `src/app/(app)/app/page.tsx` — if today has no attendance records and no explicit date was requested, automatically queries the most recent date with records and flags `isFallbackDate: true`.

### Tool 3: `get_outstanding_fee_summary`
- **Required Permission:** `tenant.ai.analytics.fees`
- **Output:** Invoiced total (paise), collected total (paise), outstanding balance (paise and rupees), pending invoice count, and overdue invoice count.
- **Mathematical Alignment:** Matches arithmetic in `src/app/(app)/app/fees/page.tsx`.

### Strict Cross-Tenant Protection
`executeApprovedTool` enforces `const tenantId = ctx.tenant.id`. Tool parameters cannot override or poison the tenant ID.

---

## 8. Step 7: Automated Test Suite & Verification Results

A comprehensive automated test suite was constructed in [`tests/ai-authorization-and-tools.test.ts`](file:///D:/IT/Saas/tests/ai-authorization-and-tools.test.ts).

### 8.1 Test Execution Results
Executed via `npx vitest run tests/ai-authorization-and-tools.test.ts`:

```
 RUN  v5.1.0 D:/IT/Saas

 ✓ tests/ai-authorization-and-tools.test.ts (25 tests) 18ms
   ✓ Knowletive Phase 2: Centralized AI Authorization & Ownership Resolution (11)
     ✓ 1. Platform Owner has default AI access enabled
     ✓ 2. Institute Owner has default AI access enabled within their own institute
     ✓ 3. Support impersonator is denied AI access by default
     ✓ 4. Institute Admin (non-owner) is denied AI access by default
     ✓ 5. Teacher role is denied AI access by default
     ✓ 6. Student role is denied AI access by default
     ✓ 7. Parent role is denied AI access by default
     ✓ 8. Explicit user grant allows non-owner staff member to access AI
     ✓ 9. Revoking permission denies access to previously authorized user
     ✓ 10. AI capability rejected if subscription is past due or plan lacks AI feature
     ✓ 11. Rejects unapproved AI permission keys outside the allowlist
   ✓ Knowletive Phase 2: Short-Lived HMAC Service Tokens (3)
     ✓ mints and verifies a valid short-lived service token
     ✓ rejects tampered or forged service tokens
     ✓ rejects arbitrary junk strings as service tokens
   ✓ Knowletive Phase 2: AI Security & Guardrails (3)
     ✓ detects and blocks prompt injection and instruction override attempts
     ✓ permits standard educational and administrative questions
     ✓ scrubs Indian phone numbers, emails, and Aadhaar numbers from prompts
   ✓ Knowletive Phase 2: Module-Level AI Tool Execution & Tenant Isolation (8)
     ✓ rejects unapproved tools not listed in the registry
     ✓ enforces granular permission: get_student_count requires tenant.ai.analytics.student
     ✓ enforces granular permission: get_attendance_summary requires tenant.ai.analytics.attendance
     ✓ enforces granular permission: get_outstanding_fee_summary requires tenant.ai.analytics.fees
     ✓ executes get_student_count with strict tenantId scoping
     ✓ executes get_attendance_summary and calculates accurate percentage
     ✓ executes get_outstanding_fee_summary and calculates correct rupee balances
     ✓ strictly prevents cross-tenant parameter poisoning

 Test Files  1 passed (1)
      Tests  25 passed (25)
   Duration  389ms
```

### 8.2 Typecheck Verification
Executed via `npm run typecheck`:
```
> knowletive-saas@0.1.0 typecheck
> tsc --noEmit
(0 errors)
```

---

## 9. List of Remaining Integration Work (Phase 3 Roadmap)

1. **Python Copilot Service Tool Implementations:**
   - Implement the empty stub files (`tools/fee_tools.py`, `tools/attendance_tools.py`, `tools/analytics_tools.py`) in the Python engine (`D:\CoachGenieNew\Coachgenie_Phase1\copilot_engine`) to ingest the normalized payloads produced by Next.js gateway tools.
2. **Conversational Chat UI Component:**
   - Build a floating, accessible chat widget or dedicated drawer (`/app/copilot`) accessible only to users with `tenant.ai.copilot` permission.
   - Wire SSE streaming client with real-time markdown and tool indicator widgets.
3. **Multi-Turn Chat Persistence Models:**
   - In a planned migration window, introduce `CopilotThread` and `CopilotMessage` models in Prisma using `cuid()` keys, scoped to `tenantId` and `userId`.
4. **Tool Confirmation for Mutating Actions:**
   - Phase 2 tools are strictly read-only. When Phase 3 introduces action-taking tools (e.g. sending fee reminders, drafting admission emails), implement human-in-the-loop explicit confirmation prompts before execution.
