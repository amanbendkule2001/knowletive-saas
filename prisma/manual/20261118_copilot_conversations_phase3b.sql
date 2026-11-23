-- Migration: Add Copilot Conversation Models & Enums for Phase 3B
-- Safe, Non-Destructive Migration for Production Deployment

DO $$ BEGIN
  CREATE TYPE "CopilotMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "CopilotMessageStatus" AS ENUM ('SENT', 'STREAMING', 'COMPLETE', 'ERROR');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "CopilotThread" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'New Chat',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "CopilotThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CopilotMessage" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "role" "CopilotMessageRole" NOT NULL DEFAULT 'USER',
  "content" TEXT NOT NULL,
  "status" "CopilotMessageStatus" NOT NULL DEFAULT 'COMPLETE',
  "provider" TEXT,
  "model" TEXT,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "durationMs" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopilotMessage_pkey" PRIMARY KEY ("id")
);

-- Foreign Keys with Cascade Deletion
DO $$ BEGIN
  ALTER TABLE "CopilotThread" 
    ADD CONSTRAINT "CopilotThread_tenantId_fkey" 
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CopilotThread" 
    ADD CONSTRAINT "CopilotThread_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CopilotMessage" 
    ADD CONSTRAINT "CopilotMessage_threadId_fkey" 
    FOREIGN KEY ("threadId") REFERENCES "CopilotThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Indexes for Tenant Isolation & High-Velocity Pagination
CREATE INDEX IF NOT EXISTS "CopilotThread_tenantId_userId_deletedAt_idx" ON "CopilotThread"("tenantId", "userId", "deletedAt");
CREATE INDEX IF NOT EXISTS "CopilotThread_updatedAt_idx" ON "CopilotThread"("updatedAt");
CREATE INDEX IF NOT EXISTS "CopilotMessage_threadId_createdAt_idx" ON "CopilotMessage"("threadId", "createdAt");
