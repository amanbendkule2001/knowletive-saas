# PHASE 3A: PYTHON COPILOT ENGINE INTEGRATION REPORT

**Author:** Principal AI Architect, Python/FastAPI Engineer & Application Security Specialist  
**Project:** Knowletive Education Management SaaS & Python Copilot Engine  
**Execution Date:** November 18, 2026  
**Status:** COMPLETE & VERIFIED

---

## 1. Executive Summary

Phase 3A establishes the production-grade bidirectional integration between the **Knowletive Next.js 16 Full-Stack SaaS Application** (`D:\IT\Saas`) and the extracted **Python FastAPI Copilot Engine** (`D:\CoachGenieNew\Coachgenie_Phase1\copilot_engine`).

### Core Architectural Principle
Next.js remains the **authoritative gatekeeper** of identity, multi-tenant isolation, RBAC capabilities, underlying domain read permissions, and database operations. The Python Copilot Engine operates strictly as a **stateless reasoning and streaming microservice**. Under no circumstances does the Python engine connect directly to the PostgreSQL database or execute raw SQL.

---

## 2. Python Engine Audit & Remediations

Prior to integration, the Python Copilot codebase was inspected and stabilized:

| Module Path | Pre-Integration Status | Phase 3A Remediated Implementation |
| :--- | :--- | :--- |
| `copilot_engine/routes/copilot.py` | Outdated endpoint `/copilot/chat`, missing service token verification, single-turn wait | Multi-route `/api/v1/copilot/chat` & `/copilot/chat`, `X-Copilot-Service-Token` HMAC verification, SSE streaming (`StreamingResponse`) & JSON |
| `copilot_engine/orchestrators/chat_orchestrators.py` | Single-turn Groq caller with hardcoded PostgreSQL URL for PDF reports | Full intent routing, dynamic tool invocation, grounded system prompt construction with zero hallucination rules & fallback date disclosures |
| `copilot_engine/llm/providers/groq_client.py` | Fake generator `generate_stream()` yielding all tokens at once | True async streaming generator using `AsyncGroq(stream=True)`, yielding token-by-token deltas with graceful offline fallback |
| `copilot_engine/tools/attendance_tools.py` | **0 bytes (Empty)** | Implemented `AttendanceTool` with `get_attendance_summary` and `get_low_attendance_summary`, capturing present, absent, rates, and fallback dates |
| `copilot_engine/tools/fee_tools.py` | **0 bytes (Empty)** | Implemented `FeeTool` with `get_outstanding_fee_summary` calculating total invoiced, collected, outstanding balance, pending, overdue, and collection rates |
| `copilot_engine/tools/analytics_tools.py` | **0 bytes (Empty)** | Implemented `AnalyticsTool` executing concurrent tool reads via `asyncio.gather` to build consolidated institute health overviews |
| `copilot_engine/tools/student_tools.py` | Deprecated UUID expectations, broken imports | Updated to accept CUID strings; implemented `StudentCountTool` with active/total strength and class breakdown |
| `copilot_engine/security/service_token.py` | **Missing** | Implemented HMAC-SHA256 signature verification, issuer/audience validation, 60s TTL, and `jti` in-memory nonce replay protection |
| `copilot_engine/security/sql_guard.py` | **0 bytes (Empty)** | Implemented `assert_no_raw_sql` preventing direct SQL queries or SQL injection attempts |
| `copilot_engine/security/tenant_guard.py` | **0 bytes (Empty)** | Implemented `enforce_tenant_boundary` and `sanitize_tool_parameters` locking tenant scope to verified context |

---

## 3. Bidirectional Communication Contract

### 3.1 Next.js $\rightarrow$ Python Copilot Engine Dispatch
- **Endpoint:** `POST ${COPILOT_ENGINE_URL}/api/v1/copilot/chat` (fallback `/copilot/chat`)
- **Headers:**
  - `Content-Type: application/json`
  - `Accept: text/event-stream` (when client requests streaming) or `application/json`
  - `X-Copilot-Service-Token`: Short-lived HMAC token (TTL 60s, HS256) signed with `AI_SERVICE_SECRET`
  - `X-Tenant-Id`: Verified tenant CUID
  - `X-User-Id`: Verified user CUID
