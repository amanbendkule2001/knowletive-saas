-- Migration: Phase 2.3.3 — Critical Pre-RLS Remediation, Composite FKs, Canonical Copilot/Webhook Closure & Role Privilege Hardening
-- Stack: PostgreSQL 18.3, Prisma 6.19.3
-- Idempotent and forward-compatible for both fresh installs and existing databases

-- ============================================================================
-- 1. TENANT-AWARE FINANCIAL COMPOSITE FOREIGN KEYS
-- ============================================================================

-- 1.1 PaymentReceipt(tenantId, branchId) -> Branch(tenantId, id)
ALTER TABLE "PaymentReceipt" DROP CONSTRAINT IF EXISTS "PaymentReceipt_branchId_fkey";

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PaymentReceipt_tenantId_branchId_fkey'
  ) THEN
    ALTER TABLE "PaymentReceipt"
      ADD CONSTRAINT "PaymentReceipt_tenantId_branchId_fkey"
      FOREIGN KEY ("tenantId", "branchId")
      REFERENCES "Branch"("tenantId", "id")
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

-- 1.2 FeePayment(tenantId, branchId) -> Branch(tenantId, id)
ALTER TABLE "FeePayment" DROP CONSTRAINT IF EXISTS "FeePayment_branchId_fkey";

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FeePayment_tenantId_branchId_fkey'
  ) THEN
    ALTER TABLE "FeePayment"
      ADD CONSTRAINT "FeePayment_tenantId_branchId_fkey"
      FOREIGN KEY ("tenantId", "branchId")
      REFERENCES "Branch"("tenantId", "id")
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

-- 1.3 Lead(tenantId, branchId) -> Branch(tenantId, id) (Hardened to ON UPDATE RESTRICT)
ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_tenantId_branchId_fkey";

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Lead_tenantId_branchId_fkey'
  ) THEN
    ALTER TABLE "Lead"
      ADD CONSTRAINT "Lead_tenantId_branchId_fkey"
      FOREIGN KEY ("tenantId", "branchId")
      REFERENCES "Branch"("tenantId", "id")
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

-- ============================================================================
-- 2. CANONICAL COPILOT THREAD & MESSAGE TABLES
-- ============================================================================

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
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CopilotThread_tenantId_fkey') THEN
    ALTER TABLE "CopilotThread"
      ADD CONSTRAINT "CopilotThread_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CopilotThread_userId_fkey') THEN
    ALTER TABLE "CopilotThread"
      ADD CONSTRAINT "CopilotThread_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CopilotMessage_threadId_fkey') THEN
    ALTER TABLE "CopilotMessage"
      ADD CONSTRAINT "CopilotMessage_threadId_fkey"
      FOREIGN KEY ("threadId") REFERENCES "CopilotThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CopilotThread_tenantId_userId_deletedAt_idx" ON "CopilotThread"("tenantId", "userId", "deletedAt");
CREATE INDEX IF NOT EXISTS "CopilotThread_updatedAt_idx" ON "CopilotThread"("updatedAt");
CREATE INDEX IF NOT EXISTS "CopilotMessage_threadId_createdAt_idx" ON "CopilotMessage"("threadId", "createdAt");

-- ============================================================================
-- 3. WEBHOOKEVENT CANONICAL RECONCILIATION
-- ============================================================================

ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "rawPayload" JSONB;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "WebhookEvent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "WebhookEvent_tenantId_idx" ON "WebhookEvent"("tenantId");
CREATE INDEX IF NOT EXISTS "WebhookEvent_status_idx" ON "WebhookEvent"("status");
CREATE INDEX IF NOT EXISTS "WebhookEvent_provider_createdAt_idx" ON "WebhookEvent"("provider", "createdAt");

-- ============================================================================
-- 4. RUNTIME DATABASE ROLE SEPARATION & LEAST-PRIVILEGE GRANTS
-- ============================================================================

-- Ensure role exists with strict non-superuser, non-bypassrls attributes
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'knowletive_app') THEN
    CREATE ROLE knowletive_app WITH LOGIN PASSWORD 'knowletive_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE knowletive_app WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- Schema usage
GRANT USAGE ON SCHEMA public TO knowletive_app;

