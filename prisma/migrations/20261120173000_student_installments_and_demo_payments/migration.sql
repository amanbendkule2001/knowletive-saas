-- ─────────────────────────────────────────────────────────────────────────────
-- Knowletive: Student Fee Installments, Demo Payments & Provider Configuration
-- Migration: 20261120173000_student_installments_and_demo_payments
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create StudentFeePlan Table
CREATE TABLE IF NOT EXISTS "StudentFeePlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT,
    "title" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "payableAmount" INTEGER NOT NULL,
    "scheduleType" TEXT NOT NULL DEFAULT 'CUSTOM',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentFeePlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_student_fee_plan_amounts" CHECK ("totalAmount" >= 0 AND "discountAmount" >= 0 AND "payableAmount" >= 0 AND "payableAmount" = "totalAmount" - "discountAmount"),
    CONSTRAINT "chk_student_fee_plan_status" CHECK ("status" IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT "chk_student_fee_plan_schedule_type" CHECK ("scheduleType" IN ('MONTHLY', 'QUARTERLY', 'CUSTOM', 'MANUAL'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudentFeePlan_tenantId_id_key" ON "StudentFeePlan"("tenantId", "id");
CREATE INDEX IF NOT EXISTS "StudentFeePlan_tenantId_studentId_idx" ON "StudentFeePlan"("tenantId", "studentId");
CREATE INDEX IF NOT EXISTS "StudentFeePlan_tenantId_branchId_idx" ON "StudentFeePlan"("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "StudentFeePlan_tenantId_status_idx" ON "StudentFeePlan"("tenantId", "status");

ALTER TABLE "StudentFeePlan" ADD CONSTRAINT "StudentFeePlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentFeePlan" ADD CONSTRAINT "StudentFeePlan_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudentFeePlan" ADD CONSTRAINT "StudentFeePlan_tenantId_studentId_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Create StudentFeeInstallment Table
CREATE TABLE IF NOT EXISTS "StudentFeeInstallment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "studentId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "feeInvoiceId" TEXT,
    "installmentNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "originalAmount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "lateFeeAmount" INTEGER NOT NULL DEFAULT 0,
    "allowPartial" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentFeeInstallment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_installment_amounts" CHECK ("originalAmount" >= 0 AND "discountAmount" >= 0 AND "lateFeeAmount" >= 0),
    CONSTRAINT "chk_installment_status" CHECK ("status" IN ('UPCOMING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED')),
    CONSTRAINT "chk_installment_number" CHECK ("installmentNumber" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudentFeeInstallment_tenantId_id_key" ON "StudentFeeInstallment"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "StudentFeeInstallment_planId_installmentNumber_key" ON "StudentFeeInstallment"("planId", "installmentNumber");
CREATE INDEX IF NOT EXISTS "StudentFeeInstallment_tenantId_studentId_idx" ON "StudentFeeInstallment"("tenantId", "studentId");
CREATE INDEX IF NOT EXISTS "StudentFeeInstallment_tenantId_dueDate_idx" ON "StudentFeeInstallment"("tenantId", "dueDate");
CREATE INDEX IF NOT EXISTS "StudentFeeInstallment_tenantId_status_idx" ON "StudentFeeInstallment"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "StudentFeeInstallment_tenantId_branchId_idx" ON "StudentFeeInstallment"("tenantId", "branchId");
CREATE INDEX IF NOT EXISTS "StudentFeeInstallment_feeInvoiceId_idx" ON "StudentFeeInstallment"("feeInvoiceId");

ALTER TABLE "StudentFeeInstallment" ADD CONSTRAINT "StudentFeeInstallment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentFeeInstallment" ADD CONSTRAINT "StudentFeeInstallment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudentFeeInstallment" ADD CONSTRAINT "StudentFeeInstallment_tenantId_studentId_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentFeeInstallment" ADD CONSTRAINT "StudentFeeInstallment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "StudentFeePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentFeeInstallment" ADD CONSTRAINT "StudentFeeInstallment_feeInvoiceId_fkey" FOREIGN KEY ("feeInvoiceId") REFERENCES "FeeInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Create InstallmentScheduleChange Table (Audit Trail)
CREATE TABLE IF NOT EXISTS "InstallmentScheduleChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "changedById" TEXT,
    "changeType" TEXT NOT NULL,
    "previousValues" JSONB NOT NULL,
    "newValues" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallmentScheduleChange_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_schedule_change_type" CHECK ("changeType" IN ('DUE_DATE_CHANGE', 'AMOUNT_ADJUSTMENT', 'AMOUNT_AND_DUE_DATE', 'STATUS_CHANGE', 'CANCELLATION'))
);

CREATE INDEX IF NOT EXISTS "InstallmentScheduleChange_tenantId_installmentId_idx" ON "InstallmentScheduleChange"("tenantId", "installmentId");
ALTER TABLE "InstallmentScheduleChange" ADD CONSTRAINT "InstallmentScheduleChange_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "StudentFeeInstallment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Create PaymentProviderConfig Table
CREATE TABLE IF NOT EXISTS "PaymentProviderConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'DEMO',
    "merchantId" TEXT,
    "collectorCode" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "secretRef" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProviderConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_provider_type" CHECK ("provider" IN ('DEMO', 'JODO')),
    CONSTRAINT "chk_provider_env" CHECK ("environment" IN ('DEMO', 'TEST', 'LIVE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentProviderConfig_tenantId_branchId_provider_environment_key" ON "PaymentProviderConfig"("tenantId", "branchId", "provider", "environment");
CREATE INDEX IF NOT EXISTS "PaymentProviderConfig_tenantId_provider_idx" ON "PaymentProviderConfig"("tenantId", "provider");
CREATE INDEX IF NOT EXISTS "PaymentProviderConfig_tenantId_branchId_idx" ON "PaymentProviderConfig"("tenantId", "branchId");

ALTER TABLE "PaymentProviderConfig" ADD CONSTRAINT "PaymentProviderConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentProviderConfig" ADD CONSTRAINT "PaymentProviderConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Create Dedicated Demo Models (Isolated)
CREATE TABLE IF NOT EXISTS "DemoFeePlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "studentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "payableAmount" INTEGER NOT NULL,
    "scheduleType" TEXT NOT NULL DEFAULT 'CUSTOM',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoFeePlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DemoFeePlan_tenantId_id_key" ON "DemoFeePlan"("tenantId", "id");
CREATE INDEX IF NOT EXISTS "DemoFeePlan_tenantId_studentId_idx" ON "DemoFeePlan"("tenantId", "studentId");
CREATE INDEX IF NOT EXISTS "DemoFeePlan_tenantId_branchId_idx" ON "DemoFeePlan"("tenantId", "branchId");

ALTER TABLE "DemoFeePlan" ADD CONSTRAINT "DemoFeePlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemoFeePlan" ADD CONSTRAINT "DemoFeePlan_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DemoFeePlan" ADD CONSTRAINT "DemoFeePlan_tenantId_studentId_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "DemoFeeInstallment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "studentId" TEXT NOT NULL,
    "demoPlanId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "originalAmount" INTEGER NOT NULL,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "allowPartial" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'UPCOMING',
    "sourceInstallmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoFeeInstallment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DemoFeeInstallment_tenantId_id_key" ON "DemoFeeInstallment"("tenantId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "DemoFeeInstallment_demoPlanId_installmentNumber_key" ON "DemoFeeInstallment"("demoPlanId", "installmentNumber");
CREATE INDEX IF NOT EXISTS "DemoFeeInstallment_tenantId_studentId_idx" ON "DemoFeeInstallment"("tenantId", "studentId");
CREATE INDEX IF NOT EXISTS "DemoFeeInstallment_tenantId_dueDate_idx" ON "DemoFeeInstallment"("tenantId", "dueDate");
CREATE INDEX IF NOT EXISTS "DemoFeeInstallment_tenantId_status_idx" ON "DemoFeeInstallment"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "DemoFeeInstallment_sourceInstallmentId_idx" ON "DemoFeeInstallment"("sourceInstallmentId");

ALTER TABLE "DemoFeeInstallment" ADD CONSTRAINT "DemoFeeInstallment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemoFeeInstallment" ADD CONSTRAINT "DemoFeeInstallment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DemoFeeInstallment" ADD CONSTRAINT "DemoFeeInstallment_tenantId_studentId_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemoFeeInstallment" ADD CONSTRAINT "DemoFeeInstallment_demoPlanId_fkey" FOREIGN KEY ("demoPlanId") REFERENCES "DemoFeePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "DemoPaymentSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "studentId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "tokenHash" TEXT,
    "sourceInstallmentId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "installmentIds" JSONB NOT NULL,
    "allowPartial" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "payerName" TEXT,
    "payerPhone" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoPaymentSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_demo_session_amount" CHECK ("amount" > 0),
    CONSTRAINT "chk_demo_session_status" CHECK ("status" IN ('OPEN', 'SUCCESS', 'FAILED', 'PENDING', 'CANCELLED', 'EXPIRED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "DemoPaymentSession_sessionToken_key" ON "DemoPaymentSession"("sessionToken");
CREATE UNIQUE INDEX IF NOT EXISTS "DemoPaymentSession_tokenHash_key" ON "DemoPaymentSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "DemoPaymentSession_tenantId_sessionToken_idx" ON "DemoPaymentSession"("tenantId", "sessionToken");
CREATE INDEX IF NOT EXISTS "DemoPaymentSession_tenantId_tokenHash_idx" ON "DemoPaymentSession"("tenantId", "tokenHash");
CREATE INDEX IF NOT EXISTS "DemoPaymentSession_tenantId_studentId_idx" ON "DemoPaymentSession"("tenantId", "studentId");
CREATE INDEX IF NOT EXISTS "DemoPaymentSession_tenantId_status_idx" ON "DemoPaymentSession"("tenantId", "status");

ALTER TABLE "DemoPaymentSession" ADD CONSTRAINT "DemoPaymentSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemoPaymentSession" ADD CONSTRAINT "DemoPaymentSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DemoPaymentSession" ADD CONSTRAINT "DemoPaymentSession_tenantId_studentId_fkey" FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "DemoPaymentTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "demoInstallmentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'DEMO',
    "reference" TEXT NOT NULL,
    "simulationOutcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoPaymentTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DemoPaymentTransaction_tenantId_sessionId_idx" ON "DemoPaymentTransaction"("tenantId", "sessionId");
CREATE INDEX IF NOT EXISTS "DemoPaymentTransaction_demoInstallmentId_idx" ON "DemoPaymentTransaction"("demoInstallmentId");

ALTER TABLE "DemoPaymentTransaction" ADD CONSTRAINT "DemoPaymentTransaction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DemoPaymentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DemoPaymentTransaction" ADD CONSTRAINT "DemoPaymentTransaction_demoInstallmentId_fkey" FOREIGN KEY ("demoInstallmentId") REFERENCES "DemoFeeInstallment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
