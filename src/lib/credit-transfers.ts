import "server-only";

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";

// ─────────────────────────────────────────────────────────────────────────────
// Custom Domain Error Classes
// ─────────────────────────────────────────────────────────────────────────────

export class CreditTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditTransferError";
  }
}

export class UnauthorizedTransferError extends CreditTransferError {
  constructor(message = "Unauthorized: insufficient permissions for credit transfer operation") {
    super(message);
    this.name = "UnauthorizedTransferError";
  }
}

export class SelfTransferForbiddenError extends CreditTransferError {
  constructor(message = "Self-transfer is forbidden: source and target student cannot be identical") {
    super(message);
    this.name = "SelfTransferForbiddenError";
  }
}

export class CrossTenantTransferForbiddenError extends CreditTransferError {
  constructor(message = "Cross-tenant transfer is forbidden: source and target students must belong to the exact same tenant") {
    super(message);
    this.name = "CrossTenantTransferForbiddenError";
  }
}

export class InvalidSiblingGuardianRelationshipError extends CreditTransferError {
  constructor(message = "Sibling verification failed: source and target students must share a common verified guardian") {
    super(message);
    this.name = "InvalidSiblingGuardianRelationshipError";
  }
}

export class MissingGuardianConsentEvidenceError extends CreditTransferError {
  constructor(message = "Guardian consent evidence reference is required and must not be empty") {
    super(message);
    this.name = "MissingGuardianConsentEvidenceError";
  }
}

export class InvalidGuardianConsentEvidenceError extends CreditTransferError {
  constructor(message = "Guardian consent evidence is invalid, unverified, or not found") {
    super(message);
    this.name = "InvalidGuardianConsentEvidenceError";
  }
}

export class InsufficientAvailableCreditError extends CreditTransferError {
  constructor(availablePaise: number, requestedPaise: number) {
    super(
      `Insufficient available credit: source student has ${availablePaise} paise available, but transfer requested ${requestedPaise} paise`
    );
    this.name = "InsufficientAvailableCreditError";
  }
}

export class MakerSelfApprovalForbiddenError extends CreditTransferError {
  constructor(message = "Maker-checker violation: the request creator cannot approve or reject their own transfer request") {
    super(message);
    this.name = "MakerSelfApprovalForbiddenError";
  }
}

export class InvalidRequestStateTransitionError extends CreditTransferError {
  constructor(currentStatus: string, attemptedAction: string) {
    super(`Cannot ${attemptedAction} request in status ${currentStatus}`);
    this.name = "InvalidRequestStateTransitionError";
  }
}

export class RejectionReasonRequiredError extends CreditTransferError {
  constructor(message = "A non-empty rejection reason is required when rejecting a transfer request") {
    super(message);
    this.name = "RejectionReasonRequiredError";
  }
}

export class UnapprovedTransferExecutionForbiddenError extends CreditTransferError {
  constructor(status: string) {
    super(`Cannot execute transfer request in status ${status}: request must be APPROVED before execution`);
    this.name = "UnapprovedTransferExecutionForbiddenError";
  }
}

export class RejectedTransferExecutionForbiddenError extends CreditTransferError {
  constructor(message = "Cannot execute a rejected credit transfer request") {
    super(message);
    this.name = "RejectedTransferExecutionForbiddenError";
  }
}

export class CancelledTransferExecutionForbiddenError extends CreditTransferError {
  constructor(message = "Cannot execute a cancelled credit transfer request") {
    super(message);
    this.name = "CancelledTransferExecutionForbiddenError";
  }
}

export class IdempotencyPayloadMismatchError extends CreditTransferError {
  constructor(message = "Idempotency key already used with different transfer parameters") {
    super(message);
    this.name = "IdempotencyPayloadMismatchError";
  }
}

export class GuardianConsentNotFoundError extends InvalidGuardianConsentEvidenceError {
  constructor(message = "Guardian consent record not found in tenant") {
    super(message);
    this.name = "GuardianConsentNotFoundError";
  }
}

export class UnverifiedGuardianConsentError extends InvalidGuardianConsentEvidenceError {
  constructor(message = "Guardian consent has not been verified by staff") {
    super(message);
    this.name = "UnverifiedGuardianConsentError";
  }
}

export class RejectedGuardianConsentError extends InvalidGuardianConsentEvidenceError {
  constructor(message = "Guardian consent has been rejected") {
    super(message);
    this.name = "RejectedGuardianConsentError";
  }
}

export class RevokedGuardianConsentError extends InvalidGuardianConsentEvidenceError {
  constructor(message = "Guardian consent has been revoked") {
    super(message);
    this.name = "RevokedGuardianConsentError";
  }
}

export class ExpiredGuardianConsentError extends InvalidGuardianConsentEvidenceError {
  constructor(message = "Guardian consent has expired") {
    super(message);
    this.name = "ExpiredGuardianConsentError";
  }
}

export class InvalidConsentScopeError extends InvalidGuardianConsentEvidenceError {
  constructor(message = "Guardian consent scope does not authorize sibling credit transfers") {
    super(message);
    this.name = "InvalidConsentScopeError";
  }
}

export class InvalidConsentStudentMismatchError extends InvalidGuardianConsentEvidenceError {
  constructor(message = "Guardian consent does not match source and destination sibling pair") {
    super(message);
    this.name = "InvalidConsentStudentMismatchError";
  }
}

export class InvalidConsentStateTransitionError extends CreditTransferError {
  constructor(message = "Invalid consent status transition") {
    super(message);
    this.name = "InvalidConsentStateTransitionError";
  }
}

// Aliases for domain errors
export const CreditTransferDomainError = CreditTransferError;
export type CreditTransferDomainError = CreditTransferError;
export const MakerCheckerViolationError = MakerSelfApprovalForbiddenError;
export type MakerCheckerViolationError = MakerSelfApprovalForbiddenError;
export const CreditTransferLifecycleError = InvalidRequestStateTransitionError;
export type CreditTransferLifecycleError = InvalidRequestStateTransitionError;
export const InsufficientReceiptBalanceError = InsufficientAvailableCreditError;
export type InsufficientReceiptBalanceError = InsufficientAvailableCreditError;
export class ConcurrencyConflictError extends CreditTransferError {}
export class DatabaseIntegrityError extends CreditTransferError {}
export class CreditTransferValidationError extends CreditTransferError {}


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ActorContext = {
  tenantId: string;
  userId: string;
  userName: string;
  roleKey: string;
  ip?: string | null;
};

export type CreateGuardianConsentInput = {
  guardianId: string;
  sourceStudentId: string;
  destinationStudentId: string;
  scope?: "SIBLING_CREDIT_TRANSFER" | "GENERAL_FINANCIAL";
  fileAssetId?: string | null;
  verificationMethod?: "STAFF_VERIFIED_DOCUMENT" | "DIGITAL_SIGNATURE" | "OTP_CHALLENGE";
  expiresAt?: Date | string | null;
};

export type VerifyGuardianConsentInput = {
  consentId: string;
  decision: "APPROVE" | "REJECT";
  rejectionReason?: string | null;
  expiresAt?: Date | string | null;
};

export type RevokeGuardianConsentInput = {
  consentId: string;
  reason: string;
};

export type StudentCreditReconciliationResult = {
  tenantId: string;
  studentId: string;
  isReconciled: boolean;
  spendableBalance: number;
  expectedSpendableBalance: number;
  directReceipts: {
    totalReceiptAmount: number;
    allocatedAmount: number;
    transferredOutAmount: number;
    unappliedAmount: number;
    reservedRefundAmount: number;
    refundedAmount: number;
    isConserved: boolean;
  };
  transfers: {
    totalTransferredIn: number;
    totalTransferredOut: number;
    totalTransferredOnward?: number;
    allocatedIn: number;
    outstandingTransferredIn: number;
  };
  discrepancies: string[];
};

export type RequestCreditTransferInput = {
  sourceStudentId: string;
  targetStudentId: string;
  amount: number; // in paise (> 0)
  reason: string;
  authorizedGuardianId?: string;
  guardianConsentRef: string;
  guardianConsentId?: string | null;
  idempotencyKey?: string | null;
};

export type ReviewCreditTransferInput = {
  requestId: string;
  notes?: string | null;
};

export type RejectCreditTransferInput = {
  requestId: string;
  reason: string;
  notes?: string | null;
};

