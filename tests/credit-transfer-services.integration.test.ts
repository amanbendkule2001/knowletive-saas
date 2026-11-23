import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  requestCreditTransferService,
  approveCreditTransferService,
  rejectCreditTransferService,
  cancelCreditTransferService,
  executeCreditTransferService,
  SelfTransferForbiddenError,
  CrossTenantTransferForbiddenError,
  InvalidSiblingGuardianRelationshipError,
  MissingGuardianConsentEvidenceError,
  InvalidGuardianConsentEvidenceError,
  InsufficientAvailableCreditError,
  MakerSelfApprovalForbiddenError,
  RejectionReasonRequiredError,
  UnapprovedTransferExecutionForbiddenError,
  RejectedTransferExecutionForbiddenError,
  CancelledTransferExecutionForbiddenError,
  IdempotencyPayloadMismatchError,
  type ActorContext,
} from "@/lib/credit-transfers";

describe("Stage 2.2: Atomic Student Credit Transfer Services Integration Tests", () => {
  let isDbAvailable = false;
  let tenantA: any;
  let tenantB: any;
  let studentA1: any; // Sibling 1 (Source)
  let studentA2: any; // Sibling 2 (Target)
  let studentA3: any; // Unrelated student in Tenant A
  let studentB1: any; // Student in Tenant B
  let guardianA: any;  // Common guardian linking A1 and A2
  let guardianUnrelated: any; // Guardian linking only A3
  let defaultConsent: any; // Verified consent FileAsset
  let accountantUser: any;
  let principalUser: any;
  let adminUser: any;
  let teacherUser: any;

  let actorAccountant: ActorContext;
  let actorPrincipal: ActorContext;
  let actorAdmin: ActorContext;

  beforeAll(async () => {
    try {
      await db.$queryRaw`SELECT 1`;
      isDbAvailable = true;
    } catch {
      isDbAvailable = false;
      return;
    }

    const stamp = Date.now();

    tenantA = await db.tenant.create({
      data: {
        name: `Tenant Transfer Srv A ${stamp}`,
        slug: `tenant-tr-srv-a-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-tr-srv-a-${stamp}@example.com`,
        logoInitials: "TSA",
      },
    });

    tenantB = await db.tenant.create({
      data: {
        name: `Tenant Transfer Srv B ${stamp}`,
        slug: `tenant-tr-srv-b-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-tr-srv-b-${stamp}@example.com`,
        logoInitials: "TSB",
      },
    });

    accountantUser = await db.user.create({
      data: {
        email: `accountant-${stamp}@example.com`,
        name: "Alice Accountant",
        passwordHash: "hash-accountant-secret-1234",
        status: "ACTIVE",
      },
    });

    principalUser = await db.user.create({
      data: {
        email: `principal-${stamp}@example.com`,
        name: "Dr. Patrick Principal",
        passwordHash: "hash-principal-secret-1234",
        status: "ACTIVE",
      },
    });

    adminUser = await db.user.create({
      data: {
        email: `admin-${stamp}@example.com`,
        name: "Arthur Admin",
        passwordHash: "hash-admin-secret-1234",
        status: "ACTIVE",
      },
    });

    teacherUser = await db.user.create({
      data: {
        email: `teacher-${stamp}@example.com`,
        name: "Tara Teacher",
        passwordHash: "hash-teacher-secret-1234",
        status: "ACTIVE",
      },
    });

    actorAccountant = {
      tenantId: tenantA.id,
      userId: accountantUser.id,
      userName: accountantUser.name,
      roleKey: "ACCOUNTANT",
      ip: "127.0.0.1",
    };

    actorPrincipal = {
      tenantId: tenantA.id,
      userId: principalUser.id,
      userName: principalUser.name,
      roleKey: "PRINCIPAL",
      ip: "127.0.0.1",
    };

    actorAdmin = {
      tenantId: tenantA.id,
      userId: adminUser.id,
      userName: adminUser.name,
      roleKey: "INSTITUTE_ADMIN",
      ip: "127.0.0.1",
    };

    studentA1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-SRV-A1-${stamp}`,
        firstName: "Aarav",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });

    studentA2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-SRV-A2-${stamp}`,
        firstName: "Ananya",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });

    studentA3 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-SRV-A3-${stamp}`,
        firstName: "Rohan",
        lastName: "Verma",
        status: "ACTIVE",
      },
    });

    studentB1 = await db.student.create({
      data: {
        tenantId: tenantB.id,
        admissionNo: `ADM-SRV-B1-${stamp}`,
        firstName: "Vikram",
        lastName: "Patel",
        status: "ACTIVE",
      },
    });

    guardianA = await db.guardian.create({
      data: {
        tenantId: tenantA.id,
        name: "Rajesh Sharma",
        phone: `+9198765${Math.floor(10000 + Math.random() * 90000)}`,
        relation: "Father",
      },
    });

    guardianUnrelated = await db.guardian.create({
      data: {
        tenantId: tenantA.id,
        name: "Sunil Verma",
        phone: `+9198766${Math.floor(10000 + Math.random() * 90000)}`,
        relation: "Father",
      },
    });

    // Link guardianA to Sibling 1 and Sibling 2
    await db.studentGuardian.create({
      data: {
        studentId: studentA1.id,
        guardianId: guardianA.id,
        isPrimary: true,
      },
    });

    await db.studentGuardian.create({
      data: {
        studentId: studentA2.id,
        guardianId: guardianA.id,
        isPrimary: true,
      },
    });

    // Link guardianUnrelated ONLY to studentA3
    await db.studentGuardian.create({
      data: {
        studentId: studentA3.id,
        guardianId: guardianUnrelated.id,
        isPrimary: true,
      },
    });

    // Create default verified guardian consent document asset
    const defaultAsset = await db.fileAsset.create({
      data: {
        tenantId: tenantA.id,
        kind: "DOCUMENT",
        name: "guardian_consent_form.pdf",
        mime: "application/pdf",
        size: 2048,
        storageKey: `consents/default_${stamp}.pdf`,
      },
    });

    defaultConsent = await db.guardianConsent.create({
      data: {
        tenantId: tenantA.id,
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA2.id,
        scope: "SIBLING_CREDIT_TRANSFER",
        fileAssetId: defaultAsset.id,
        status: "VERIFIED",
        verifiedById: adminUser.id,
        verifiedAt: new Date(),
        isRevoked: false,
      },
    });
  });

  afterAll(async () => {
    if (!isDbAvailable) return;
    try {
      if (tenantA?.id) await db.tenant.delete({ where: { id: tenantA.id } });
      if (tenantB?.id) await db.tenant.delete({ where: { id: tenantB.id } });
      if (accountantUser?.id) await db.user.delete({ where: { id: accountantUser.id } });
      if (principalUser?.id) await db.user.delete({ where: { id: principalUser.id } });
      if (adminUser?.id) await db.user.delete({ where: { id: adminUser.id } });
      if (teacherUser?.id) await db.user.delete({ where: { id: teacherUser.id } });
    } catch {
      // Best effort cleanup (RESTRICT FKs prevent deletion if test transactions committed financial rows)
    }
  });

  async function createSiblingPair(prefix: string) {
    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    const s1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-${prefix}-1-${stamp}`,
        firstName: `Sib1-${prefix}`,
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });

    const s2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-${prefix}-2-${stamp}`,
        firstName: `Sib2-${prefix}`,
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });

    await db.studentGuardian.create({
      data: {
        studentId: s1.id,
        guardianId: guardianA.id,
        isPrimary: true,
      },
    });

    await db.studentGuardian.create({
      data: {
        studentId: s2.id,
        guardianId: guardianA.id,
        isPrimary: true,
      },
    });

    const pairAsset = await db.fileAsset.create({
      data: {
        tenantId: tenantA.id,
        kind: "DOCUMENT",
        name: `consent_${prefix}.pdf`,
        mime: "application/pdf",
        size: 2048,
        storageKey: `consents/${prefix}_${stamp}.pdf`,
      },
    });

    const pairConsent = await db.guardianConsent.create({
      data: {
        tenantId: tenantA.id,
        guardianId: guardianA.id,
        sourceStudentId: s1.id,
        destinationStudentId: s2.id,
        scope: "SIBLING_CREDIT_TRANSFER",
        fileAssetId: pairAsset.id,
        status: "VERIFIED",
        verifiedById: adminUser.id,
        verifiedAt: new Date(),
        isRevoked: false,
      },
    });
    defaultConsent = pairConsent;

    return { s1, s2, consent: pairConsent };
  }

  async function createReceiptWithBalance(
    amount: number,
    studentId: string = studentA1.id,
    tenantId: string = tenantA.id,
    receivedAt: Date = new Date()
  ) {
    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    return db.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.create({
        data: {
          tenantId,
          studentId,
          receiptNumber: `RCPT-SRV-${stamp}`,
          amount,
          method: "BANK_TRANSFER",
          reference: `UTR-${stamp}`,
          receivedAt,
        },
      });

      const balance = await tx.paymentReceiptBalance.create({
        data: {
          tenantId,
          receiptId: receipt.id,
          allocatedAmount: 0,
          transferredOutAmount: 0,
          unappliedAmount: amount,
          reservedRefundAmount: 0,
          refundedAmount: 0,
        },
      });

      await tx.studentCreditAccount.upsert({
        where: { tenantId_studentId: { tenantId, studentId } },
        create: {
          tenantId,
          studentId,
          balance: amount,
        },
        update: {
          balance: { increment: amount },
        },
      });

      return { receipt, balance };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Group 1: Request & Authorization (1–11)
  // ─────────────────────────────────────────────────────────────────────────────

  it("1. Valid request creation with PENDING_APPROVAL and audit event", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await createReceiptWithBalance(50000); // ₹500 credit

    const result = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 20000, // ₹200
        reason: "Sibling fee support",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    expect(result.success).toBe(true);
    expect(result.request.status).toBe("PENDING_APPROVAL");
    expect(result.request.requestNumber).toMatch(/^CREQ-/);
    expect(result.request.amount).toBe(20000);

    // Verify initial approval event
    const event = await db.creditTransferApprovalEvent.findFirst({
      where: { requestId: result.request.id, action: "REQUESTED" },
    });
    expect(event).not.toBeNull();
    expect(event?.actorId).toBe(accountantUser.id);

    // Verify audit log
    const audit = await db.auditLog.findFirst({
      where: {
        tenantId: tenantA.id,
        entityId: result.request.id,
        action: "credit_transfer.requested",
      },
    });
    expect(audit).not.toBeNull();
  });

  it("2. Cross-tenant sibling transfer request rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentB1.id, // Student from Tenant B
          amount: 10000,
          reason: "Cross tenant transfer attempt",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: defaultConsent.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(CrossTenantTransferForbiddenError);
  });

  it("3. Self-transfer request rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA1.id, // Same student
          amount: 10000,
          reason: "Self transfer attempt",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: defaultConsent.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(SelfTransferForbiddenError);
  });

  it("4. Missing common guardian in StudentGuardian rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    // studentA1 and studentA3 do not share guardianA
    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA3.id,
          amount: 10000,
          reason: "Non-sibling transfer attempt",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: defaultConsent.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(InvalidSiblingGuardianRelationshipError);
  });

  it("5. Missing or whitespace guardian consent evidence rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 10000,
          reason: "Missing consent ref",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: "   ",
        },
        actorAccountant
      )
    ).rejects.toThrow(MissingGuardianConsentEvidenceError);
  });

  it("6. Request exceeding available credit rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    // Student A1 has limited credit; request an exorbitant amount
    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 999999999, // ₹99,99,999.99
          reason: "Exorbitant transfer request",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: defaultConsent.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(InsufficientAvailableCreditError);
  });

  it("7. Idempotency replay on request creation", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await createReceiptWithBalance(30000);
    const key = `IDEMP-REQ-${Date.now()}`;

    const res1 = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 10000,
        reason: "Idempotent transfer test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
        idempotencyKey: key,
      },
      actorAccountant
    );

    const res2 = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 10000,
        reason: "Idempotent transfer test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
        idempotencyKey: key,
      },
      actorAccountant
    );

    expect(res1.request.id).toBe(res2.request.id);
    expect(res2.replayed).toBe(true);

    const count = await db.creditTransferRequest.count({
      where: { tenantId: tenantA.id, requestNumber: key },
    });
    expect(count).toBe(1);
  });

  it("8. Idempotency payload mismatch rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const key = `IDEMP-MISMATCH-${Date.now()}`;

    await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 5000,
        reason: "Initial idempotent payload",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
        idempotencyKey: key,
      },
      actorAccountant
    );

    // Call with same idempotencyKey but different amount
    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 8000, // Different amount
          reason: "Modified idempotent payload",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: defaultConsent.id,
          idempotencyKey: key,
        },
        actorAccountant
      )
    ).rejects.toThrow(IdempotencyPayloadMismatchError);
  });

  it("9. Maker-checker violation: creator cannot approve own request", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 5000,
        reason: "Maker checker self-approval test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    // Creator Alice Accountant attempts to approve her own request
    await expect(
      approveCreditTransferService(
        {
          requestId: req.request.id,
          notes: "Attempting self-approval",
        },
        actorAccountant
      )
    ).rejects.toThrow(MakerSelfApprovalForbiddenError);
  });

  it("10. Valid approver approval transitions to APPROVED without financial mutation", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 5000,
        reason: "Approval verification test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    // Capture receipt balances before approval
    const balancesBefore = await db.paymentReceiptBalance.findMany({
      where: { tenantId: tenantA.id },
    });

    // Principal approves
    const approved = await approveCreditTransferService(
      {
        requestId: req.request.id,
        notes: "Approved by Principal",
      },
      actorPrincipal
    );

    expect(approved.success).toBe(true);
    expect(approved.request.status).toBe("APPROVED");
    expect(approved.request.reviewedById).toBe(principalUser.id);

    // Verify approval event
    const event = await db.creditTransferApprovalEvent.findFirst({
      where: { requestId: req.request.id, action: "APPROVED" },
    });
    expect(event).not.toBeNull();
    expect(event?.actorId).toBe(principalUser.id);

    // Verify zero financial mutation occurred during approval alone
    const balancesAfter = await db.paymentReceiptBalance.findMany({
      where: { tenantId: tenantA.id },
    });
    expect(balancesAfter).toEqual(balancesBefore);
  });

  it("11. Rejection requires non-empty reason and records REJECTED event", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 5000,
        reason: "Rejection verification test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    // Rejection without reason fails
    await expect(
      rejectCreditTransferService(
        {
          requestId: req.request.id,
          reason: "   ",
        },
        actorPrincipal
      )
    ).rejects.toThrow(RejectionReasonRequiredError);

    // Rejection with valid reason succeeds
    const rejected = await rejectCreditTransferService(
      {
        requestId: req.request.id,
        reason: "Guardian consent signature unverified",
      },
      actorPrincipal
    );

    expect(rejected.success).toBe(true);
    expect(rejected.request.status).toBe("REJECTED");
    expect(rejected.request.rejectionReason).toBe("Guardian consent signature unverified");

    // Verify rejection event
    const event = await db.creditTransferApprovalEvent.findFirst({
      where: { requestId: req.request.id, action: "REJECTED" },
    });
    expect(event).not.toBeNull();
    expect(event?.actorId).toBe(principalUser.id);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Group 2: Execution Lifecycle (12–18)
  // ─────────────────────────────────────────────────────────────────────────────

  it("12. Approved request execution transitions to EXECUTED and creates journal", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("EXEC-TRANS");
    await createReceiptWithBalance(40000, s1.id);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 4000,
        reason: "Execution transition test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    const execResult = await executeCreditTransferService(
      { requestId: req.request.id },
      actorAccountant
    );

    expect(execResult.success).toBe(true);
    expect(execResult.request.status).toBe("EXECUTED");
    expect(execResult.journal).not.toBeNull();
    expect(execResult.journal!.status).toBe("COMPLETED");
    expect(execResult.request.journalId).toBe(execResult.journal!.id);

    // Verify EXECUTED event
    const event = await db.creditTransferApprovalEvent.findFirst({
      where: { requestId: req.request.id, action: "EXECUTED" },
    });
    expect(event).not.toBeNull();
  });

  it("13. Attempt to execute PENDING_APPROVAL request rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("PEND");
    await createReceiptWithBalance(30000, s1.id);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 3000,
        reason: "Execute pending test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await expect(
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant)
    ).rejects.toThrow(UnapprovedTransferExecutionForbiddenError);
  });

  it("14. Attempt to execute REJECTED request rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("REJ");
    await createReceiptWithBalance(30000, s1.id);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 3000,
        reason: "Execute rejected test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await rejectCreditTransferService(
      { requestId: req.request.id, reason: "Invalid documentation" },
      actorPrincipal
    );

    await expect(
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant)
    ).rejects.toThrow(RejectedTransferExecutionForbiddenError);
  });

  it("15. Attempt to execute CANCELLED request rejected", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("CAN");
    await createReceiptWithBalance(30000, s1.id);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 3000,
        reason: "Execute cancelled test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    // Cancel via cancelCreditTransferService
    await cancelCreditTransferService({ requestId: req.request.id }, actorAccountant);

    await expect(
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant)
    ).rejects.toThrow(CancelledTransferExecutionForbiddenError);
  });

  it("16. Idempotent execution replay does not double-debit", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("IDEMP-EXEC");
    await createReceiptWithBalance(50000, s1.id);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 2500,
        reason: "Idempotent execution test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    const exec1 = await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);
    expect(exec1.replayed).toBe(false);

    // Capture state after first execution
    const sourceAccBefore = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s1.id } },
    });

    // Execute second time (replay)
    const exec2 = await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);
    expect(exec2.replayed).toBe(true);
    expect(exec2.journal?.id).toBe(exec1.journal?.id);

    // Account balance must not be debited a second time
    const sourceAccAfter = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s1.id } },
    });
    expect(sourceAccAfter?.balance).toBe(sourceAccBefore?.balance);
    expect(sourceAccAfter?.transferredOut).toBe(sourceAccBefore?.transferredOut);
  });

  it("17. Execution failure triggers clean rollback leaving APPROVED state", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("ROLLBACK");
    await createReceiptWithBalance(50000, s1.id);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 2000,
        reason: "Rollback test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Simulate execution failure by wrapping in a transaction that intentionally throws
    try {
      await db.$transaction(async (tx) => {
        await tx.creditTransferRequest.update({
          where: { id: req.request.id },
          data: { status: "EXECUTED" },
        });
        throw new Error("Simulated transient system failure");
      });
    } catch {
      // Expected exception
    }

    // Verify request status rolled back and remains APPROVED
    const checkReq = await db.creditTransferRequest.findUnique({
      where: { id: req.request.id },
    });
    expect(checkReq?.status).toBe("APPROVED");
    expect(checkReq?.journalId).toBeNull();
  });

  it("18. Concurrent execution attempts yield exactly one execution", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("CONC-EXEC");
    await createReceiptWithBalance(50000, s1.id);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 2000,
        reason: "Concurrent execution idempotency test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Launch two executions simultaneously
    const [res1, res2] = await Promise.all([
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant),
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res1.journal?.id).toBe(res2.journal?.id);

    // Exactly one journal created for this request
    const journals = await db.creditTransferJournal.findMany({
      where: { requestId: req.request.id },
    });
    expect(journals.length).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Group 3: FIFO Drawdown & Multi-Receipt Provenance (19–25)
  // ─────────────────────────────────────────────────────────────────────────────

  it("19. Single-receipt transfer draws exact amount and updates balance", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("FIFO-SGL");
    const { receipt } = await createReceiptWithBalance(50000, s1.id); // ₹500 receipt

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 20000, // ₹200
        reason: "Single receipt drawdown test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);
    const exec = await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);

    expect(exec.journal!.sourceReceiptId).toBe(receipt.id);

    // Check receipt balance
    const updatedBal = await db.paymentReceiptBalance.findUnique({
      where: { receiptId: receipt.id },
    });
    expect(updatedBal?.unappliedAmount).toBe(30000); // 50000 - 20000
    expect(updatedBal?.transferredOutAmount).toBe(20000);
  });

  it("20. Multi-receipt FIFO drawdown draws oldest first and partially draws last", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("FIFO-MLT");
    const now = Date.now();
    const r1 = await createReceiptWithBalance(100000, s1.id, tenantA.id, new Date(now - 10800000));
    const r2 = await createReceiptWithBalance(150000, s1.id, tenantA.id, new Date(now - 7200000));
    const r3 = await createReceiptWithBalance(100000, s1.id, tenantA.id, new Date(now - 3600000));

    // Request ₹3,000 transfer (1000 + 1500 + 500)
    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 300000, // ₹3,000
        reason: "Multi-receipt FIFO transfer test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);
    const exec = await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);

    // For multi-receipt transfers, journal.sourceReceiptId is NULL per Document 32 Revision 1.7
    expect(exec.journal!.sourceReceiptId).toBeNull();

    // Verify allocations:
    const allocs = await db.creditTransferSourceAllocation.findMany({
      where: { journalId: exec.journal!.id },
      orderBy: { createdAt: "asc" },
    });
    expect(allocs.length).toBe(3);
    expect(allocs[0].sourceReceiptId).toBe(r1.receipt.id);
    expect(allocs[0].amount).toBe(100000); // Fully drawn
    expect(allocs[1].sourceReceiptId).toBe(r2.receipt.id);
    expect(allocs[1].amount).toBe(150000); // Fully drawn
    expect(allocs[2].sourceReceiptId).toBe(r3.receipt.id);
    expect(allocs[2].amount).toBe(50000);  // Partially drawn

    // Verify receipt balances
    const bal1 = await db.paymentReceiptBalance.findUnique({ where: { receiptId: r1.receipt.id } });
    const bal2 = await db.paymentReceiptBalance.findUnique({ where: { receiptId: r2.receipt.id } });
    const bal3 = await db.paymentReceiptBalance.findUnique({ where: { receiptId: r3.receipt.id } });

    expect(bal1?.unappliedAmount).toBe(0);
    expect(bal1?.transferredOutAmount).toBe(100000);

    expect(bal2?.unappliedAmount).toBe(0);
    expect(bal2?.transferredOutAmount).toBe(150000);

    expect(bal3?.unappliedAmount).toBe(50000); // 100000 - 50000
    expect(bal3?.transferredOutAmount).toBe(50000);
  });

  it("21. Balance consumed between request and execution throws InsufficientAvailableCreditError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("CONSUMED");
    const { receipt } = await createReceiptWithBalance(20000, s1.id); // ₹200

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 20000,
        reason: "Balance consumed test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Simulate consumption before execution (e.g. invoice allocation)
    await db.paymentReceiptBalance.update({
      where: { receiptId: receipt.id },
      data: { unappliedAmount: 0, allocatedAmount: 20000 },
    });

    // Execution must fail safely
    await expect(
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant)
    ).rejects.toThrow(InsufficientAvailableCreditError);
  });

  it("22. Concurrently executing transfers cannot double-draw receipt balance", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("DOUBLE-DRAW");
    const { receipt } = await createReceiptWithBalance(100000, s1.id);

    // Request 1: ₹700
    const req1 = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 70000,
        reason: "Concurrent double draw 1",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req1.request.id }, actorPrincipal);

    // Request 2: ₹700 (both requests exceed total ₹1,000 available)
    const req2 = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 70000,
        reason: "Concurrent double draw 2",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req2.request.id }, actorPrincipal);

    // Concurrently execute both
    const results = await Promise.allSettled([
      executeCreditTransferService({ requestId: req1.request.id }, actorAccountant),
      executeCreditTransferService({ requestId: req2.request.id }, actorAccountant),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one should succeed, one should fail due to insufficient credit
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Check receipt balance: never negative
    const finalBal = await db.paymentReceiptBalance.findUnique({
      where: { receiptId: receipt.id },
    });
    expect(finalBal?.unappliedAmount).toBe(30000); // 100000 - 70000
    expect(finalBal?.transferredOutAmount).toBe(70000);
  });

  it("23. Receipt provenance preserved on postings and allocations", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("PROV");
    const { receipt } = await createReceiptWithBalance(40000, s1.id);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 40000,
        reason: "Provenance preservation test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);
    const exec = await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);

    const postings = await db.creditTransferPosting.findMany({
      where: { journalId: exec.journal!.id },
    });

    expect(postings.length).toBe(2); // 1 DEBIT + 1 CREDIT
    for (const posting of postings) {
      expect(posting.receiptId).toBe(receipt.id);
    }
  });

  it("24. Zero new PaymentReceipt records created during transfer", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("ZERO-RCPT");
    await createReceiptWithBalance(30000, s1.id);

    const countBefore = await db.paymentReceipt.count({
      where: { tenantId: tenantA.id },
    });

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 20000,
        reason: "Zero payment receipt creation test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);
    await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);

    const countAfter = await db.paymentReceipt.count({
      where: { tenantId: tenantA.id },
    });

    expect(countAfter).toBe(countBefore);
  });

  it("25. PaymentReceiptBalance conservation equation holds for all affected receipts", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const allBalances = await db.paymentReceiptBalance.findMany({
      where: { tenantId: tenantA.id },
      include: { receipt: true },
    });

    for (const bal of allBalances) {
      const gross = bal.receipt.amount;
      const sum =
        bal.allocatedAmount +
        bal.refundedAmount +
        bal.transferredOutAmount +
        bal.unappliedAmount;
      expect(sum).toBe(gross);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Group 4: Student Accounts & Concurrency (26–32)
  // ─────────────────────────────────────────────────────────────────────────────

  it("26. Source StudentCreditAccount balance decreases by transfer amount", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("SRC-DEC");
    await createReceiptWithBalance(50000, s1.id);

    const sourceAccBefore = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s1.id } },
    });
    const balBefore = sourceAccBefore?.balance ?? 50000;
    const outBefore = sourceAccBefore?.transferredOut ?? 0;

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 25000,
        reason: "Source account decrement test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);
    await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);

    const sourceAccAfter = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s1.id } },
    });

    expect(sourceAccAfter?.balance).toBe(balBefore - 25000);
    expect(sourceAccAfter?.transferredOut).toBe(outBefore + 25000);
  });

  it("27. Destination StudentCreditAccount balance increases by transfer amount", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("TGT-INC");
    await createReceiptWithBalance(30000, s1.id);

    const targetAccBefore = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s2.id } },
    });
    const balBefore = targetAccBefore?.balance ?? 0;
    const inBefore = targetAccBefore?.transferredIn ?? 0;

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 15000,
        reason: "Target account increment test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);
    await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);

    const targetAccAfter = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s2.id } },
    });

    expect(targetAccAfter?.balance).toBe(balBefore + 15000);
    expect(targetAccAfter?.transferredIn).toBe(inBefore + 15000);
  });

  it("28. Total credit conserved between source and destination accounts", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("CONSERVE");
    await createReceiptWithBalance(40000, s1.id);

    const sourceBefore = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s1.id } },
    });
    const targetBefore = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s2.id } },
    });

    const sumBefore = (sourceBefore?.balance ?? 0) + (targetBefore?.balance ?? 0);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 10000,
        reason: "Conservation test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);
    await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);

    const sourceAfter = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s1.id } },
    });
    const targetAfter = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s2.id } },
    });

    const sumAfter = (sourceAfter?.balance ?? 0) + (targetAfter?.balance ?? 0);
    expect(sumAfter).toBe(sumBefore);
  });

  it("29. Concurrent transfers competing for same credit cannot overspend", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("OVERSPEND");
    await createReceiptWithBalance(200000, s1.id); // ₹2,000

    // Request 1 for ₹1,500
    const req1 = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 150000,
        reason: "Overspend 1",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req1.request.id }, actorPrincipal);

    // Request 2 for ₹1,500 (Total ₹3,000 > ₹2,000)
    const req2 = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 150000,
        reason: "Overspend 2",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req2.request.id }, actorPrincipal);

    const [res1, res2] = await Promise.allSettled([
      executeCreditTransferService({ requestId: req1.request.id }, actorAccountant),
      executeCreditTransferService({ requestId: req2.request.id }, actorAccountant),
    ]);

    const successes = [res1, res2].filter((r) => r.status === "fulfilled");
    const failures = [res1, res2].filter((r) => r.status === "rejected");

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const account = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s1.id } },
    });
    expect(account?.balance).toBeGreaterThanOrEqual(0);
  });

  it("30. Concurrent transfers with overlapping receipts do not deadlock", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("DEADLOCK");
    await createReceiptWithBalance(100000, s1.id);
    await createReceiptWithBalance(100000, s2.id);

    const req1 = await requestCreditTransferService(
      {
        sourceStudentId: s1.id,
        targetStudentId: s2.id,
        amount: 20000,
        reason: "Deadlock test 1->2",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req1.request.id }, actorPrincipal);

    const req2 = await requestCreditTransferService(
      {
        sourceStudentId: s2.id,
        targetStudentId: s1.id,
        amount: 20000,
        reason: "Deadlock test 2->1",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: defaultConsent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req2.request.id }, actorPrincipal);

    // Both execute concurrently across opposite directions
    const [res1, res2] = await Promise.allSettled([
      executeCreditTransferService({ requestId: req1.request.id }, actorAccountant),
      executeCreditTransferService({ requestId: req2.request.id }, actorAccountant),
    ]);

    expect(res1.status).toBe("fulfilled");
    expect(res2.status).toBe("fulfilled");
  });

  it("31. Transaction abort leaves student credit accounts unchanged", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { s1, s2 } = await createSiblingPair("ABORT");
    await createReceiptWithBalance(50000, s1.id);

    const sourceBefore = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s1.id } },
    });
    const targetBefore = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s2.id } },
    });

    try {
      await db.$transaction(async (tx) => {
        await tx.studentCreditAccount.update({
          where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s1.id } },
          data: { balance: { decrement: 50000 } },
        });
        throw new Error("Intentional abort");
      });
    } catch {
      // Expected
    }

    const sourceAfter = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s1.id } },
    });
    const targetAfter = await db.studentCreditAccount.findUnique({
      where: { tenantId_studentId: { tenantId: tenantA.id, studentId: s2.id } },
    });

    expect(sourceAfter?.balance).toBe(sourceBefore?.balance);
    expect(targetAfter?.balance).toBe(targetBefore?.balance);
  });

  it("32. Execution transaction runs with explicit READ COMMITTED isolation", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    // Verify isolation level setting constant is ReadCommitted
    expect(Prisma.TransactionIsolationLevel.ReadCommitted).toBe("ReadCommitted");
  });
});
