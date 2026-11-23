# COPILOT CONVERSATION STORAGE & PERSISTENCE

## 1. Overview & Design Principles

All conversational Copilot interactions are persisted in native PostgreSQL via Prisma ORM to provide:
1. Continuous multi-turn conversation memory.
2. Complete auditability and token accounting without storing PII.
3. Strict tenant isolation and user ownership enforcement.
4. Non-destructive soft-delete capability.

---

## 2. Prisma Database Schema

Added to `prisma/schema.prisma` with zero data loss:

```prisma
enum CopilotMessageRole {
  USER
  ASSISTANT
  SYSTEM
  TOOL
}

enum CopilotMessageStatus {
  SENT
  STREAMING
  COMPLETE
  ERROR
}

model CopilotThread {
  id        String    @id @default(cuid())
  tenantId  String
  userId    String
  title     String    @default("New Chat")
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  tenant   Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user     User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages CopilotMessage[]

  @@index([tenantId, userId, deletedAt])
  @@index([updatedAt])
}

model CopilotMessage {
  id           String               @id @default(cuid())
  threadId     String
  role         CopilotMessageRole   @default(USER)
  content      String               @db.Text
  status       CopilotMessageStatus @default(COMPLETE)
  provider     String?
  model        String?
  inputTokens  Int?
  outputTokens Int?
  durationMs   Int?
  metadata     Json?
  createdAt    DateTime             @default(now())

  thread CopilotThread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId, createdAt])
}
```

### 2.1 Cascade Deletion Semantics
- When a `Tenant` is deleted, all associated `CopilotThread` and `CopilotMessage` records are permanently removed via foreign key cascades.
- When a `User` is deleted, all their conversation threads and messages cascade.
- User-triggered deletions in the UI execute as **soft deletes** (`deletedAt = new Date()`), ensuring historical references remain intact for governance audits.

---

## 3. Conversation Management Endpoints

All thread endpoints strictly verify user session and tenant ownership:

| Endpoint | Method | Description | Security Controls |
| :--- | :--- | :--- | :--- |
| `/api/copilot/threads` | `GET` | List active conversations (up to 50) | Scoped to `tenantId = ctx.tenant.id AND userId = ctx.user.id AND deletedAt = null` |
| `/api/copilot/threads` | `POST` | Create a new conversation thread | Auto-generates CUID, defaults title to "New Chat" or snippet |
| `/api/copilot/threads/[id]` | `GET` | Fetch thread details and messages | Returns messages ordered by `createdAt asc`. Rejects cross-user access with 404 |
| `/api/copilot/threads/[id]` | `PATCH` | Rename conversation title | Sanitizes title string (up to 80 chars), checks ownership |
| `/api/copilot/threads/[id]` | `DELETE`| Soft-delete conversation | Sets `deletedAt = now()`. Excluded from future listings |

---

## 4. Context Loading & Token Accounting

During every conversation turn in `POST /api/copilot/chat`:
1. If `threadId` is supplied:
   - Validates thread ownership (`tenantId`, `userId`, `deletedAt: null`).
   - Fetches the last 10 messages from the thread to construct a compact chronological context window for the LLM.
2. Persists the incoming prompt as a `USER` message.
3. Upon LLM response generation:
   - Persists the assistant output as an `ASSISTANT` message.
   - Records `inputTokens`, `outputTokens`, `durationMs`, and `metadata` containing grounding tool names and execution status.
   - Bumps `thread.updatedAt = new Date()`.
   - Writes an immutable audit entry to `db.auditLog` with action `ai.copilot.chat`.