export type ExecuteCreditTransferInput = {
  requestId: string;
  preventReplay?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Guardian Consent Services
// ─────────────────────────────────────────────────────────────────────────────

export async function createGuardianConsentService(
  input: CreateGuardianConsentInput,
  actor: ActorContext
) {
  const { tenantId } = actor;

  if (input.sourceStudentId === input.destinationStudentId) {
    throw new SelfTransferForbiddenError("Source and destination students must be distinct siblings");
  }

  // Verify students belong to tenant
  const students = await db.student.findMany({
    where: {
      tenantId,
      id: { in: [input.sourceStudentId, input.destinationStudentId] },
    },
    select: { id: true },
  });
  if (students.length !== 2) {
    throw new CrossTenantTransferForbiddenError("One or both students not found in this tenant");
  }

  // Verify guardian belongs to tenant
  const guardian = await db.guardian.findFirst({
    where: { id: input.guardianId, tenantId },
    select: { id: true },
  });
  if (!guardian) {
    throw new InvalidSiblingGuardianRelationshipError(`Guardian ${input.guardianId} not found in tenant`);
  }

  // Verify guardian is linked to both students in StudentGuardian
  const linkages = await db.studentGuardian.findMany({
    where: {
      guardianId: input.guardianId,
      studentId: { in: [input.sourceStudentId, input.destinationStudentId] },
    },
    select: { studentId: true },
  });
  const linkedIds = new Set(linkages.map((l) => l.studentId));
  if (!linkedIds.has(input.sourceStudentId) || !linkedIds.has(input.destinationStudentId)) {
    throw new InvalidSiblingGuardianRelationshipError(
      `Guardian ${input.guardianId} is not linked to both students in StudentGuardian`
    );
  }

  // If fileAssetId provided, verify it belongs to tenant and is DOCUMENT
  if (input.fileAssetId) {
    const asset = await db.fileAsset.findFirst({
      where: { id: input.fileAssetId, tenantId },
      select: { id: true, kind: true, studentId: true },
    });
    if (!asset || asset.kind !== "DOCUMENT") {
      throw new InvalidGuardianConsentEvidenceError(
        `FileAsset ${input.fileAssetId} not found in tenant or is not a DOCUMENT`
      );
    }
    if (asset.studentId && asset.studentId !== input.sourceStudentId && asset.studentId !== input.destinationStudentId) {
      throw new InvalidGuardianConsentEvidenceError(
        `FileAsset ${input.fileAssetId} is associated with an unrelated student`
      );
    }
  }

  const expDate = input.expiresAt ? new Date(input.expiresAt) : null;

  return await db.$transaction(async (tx) => {
    const consent = await tx.guardianConsent.create({
      data: {
        tenantId,
        guardianId: input.guardianId,
        sourceStudentId: input.sourceStudentId,
        destinationStudentId: input.destinationStudentId,
        scope: input.scope ?? "SIBLING_CREDIT_TRANSFER",
        fileAssetId: input.fileAssetId ?? null,
        verificationMethod: input.verificationMethod ?? "STAFF_VERIFIED_DOCUMENT",
        status: "PENDING", // Always initial state PENDING
        expiresAt: expDate,
        isRevoked: false,
      },
    });

    await tx.guardianConsentEvent.create({
      data: {
        tenantId,
        consentId: consent.id,
        action: "CREATED",
        actorId: actor.userId,
        actorName: actor.userName,
        notes: "Guardian consent record created",
      },
    });

    return consent;
  });
}

export async function verifyGuardianConsentService(
  input: VerifyGuardianConsentInput,
  actor: ActorContext
) {
  const { tenantId, userId, userName } = actor;

  return await db.$transaction(async (tx) => {
    const consent = await tx.guardianConsent.findFirst({
      where: { id: input.consentId, tenantId },
    });
    if (!consent) {
      throw new GuardianConsentNotFoundError(`Guardian consent ${input.consentId} not found in tenant`);
    }

    if (consent.status !== "PENDING") {
      throw new InvalidConsentStateTransitionError(
        `Cannot verify consent ${consent.id}: current status is ${consent.status}, expected PENDING`
      );
    }

    const expDate = input.expiresAt ? new Date(input.expiresAt) : consent.expiresAt;

    if (input.decision === "APPROVE") {
      const updated = await tx.guardianConsent.update({
        where: { id: consent.id },
        data: {
          status: "VERIFIED",
          verifiedById: userId,
          verifiedAt: new Date(),
          expiresAt: expDate,
        },
      });

      await tx.guardianConsentEvent.create({
        data: {
          tenantId,
          consentId: consent.id,
          action: "VERIFIED",
          actorId: userId,
          actorName: userName,
          notes: "Guardian consent verified by staff",
        },
      });

      return updated;
    } else {
      const updated = await tx.guardianConsent.update({
        where: { id: consent.id },
        data: {
          status: "REJECTED",
          verifiedById: userId,
          verifiedAt: new Date(),
          rejectionReason: input.rejectionReason ?? "Staff rejected",
        },
      });

      await tx.guardianConsentEvent.create({
        data: {
          tenantId,
          consentId: consent.id,
          action: "REJECTED",
          actorId: userId,
          actorName: userName,
          notes: input.rejectionReason ?? "Staff rejected",
        },
      });

      return updated;
    }
  });
}

export async function revokeGuardianConsentService(
  input: RevokeGuardianConsentInput,
  actor: ActorContext
) {
  const { tenantId, userId, userName } = actor;

  return await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<any[]>`
      SELECT id, "tenantId", "status", "isRevoked"
      FROM "GuardianConsent"
      WHERE id = ${input.consentId} AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    const consent = rows[0];
    if (!consent) {
      throw new GuardianConsentNotFoundError(`Guardian consent ${input.consentId} not found in tenant`);
    }

    if (consent.isRevoked || consent.status === "REVOKED") {
      throw new InvalidConsentStateTransitionError(`Consent ${consent.id} is already revoked`);
    }

    const updated = await tx.guardianConsent.update({
      where: { id: consent.id },
      data: {
        status: "REVOKED",
        isRevoked: true,
        revokedById: userId,
        revokedAt: new Date(),
        revocationReason: input.reason,
      },
    });

    await tx.guardianConsentEvent.create({
      data: {
        tenantId,
        consentId: consent.id,
        action: "REVOKED",
        actorId: userId,
        actorName: userName,
        notes: input.reason,
      },
    });

    return updated;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates sibling relationship and authentic GuardianConsent record:
 * 1. Both students belong to the tenant.
 * 2. Guardian exists in the tenant.
 * 3. Both students are linked to the common guardian in StudentGuardian.
 * 4. Genuine GuardianConsent record exists in tenant, scope = SIBLING_CREDIT_TRANSFER.
 * 5. Consent status is VERIFIED (not PENDING or REJECTED).
 * 6. Consent is not revoked and not expired.
 * 7. Evidence FileAsset (if attached) is a valid DOCUMENT.
 */
export async function validateSiblingAndConsent(
  client: Prisma.TransactionClient,
  tenantId: string,
  sourceStudentId: string,
  targetStudentId: string,
  authorizedGuardianId?: string | null,
  guardianConsentRef?: string | null,
  guardianConsentId?: string | null
) {
  if (sourceStudentId === targetStudentId) {
    throw new SelfTransferForbiddenError();
  }

  const consentIdentifier = (guardianConsentId || guardianConsentRef || "").trim();
  if (!consentIdentifier) {
    throw new MissingGuardianConsentEvidenceError();
  }

  // Check students belong to the tenant
  const students = await client.student.findMany({
    where: {
      tenantId,
      id: { in: [sourceStudentId, targetStudentId] },
    },
    select: { id: true, tenantId: true },
  });

  if (students.length !== 2) {
    throw new CrossTenantTransferForbiddenError("One or both students do not exist or belong to a different tenant");
  }

  // Check authorized guardian and StudentGuardian linkage for BOTH students
  if (authorizedGuardianId) {
    const guardian = await client.guardian.findFirst({
      where: {
        id: authorizedGuardianId,
        tenantId,
      },
      select: { id: true },
    });

    if (!guardian) {
      throw new InvalidSiblingGuardianRelationshipError(
        `Guardian ${authorizedGuardianId} not found in tenant ${tenantId}`
      );
    }

    const linkages = await client.studentGuardian.findMany({
      where: {
        guardianId: authorizedGuardianId,
        studentId: { in: [sourceStudentId, targetStudentId] },
      },
      select: { studentId: true },
    });

    const linkedStudentIds = new Set(linkages.map((l) => l.studentId));
    if (!linkedStudentIds.has(sourceStudentId) || !linkedStudentIds.has(targetStudentId)) {
      throw new InvalidSiblingGuardianRelationshipError(
        `Guardian ${authorizedGuardianId} is not linked to both source student (${sourceStudentId}) and target student (${targetStudentId})`
      );
    }
  }

  // Retrieve genuine GuardianConsent record
  const consent = await client.guardianConsent.findFirst({
    where: {
      id: consentIdentifier,
      tenantId,
    },
  });

  if (!consent) {
    throw new GuardianConsentNotFoundError(
      `Guardian consent record "${consentIdentifier}" was not found or does not belong to tenant ${tenantId}. Ordinary document uploads or arbitrary strings do not satisfy consent.`
    );
  }

  // Cross-tenant check
  if (consent.tenantId !== tenantId) {
    throw new CrossTenantTransferForbiddenError("Consent belongs to a different tenant");
  }

  // Scope check
  if (consent.scope !== "SIBLING_CREDIT_TRANSFER") {
    throw new InvalidConsentScopeError(
      `Guardian consent scope "${consent.scope}" does not authorize sibling credit transfers`
    );
  }

  // Student pair association check (supports bidirectional transfer within the authorized sibling pair)
  const matchesPair =
    (consent.sourceStudentId === sourceStudentId && consent.destinationStudentId === targetStudentId) ||
    (consent.sourceStudentId === targetStudentId && consent.destinationStudentId === sourceStudentId);

  if (!matchesPair) {
    throw new InvalidConsentStudentMismatchError(
      `Guardian consent students (${consent.sourceStudentId}, ${consent.destinationStudentId}) do not match transfer request (${sourceStudentId} -> ${targetStudentId})`
    );
  }

  const effectiveGuardianId = authorizedGuardianId || consent.guardianId;

  // Guardian identity match
  if (consent.guardianId !== effectiveGuardianId) {
    throw new InvalidSiblingGuardianRelationshipError(
      `Consent guardian "${consent.guardianId}" does not match requested authorized guardian "${effectiveGuardianId}"`
    );
  }

  // Ensure effective guardian is linked to both students
  if (!authorizedGuardianId) {
    const guardian = await client.guardian.findFirst({
      where: {
        id: effectiveGuardianId,
        tenantId,
      },
      select: { id: true },
    });

    if (!guardian) {
      throw new InvalidSiblingGuardianRelationshipError(
        `Guardian ${effectiveGuardianId} not found in tenant ${tenantId}`
      );
    }

    const linkages = await client.studentGuardian.findMany({
      where: {
        guardianId: effectiveGuardianId,
        studentId: { in: [sourceStudentId, targetStudentId] },
      },
      select: { studentId: true },
    });

    const linkedStudentIds = new Set(linkages.map((l) => l.studentId));
    if (!linkedStudentIds.has(sourceStudentId) || !linkedStudentIds.has(targetStudentId)) {
      throw new InvalidSiblingGuardianRelationshipError(
        `Guardian ${effectiveGuardianId} is not linked to both source student (${sourceStudentId}) and target student (${targetStudentId})`
      );
    }
  }

  // Revocation check
  if (consent.isRevoked || consent.status === "REVOKED") {
    throw new RevokedGuardianConsentError(
      `Guardian consent "${consent.id}" has been revoked: ${consent.revocationReason ?? "Revoked by staff"}`
    );
  }

  // Expiry check
  if (consent.expiresAt && consent.expiresAt.getTime() <= Date.now()) {
    throw new ExpiredGuardianConsentError(
      `Guardian consent "${consent.id}" expired at ${consent.expiresAt.toISOString()}`
    );
  }

  // Verification status check
  if (consent.status === "PENDING") {
    throw new UnverifiedGuardianConsentError(
      `Guardian consent "${consent.id}" has not been verified yet (status is PENDING)`
    );
  }

  if (consent.status === "REJECTED") {
    throw new RejectedGuardianConsentError(
      `Guardian consent "${consent.id}" was rejected: ${consent.rejectionReason ?? "No reason provided"}`
    );
  }

  if (consent.status !== "VERIFIED") {
    throw new UnverifiedGuardianConsentError(
      `Guardian consent "${consent.id}" has status "${consent.status}". Must be actively VERIFIED.`
    );
  }

  // Evidence file asset check (if present)
  if (consent.fileAssetId) {
    const asset = await client.fileAsset.findFirst({
      where: {
        id: consent.fileAssetId,
        tenantId,
      },
      select: { id: true, kind: true },
    });

    if (!asset || asset.kind !== "DOCUMENT") {
      throw new InvalidGuardianConsentEvidenceError(
        `Associated evidence FileAsset "${consent.fileAssetId}" not found or is not a DOCUMENT`
      );
    }
  }

  return { valid: true, consent };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Request Credit Transfer Service
// ─────────────────────────────────────────────────────────────────────────────

export async function requestCreditTransferService(
  input: RequestCreditTransferInput,
  actor: ActorContext
) {
  const { tenantId, userId, userName, ip } = actor;

  if (!input.amount || input.amount <= 0 || !Number.isInteger(input.amount)) {
    throw new CreditTransferError("Transfer amount must be a positive integer in paise");
  }

  // Idempotency check if key provided
  if (input.idempotencyKey) {
    const existing = await db.creditTransferRequest.findFirst({
      where: {
        tenantId,
        requestNumber: input.idempotencyKey,
      },
    });

    if (existing) {
      if (
        existing.sourceStudentId === input.sourceStudentId &&
        existing.targetStudentId === input.targetStudentId &&
        existing.amount === input.amount
      ) {
        return { success: true, request: existing, replayed: true };
      }
      throw new IdempotencyPayloadMismatchError();
    }
  }

  return await db.$transaction(
    async (tx) => {
      // 1. Validate Sibling and Genuine Guardian Consent
      const { consent } = await validateSiblingAndConsent(
        tx,
        tenantId,
        input.sourceStudentId,
        input.targetStudentId,
        input.authorizedGuardianId,
        input.guardianConsentRef,
        input.guardianConsentId
      );

      // 2. Verify source credit availability from PaymentReceiptBalance and StudentCreditAccount
      const availableReceipts = await tx.paymentReceiptBalance.findMany({
        where: {
          tenantId,
          receipt: {
            studentId: input.sourceStudentId,
          },
          unappliedAmount: { gt: 0 },
        },
        select: { unappliedAmount: true },
      });

      const directAvailable = availableReceipts.reduce((sum, r) => sum + r.unappliedAmount, 0);

      // Check if source student has available transferred-in sibling credit
      const sourceCreditAcc = await tx.studentCreditAccount.findFirst({
        where: { tenantId, studentId: input.sourceStudentId },
      });
      const transferredAvailable = sourceCreditAcc
        ? Math.max(0, sourceCreditAcc.transferredIn - sourceCreditAcc.allocatedIn - sourceCreditAcc.transferredOnward)
        : 0;
      const totalAvailable = directAvailable + transferredAvailable;

      if (totalAvailable < input.amount) {
        throw new InsufficientAvailableCreditError(totalAvailable, input.amount);
      }

      // 3. Generate Request Number
      const stamp = Date.now();
      const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
      const requestNumber = input.idempotencyKey ?? `CREQ-${stamp}-${randomSuffix}`;

      // 4. Create CreditTransferRequest
      const request = await tx.creditTransferRequest.create({
        data: {
          tenantId,
          requestNumber,
          sourceStudentId: input.sourceStudentId,
          targetStudentId: input.targetStudentId,
          amount: input.amount,
          reason: input.reason,
          status: "PENDING_APPROVAL",
          authorizedGuardianId: consent.guardianId,
          guardianConsentRef: consent.id,
          guardianConsentId: consent.id,
          requestedById: userId,
          requestedAt: new Date(),
        },
      });

      // 5. Create initial CreditTransferApprovalEvent
      await tx.creditTransferApprovalEvent.create({
        data: {
          tenantId,
          requestId: request.id,
          action: "REQUESTED",
          actorId: userId,
          notes: `Transfer requested for ₹${(input.amount / 100).toFixed(2)}: ${input.reason}`,
        },
      });

      // 6. Write Audit Log
      await writeAudit(
        {
          tenantId,
          actorId: userId,
          actorName: userName,
          action: "credit_transfer.requested",
          entity: "CreditTransferRequest",
          entityId: request.id,
          meta: {
            requestNumber,
            sourceStudentId: input.sourceStudentId,
            targetStudentId: input.targetStudentId,
            amount: input.amount,
            authorizedGuardianId: input.authorizedGuardianId,
            guardianConsentRef: input.guardianConsentRef,
          },
          ip,
        },
        tx
      );

      return { success: true, request, replayed: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Maker-Checker Approval Service
// ─────────────────────────────────────────────────────────────────────────────

export async function approveCreditTransferService(
  input: ReviewCreditTransferInput,
  actor: ActorContext
) {
  const { tenantId, userId, userName, ip } = actor;

  return await db.$transaction(
    async (tx) => {
      // 1. Lock and read request row FOR UPDATE (Coordination Lock)
      const rows = await tx.$queryRaw<any[]>`
        SELECT id, "tenantId", "requestNumber", "sourceStudentId", "targetStudentId", amount, status, "requestedById", "reviewedById"
        FROM "CreditTransferRequest"
        WHERE id = ${input.requestId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;

      const request = rows[0];
      if (!request) {
        throw new CreditTransferError(`CreditTransferRequest ${input.requestId} not found`);
      }

      // 2. Maker-checker constraint
      if (request.requestedById === userId) {
        throw new MakerSelfApprovalForbiddenError();
      }

      // 3. Status validation: only PENDING_APPROVAL requests can be approved
      if (request.status !== "PENDING_APPROVAL") {
        throw new InvalidRequestStateTransitionError(request.status, "approve");
      }

      // 4. Update request status to APPROVED
      const updated = await tx.creditTransferRequest.update({
        where: { id: request.id },
        data: {
          status: "APPROVED",
          reviewedById: userId,
          reviewedAt: new Date(),
        },
      });

      // 5. Append Approval Event
      await tx.creditTransferApprovalEvent.create({
        data: {
          tenantId,
          requestId: request.id,
          action: "APPROVED",
          actorId: userId,
          notes: input.notes ?? "Transfer approved by reviewer",
        },
      });

      // 6. Audit Log
      await writeAudit(
        {
          tenantId,
          actorId: userId,
          actorName: userName,
          action: "credit_transfer.approved",
          entity: "CreditTransferRequest",
          entityId: request.id,
          meta: {
            requestNumber: request.requestNumber,
            amount: request.amount,
            notes: input.notes,
          },
          ip,
        },
        tx
      );

      return { success: true, request: updated };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Maker-Checker Rejection Service
// ─────────────────────────────────────────────────────────────────────────────

export async function rejectCreditTransferService(
  input: RejectCreditTransferInput,
  actor: ActorContext
) {
  const { tenantId, userId, userName, ip } = actor;

  if (!input.reason || input.reason.trim() === "") {
    throw new RejectionReasonRequiredError();
  }

  return await db.$transaction(
    async (tx) => {
      // 1. Lock request row FOR UPDATE (Coordination Lock)
      const rows = await tx.$queryRaw<any[]>`
        SELECT id, "tenantId", "requestNumber", "sourceStudentId", "targetStudentId", amount, status, "requestedById", "reviewedById"
        FROM "CreditTransferRequest"
        WHERE id = ${input.requestId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;

      const request = rows[0];
      if (!request) {
        throw new CreditTransferError(`CreditTransferRequest ${input.requestId} not found`);
      }

      // 2. Maker-checker constraint
      if (request.requestedById === userId) {
        throw new MakerSelfApprovalForbiddenError();
      }

      // 3. Status validation: only PENDING_APPROVAL requests can be rejected
      if (request.status !== "PENDING_APPROVAL") {
        throw new InvalidRequestStateTransitionError(request.status, "reject");
      }

      const updated = await tx.creditTransferRequest.update({
        where: { id: request.id },
        data: {
          status: "REJECTED",
          reviewedById: userId,
          reviewedAt: new Date(),
          rejectionReason: input.reason,
        },
      });

      await tx.creditTransferApprovalEvent.create({
        data: {
          tenantId,
          requestId: request.id,
          action: "REJECTED",
          actorId: userId,
          notes: input.reason,
        },
      });

      await writeAudit(
        {
          tenantId,
          actorId: userId,
          actorName: userName,
          action: "credit_transfer.rejected",
          entity: "CreditTransferRequest",
          entityId: request.id,
          meta: {
            requestNumber: request.requestNumber,
            reason: input.reason,
          },
          ip,
        },
        tx
      );

      return { success: true, request: updated };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3b. Request Cancellation Service
// ─────────────────────────────────────────────────────────────────────────────

export type CancelCreditTransferInput = {
  requestId: string;
  reason?: string | null;
};

export async function cancelCreditTransferService(
  input: CancelCreditTransferInput,
  actor: ActorContext
) {
  const { tenantId, userId, userName, ip } = actor;

  return await db.$transaction(
    async (tx) => {
      // 1. Lock request row FOR UPDATE (Coordination Lock)
      const rows = await tx.$queryRaw<any[]>`
        SELECT id, "tenantId", "requestNumber", "sourceStudentId", "targetStudentId", amount, status, "requestedById", "reviewedById"
        FROM "CreditTransferRequest"
        WHERE id = ${input.requestId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;

      const request = rows[0];
      if (!request) {
        throw new CreditTransferError(`CreditTransferRequest ${input.requestId} not found`);
      }

      // 2. Status validation: only PENDING_APPROVAL requests can be cancelled
      if (request.status !== "PENDING_APPROVAL") {
        throw new InvalidRequestStateTransitionError(request.status, "cancel");
      }

      const updated = await tx.creditTransferRequest.update({
        where: { id: request.id },
        data: {
          status: "CANCELLED",
        },
      });

      await tx.creditTransferApprovalEvent.create({
        data: {
          tenantId,
          requestId: request.id,
          action: "CANCELLED",
          actorId: userId,
          notes: input.reason ?? "Transfer request cancelled",
        },
      });

      await writeAudit(
        {
          tenantId,
          actorId: userId,
          actorName: userName,
          action: "credit_transfer.cancelled",
          entity: "CreditTransferRequest",
          entityId: request.id,
          meta: {
            requestNumber: request.requestNumber,
            reason: input.reason,
          },
          ip,
        },
        tx
      );

      return { success: true, request: updated };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Atomic Transfer Execution Service with Bounded Retry
// ─────────────────────────────────────────────────────────────────────────────

type LockedReceiptRow = {
  receiptId: string;
  unappliedAmount: number;
  transferredOutAmount: number;
  allocatedAmount: number;
  reservedRefundAmount: number;
  refundedAmount: number;
  grossAmount: number;
  receivedAt: Date;
};

type LockedAccountRow = {
  studentId: string;
  balance: number;
  transferredIn: number;
  transferredOut: number;
  transferredOnward?: number;
  allocatedIn?: number;
};

/**
 * Executes an approved credit transfer request atomically following the canonical lock hierarchy:
 *   Tier 3: PaymentReceiptBalance (ordered by receiptId ASC)
 *   Tier 4: LedgerEvents (CreditTransferJournal, CreditTransferSourceAllocation, CreditTransferPosting)
 *   Tier 5: Student / StudentCreditAccount (ordered by studentId ASC)
 *
 * Wrapped in a bounded exponential backoff retry for transient PostgreSQL concurrency errors (40P01, 40001).
 */
export async function executeCreditTransferService(
  input: ExecuteCreditTransferInput,
  actor: ActorContext
) {
  const maxRetries = 3;
  let attempt = 0;

  while (true) {
    try {
      return await executeCreditTransferTransaction(input, actor);
    } catch (error: any) {
      attempt++;
      const isTransient =
        error?.code === "40P01" || // Deadlock detected
        error?.code === "40001" || // Serialization failure
        error?.message?.includes("deadlock detected") ||
        error?.message?.includes("could not serialize access");

      if (isTransient && attempt < maxRetries) {
        const backoffMs = Math.floor(Math.random() * 50) + attempt * 50;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      throw error;
    }
  }
}

async function executeCreditTransferTransaction(
  input: ExecuteCreditTransferInput,
  actor: ActorContext
) {
  const { tenantId, userId, userName, ip } = actor;

  return await db.$transaction(
    async (tx) => {
      // 1. Lock CreditTransferRequest row FOR UPDATE
      const requestRows = await tx.$queryRaw<any[]>`
        SELECT id, "tenantId", "requestNumber", "sourceStudentId", "targetStudentId", amount, status, "journalId", "requestedById", "reviewedById", "authorizedGuardianId", "guardianConsentId", "guardianConsentRef"
        FROM "CreditTransferRequest"
        WHERE id = ${input.requestId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;

      const request = requestRows[0];
      if (!request) {
        throw new CreditTransferError(`CreditTransferRequest ${input.requestId} not found`);
      }

      // If already executed, return existing journal (Idempotent replay) or throw if preventReplay requested
      if (request.status === "EXECUTED") {
        if (input.preventReplay) {
          throw new InvalidRequestStateTransitionError("EXECUTED", "execute");
        }
        if (request.journalId) {
          const journal = await tx.creditTransferJournal.findUnique({
            where: { id: request.journalId },
          });
          return { success: true, request, journal, replayed: true };
        }
      }

      // State guards
      if (request.status === "PENDING_APPROVAL") {
        throw new UnapprovedTransferExecutionForbiddenError(request.status);
      }
      if (request.status === "REJECTED") {
        throw new RejectedTransferExecutionForbiddenError();
      }
      if (request.status === "CANCELLED") {
        throw new CancelledTransferExecutionForbiddenError();
      }
      if (request.status !== "APPROVED") {
        throw new CreditTransferError(`Request is in invalid state for execution: ${request.status}`);
      }

      // Revalidate genuine GuardianConsent at execution time under row lock
      const consentIdToValidate = request.guardianConsentId || request.guardianConsentRef;
      if (consentIdToValidate) {
        const consentRows = await tx.$queryRaw<any[]>`
          SELECT id, "tenantId", "guardianId", "sourceStudentId", "destinationStudentId", scope, status, "isRevoked", "expiresAt", "revocationReason"
          FROM "GuardianConsent"
          WHERE id = ${consentIdToValidate} AND "tenantId" = ${tenantId}
          FOR UPDATE
        `;
        const consent = consentRows[0];
        if (!consent) {
          throw new GuardianConsentNotFoundError(`Guardian consent record ${consentIdToValidate} not found`);
        }
        if (consent.isRevoked || consent.status === "REVOKED") {
          throw new RevokedGuardianConsentError(consent.revocationReason ?? "Guardian consent has been revoked");
        }
        if (consent.expiresAt && new Date(consent.expiresAt).getTime() <= Date.now()) {
          throw new ExpiredGuardianConsentError(`Guardian consent expired at ${new Date(consent.expiresAt).toISOString()}`);
        }
        if (consent.status === "PENDING") {
          throw new UnverifiedGuardianConsentError(`Guardian consent status is PENDING`);
        }
        if (consent.status === "REJECTED") {
          throw new RejectedGuardianConsentError(consent.rejectionReason ?? "Guardian consent was rejected");
        }
        if (consent.status !== "VERIFIED") {
          throw new UnverifiedGuardianConsentError(`Guardian consent status is ${consent.status}`);
        }
        if (consent.scope !== "SIBLING_CREDIT_TRANSFER") {
          throw new InvalidConsentScopeError(`Consent scope ${consent.scope} does not authorize sibling credit transfers`);
        }
        const matchesPair =
          (consent.sourceStudentId === request.sourceStudentId && consent.destinationStudentId === request.targetStudentId) ||
          (consent.sourceStudentId === request.targetStudentId && consent.destinationStudentId === request.sourceStudentId);
        if (!matchesPair) {
          throw new InvalidConsentStudentMismatchError(
            `Consent pair (${consent.sourceStudentId}, ${consent.destinationStudentId}) does not match transfer (${request.sourceStudentId} -> ${request.targetStudentId})`
          );
        }
        const effectiveGuardianId = request.authorizedGuardianId || consent.guardianId;
        const linkages = await tx.studentGuardian.findMany({
          where: {
            guardianId: effectiveGuardianId,
            studentId: { in: [request.sourceStudentId, request.targetStudentId] },
            student: { tenantId },
          },
          select: { studentId: true },
        });
        const linkedIds = new Set(linkages.map((l) => l.studentId));
        if (!linkedIds.has(request.sourceStudentId) || !linkedIds.has(request.targetStudentId)) {
          throw new InvalidSiblingGuardianRelationshipError(
            `Guardian ${effectiveGuardianId} is not linked to both students`
          );
        }
      }

      const transferAmount = Number(request.amount);

      // ───────────────────────────────────────────────────────────────────────
      // Tier 3: Lock PaymentReceiptBalance rows in deterministic receiptId ASC order
      // ───────────────────────────────────────────────────────────────────────
      const candidateReceipts = await tx.$queryRaw<LockedReceiptRow[]>`
        SELECT 
          b."receiptId",
          b."unappliedAmount",
          b."transferredOutAmount",
          b."allocatedAmount",
          b."reservedRefundAmount",
          b."refundedAmount",
          r.amount as "grossAmount",
          r."receivedAt"
        FROM "PaymentReceiptBalance" b
        JOIN "PaymentReceipt" r ON r.id = b."receiptId"
        WHERE b."tenantId" = ${tenantId}
          AND r."studentId" = ${request.sourceStudentId}
          AND b."unappliedAmount" > 0
        ORDER BY b."receiptId" ASC
        FOR UPDATE OF b
      `;

      // 2. FIFO Drawdown calculation: tie-breaker is deterministic (receivedAt ASC, receiptId ASC)
      const sortedForFifo = [...candidateReceipts].sort((a, b) => {
        const timeDiff = new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.receiptId.localeCompare(b.receiptId);
      });

      let remaining = transferAmount;
      type DrawdownLine = {
        receiptId: string;
        amount: number;
        isTransferredCredit: boolean;
        row?: LockedReceiptRow;
      };
      const drawdowns: DrawdownLine[] = [];

      for (const rcpt of sortedForFifo) {
        if (remaining <= 0) break;
        const available = rcpt.unappliedAmount;
        const toDraw = Math.min(available, remaining);
        if (toDraw > 0) {
          drawdowns.push({ receiptId: rcpt.receiptId, amount: toDraw, isTransferredCredit: false, row: rcpt });
          remaining -= toDraw;
        }
      }

      // If remaining > 0, check source student's available transferred-in sibling credit
      if (remaining > 0) {
        const creditPostings = await tx.$queryRaw<any[]>`
          SELECT 
            p.id as "postingId",
            p."receiptId",
            p."journalId",
            p.amount,
            p."createdAt"
          FROM "CreditTransferPosting" p
          WHERE p."tenantId" = ${tenantId}
            AND p."studentId" = ${request.sourceStudentId}
            AND p."entryType" = 'CREDIT'
          ORDER BY p."createdAt" ASC, p.id ASC
        `;

        for (const cp of creditPostings) {
          if (remaining <= 0) break;

          const allocatedRows = await tx.$queryRaw<any[]>`
            SELECT COALESCE(SUM(amount), 0) as "sum"
            FROM "PaymentAllocation"
            WHERE "tenantId" = ${tenantId}
              AND "studentId" = ${request.sourceStudentId}
              AND "receiptId" = ${cp.receiptId}
              AND "creditTransferId" = ${cp.journalId}
          `;
          const onwardRows = await tx.$queryRaw<any[]>`
            SELECT COALESCE(SUM(p.amount), 0) as "sum"
            FROM "CreditTransferPosting" p
            JOIN "PaymentReceipt" r ON r.id = p."receiptId"
            WHERE p."tenantId" = ${tenantId}
              AND p."studentId" = ${request.sourceStudentId}
              AND p."entryType" = 'DEBIT'
              AND p."receiptId" = ${cp.receiptId}
              AND r."studentId" <> ${request.sourceStudentId}
          `;

          const alreadyAllocated = Number(allocatedRows[0]?.sum ?? 0);
          const alreadyOnward = Number(onwardRows[0]?.sum ?? 0);
          const postingAmount = Number(cp.amount);
          const netAvailable = postingAmount - alreadyAllocated - alreadyOnward;

          if (netAvailable > 0) {
            // Lock original PaymentReceiptBalance row FOR UPDATE
            await tx.$queryRaw`
              SELECT "receiptId" FROM "PaymentReceiptBalance"
              WHERE "receiptId" = ${cp.receiptId} AND "tenantId" = ${tenantId}
              FOR UPDATE
            `;

            const toDraw = Math.min(netAvailable, remaining);
            drawdowns.push({
              receiptId: cp.receiptId,
              amount: toDraw,
              isTransferredCredit: true,
            });
            remaining -= toDraw;
          }
        }
      }

      if (remaining > 0) {
        const directAvail = candidateReceipts.reduce((sum, r) => sum + r.unappliedAmount, 0);
        const sourceCreditAcc = await tx.studentCreditAccount.findFirst({
          where: { tenantId, studentId: request.sourceStudentId },
        });
        const totalAvail = sourceCreditAcc?.balance ?? directAvail;
        throw new InsufficientAvailableCreditError(totalAvail, transferAmount);
      }

      // 3. Update PaymentReceiptBalance counters for direct receipts
      for (const draw of drawdowns) {
        if (!draw.isTransferredCredit && draw.row) {
          const newUnapplied = draw.row.unappliedAmount - draw.amount;
          const newTransferredOut = draw.row.transferredOutAmount + draw.amount;

          await tx.paymentReceiptBalance.update({
            where: { receiptId: draw.receiptId },
            data: {
              unappliedAmount: newUnapplied,
              transferredOutAmount: newTransferredOut,
              version: { increment: 1 },
              lastRebalancedAt: new Date(),
            },
          });
        }
      }

      // ───────────────────────────────────────────────────────────────────────
      // Tier 4: Insert Immutable Ledger Events (Journal, Allocations, Postings)
      // ───────────────────────────────────────────────────────────────────────
      const stamp = Date.now();
      const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
      const transferNumber = `TRNS-${stamp}-${randomSuffix}`;
      const isSingleReceipt = drawdowns.length === 1;

      // 4a. Create CreditTransferJournal
      const journal = await tx.creditTransferJournal.create({
        data: {
          tenantId,
          transferNumber,
          requestId: request.id,
          sourceStudentId: request.sourceStudentId,
          targetStudentId: request.targetStudentId,
          sourceReceiptId: isSingleReceipt ? drawdowns[0].receiptId : null,
          amount: transferAmount,
          reason: `Execution of request ${request.requestNumber}`,
          status: "COMPLETED",
          authorizedGuardianId: request.authorizedGuardianId,
          guardianConsentRef: request.guardianConsentRef,
          requestedById: request.requestedById,
          approvedById: request.reviewedById,
          executedAt: new Date(),
        },
      });

      // 4b. Insert CreditTransferSourceAllocation line items & paired postings
      for (const draw of drawdowns) {
        const allocLine = await tx.creditTransferSourceAllocation.create({
          data: {
            tenantId,
            journalId: journal.id,
            sourceReceiptId: draw.receiptId,
            sourceStudentId: request.sourceStudentId,
            targetStudentId: request.targetStudentId,
            amount: draw.amount,
          },
        });

        // DEBIT posting for source student
        await tx.creditTransferPosting.create({
          data: {
            tenantId,
            journalId: journal.id,
            sourceAllocationId: allocLine.id,
            entryType: "DEBIT",
            studentId: request.sourceStudentId,
            counterpartyStudentId: request.targetStudentId,
            receiptId: draw.receiptId,
            amount: draw.amount,
            createdById: userId,
          },
        });

        // CREDIT posting for target student
        await tx.creditTransferPosting.create({
          data: {
            tenantId,
            journalId: journal.id,
            sourceAllocationId: allocLine.id,
            entryType: "CREDIT",
            studentId: request.targetStudentId,
            counterpartyStudentId: request.sourceStudentId,
            receiptId: draw.receiptId,
            amount: draw.amount,
            createdById: userId,
          },
        });
      }

      // ───────────────────────────────────────────────────────────────────────
      // Tier 5: Lock & Update StudentCreditAccount projections (studentId ASC)
      // ───────────────────────────────────────────────────────────────────────
      // Ensure accounts exist (seed with sum of unapplied receipts if first time)
      const existingSource = await tx.studentCreditAccount.findUnique({
        where: { tenantId_studentId: { tenantId, studentId: request.sourceStudentId } },
      });
      if (!existingSource) {
        const unappliedTotal = candidateReceipts.reduce((sum, r) => sum + r.unappliedAmount, 0);
        await tx.studentCreditAccount.create({
          data: { tenantId, studentId: request.sourceStudentId, balance: unappliedTotal },
        });
      }

      const existingTarget = await tx.studentCreditAccount.findUnique({
        where: { tenantId_studentId: { tenantId, studentId: request.targetStudentId } },
      });
      if (!existingTarget) {
        const sumTarget = await tx.paymentReceiptBalance.aggregate({
          where: { tenantId, receipt: { studentId: request.targetStudentId } },
          _sum: { unappliedAmount: true },
        });
        await tx.studentCreditAccount.create({
          data: { tenantId, studentId: request.targetStudentId, balance: sumTarget._sum.unappliedAmount ?? 0 },
        });
      }

      const sortedStudents = [request.sourceStudentId, request.targetStudentId].sort();
      const lockedAccounts = await tx.$queryRaw<LockedAccountRow[]>`
        SELECT "studentId", balance, "transferredIn", "transferredOut", "transferredOnward", "allocatedIn"
        FROM "StudentCreditAccount"
        WHERE "tenantId" = ${tenantId}
          AND "studentId" IN (${sortedStudents[0]}, ${sortedStudents[1]})
        ORDER BY "studentId" ASC
        FOR UPDATE
      `;

      const sourceAcc = lockedAccounts.find((a) => a.studentId === request.sourceStudentId);
      const targetAcc = lockedAccounts.find((a) => a.studentId === request.targetStudentId);

      const sourceBal = Number(sourceAcc?.balance ?? 0);
      const targetBal = Number(targetAcc?.balance ?? 0);

      const directDrawnAmount = drawdowns
        .filter((d) => !d.isTransferredCredit)
        .reduce((sum, d) => sum + d.amount, 0);
      const onwardDrawnAmount = drawdowns
        .filter((d) => d.isTransferredCredit)
        .reduce((sum, d) => sum + d.amount, 0);

      // Decrement source student available balance
      await tx.studentCreditAccount.update({
        where: { tenantId_studentId: { tenantId, studentId: request.sourceStudentId } },
        data: {
          balance: sourceBal - transferAmount,
          transferredOut: { increment: directDrawnAmount },
          transferredOnward: { increment: onwardDrawnAmount },
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });

      // Increment target student available balance
      await tx.studentCreditAccount.update({
        where: { tenantId_studentId: { tenantId, studentId: request.targetStudentId } },
        data: {
          balance: targetBal + transferAmount,
          transferredIn: { increment: transferAmount },
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });

      // ───────────────────────────────────────────────────────────────────────
      // Transition CreditTransferRequest to EXECUTED & record event
      // ───────────────────────────────────────────────────────────────────────
      const updatedRequest = await tx.creditTransferRequest.update({
        where: { id: request.id },
        data: {
          status: "EXECUTED",
          journalId: journal.id,
        },
      });

      await tx.creditTransferApprovalEvent.create({
        data: {
          tenantId,
          requestId: request.id,
          action: "EXECUTED",
          actorId: userId,
          notes: `Executed via journal ${journal.transferNumber}`,
        },
      });

      // Audit Log
      await writeAudit(
        {
          tenantId,
          actorId: userId,
          actorName: userName,
          action: "credit_transfer.executed",
          entity: "CreditTransferJournal",
          entityId: journal.id,
          meta: {
            requestId: request.id,
            requestNumber: request.requestNumber,
            transferNumber: journal.transferNumber,
            amount: transferAmount,
            drawnReceiptsCount: drawdowns.length,
          },
          ip,
        },
        tx
      );

      return { success: true, request: updatedRequest, journal, replayed: false };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    }
  );
}

export interface AllocateStudentCreditToInvoiceInput {
  studentId: string;
  feeInvoiceId: string;
  amount: number; // in paise (> 0)
  idempotencyKey?: string | null;
  sourcePreference?: "AUTO_FIFO" | "DIRECT_FIRST" | "TRANSFERRED_FIRST";
  notes?: string | null;
}

export interface AllocateStudentCreditToInvoiceResult {
  success: boolean;
  replayed?: boolean;
  feeInvoiceId: string;
  allocatedAmount: number;
  newInvoiceStatus: string;
  newInvoicePaidAmount: number;
  allocations: {
    allocationId: string;
    receiptId: string;
    amount: number;
    creditTransferId: string | null;
  }[];
  studentCreditAccount: any;
}

export interface AllocateTransferredCreditInput {
  studentId: string;
  feeInvoiceId: string;
  amount: number; // in paise (> 0)
}

/**
 * Universal Student Credit Allocation Service (Document 32 Revision 1.7)
 *
 * Atomically allocates available student credit (direct receipt credit and/or transferred-in sibling credit)
 * towards an outstanding FeeInvoice, strictly preserving original receipt provenance.
 *
 * Concurrency & Lock Hierarchy (Document 32 Section 10):
 *   Tier 1: FeeInvoice FOR UPDATE
 *   Tier 3: PaymentReceiptBalance FOR UPDATE (ordered by receiptId ASC)
 *   Tier 5: StudentCreditAccount FOR UPDATE (ordered by studentId ASC)
 *   Layer 1: Immutable PaymentAllocation inserts
 *
 * Wrapped in a bounded exponential backoff retry for transient PostgreSQL concurrency errors (40P01, 40001).
 * Transaction runs under explicit READ COMMITTED isolation.
 */
export async function allocateStudentCreditToInvoiceService(
  input: AllocateStudentCreditToInvoiceInput,
  actor: ActorContext
): Promise<AllocateStudentCreditToInvoiceResult> {
  const maxRetries = 3;
  let attempt = 0;

  while (true) {
    try {
      return await allocateStudentCreditToInvoiceTransaction(input, actor);
    } catch (error: any) {
      attempt++;
      const isTransient =
        error?.code === "40P01" || // Deadlock detected
        error?.code === "40001" || // Serialization failure
        error?.message?.includes("deadlock detected") ||
        error?.message?.includes("could not serialize access");

      if (isTransient && attempt < maxRetries) {
        const backoffMs = Math.floor(Math.random() * 50) + attempt * 50;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      throw error;
    }
  }
}

async function allocateStudentCreditToInvoiceTransaction(
  input: AllocateStudentCreditToInvoiceInput,
  actor: ActorContext
): Promise<AllocateStudentCreditToInvoiceResult> {
  const { tenantId, userId, userName } = actor;

  if (input.amount <= 0) {
    throw new CreditTransferValidationError("Allocation amount must be greater than 0");
  }

  // Idempotency check if idempotencyKey provided
  if (input.idempotencyKey) {
    const existingAuditRows = await db.$queryRaw<any[]>`
      SELECT id, meta
      FROM "AuditLog"
      WHERE "tenantId" = ${tenantId}
        AND "action" = 'fee_invoice.credit_allocation'
        AND meta->>'idempotencyKey' = ${input.idempotencyKey}
      LIMIT 1
    `;
    if (existingAuditRows.length > 0) {
      const meta = existingAuditRows[0].meta;
      if (
        meta &&
        meta.studentId === input.studentId &&
        meta.feeInvoiceId === input.feeInvoiceId &&
        Number(meta.amount) === Number(input.amount)
      ) {
        return {
          success: true,
          replayed: true,
          feeInvoiceId: meta.feeInvoiceId,
          allocatedAmount: meta.amount,
          newInvoiceStatus: meta.newInvoiceStatus,
          newInvoicePaidAmount: meta.newInvoicePaidAmount,
          allocations: meta.allocations ?? [],
          studentCreditAccount: meta.studentCreditAccount,
        };
      }
      throw new IdempotencyPayloadMismatchError(
        "Idempotency key already used with different allocation parameters"
      );
    }
  }

  return await db.$transaction(
    async (tx) => {
      // ───────────────────────────────────────────────────────────────────────
      // Step 1: Tier 1 - Lock FeeInvoice FOR UPDATE
      // ───────────────────────────────────────────────────────────────────────
      const invoiceRows = await tx.$queryRaw<any[]>`
        SELECT id, "tenantId", "studentId", amount, "paidAmount", status
        FROM "FeeInvoice"
        WHERE id = ${input.feeInvoiceId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      const invoice = invoiceRows[0];
      if (!invoice) {
        throw new CreditTransferError(`FeeInvoice ${input.feeInvoiceId} not found in tenant`);
      }

      if (invoice.studentId !== input.studentId) {
        throw new CreditTransferError(
          `Invoice student ${invoice.studentId} does not match allocation student ${input.studentId}`
        );
      }

      if (
        invoice.status === "PAID" ||
        invoice.status === "WAIVED" ||
        invoice.status === "CANCELLED" ||
        invoice.status === "VOID"
      ) {
        throw new CreditTransferValidationError(`Cannot allocate credit to invoice in status ${invoice.status}`);
      }

      const remainingDue = Number(invoice.amount) - Number(invoice.paidAmount);
      if (input.amount > remainingDue) {
        throw new CreditTransferValidationError(
          `Allocation amount (${input.amount} paise) exceeds invoice remaining balance (${remainingDue} paise)`
        );
      }

      // ───────────────────────────────────────────────────────────────────────
      // Step 2: Candidate sources discovery
      // ───────────────────────────────────────────────────────────────────────
      // Direct candidate receipts owned by this student with unappliedAmount > 0
      const directCandidates = await tx.$queryRaw<any[]>`
        SELECT 
          b."receiptId",
          b."unappliedAmount",
          b."transferredOutAmount",
          b."allocatedAmount",
          b."reservedRefundAmount",
          b."refundedAmount",
          r.amount as "grossAmount",
          r."receivedAt"
        FROM "PaymentReceiptBalance" b
        JOIN "PaymentReceipt" r ON r.id = b."receiptId"
        WHERE b."tenantId" = ${tenantId}
          AND r."studentId" = ${input.studentId}
          AND b."unappliedAmount" > 0
      `;

      // Transferred-in CREDIT postings for this student
      const creditPostings = await tx.$queryRaw<any[]>`
        SELECT 
          p.id as "postingId",
          p."receiptId",
          p."journalId",
          p.amount,
          p."createdAt",
          r."receivedAt"
        FROM "CreditTransferPosting" p
        JOIN "PaymentReceipt" r ON r.id = p."receiptId"
        WHERE p."tenantId" = ${tenantId}
          AND p."studentId" = ${input.studentId}
          AND p."entryType" = 'CREDIT'
        ORDER BY p."createdAt" ASC, p.id ASC
      `;

      // Collect all candidate receiptIds to lock in canonical order (Tier 3: receiptId ASC)
      const allCandidateReceiptIds = new Set<string>();
      directCandidates.forEach((d) => allCandidateReceiptIds.add(d.receiptId));
      creditPostings.forEach((c) => allCandidateReceiptIds.add(c.receiptId));

      const sortedReceiptIds = Array.from(allCandidateReceiptIds).sort();

      // ───────────────────────────────────────────────────────────────────────
      // Step 3: Tier 3 - Lock PaymentReceiptBalance rows in deterministic receiptId ASC order
      // ───────────────────────────────────────────────────────────────────────
      const lockedBalancesMap = new Map<string, any>();
      if (sortedReceiptIds.length > 0) {
        const lockedRows = await tx.$queryRaw<any[]>`
          SELECT "receiptId", "unappliedAmount", "transferredOutAmount", "allocatedAmount", "reservedRefundAmount", "refundedAmount"
          FROM "PaymentReceiptBalance"
          WHERE "tenantId" = ${tenantId}
            AND "receiptId" IN (${Prisma.join(sortedReceiptIds)})
          ORDER BY "receiptId" ASC
          FOR UPDATE
        `;
        lockedRows.forEach((row) => lockedBalancesMap.set(row.receiptId, row));
      }

      // ───────────────────────────────────────────────────────────────────────
      // Step 4: Tier 5 - Lock StudentCreditAccount FOR UPDATE
      // ───────────────────────────────────────────────────────────────────────
      const accountRows = await tx.$queryRaw<any[]>`
        SELECT "studentId", balance, "transferredIn", "transferredOut", "transferredOnward", "allocatedIn"
        FROM "StudentCreditAccount"
        WHERE "tenantId" = ${tenantId} AND "studentId" = ${input.studentId}
        FOR UPDATE
      `;
      const account = accountRows[0];
      if (!account) {
        throw new CreditTransferError(`StudentCreditAccount not found for student ${input.studentId}`);
      }

      const currentBalance = Number(account.balance);
      if (input.amount > currentBalance) {
        throw new InsufficientAvailableCreditError(currentBalance, input.amount);
      }

      // ───────────────────────────────────────────────────────────────────────
      // Step 5: Recalculate current availability per line under held locks
      // ───────────────────────────────────────────────────────────────────────
      type CandidateCreditLine = {
        receiptId: string;
        journalId: string | null;
        type: "DIRECT" | "TRANSFERRED";
        receivedAt: Date;
        availablePaise: number;
      };

      const candidateLines: CandidateCreditLine[] = [];

      // 1. Direct receipts: unappliedAmount under held row lock
      for (const d of directCandidates) {
        const locked = lockedBalancesMap.get(d.receiptId);
        const unapplied = locked ? Number(locked.unappliedAmount) : 0;
        if (unapplied > 0) {
          candidateLines.push({
            receiptId: d.receiptId,
            journalId: null,
            type: "DIRECT",
            receivedAt: new Date(d.receivedAt),
            availablePaise: unapplied,
          });
        }
      }

      // 2. Transferred credit postings: net of active allocations (minus reversals) and onward transfers
      for (const cp of creditPostings) {
        const allocatedRows = await tx.$queryRaw<any[]>`
          SELECT COALESCE(SUM(a.amount - COALESCE(r.rev_sum, 0)), 0) as "sum"
          FROM "PaymentAllocation" a
          LEFT JOIN (
            SELECT "originalAllocationId", SUM(amount) as rev_sum
            FROM "PaymentAllocationReversal"
            WHERE "tenantId" = ${tenantId}
            GROUP BY "originalAllocationId"
          ) r ON r."originalAllocationId" = a.id
          WHERE a."tenantId" = ${tenantId}
            AND a."studentId" = ${input.studentId}
            AND a."receiptId" = ${cp.receiptId}
            AND a."creditTransferId" = ${cp.journalId}
        `;
        const onwardRows = await tx.$queryRaw<any[]>`
          SELECT COALESCE(SUM(p.amount), 0) as "sum"
          FROM "CreditTransferPosting" p
          JOIN "PaymentReceipt" r ON r.id = p."receiptId"
          WHERE p."tenantId" = ${tenantId}
            AND p."studentId" = ${input.studentId}
            AND p."entryType" = 'DEBIT'
            AND p."receiptId" = ${cp.receiptId}
            AND r."studentId" <> ${input.studentId}
        `;

        const alreadyAllocated = Number(allocatedRows[0]?.sum ?? 0);
        const alreadyOnward = Number(onwardRows[0]?.sum ?? 0);
        const postingAmount = Number(cp.amount);
        const netAvailable = postingAmount - alreadyAllocated - alreadyOnward;

        if (netAvailable > 0) {
          candidateLines.push({
            receiptId: cp.receiptId,
            journalId: cp.journalId,
            type: "TRANSFERRED",
            receivedAt: new Date(cp.receivedAt || cp.createdAt),
            availablePaise: netAvailable,
          });
        }
      }

      // ───────────────────────────────────────────────────────────────────────
      // Step 6: FIFO sorting & preference ordering
      // ───────────────────────────────────────────────────────────────────────
      const preference = input.sourcePreference ?? "AUTO_FIFO";
      candidateLines.sort((a, b) => {
        if (preference === "DIRECT_FIRST") {
          if (a.type !== b.type) return a.type === "DIRECT" ? -1 : 1;
        } else if (preference === "TRANSFERRED_FIRST") {
          if (a.type !== b.type) return a.type === "TRANSFERRED" ? -1 : 1;
        }
        // Strict deterministic FIFO: receivedAt ASC, receiptId ASC
        const timeDiff = a.receivedAt.getTime() - b.receivedAt.getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.receiptId.localeCompare(b.receiptId);
      });

      // ───────────────────────────────────────────────────────────────────────
      // Step 7: FIFO Drawdown calculation
      // ───────────────────────────────────────────────────────────────────────
      let remainingToAllocate = input.amount;
      const plannedAllocations: {
        receiptId: string;
        journalId: string | null;
        type: "DIRECT" | "TRANSFERRED";
        amount: number;
      }[] = [];

      for (const line of candidateLines) {
        if (remainingToAllocate <= 0) break;
        const toDraw = Math.min(line.availablePaise, remainingToAllocate);
        if (toDraw > 0) {
          plannedAllocations.push({
            receiptId: line.receiptId,
            journalId: line.journalId,
            type: line.type,
            amount: toDraw,
          });
          remainingToAllocate -= toDraw;
        }
      }

      if (remainingToAllocate > 0) {
        throw new InsufficientAvailableCreditError(
          input.amount - remainingToAllocate,
          input.amount
        );
      }

      // ───────────────────────────────────────────────────────────────────────
      // Step 8: Apply allocations & mutate projections
      // ───────────────────────────────────────────────────────────────────────
      let totalTransferredDrawn = 0;
      let totalDirectDrawn = 0;
      const createdAllocations: {
        allocationId: string;
        receiptId: string;
        amount: number;
        creditTransferId: string | null;
      }[] = [];

      for (const alloc of plannedAllocations) {
        const rb = lockedBalancesMap.get(alloc.receiptId);
        if (!rb) {
          throw new DatabaseIntegrityError(`PaymentReceiptBalance ${alloc.receiptId} not found`);
        }

        if (alloc.type === "DIRECT") {
          totalDirectDrawn += alloc.amount;
          const newUnapplied = Number(rb.unappliedAmount) - alloc.amount;
          const newAllocated = Number(rb.allocatedAmount) + alloc.amount;
          rb.unappliedAmount = newUnapplied;
          rb.allocatedAmount = newAllocated;

          await tx.paymentReceiptBalance.update({
            where: { receiptId: alloc.receiptId },
            data: {
              unappliedAmount: newUnapplied,
              allocatedAmount: newAllocated,
              version: { increment: 1 },
              lastRebalancedAt: new Date(),
            },
          });

          const pa = await tx.paymentAllocation.create({
            data: {
              tenantId,
              receiptId: alloc.receiptId,
              feeInvoiceId: invoice.id,
              studentId: input.studentId,
              amount: alloc.amount,
              creditTransferId: null, // null for direct same-student credit
              allocatedById: userId,
            },
          });

          createdAllocations.push({
            allocationId: pa.id,
            receiptId: alloc.receiptId,
            amount: alloc.amount,
            creditTransferId: null,
          });
        } else {
          totalTransferredDrawn += alloc.amount;
          const newTransferredOut = Number(rb.transferredOutAmount) - alloc.amount;
          const newAllocated = Number(rb.allocatedAmount) + alloc.amount;
          rb.transferredOutAmount = newTransferredOut;
          rb.allocatedAmount = newAllocated;

          await tx.paymentReceiptBalance.update({
            where: { receiptId: alloc.receiptId },
            data: {
              transferredOutAmount: newTransferredOut,
              allocatedAmount: newAllocated,
              version: { increment: 1 },
              lastRebalancedAt: new Date(),
            },
          });

          const pa = await tx.paymentAllocation.create({
            data: {
              tenantId,
              receiptId: alloc.receiptId,
              feeInvoiceId: invoice.id,
              studentId: input.studentId,
              amount: alloc.amount,
              creditTransferId: alloc.journalId, // references CreditTransferJournal
              allocatedById: userId,
            },
          });

          createdAllocations.push({
            allocationId: pa.id,
            receiptId: alloc.receiptId,
            amount: alloc.amount,
            creditTransferId: alloc.journalId,
          });
        }
      }

      // ───────────────────────────────────────────────────────────────────────
      // Step 9: Update FeeInvoice
      // ───────────────────────────────────────────────────────────────────────
      const newPaidAmount = Number(invoice.paidAmount) + input.amount;
      const newStatus = newPaidAmount >= Number(invoice.amount) ? "PAID" : "PARTIAL";
      await tx.feeInvoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaidAmount,
          status: newStatus,
          paidAt: newStatus === "PAID" ? new Date() : undefined,
        },
      });

      // ───────────────────────────────────────────────────────────────────────
      // Step 10: Update StudentCreditAccount
      // ───────────────────────────────────────────────────────────────────────
      const updatedAccount = await tx.studentCreditAccount.update({
        where: { tenantId_studentId: { tenantId, studentId: input.studentId } },
        data: {
          balance: { decrement: input.amount },
          allocatedIn: { increment: totalTransferredDrawn },
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });

      // Invalidate stale open payment links if invoice is now fully settled
      if (newStatus === "PAID") {
        await tx.feePaymentLink.updateMany({
          where: { feeInvoiceId: invoice.id, status: "OPEN" },
          data: { status: "CANCELED" },
        });
      }

      // ───────────────────────────────────────────────────────────────────────
      // Step 11: Write Audit Log
      // ───────────────────────────────────────────────────────────────────────
      await writeAudit(
        {
          tenantId,
          actorId: userId,
          actorName: userName,
          action: "fee_invoice.credit_allocation",
          entity: "FeeInvoice",
          entityId: invoice.id,
          meta: {
            idempotencyKey: input.idempotencyKey ?? null,
            studentId: input.studentId,
            feeInvoiceId: invoice.id,
            amount: input.amount,
            totalDirectDrawn,
            totalTransferredDrawn,
            newInvoiceStatus: newStatus,
            newInvoicePaidAmount: newPaidAmount,
            allocations: createdAllocations,
            studentCreditAccount: updatedAccount,
            notes: input.notes ?? null,
          },
        },
        tx
      );

      return {
        success: true,
        feeInvoiceId: invoice.id,
        allocatedAmount: input.amount,
        newInvoiceStatus: newStatus,
        newInvoicePaidAmount: newPaidAmount,
        allocations: createdAllocations,
        studentCreditAccount: updatedAccount,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 15000,
      maxWait: 5000,
    }
  );
}

/**
 * Convenience wrapper for transferred sibling credit allocation (Stage 2.2.3 compatibility)
 */
export async function allocateTransferredCreditService(
  input: AllocateTransferredCreditInput,
  actor: ActorContext
) {
  return await allocateStudentCreditToInvoiceService(
    {
      studentId: input.studentId,
      feeInvoiceId: input.feeInvoiceId,
      amount: input.amount,
      sourcePreference: "TRANSFERRED_FIRST",
    },
    actor
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4B. Payment Allocation Reversal Service (Document 32 Revision 1.7)
// ─────────────────────────────────────────────────────────────────────────────

export interface ReverseStudentCreditAllocationInput {
  allocationId: string;
  amount: number; // in paise (> 0)
  reason: string;
}

export interface ReverseStudentCreditAllocationResult {
  success: boolean;
  reversalId: string;
  allocationId: string;
  reversedAmount: number;
  newInvoiceStatus: string;
  newInvoicePaidAmount: number;
  paymentReceiptBalance: any;
  studentCreditAccount: any;
}

/**
 * Reverses a previously applied PaymentAllocation:
 * - Creates an append-only PaymentAllocationReversal record (Layer 1 immutable event).
 * - Enforces READ COMMITTED isolation level and cumulative reversal limit (SUM(reversals) <= allocation.amount).
 * - Restores exact original provenance:
 *   - Direct: decrements allocatedAmount and increments unappliedAmount on original receipt balance.
 *   - Transferred: decrements allocatedAmount and increments transferredOutAmount on original receipt balance.
 * - Restores StudentCreditAccount: increments balance (and decrements allocatedIn if transferred).
 * - Decrements FeeInvoice.paidAmount and restores status (PARTIAL or PENDING).
 */
export async function reverseStudentCreditAllocationService(
  input: ReverseStudentCreditAllocationInput,
  actor: ActorContext
): Promise<ReverseStudentCreditAllocationResult> {
  const maxRetries = 3;
  let attempt = 0;

  while (true) {
    try {
      return await reverseStudentCreditAllocationTransaction(input, actor);
    } catch (error: any) {
      attempt++;
      const isTransient =
        error?.code === "40P01" || // Deadlock detected
        error?.code === "40001" || // Serialization failure
        error?.message?.includes("deadlock detected") ||
        error?.message?.includes("could not serialize access");

      if (isTransient && attempt < maxRetries) {
        const backoffMs = Math.floor(Math.random() * 50) + attempt * 50;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      throw error;
    }
  }
}

async function reverseStudentCreditAllocationTransaction(
  input: ReverseStudentCreditAllocationInput,
  actor: ActorContext
): Promise<ReverseStudentCreditAllocationResult> {
  const { tenantId, userId, userName } = actor;

  if (input.amount <= 0) {
    throw new CreditTransferValidationError("Reversal amount must be positive");
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw new CreditTransferValidationError("Reversal reason is required");
  }

  return await db.$transaction(
    async (tx) => {
      // 1. Fetch PaymentAllocation (Layer 1 event)
      const allocRows = await tx.$queryRaw<any[]>`
        SELECT id, "tenantId", "receiptId", "creditTransferId", "studentId", "feeInvoiceId", amount
        FROM "PaymentAllocation"
        WHERE id = ${input.allocationId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      const allocation = allocRows[0];
      if (!allocation) {
        throw new CreditTransferError(`PaymentAllocation ${input.allocationId} not found in tenant`);
      }

      // Check existing cumulative reversals on this allocation
      const revRows = await tx.$queryRaw<any[]>`
        SELECT COALESCE(SUM(amount), 0) as "sum"
        FROM "PaymentAllocationReversal"
        WHERE "tenantId" = ${tenantId} AND "originalAllocationId" = ${allocation.id}
      `;
      const currentReversals = Number(revRows[0]?.sum ?? 0);
      const remainingUnreversed = Number(allocation.amount) - currentReversals;

      if (input.amount > remainingUnreversed) {
        throw new CreditTransferValidationError(
          `Reversal amount (${input.amount} paise) exceeds unreversed allocation balance (${remainingUnreversed} paise)`
        );
      }

      // 2. Canonical lock hierarchy:
      // Tier 1: FeeInvoice FOR UPDATE
      const invoiceRows = await tx.$queryRaw<any[]>`
        SELECT id, "tenantId", "studentId", amount, "paidAmount", status
        FROM "FeeInvoice"
        WHERE id = ${allocation.feeInvoiceId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      const invoice = invoiceRows[0];
      if (!invoice) {
        throw new DatabaseIntegrityError(`FeeInvoice ${allocation.feeInvoiceId} not found`);
      }

      // Tier 3: PaymentReceiptBalance FOR UPDATE
      const balanceRows = await tx.$queryRaw<any[]>`
        SELECT "receiptId", "unappliedAmount", "transferredOutAmount", "allocatedAmount", "reservedRefundAmount", "refundedAmount"
        FROM "PaymentReceiptBalance"
        WHERE "receiptId" = ${allocation.receiptId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      const balance = balanceRows[0];
      if (!balance) {
        throw new DatabaseIntegrityError(`PaymentReceiptBalance ${allocation.receiptId} not found`);
      }

      // Tier 5: StudentCreditAccount FOR UPDATE
      const accountRows = await tx.$queryRaw<any[]>`
        SELECT "studentId", balance, "transferredIn", "transferredOut", "transferredOnward", "allocatedIn"
        FROM "StudentCreditAccount"
        WHERE "studentId" = ${allocation.studentId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      const account = accountRows[0];
      if (!account) {
        throw new DatabaseIntegrityError(`StudentCreditAccount for student ${allocation.studentId} not found`);
      }

      // 3. Create Layer 1 immutable reversal record (Trigger enforces READ COMMITTED & cumulative limit)
      const reversal = await tx.paymentAllocationReversal.create({
        data: {
          tenantId,
          originalAllocationId: allocation.id,
          amount: input.amount,
          reason: input.reason.trim(),
          destination: "UNAPPLIED_CREDIT",
          reversedById: userId,
        },
      });

      // 4. Update PaymentReceiptBalance and StudentCreditAccount based on provenance
      let updatedBalance: any;
      let updatedAccount: any;

      if (allocation.creditTransferId === null) {
        // Direct receipt allocation reversal:
        // Decrement allocatedAmount, increment unappliedAmount on original receipt
        const newAllocated = Number(balance.allocatedAmount) - input.amount;
        const newUnapplied = Number(balance.unappliedAmount) + input.amount;

        updatedBalance = await tx.paymentReceiptBalance.update({
          where: { receiptId: allocation.receiptId },
          data: {
            allocatedAmount: newAllocated,
            unappliedAmount: newUnapplied,
            version: { increment: 1 },
            lastRebalancedAt: new Date(),
          },
        });

        // Increment StudentCreditAccount.balance
        updatedAccount = await tx.studentCreditAccount.update({
          where: { tenantId_studentId: { tenantId, studentId: allocation.studentId } },
          data: {
            balance: { increment: input.amount },
            version: { increment: 1 },
            lastActivityAt: new Date(),
          },
        });
      } else {
        // Transferred-in sibling credit allocation reversal:
        // Decrement allocatedAmount, increment transferredOutAmount on original receipt
        const newAllocated = Number(balance.allocatedAmount) - input.amount;
        const newTransferredOut = Number(balance.transferredOutAmount) + input.amount;

        updatedBalance = await tx.paymentReceiptBalance.update({
          where: { receiptId: allocation.receiptId },
          data: {
            allocatedAmount: newAllocated,
            transferredOutAmount: newTransferredOut,
            version: { increment: 1 },
            lastRebalancedAt: new Date(),
          },
        });

        // Decrement allocatedIn, increment balance on StudentCreditAccount
        updatedAccount = await tx.studentCreditAccount.update({
          where: { tenantId_studentId: { tenantId, studentId: allocation.studentId } },
          data: {
            allocatedIn: { decrement: input.amount },
            balance: { increment: input.amount },
            version: { increment: 1 },
            lastActivityAt: new Date(),
          },
        });
      }

      // 5. Update FeeInvoice: decrement paidAmount and restore status
      const newPaidAmount = Math.max(0, Number(invoice.paidAmount) - input.amount);
      const newStatus = newPaidAmount === 0 ? "PENDING" : "PARTIAL";

      await tx.feeInvoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaidAmount,
          status: newStatus,
          paidAt: null,
        },
      });

      // 6. Write Audit Log
      await writeAudit(
        {
          tenantId,
          actorId: userId,
          actorName: userName,
          action: "fee_invoice.credit_allocation_reversal",
          entity: "FeeInvoice",
          entityId: invoice.id,
          meta: {
            allocationId: allocation.id,
            reversalId: reversal.id,
            amount: input.amount,
            reason: input.reason.trim(),
            receiptId: allocation.receiptId,
            creditTransferId: allocation.creditTransferId,
            studentId: allocation.studentId,
            newInvoiceStatus: newStatus,
            newInvoicePaidAmount: newPaidAmount,
          },
        },
        tx
      );

      return {
        success: true,
        reversalId: reversal.id,
        allocationId: allocation.id,
        reversedAmount: input.amount,
        newInvoiceStatus: newStatus,
        newInvoicePaidAmount: newPaidAmount,
        paymentReceiptBalance: updatedBalance,
        studentCreditAccount: updatedAccount,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 15000,
      maxWait: 5000,
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Student Credit Account Reconciliation Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconciles a student's credit account against underlying receipt, transfer and allocation provenance:
 *
 * Provenance-aware Spendable Balance Equation:
 *   balance = directUnapplied + (transferredIn - allocatedIn)
 * where:
 *   - directUnapplied = SUM(PaymentReceiptBalance.unappliedAmount) for this student's receipts.
 *     (Direct invoice allocations and transfers-out have already been deducted from receipt unapplied amounts).
 *   - transferredIn = cumulative incoming credit transferred from siblings via CreditTransferPosting(CREDIT).
 *   - allocatedIn = cumulative transferred credit subsequently allocated towards this student's invoices.
 *   - transferredOut = cumulative outgoing credit transferred to siblings via CreditTransferPosting(DEBIT).
 *
 * Direct receipt allocations are tracked in PaymentReceiptBalance.allocatedAmount and MUST NOT be
 * subtracted again in allocatedIn, completely preventing double-counting.
 */
export async function reconcileStudentCreditAccount(
  tenantId: string,
  studentId: string,
  client: Prisma.TransactionClient | typeof db = db
): Promise<StudentCreditReconciliationResult> {
  const discrepancies: string[] = [];

  // 1. Fetch StudentCreditAccount projection
  const account = await client.studentCreditAccount.findFirst({
    where: { tenantId, studentId },
  });

  const currentBalance = account?.balance ?? 0;
  const currentTransferredIn = account?.transferredIn ?? 0;
  const currentTransferredOut = account?.transferredOut ?? 0;
  const currentTransferredOnward = account?.transferredOnward ?? 0;
  const currentAllocatedIn = account?.allocatedIn ?? 0;

  // 2. Aggregate PaymentReceiptBalance rows for receipts owned by this student
  const receiptBalances = await client.paymentReceiptBalance.findMany({
    where: {
      tenantId,
      receipt: { studentId },
    },
    include: {
      receipt: { select: { amount: true } },
    },
  });

  let totalReceiptAmount = 0;
  let directAllocated = 0;
  let directTransferredOut = 0;
  let directUnapplied = 0;
  let directReserved = 0;
  let directRefunded = 0;
  let isConserved = true;

  for (const rb of receiptBalances) {
    const gross = rb.receipt.amount;
    totalReceiptAmount += gross;
    directAllocated += rb.allocatedAmount;
    directTransferredOut += rb.transferredOutAmount;
    directUnapplied += rb.unappliedAmount;
    directReserved += rb.reservedRefundAmount;
    directRefunded += rb.refundedAmount;

    const componentsSum =
      rb.allocatedAmount +
      rb.transferredOutAmount +
      rb.unappliedAmount +
      rb.reservedRefundAmount +
      rb.refundedAmount;
    if (componentsSum !== gross) {
      isConserved = false;
      discrepancies.push(
        `Receipt ${rb.receiptId} conservation failed: gross=${gross}, sum=${componentsSum}`
      );
    }
  }

  // 3. Aggregate CreditTransferPostings
  const creditPostings = await client.creditTransferPosting.aggregate({
    where: {
      tenantId,
      studentId,
      entryType: "CREDIT",
    },
    _sum: { amount: true },
  });
  const totalTransferredInPostings = creditPostings._sum?.amount ?? 0;

  // Direct transfers out: DEBIT postings where receipt is owned by this student
  const directDebitPostings = await client.creditTransferPosting.aggregate({
    where: {
      tenantId,
      studentId,
      entryType: "DEBIT",
      receipt: { studentId },
    },
    _sum: { amount: true },
  });
  const directTransferredOutPostings = directDebitPostings._sum?.amount ?? 0;

  // Onward transfers: DEBIT postings where receipt is NOT owned by this student
  const onwardDebitPostings = await client.creditTransferPosting.aggregate({
    where: {
      tenantId,
      studentId,
      entryType: "DEBIT",
      receipt: { studentId: { not: studentId } },
    },
    _sum: { amount: true },
  });
  const onwardTransferredPostings = onwardDebitPostings._sum?.amount ?? 0;

  // 4. Validate counter integrity against journal postings
  if (currentTransferredIn !== totalTransferredInPostings) {
    discrepancies.push(
      `transferredIn counter mismatch: account has ${currentTransferredIn}, journal postings sum to ${totalTransferredInPostings}`
    );
  }

  if (currentTransferredOut !== directTransferredOutPostings) {
    discrepancies.push(
      `transferredOut counter mismatch: account has ${currentTransferredOut}, direct debit postings sum to ${directTransferredOutPostings}`
    );
  }

  if (currentTransferredOnward !== onwardTransferredPostings) {
    discrepancies.push(
      `transferredOnward counter mismatch: account has ${currentTransferredOnward}, onward debit postings sum to ${onwardTransferredPostings}`
    );
  }

  // 5. Spendable balance calculation and verification
  // balance = directUnapplied + (transferredIn - allocatedIn - transferredOnward)
  const outstandingTransferredIn = currentTransferredIn - currentAllocatedIn - currentTransferredOnward;
  const expectedSpendableBalance = directUnapplied + outstandingTransferredIn;

  if (currentBalance !== expectedSpendableBalance) {
    discrepancies.push(
      `Spendable balance mismatch: account.balance=${currentBalance}, expected=${expectedSpendableBalance} (directUnapplied=${directUnapplied} + outstandingTransferredIn=${outstandingTransferredIn})`
    );
  }

  return {
    tenantId,
    studentId,
    isReconciled: discrepancies.length === 0,
    spendableBalance: currentBalance,
    expectedSpendableBalance,
    directReceipts: {
      totalReceiptAmount,
      allocatedAmount: directAllocated,
      transferredOutAmount: directTransferredOut,
      unappliedAmount: directUnapplied,
      reservedRefundAmount: directReserved,
      refundedAmount: directRefunded,
      isConserved,
    },
    transfers: {
      totalTransferredIn: totalTransferredInPostings,
      totalTransferredOut: directTransferredOutPostings,
      totalTransferredOnward: onwardTransferredPostings,
      allocatedIn: currentAllocatedIn,
      outstandingTransferredIn,
    },
    discrepancies,
  };
}
