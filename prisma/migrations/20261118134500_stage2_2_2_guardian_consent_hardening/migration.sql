-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('SIBLING_CREDIT_TRANSFER', 'GENERAL_FINANCIAL');

-- CreateEnum
CREATE TYPE "ConsentVerificationMethod" AS ENUM ('STAFF_VERIFIED_DOCUMENT', 'DIGITAL_SIGNATURE', 'OTP_CHALLENGE');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "GuardianConsent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "sourceStudentId" TEXT NOT NULL,
    "destinationStudentId" TEXT NOT NULL,
    "scope" "ConsentScope" NOT NULL DEFAULT 'SIBLING_CREDIT_TRANSFER',
    "fileAssetId" TEXT,
    "verificationMethod" "ConsentVerificationMethod" NOT NULL DEFAULT 'STAFF_VERIFIED_DOCUMENT',
    "status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianConsent_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CreditTransferRequest" ADD COLUMN "guardianConsentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GuardianConsent_tenantId_id_key" ON "GuardianConsent"("tenantId", "id");

-- CreateIndex
CREATE INDEX "GuardianConsent_tenantId_guardianId_idx" ON "GuardianConsent"("tenantId", "guardianId");

-- CreateIndex
CREATE INDEX "GuardianConsent_tenantId_sourceStudentId_destinationStudentId_idx" ON "GuardianConsent"("tenantId", "sourceStudentId", "destinationStudentId");

-- CreateIndex
CREATE INDEX "GuardianConsent_tenantId_status_idx" ON "GuardianConsent"("tenantId", "status");

-- CreateIndex
CREATE INDEX "GuardianConsent_tenantId_scope_idx" ON "GuardianConsent"("tenantId", "scope");

-- CreateIndex
CREATE INDEX "GuardianConsent_fileAssetId_idx" ON "GuardianConsent"("fileAssetId");

-- CreateIndex
CREATE INDEX "CreditTransferRequest_tenantId_guardianConsentId_idx" ON "CreditTransferRequest"("tenantId", "guardianConsentId");

-- AddForeignKey
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_tenantId_sourceStudentId_fkey" FOREIGN KEY ("tenantId", "sourceStudentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_tenantId_destinationStudentId_fkey" FOREIGN KEY ("tenantId", "destinationStudentId") REFERENCES "Student"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransferRequest" ADD CONSTRAINT "CreditTransferRequest_tenantId_guardianConsentId_fkey" FOREIGN KEY ("tenantId", "guardianConsentId") REFERENCES "GuardianConsent"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