- **Request Body:**
  ```json
  {
    "message": "What is our current attendance rate and outstanding fee balance?",
    "history": [
      { "role": "user", "content": "..." },
      { "role": "assistant", "content": "..." }
    ],
    "tool_context": [
      {
        "success": true,
        "toolName": "get_student_count",
        "data": { "activeStudents": 150, "totalStudents": 160, "byClassBreakdown": [...] }
      }
    ],
    "stream": true
  }
  ```

### 3.2 Python Copilot Engine $\rightarrow$ Next.js Tool Execution Callback
When the Python engine requires fresh or dynamic database metrics, it calls back to the authoritative Next.js API:
- **Endpoint:** `POST ${BACKEND_API_BASE_URL}/api/copilot/tools/execute`
- **Headers:**
  - `X-Copilot-Service-Token`: Token passed in the originating request
  - `X-Tenant-Id`: Verified tenant CUID
  - `X-User-Id`: Verified user CUID
- **Request Body:**
  ```json
  {
    "toolName": "get_attendance_summary",
    "params": {
      "date": "2026-11-18",
      "sectionId": "cuid_section_123"
    }
  }
  ```
- **Security Validation in Next.js:**
  1. Validates token HMAC signature against `AI_SERVICE_SECRET`.
  2. Ensures `iss === "knowletive-gateway"` and `aud === "knowletive-copilot-engine"`.
  3. Verifies `jti` nonce has not been consumed within its 60-second window (replay defense).
  4. Cross-checks `X-Tenant-Id` and `X-User-Id` headers against service token claims.
  5. Resolves authoritative `TenantContext` from PostgreSQL.
  6. Evaluates AI module capability (`evaluateAiPermission`).
  7. Evaluates underlying domain read permission (`TOOL_DOMAIN_PERMISSION_MAP`). Non-owners without `tenant.<domain>.read` are rejected with `403 DOMAIN_READ_DENIED`.
  8. Executes deterministic Prisma query with locked tenant boundary.

### 3.3 Server-Sent Events (SSE) Streaming Protocol
When streaming is requested (`stream: true` or `Accept: text/event-stream`), the Python engine and Next.js forwarder emit standard SSE chunks:
1. `event: tool_start\ndata: {"message": "Resolving database metrics..."}\n\n`
2. `event: tool_end\ndata: {"tools": [...]}\n\n`
3. `event: chunk\ndata: {"text": " token "}\n\n`
4. `event: done\ndata: {"tokens": 142, "duration_ms": 320, "engine": "python_service"}\n\n`
5. `event: error\ndata: {"error": "..."}\n\n` (on error)

---

## 4. Operational Invariants & Security Enforcements

1. **Strict Tenant Isolation:**
   - Parameter manipulation attempts (e.g. sending `params: { tenantId: "victim_tenant" }`) are purged and overridden with the verified context `ctx.tenant.id`.
   - Header mismatches between `X-Tenant-Id` and token `payload.tenantId` fail immediately with `403 CROSS_TENANT_FORBIDDEN`.
2. **Replay Protection via `jti` Nonces:**
   - Every service token carries a unique cryptographic `jti` identifier.
   - Nonce consumption is recorded in an in-memory TTL cache with automatic pruning. Replayed tokens fail with `401 Unauthorized`.
3. **Attendance Fallback Date Disclosure:**
   - If an institute has not marked attendance for today, the query retrieves the most recent calendar register.
   - The engine explicitly returns `isFallbackDate: true` and formats a mandatory disclosure:  
     `[NOTICE: No register marked for today; displaying latest register from YYYY-MM-DD]`  
     Ensuring past data is never represented as today's data.
4. **Zero Direct Database Connections from Python:**
   - Python code contains zero raw SQL statements and does not connect directly to PostgreSQL.
   - All data is accessed via the Next.js `/api/copilot/tools/execute` gateway.
