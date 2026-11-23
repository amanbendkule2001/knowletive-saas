# Knowletive SaaS — Existing AI Module Audit

**Document Version:** 1.0.0  
**Audit Date:** November 18, 2026  
**Auditor:** Senior Software Architect, AI Systems Engineer & SaaS Security Auditor  
**Repository Working Directory:** `D:\IT\Saas`  
**Primary AI Code Artifacts:**
- Master Library: [`src/lib/ai.ts`](file:///D:/IT/Saas/src/lib/ai.ts) (326 lines)
- Master Action: [`src/actions/operations.ts`](file:///D:/IT/Saas/src/actions/operations.ts#L528) (`runAiAction`, `deleteAiJobAction`)
- AI Catalog Registry: [`src/lib/catalog.ts`](file:///D:/IT/Saas/src/lib/catalog.ts#L392) (`AI_FEATURES`)
- Institute UI: [`src/app/(app)/app/ai/page.tsx`](file:///D:/IT/Saas/src/app/(app)/app/ai/page.tsx)
- Platform UI: [`src/app/(platform)/platform/ai/page.tsx`](file:///D:/IT/Saas/src/app/(platform)/platform/ai/page.tsx)
- Client Composer Island: [`src/components/app/ai-composer.tsx`](file:///D:/IT/Saas/src/components/app/ai-composer.tsx)
- Lead Reply Island: [`src/components/app/lead-ai-reply.tsx`](file:///D:/IT/Saas/src/components/app/lead-ai-reply.tsx)

---

## 1. Existing AI System Architecture

The existing AI implementation in Knowletive is a **synchronous, task-based generation engine branded as "AI Studio"**. It is designed as an administrative drafting assistant rather than an autonomous conversational agent.

```
┌────────────────────────────────────────────────────────────────────────┐
│                          CLIENT BROWSER (UI)                           │
│  - /app/ai (AI Studio Page)                                            │
│  - <AiComposer /> (Client Island using React 19 useActionState)        │
│  - Selects 1 of 6 Predefined Modules                                   │
│  - Enters brief in <textarea name="prompt" maxLength={6000} />         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Form Submission (HTTP POST)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│             SERVER ACTION: runAiAction (src/actions/operations.ts)     │
│  1. RBAC Guard: authorizeTenantWrite("tenant.ai.use")                  │
│  2. Entitlement Guard: hasFeature(plan, "ai")                          │
│  3. Validation: aiSchema.safeParse(formData)                           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Invokes runAiJob(input)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               AI SERVICE PIPELINE (src/lib/ai.ts)                      │
│                                                                        │
│  1. Check Monthly Capacity                                             │
│     - Queries TenantUsage (periodStart = startOfMonth())               │
│                                                                        │
│  2. Optimistic Concurrency Credit Reservation                          │
│     - db.tenantUsage.updateMany({                                      │
│         where: { aiCreditsUsed: { lte: creditLimit - cost } },         │
│         data: { aiCreditsUsed: { increment: cost } }                   │
│       })                                                               │
│     - If count === 0: Throws "Not enough AI credits"                   │
│                                                                        │
│  3. Provider Routing & Generation (generate(input))                    │
│     - If AI_PROVIDER === "openai" AND OPENAI_API_KEY:                  │
│         Calls https://api.openai.com/v1/chat/completions (fetch, 45s) │
│     - Else (Default Demo Mode):                                        │
│         Calls mockGeneration() -> Returns deterministic template       │
│                                                                        │
│  4. Post-Execution Settlement                                          │
│     - On Success: Records AiJob (status: SUCCEEDED, tokensIn, duration)│
│     - On Error: Refunds credits (aiCreditsUsed decrement: cost)        │
│                 Records AiJob (status: FAILED, error message)          │
│                                                                        │
│  5. Audit Log                                                          │
│     - writeAudit({ action: "ai.run", entity: "AiJob", ... })           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ revalidatePath("/app/ai")
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        RESULT PRESENTATION                             │
│  Redirects browser to /app/ai?job=<jobId>                              │
│  Renders generated text in copyable Card with metadata badges           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Inventory of Existing AI Modules

The system defines 6 specialized modules in [`src/lib/catalog.ts`](file:///D:/IT/Saas/src/lib/catalog.ts#L401):

| Module Key | Display Label | Description | Credit Cost | System Prompt Specialization |
| :--- | :--- | :--- | :---: | :--- |
| `report_card_remarks` | Report card remarks | Turn marks and observations into balanced, parent-friendly remarks. | 2 | "Write a balanced report card remark of 90-140 words: strengths, one growth area, and a concrete suggestion for parents. Warm, professional, no labels." |
| `lesson_plan` | Lesson plan builder | Generate a structured, outcome-based lesson plan for any topic. | 3 | "Produce a 45-minute lesson plan with learning outcomes, prior knowledge, hook, guided practice, independent task, differentiation and a 3-question exit ticket. Include one low-cost classroom activity." |
| `question_paper` | Question paper | Create a blueprint-aligned question paper with answer keys. | 4 | "Create a question paper with sections A-E, clear marks per question, instructions, and a short answer key. Match the requested blueprint and total marks." |
| `fee_reminder` | Fee reminder | Write polite, firm reminders for pending fees in seconds. | 1 | "Draft a polite but clear fee reminder of 100-150 words with amount, due date, payment options and an offer to discuss a payment plan. Keep dignity and relationship intact." |
| `admission_reply` | Admission enquiry reply | Answer admission enquiries with accurate next steps. | 1 | "Draft an admission enquiry reply with a warm opening, the requested details (fees, transport, documents, timeline) as bullets, and one clear next step with a call to action. Note any information the school must confirm." |
| `attendance_insight` | Attendance insight | Spot attendance risks and get an action plan for the week. | 2 | "Analyse the attendance brief. List 3 likely causes, 3 prioritized interventions with owners and timelines, and one parent-communication template. Flag anything that needs a counsellor." |

---

## 3. Provider & Model Routing Audit

- **Configured Providers:**
  1. `openai`: Invoked when `AI_PROVIDER=openai` and `OPENAI_API_KEY` is present.
  2. `mock`: Default offline mock engine. Evaluates prompt and returns instant, deterministic, curriculum-accurate markdown templates.
- **Model Configuration:** Configured via `process.env.OPENAI_MODEL ?? "gpt-4o-mini"`.
- **Base URL:** Configurable via `process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"`.
- **Missing Provider Features:**
  - No streaming response handling (`stream: false`).
  - No fallback chain (e.g. if OpenAI fails, failover to Anthropic or Gemini).
  - No dynamic router or model selector (e.g. routing simple tasks to Flash/Mini and complex reasoning to Pro/GPT-4o).
  - No support for open-source self-hosted models (Ollama, vLLM) out-of-the-box.

---

## 4. Analytics, Metering & Billing Enforcement

- **Database Model `TenantUsage`:**
  - Tracks `aiCreditsUsed` and `aiCreditsLimit` keyed by `@@unique([tenantId, periodStart])`.
  - Resets monthly (`startOfMonth()`).
- **Database Model `AiJob`:**
  - Stores execution telemetry: `id`, `tenantId`, `userId`, `feature`, `prompt`, `output`, `credits`, `status` (`SUCCEEDED`, `FAILED`), `provider`, `model`, `tokensIn`, `tokensOut`, `durationMs`, `error`, `createdAt`.
- **Optimistic Concurrency Protection:**
  - Credits are reserved atomically in PostgreSQL before model dispatch:
    ```typescript
    const reserved = await db.tenantUsage.updateMany({
      where: {
        tenantId: input.tenantId,
        periodStart,
        aiCreditsUsed: { lte: input.creditLimit - cost },
      },
      data: { aiCreditsUsed: { increment: cost } },
    });
    ```
  - This eliminates race conditions where concurrent browser tabs consume more credits than allowed by the plan.
- **Failure Refund Guarantee:**
  - If the upstream provider times out (45s) or returns an HTTP error, the system decrements `aiCreditsUsed` by `cost` and logs an `AiJob` with status `FAILED` and `credits: 0`.

---

## 5. Security & Isolation Controls

1. **Plan Entitlement Verification:** Server action verifies that `ctx.tenant.subscription.plan.features` contains `"ai"`. Tenants on the `starter` tier (which lacks the `"ai"` feature flag) are rejected.
2. **Permission Gate:** Requires `tenant.ai.use` permission, preventing unauthorized roles (such as parents, students, front desk) from triggering AI jobs.
3. **Multi-Tenant Scoping:** All `AiJob` and `TenantUsage` records are bound to `ctx.tenant.id`. A tenant cannot view another tenant's AI jobs.
4. **Input Boundary:** Client enforces `maxLength={6000}` on prompt textarea; server validates via Zod `z.string().min(10).max(6000)`.
5. **Security Gaps Identified:**
   - **No Prompt Injection Defense:** User prompts are concatenated directly into the LLM user message without sanitization or adversarial detection.
   - **No PII Redaction:** Prompts containing student names, phone numbers, or health data are transmitted directly to external LLM providers without tokenization or anonymization.

---

## 6. Functional Gap Analysis: AI Studio vs AI Copilot Engine

| Capability | Existing AI Studio Implementation | AI Copilot Engine Requirements | Status |
| :--- | :--- | :--- | :---: |
| **Interaction Model** | One-shot form submission (`<textarea>` -> Submit -> Page reload) | Interactive, multi-turn conversational chat | **Missing** |
| **Response Delivery** | Synchronous HTTP blocking (waits up to 45s for full payload) | Real-time token streaming via Server-Sent Events (SSE) | **Missing** |
| **Conversation Memory** | None (Each job is an isolated row in `AiJob`) | Persistent multi-turn chat threads & message history | **Missing** |
| **Context Grounding (RAG)** | User must manually paste student/class data into the brief | Autonomous retrieval of database context (students, fees, exams) | **Missing** |
| **Tool Execution / Function Calling** | None (Static text generation only) | Agentic tool invocation (e.g. `lookup_student`, `get_exam_results`) | **Missing** |
| **Streaming UI** | Static card rendering after page redirect | Real-time chat widget, markdown renderer, thinking states | **Missing** |
| **Default Access Policy** | Accessible to any staff member with `tenant.ai.use` (e.g. Teachers) | Restricted strictly to Platform Owner & Institute Owner by default | **Requires Configuration** |

---

## 7. Assessment of Supplied `copilot_engine.zip`

- **Physical File Status:** The file `copilot_engine.zip` is **not present** in the repository root or subdirectories.
- **Architectural Role:** Based on prompt instructions, `copilot_engine.zip` represents a standalone AI Copilot Engine (implemented in Python / FastAPI).
- **Compatibility Analysis:**
  - The existing Next.js application has **no FastAPI or Python runtime components**.
  - Integrating `copilot_engine.zip` requires establishing a decoupled sidecar or microservice deployment:
    - FastAPI runs as an independent container/service.
    - Next.js acts as the authenticated API Gateway, verifying sessions, checking tenant entitlements, proxying streaming chat requests to FastAPI, and maintaining audit logs.
  - The existing database tables (`AiJob`, `TenantUsage`) can be reused or extended with dedicated conversation models (`CopilotThread`, `CopilotMessage`) to store conversational history.
