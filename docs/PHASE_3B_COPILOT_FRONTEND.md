# PHASE 3B: KNOWLETIVE AI COPILOT FRONTEND & ACCESS MANAGEMENT

## 1. Executive Summary

Phase 3B delivers the complete, user-facing AI Copilot experience and owner-governed access management system directly within the existing Knowletive Next.js 16 SaaS application (`D:\IT\Saas`).

All components maintain strict alignment with Knowletive's production architecture:
- Next.js 16 App Router (React 19 Server & Client Components)
- Native PostgreSQL with Prisma ORM
- Centralized RBAC and tenant security isolation
- Full streaming SSE protocol integration with the Python Copilot Engine (`D:\CoachGenieNew\Coachgenie_Phase1\copilot_engine`)
- Preserved existing design system (Tailwind CSS, Lucide icons, existing design tokens)
- Completely independent of the existing AI Studio (`/app/ai`)

---

## 2. Component Architecture Overview

The frontend Copilot interface is structured modularly under `src/components/ai-copilot/`:

```
src/components/ai-copilot/
├── CopilotWidget.tsx          # Floating bottom-right launcher button (Ctrl+J shortcut)
├── CopilotPanel.tsx           # Slide-in chat drawer with SSE stream consumer
├── CopilotHeader.tsx          # Live status badge, new chat, history toggle, minimize
├── CopilotMessages.tsx        # Autoscrolling message feed with empty state greeting
├── CopilotMessage.tsx         # User & Assistant bubbles with custom markdown formatter
├── CopilotInput.tsx           # Auto-resizing multiline textarea with abort generator
├── CopilotSuggestions.tsx     # Context-aware question chips based on current pathname
├── CopilotDataTable.tsx       # Tabular renderer for census, attendance, and fee metrics
├── CopilotSourceReference.tsx # Accordion for verified tool grounding and date fallbacks
└── CopilotHistory.tsx         # Conversation drawer for renaming, deleting, and resuming chats
```

### 2.1 Mounting & Permission Boundary
`CopilotWidget` is mounted inside `src/app/(app)/app/layout.tsx` after the main page `{children}`:
- **Permission Pre-check:** Before rendering, `evaluateAiPermission(ctx, "tenant.ai.copilot")` is evaluated on the server.
- **Fail-Closed Privacy:** If the authenticated user does not have active Copilot permission (e.g., standard Teacher, Student, Parent, or non-owner Admin without an explicit grant), `CopilotWidget` returns `null` and renders nothing to the DOM.

---

## 3. Streaming SSE & Error Handling Protocol

`CopilotPanel.tsx` communicates with Next.js endpoint `POST /api/copilot/chat` requesting Server-Sent Events (`Accept: text/event-stream`):

1. **`event: thread`**: Dispatches the persistent thread identifier (`{ threadId: string }`). The frontend binds to this thread immediately.
2. **`event: tools`**: Delivers array of executed tools (`{ toolName, success, data, disclaimer }`). Rendered interactively via `CopilotSourceReference`.
3. **`event: chunk`**: Emits real-time word tokens (`{ text: string }`), streaming directly into the message bubble without UI freezing.
4. **`event: done`**: Finalizes the message stream with performance and engine metadata (`{ engine, threadId }`).
5. **Abort Controller Support:** Users can halt generation at any instant by clicking the Stop (`Square`) button. The client triggers `AbortController.abort()`, closing the HTTP connection and preventing unwanted token consumption.

---

## 4. Context-Aware Suggestions Engine

`CopilotSuggestions.tsx` dynamically inspects the active browser route using Next.js `usePathname()` and recommends tailored, grounded queries:

| Route Path | Contextual Suggestion Chips |
| :--- | :--- |
| `/app` | "What is our current student strength?", "Summarize today's attendance", "Show outstanding fees summary" |
| `/app/attendance` | "Summarize today's attendance figures", "Which classes have the highest absent rate?", "How many students were marked late?" |
| `/app/fees` | "What is our total outstanding fee balance?", "Show overdue fee invoice summary", "Which class has the largest unpaid balance?" |
| `/app/students` | "What is our total student strength?", "Break down student enrollment by class", "Show newly admitted students" |
| `/app/exams` | "Summarize recent exam results", "Which subject had the lowest pass percentage?", "Show grade distribution breakdown" |

---

## 5. Security Invariants & Grounding Disclaimers

1. **Fallback Date Disclaimers:** When attendance data cannot be located for the exact current date, the tool falls back to the most recent historical attendance session and returns an explicit disclaimer (e.g. `Attendance recorded on 2026-11-17 (most recent session)`). `CopilotSourceReference` renders this with an amber warning banner so previous-day figures are never misrepresented as today's live data.
2. **Zero PII Exposure:** User prompts are scrubbed of phone numbers, emails, Aadhaar numbers, and PAN cards prior to forwarding to LLM providers.
3. **Domain Isolation:** Even if granted AI conversational privileges, a user lacking `tenant.fees.read` cannot extract financial balances via tools. The tool gateway enforces domain-level permissions on every invocation.

---

## 6. Verification Status

- **Automated Vitest Suite:** 89/89 tests passing across all 4 suites (`tests/copilot-frontend-and-threads.test.ts`, `tests/copilot-live-verification.test.ts`, `tests/copilot-engine-integration.test.ts`, `tests/ai-authorization-and-tools.test.ts`).
- **Python Copilot Engine:** 12/12 pytest tests passing (`tests/test_copilot_service.py`).
- **TypeScript Checking:** `npm run typecheck` passing with 0 errors.