5. **Usage & Audit Logging:**
   - Every Copilot interaction triggers asynchronous `writeAudit` logging in `src/app/api/copilot/chat/route.ts`:
     - `action: "ai.copilot.chat"`
     - Records `engineUsed`, `toolsRequested`, `toolsExecutedCount`, `tokens`, and `durationMs`.

---

## 5. Verification & Test Suite Results

### 5.1 Next.js Vitest Integration Scenarios (`tests/copilot-engine-integration.test.ts`)
All 13 specific integration scenarios pass 100%:
- **Scenario 1 (Student Count):** PASS (active strength & class breakdown verified)
- **Scenario 2 (Attendance Percentage):** PASS (attendance percentage & status counts verified)
- **Scenario 3 (Outstanding Fees):** PASS (invoiced, collected, balance, overdue count verified)
- **Scenario 4 (Multiple Tools):** PASS (compound student + attendance + fees executed concurrently)
- **Scenario 5 (Invalid Tool Request):** PASS (unapproved tools rejected with `TOOL_NOT_APPROVED`)
- **Scenario 6 (Unauthorized Module Access):** PASS (missing domain read permission rejected with `DOMAIN_READ_DENIED`)
- **Scenario 7 (Cross-Tenant Access Attempt):** PASS (header spoofing rejected with `403 CROSS_TENANT_FORBIDDEN`)
- **Scenario 8 (Missing Database Information):** PASS (fallback date & explicit notice verified)
- **Scenario 9 (LLM Provider Failure):** PASS (graceful grounded synthesis fallback verified)
- **Scenario 10 (Streaming Interruption):** PASS (clean abort and disconnect signal handling)
- **Scenario 11 (Invalid Service Token):** PASS (tampered signature rejected with 401)
- **Scenario 12 (Expired Service Token):** PASS (expired token rejected with 401)
- **Scenario 13 (Tool Parameter Manipulation):** PASS (tenant parameter spoofing overridden by verified context)

### 5.2 Python Copilot Engine Pytest Suite (`copilot_engine/tests/test_copilot_service.py`)
All 12 Python integration tests pass 100%:
- `TestServiceTokenSecurity::test_valid_token_decodes_cleanly` PASSED
- `TestServiceTokenSecurity::test_replayed_nonce_is_rejected` PASSED
- `TestServiceTokenSecurity::test_expired_token_is_rejected` PASSED
- `TestServiceTokenSecurity::test_tampered_signature_is_rejected` PASSED
- `TestServiceTokenSecurity::test_invalid_audience_or_issuer_is_rejected` PASSED
- `TestSecurityGuards::test_zero_raw_sql_guard_blocks_sql` PASSED
- `TestSecurityGuards::test_tenant_boundary_guard_enforced` PASSED
- `TestSecurityGuards::test_parameter_manipulation_sanitized` PASSED
- `TestChatEndpointsAsync::test_chat_without_token_rejected_401` PASSED
- `TestChatEndpointsAsync::test_chat_with_cross_tenant_header_mismatch_rejected_403` PASSED
- `TestChatEndpointsAsync::test_chat_with_valid_token_and_grounded_context` PASSED
- `TestChatEndpointsAsync::test_streaming_sse_endpoint` PASSED

### 5.3 Full Regression Suite
- `npm run typecheck`: **0 errors (Passes cleanly)**
- Existing AI Authorization Suite (`tests/ai-authorization-and-tools.test.ts`): **38/38 passing (100%)**
- Baseline Tracked Repository Suites: **19/19 files passing (375 tests passing, 0 regressions)**

---

## 6. Constraints Adherence Affirmation

In strict compliance with the Phase 3A requirements:
- [x] **No Chat UI Widget Built:** Frontend UI chat components have not been created yet (reserved for Phase 3B).
- [x] **No Database Schema Alterations:** No `CopilotThread` or `CopilotMessage` models or migrations were added.
- [x] **No RAG or Autonomous Mutations:** All data access is strictly read-only deterministic reporting.
- [x] **No AI Studio Replacement:** Existing AI Studio, credit accounting, and model pipelines remain untouched.
- [x] **Zero Raw SQL in Python:** Python microservice contains no database connection strings or raw queries.