-- 4.1 Operational Tables (Standard CRUD)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "Tenant", "User", "Membership", "MembershipBranch", "Branch",
  "Student", "Guardian", "StudentGuardian", "GuardianConsent",
  "AcademicYear", "ClassLevel", "Section", "Subject", "GradeScale", "GradeBand",
  "Batch", "BatchStudent", "BatchTeacher", "Attendance",
  "Examination", "ExamSubject", "ExamEnrollment", "ExamMark", "ExamResult",
  "SyllabusTrack", "SyllabusChapter", "SyllabusTopic", "SyllabusTeacher", "TopicProgress", "LessonPlan",
  "Lead", "Announcement", "FileAsset",
  "FeeInvoice", "FeePaymentLink", "StudentFeePlan", "StudentFeeInstallment",
  "DemoFeePlan", "DemoFeeInstallment", "DemoPaymentSession", "DemoPaymentTransaction",
  "PaymentCollectorRoute", "PaymentProviderConfig", "Plan", "Invoice", "Payment", "TenantSubscription", "TenantUsage",
  "RateLimitBucket", "Session", "PasswordResetToken", "Setting", "AiJob"
TO knowletive_app;

-- 4.2 AI Conversation Models (Full Turn CRUD)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "CopilotThread", "CopilotMessage"
TO knowletive_app;

-- 4.3 Webhook Inbox (Append & Update lifecycle)
GRANT SELECT, INSERT, UPDATE ON TABLE
  "WebhookEvent"
TO knowletive_app;

-- 4.4 Mutable Financial Projections (SELECT, INSERT, UPDATE — NO DELETE)
GRANT SELECT, INSERT, UPDATE ON TABLE
  "PaymentReceiptBalance", "StudentCreditAccount", "BranchPayout"
TO knowletive_app;

-- 4.5 Immutable Financial Event & Ledger Tables (SELECT, INSERT — STRICTLY NO UPDATE, NO DELETE)
REVOKE UPDATE, DELETE ON TABLE
  "FeePayment", "PaymentReceipt", "PaymentAllocation", "PaymentAllocationReversal",
  "CreditTransferRequest", "CreditTransferApprovalEvent", "CreditTransferJournal",
  "CreditTransferSourceAllocation", "CreditTransferPosting",
  "BranchLedgerEntry"
FROM knowletive_app;

GRANT SELECT, INSERT ON TABLE
  "FeePayment", "PaymentReceipt", "PaymentAllocation", "PaymentAllocationReversal",
  "CreditTransferRequest", "CreditTransferApprovalEvent", "CreditTransferJournal",
  "CreditTransferSourceAllocation", "CreditTransferPosting",
  "BranchLedgerEntry"
TO knowletive_app;

-- 4.6 Immutable Audit & Event Tables (SELECT, INSERT — STRICTLY NO UPDATE, NO DELETE)
REVOKE UPDATE, DELETE ON TABLE
  "AuditLog", "BatchEnrollmentEvent", "ExamResultSnapshot",
  "ExamMarksRevisionEvent", "SyllabusProgressEvent", "BranchReconciliationAudit",
  "GuardianConsentEvent", "LeadActivity", "NotificationLog"
FROM knowletive_app;

GRANT SELECT, INSERT ON TABLE
  "AuditLog", "BatchEnrollmentEvent", "ExamResultSnapshot",
  "ExamMarksRevisionEvent", "SyllabusProgressEvent", "BranchReconciliationAudit",
  "GuardianConsentEvent", "LeadActivity", "NotificationLog"
TO knowletive_app;

-- 4.7 Permission Registry Tables (SELECT ONLY — Writes are deployment/migration responsibility)
REVOKE INSERT, UPDATE, DELETE ON TABLE
  "Permission", "Role", "RolePermission"
FROM knowletive_app;

GRANT SELECT ON TABLE
  "Permission", "Role", "RolePermission"
TO knowletive_app;

-- 4.8 Mutable Financial Projections & Webhook Inbox (REVOKE DELETE)
REVOKE DELETE ON TABLE
  "PaymentReceiptBalance", "StudentCreditAccount", "BranchPayout", "WebhookEvent"
FROM knowletive_app;

-- 4.8 Reporting Views (SELECT)
GRANT SELECT ON TABLE
  "v_effective_fee_payment", "v_effective_payment_receipt", "v_effective_payment_allocation"
TO knowletive_app;

-- 4.9 Sequences & Functions
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO knowletive_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO knowletive_app;

-- Revoke dangerous privileges
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM knowletive_app;
REVOKE CREATE ON SCHEMA public FROM knowletive_app;
