-- Stage 2.2.3: Credit Provenance, Outstanding Transfer Balances and Consent Lifecycle Corrections
-- 1. Introduces ConsentAction enum and GuardianConsentEvent immutable audit trail
-- 2. Adds transferredOnward column to StudentCreditAccount with non-negative check constraint
-- 3. Immutability guard trigger for GuardianConsentEvent

-- CreateEnum
CREATE TYPE "ConsentAction" AS ENUM ('CREATED', 'VERIFIED', 'REJECTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "GuardianConsentEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "action" "ConsentAction" NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuardianConsentEvent_tenantId_id_key" ON "GuardianConsentEvent"("tenantId", "id");

-- CreateIndex
CREATE INDEX "GuardianConsentEvent_tenantId_consentId_idx" ON "GuardianConsentEvent"("tenantId", "consentId");

-- CreateIndex
CREATE INDEX "GuardianConsentEvent_tenantId_action_idx" ON "GuardianConsentEvent"("tenantId", "action");

-- CreateIndex
CREATE INDEX "GuardianConsentEvent_tenantId_createdAt_idx" ON "GuardianConsentEvent"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "GuardianConsentEvent" ADD CONSTRAINT "GuardianConsentEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianConsentEvent" ADD CONSTRAINT "GuardianConsentEvent_tenantId_consentId_fkey" FOREIGN KEY ("tenantId", "consentId") REFERENCES "GuardianConsent"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddColumn and CheckConstraint to StudentCreditAccount
ALTER TABLE "StudentCreditAccount" ADD COLUMN "transferredOnward" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "StudentCreditAccount" ADD CONSTRAINT "chk_student_credit_transferred_onward_non_negative" CHECK ("transferredOnward" >= 0);

-- ----------------------------------------------------------------------------
-- Immutability Guard Trigger: GuardianConsentEvent
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_protect_guardian_consent_event_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'GuardianConsentEvent records are immutable audit logs and cannot be updated, deleted, or truncated (id: %, consentId: %)',
    OLD.id, OLD."consentId"
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guardian_consent_event_protect ON "GuardianConsentEvent";
CREATE TRIGGER trg_guardian_consent_event_protect
BEFORE UPDATE OR DELETE ON "GuardianConsentEvent"
FOR EACH ROW
EXECUTE FUNCTION fn_protect_guardian_consent_event_immutability();

DROP TRIGGER IF EXISTS trg_guardian_consent_event_truncate ON "GuardianConsentEvent";
CREATE TRIGGER trg_guardian_consent_event_truncate
BEFORE TRUNCATE ON "GuardianConsentEvent"
FOR EACH STATEMENT
EXECUTE FUNCTION fn_protect_guardian_consent_event_immutability();
