import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  createGuardianConsentService,
  verifyGuardianConsentService,
  revokeGuardianConsentService,
  requestCreditTransferService,
  approveCreditTransferService,
  rejectCreditTransferService,
  cancelCreditTransferService,
  executeCreditTransferService,
  allocateTransferredCreditService,
  reconcileStudentCreditAccount,
  GuardianConsentNotFoundError,
  UnverifiedGuardianConsentError,
  RejectedGuardianConsentError,
  RevokedGuardianConsentError,
  ExpiredGuardianConsentError,
  InvalidConsentScopeError,
  InvalidConsentStudentMismatchError,
  InvalidSiblingGuardianRelationshipError,
  CrossTenantTransferForbiddenError,
  SelfTransferForbiddenError,
  InvalidGuardianConsentEvidenceError,
  InvalidRequestStateTransitionError,
  UnapprovedTransferExecutionForbiddenError,
  type ActorContext,
} from "@/lib/credit-transfers";

describe("Stage 2.2.2: Credit Transfer Consent, Reconciliation & Lifecycle Hardening", () => {
  let isDbAvailable = false;
  let tenantA: any;
  let tenantB: any;
  let studentA1: any;
  let studentA2: any;
  let studentA3: any;
  let studentB1: any;
  let guardianA: any;
  let guardianB: any;
  let guardianUnrelated: any;
  let accountantUser: any;
  let principalUser: any;
  let adminUser: any;
  let actorAccountant: ActorContext;
  let actorPrincipal: ActorContext;
  let actorAdmin: ActorContext;

  beforeAll(async () => {
    try {
      await db.$queryRaw`SELECT 1`;
      isDbAvailable = true;
    } catch {
      console.warn("PostgreSQL not available. Skipping Stage 2.2.2 integration tests.");
      return;
    }

    const stamp = Date.now() + Math.floor(Math.random() * 1000000);

    tenantA = await db.tenant.create({
      data: {
        id: `t_c_a_${stamp}`,
        name: `Consent Institute A ${stamp}`,
        slug: `consent-inst-a-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `consent-inst-a-${stamp}@example.com`,
        logoInitials: "CIA",
      },
    });

    tenantB = await db.tenant.create({
      data: {
        id: `t_c_b_${stamp}`,
        name: `Consent Institute B ${stamp}`,
        slug: `consent-inst-b-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `consent-inst-b-${stamp}@example.com`,
        logoInitials: "CIB",
      },
    });

    accountantUser = await db.user.create({
      data: {
        email: `acc-${stamp}@example.com`,
        name: "Abha Accountant",
        passwordHash: "hash-secret-1234",
        status: "ACTIVE",
      },
    });

    principalUser = await db.user.create({
      data: {
        email: `prin-${stamp}@example.com`,
        name: "Pooja Principal",
        passwordHash: "hash-secret-1234",
        status: "ACTIVE",
      },
    });

    adminUser = await db.user.create({
      data: {
        email: `adm-${stamp}@example.com`,
        name: "Anil Admin",
        passwordHash: "hash-secret-1234",
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
        admissionNo: `ADM-C-A1-${stamp}`,
        firstName: "Aarav",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });

    studentA2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-C-A2-${stamp}`,
        firstName: "Ananya",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });

    studentA3 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-C-A3-${stamp}`,
        firstName: "Rohan",
        lastName: "Verma",
        status: "ACTIVE",
      },
    });

    studentB1 = await db.student.create({
      data: {
        tenantId: tenantB.id,
        admissionNo: `ADM-C-B1-${stamp}`,
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

    guardianB = await db.guardian.create({
      data: {
        tenantId: tenantB.id,
        name: "Mukesh Patel",
        phone: `+9198767${Math.floor(10000 + Math.random() * 90000)}`,
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

    // Link guardianA to studentA1 and studentA2 (siblings)
    await db.studentGuardian.create({
      data: { studentId: studentA1.id, guardianId: guardianA.id, isPrimary: true },
    });
    await db.studentGuardian.create({
      data: { studentId: studentA2.id, guardianId: guardianA.id, isPrimary: true },
    });

    // Link guardianUnrelated only to studentA3
    await db.studentGuardian.create({
      data: { studentId: studentA3.id, guardianId: guardianUnrelated.id, isPrimary: true },
    });

    // Link guardianB to studentB1 in Tenant B
    await db.studentGuardian.create({
      data: { studentId: studentB1.id, guardianId: guardianB.id, isPrimary: true },
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
    } catch {
      // Best-effort cleanup
    }
  });

  async function createReceiptWithBalance(amount: number, studentId: string = studentA1.id, tenantId: string = tenantA.id) {
    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    return await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId,
          studentId,
          receiptNumber: `RCPT-C-${stamp}`,
          amount,
          method: "ONLINE",
          reference: `PAY-${stamp}`,
        },
      });

      const b = await tx.paymentReceiptBalance.create({
        data: {
          tenantId,
          receiptId: r.id,
          allocatedAmount: 0,
          transferredOutAmount: 0,
          unappliedAmount: amount,
          reservedRefundAmount: 0,
          refundedAmount: 0,
        },
      });

      return { receipt: r, balance: b };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Section A: Genuine Guardian Consent Verification Workflow (1–9)
  // ─────────────────────────────────────────────────────────────────────────────

  it("1. Valid staff-verified guardian consent enables credit transfer request", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await createReceiptWithBalance(50000);

    // 1. Create consent (starts as PENDING)
    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA2.id,
        scope: "SIBLING_CREDIT_TRANSFER",
      },
      actorAccountant
    );
    expect(consent.status).toBe("PENDING");
    expect(consent.isRevoked).toBe(false);

    // 2. Staff approves consent
    const verified = await verifyGuardianConsentService(
      {
        consentId: consent.id,
        decision: "APPROVE",
      },
      actorAdmin
    );
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verifiedById).toBe(adminUser.id);
    expect(verified.verifiedAt).toBeDefined();

    // 3. Initiate request with verified consent
    const result = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 15000,
        reason: "Valid verified consent",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: consent.id,
      },
      actorAccountant
    );
    expect(result.success).toBe(true);
    expect(result.request.status).toBe("PENDING_APPROVAL");
    expect(result.request.guardianConsentId).toBe(consent.id);
  });

  it("2. Nonexistent consent ID rejected with GuardianConsentNotFoundError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 5000,
          reason: "Nonexistent consent test",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: "non-existent-consent-cuid-99999",
        },
        actorAccountant
      )
    ).rejects.toThrow(GuardianConsentNotFoundError);
  });

  it("3. Ordinary document upload / arbitrary string does not satisfy consent", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const plainDoc = await db.fileAsset.create({
      data: {
        tenantId: tenantA.id,
        kind: "DOCUMENT",
        name: "random_doc.pdf",
        mime: "application/pdf",
        size: 1024,
        storageKey: `docs/random_${Date.now()}.pdf`,
      },
    });

    // Passing ordinary FileAsset ID without a GuardianConsent record
    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 5000,
          reason: "Ordinary document test",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: plainDoc.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(GuardianConsentNotFoundError);
  });

  it("4. Wrong guardian (not linked to both siblings) rejected with InvalidSiblingGuardianRelationshipError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    // Attempting to create consent with guardianUnrelated (linked only to A3, not A1 or A2)
    await expect(
      createGuardianConsentService(
        {
          guardianId: guardianUnrelated.id,
          sourceStudentId: studentA1.id,
          destinationStudentId: studentA2.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(InvalidSiblingGuardianRelationshipError);
  });

  it("5. Wrong tenant consent rejected with CrossTenantTransferForbiddenError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    // Attempting to create consent across tenants
    await expect(
      createGuardianConsentService(
        {
          guardianId: guardianA.id,
          sourceStudentId: studentA1.id,
          destinationStudentId: studentB1.id, // in Tenant B!
        },
        actorAccountant
      )
    ).rejects.toThrow(CrossTenantTransferForbiddenError);
  });

  it("6. Wrong consent scope (GENERAL_FINANCIAL) rejected with InvalidConsentScopeError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA2.id,
        scope: "GENERAL_FINANCIAL",
      },
      actorAccountant
    );

    await verifyGuardianConsentService(
      {
        consentId: consent.id,
        decision: "APPROVE",
      },
      actorAdmin
    );

    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 5000,
          reason: "Scope test",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: consent.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(InvalidConsentScopeError);
  });

  it("7. Unverified consent (status: PENDING) rejected with UnverifiedGuardianConsentError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA2.id,
        scope: "SIBLING_CREDIT_TRANSFER",
      },
      actorAccountant
    );

    // Not approved yet (status is PENDING)
    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 5000,
          reason: "Pending consent test",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: consent.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(UnverifiedGuardianConsentError);
  });

  it("8. Revoked consent rejected with RevokedGuardianConsentError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA2.id,
        scope: "SIBLING_CREDIT_TRANSFER",
      },
      actorAccountant
    );

    await verifyGuardianConsentService({ consentId: consent.id, decision: "APPROVE" }, actorAdmin);

    // Revoke consent
    await revokeGuardianConsentService({ consentId: consent.id, reason: "Parent withdrew permission" }, actorAdmin);

    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 5000,
          reason: "Revoked consent test",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: consent.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(RevokedGuardianConsentError);
  });

  it("9. Expired consent rejected with ExpiredGuardianConsentError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const pastDate = new Date(Date.now() - 10000); // 10s ago

    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA2.id,
        scope: "SIBLING_CREDIT_TRANSFER",
        expiresAt: pastDate,
      },
      actorAccountant
    );

    await verifyGuardianConsentService({ consentId: consent.id, decision: "APPROVE" }, actorAdmin);

    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 5000,
          reason: "Expired consent test",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: consent.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(ExpiredGuardianConsentError);
  });

  it("10. Student pair mismatch rejected with InvalidConsentStudentMismatchError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    // Link guardianA to studentA3 as well
    await db.studentGuardian.create({
      data: { studentId: studentA3.id, guardianId: guardianA.id, isPrimary: false },
    });

    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA3.id, // A1 -> A3
        scope: "SIBLING_CREDIT_TRANSFER",
      },
      actorAccountant
    );
    await verifyGuardianConsentService({ consentId: consent.id, decision: "APPROVE" }, actorAdmin);

    // Attempt to use A1->A3 consent for A1->A2 transfer
    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id, // target is A2, not A3!
          amount: 5000,
          reason: "Mismatch test",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: consent.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(InvalidConsentStudentMismatchError);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Section B: Complete Request Lifecycle Concurrency Matrix (10 Cases)
  // ─────────────────────────────────────────────────────────────────────────────

  async function createVerifiedPendingRequest(amount = 20000) {
    await createReceiptWithBalance(amount + 10000);
    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA2.id,
      },
      actorAccountant
    );
    await verifyGuardianConsentService({ consentId: consent.id, decision: "APPROVE" }, actorAdmin);

    return await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount,
        reason: "Concurrency matrix request",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: consent.id,
      },
      actorAccountant
    );
  }

  it("11.1 Concurrency Case 1: Two concurrent approvals of one pending request (exactly 1 wins)", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await createVerifiedPendingRequest();

    const [r1, r2] = await Promise.allSettled([
      approveCreditTransferService({ requestId: req.request.id, notes: "Admin 1" }, actorPrincipal),
      approveCreditTransferService({ requestId: req.request.id, notes: "Admin 2" }, actorAdmin),
    ]);

    const successes = [r1, r2].filter((r) => r.status === "fulfilled");
    const failures = [r1, r2].filter((r) => r.status === "rejected");

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const events = await db.creditTransferApprovalEvent.findMany({
      where: { requestId: req.request.id, action: "APPROVED" },
    });
    expect(events.length).toBe(1);
  });

  it("11.2 Concurrency Case 2: Two concurrent rejections of one pending request (exactly 1 wins)", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await createVerifiedPendingRequest();

    const [r1, r2] = await Promise.allSettled([
      rejectCreditTransferService({ requestId: req.request.id, reason: "Reject 1" }, actorPrincipal),
      rejectCreditTransferService({ requestId: req.request.id, reason: "Reject 2" }, actorAdmin),
    ]);

    const successes = [r1, r2].filter((r) => r.status === "fulfilled");
    const failures = [r1, r2].filter((r) => r.status === "rejected");

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const events = await db.creditTransferApprovalEvent.findMany({
      where: { requestId: req.request.id, action: "REJECTED" },
    });
    expect(events.length).toBe(1);
  });

  it("11.3 Concurrency Case 3: Concurrent approval and rejection (exactly 1 wins)", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await createVerifiedPendingRequest();

    const [r1, r2] = await Promise.allSettled([
      approveCreditTransferService({ requestId: req.request.id, notes: "Approve notes" }, actorPrincipal),
      rejectCreditTransferService({ requestId: req.request.id, reason: "Reject reason" }, actorAdmin),
    ]);

    const successes = [r1, r2].filter((r) => r.status === "fulfilled");
    const failures = [r1, r2].filter((r) => r.status === "rejected");

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const finalReq = await db.creditTransferRequest.findUnique({ where: { id: req.request.id } });
    expect(["APPROVED", "REJECTED"]).toContain(finalReq?.status);
  });

  it("11.4 Concurrency Case 4: Concurrent approval and cancellation (exactly 1 wins)", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await createVerifiedPendingRequest();

    const [r1, r2] = await Promise.allSettled([
      approveCreditTransferService({ requestId: req.request.id }, actorPrincipal),
      cancelCreditTransferService({ requestId: req.request.id, reason: "Cancelled by accountant" }, actorAccountant),
    ]);

    const successes = [r1, r2].filter((r) => r.status === "fulfilled");
    const failures = [r1, r2].filter((r) => r.status === "rejected");

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const finalReq = await db.creditTransferRequest.findUnique({ where: { id: req.request.id } });
    expect(["APPROVED", "CANCELLED"]).toContain(finalReq?.status);
  });

  it("11.5 Concurrency Case 5: Concurrent approval and execution", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await createVerifiedPendingRequest();

    // From PENDING_APPROVAL, execution cannot proceed until request is APPROVED.
    const [rApprove, rExec] = await Promise.allSettled([
      approveCreditTransferService({ requestId: req.request.id }, actorPrincipal),
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant),
    ]);

    // Either approval committed first and execution succeeded, or execution saw PENDING_APPROVAL and threw
    if (rExec.status === "rejected") {
      expect(rApprove.status).toBe("fulfilled");
      expect(rExec.reason).toBeInstanceOf(UnapprovedTransferExecutionForbiddenError);
    } else {
      expect(rApprove.status).toBe("fulfilled");
      expect(rExec.status).toBe("fulfilled");
    }

    const finalReq = await db.creditTransferRequest.findUnique({ where: { id: req.request.id } });
    expect(["APPROVED", "EXECUTED"]).toContain(finalReq?.status);
  });

  it("11.6 Concurrency Case 6: Concurrent rejection and execution on approved request (execution succeeds, rejection fails)", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await createVerifiedPendingRequest();
    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Now request is APPROVED: reject vs execute
    const [rRej, rExec] = await Promise.allSettled([
      rejectCreditTransferService({ requestId: req.request.id, reason: "Too late" }, actorPrincipal),
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant),
    ]);

    // rejectCreditTransferService requires PENDING_APPROVAL, so rejection must fail on an APPROVED request
    expect(rRej.status).toBe("rejected");
    expect(rExec.status).toBe("fulfilled");

    const finalReq = await db.creditTransferRequest.findUnique({ where: { id: req.request.id } });
    expect(finalReq?.status).toBe("EXECUTED");
  });

  it("11.7 Concurrency Case 7: Concurrent cancellation and execution on approved request (cancellation rejected, execution succeeds)", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await createVerifiedPendingRequest();
    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Cancel requires PENDING_APPROVAL, so on an APPROVED request, cancellation fails
    const [rCan, rExec] = await Promise.allSettled([
      cancelCreditTransferService({ requestId: req.request.id }, actorAccountant),
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant),
    ]);

    expect(rCan.status).toBe("rejected");
    expect(rExec.status).toBe("fulfilled");

    const finalReq = await db.creditTransferRequest.findUnique({ where: { id: req.request.id } });
    expect(finalReq?.status).toBe("EXECUTED");
  });

  it("11.8 Concurrency Case 8: Repeated approval after successful approval fails with domain error", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await createVerifiedPendingRequest();
    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Second approval
    await expect(
      approveCreditTransferService({ requestId: req.request.id }, actorAdmin)
    ).rejects.toThrow(InvalidRequestStateTransitionError);
  });

  it("11.9 Concurrency Case 9: Repeated rejection after terminal rejection fails with domain error", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await createVerifiedPendingRequest();
    await rejectCreditTransferService({ requestId: req.request.id, reason: "First rejection" }, actorPrincipal);

    // Second rejection
    await expect(
      rejectCreditTransferService({ requestId: req.request.id, reason: "Second rejection" }, actorAdmin)
    ).rejects.toThrow(InvalidRequestStateTransitionError);
  });

  it("11.10 Concurrency Case 10: Duplicate execution with preventReplay fails with domain error; without preventReplay returns replayed", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await createVerifiedPendingRequest();
    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    const exec1 = await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);
    expect(exec1.replayed).toBe(false);

    // Default idempotent replay
    const exec2 = await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);
    expect(exec2.replayed).toBe(true);

    // Strict non-replay execution
    await expect(
      executeCreditTransferService({ requestId: req.request.id, preventReplay: true }, actorAccountant)
    ).rejects.toThrow(InvalidRequestStateTransitionError);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Section C: Account Reconciliation & Provenance Equations (12–15)
  // ─────────────────────────────────────────────────────────────────────────────

  it("12. Account reconciliation holds after direct receipt creation and unapplied credit", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    const sRecon1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-RECON-1-${stamp}`,
        firstName: "R1",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });
    const sRecon2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-RECON-2-${stamp}`,
        firstName: "R2",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });
    await db.studentGuardian.create({
      data: { studentId: sRecon1.id, guardianId: guardianA.id, isPrimary: true },
    });
    await db.studentGuardian.create({
      data: { studentId: sRecon2.id, guardianId: guardianA.id, isPrimary: true },
    });

    // Initial state before any receipts
    const reconBefore = await reconcileStudentCreditAccount(tenantA.id, sRecon1.id);
    expect(reconBefore.isReconciled).toBe(true);
    expect(reconBefore.spendableBalance).toBe(0);

    // Add direct receipt
    await createReceiptWithBalance(30000, sRecon1.id);

    // Initialize StudentCreditAccount projection
    await db.studentCreditAccount.create({
      data: {
        tenantId: tenantA.id,
        studentId: sRecon1.id,
        balance: 30000,
      },
    });

    const reconAfter = await reconcileStudentCreditAccount(tenantA.id, sRecon1.id);
    expect(reconAfter.isReconciled).toBe(true);
    expect(reconAfter.discrepancies).toHaveLength(0);
    expect(reconAfter.spendableBalance).toBe(30000);
    expect(reconAfter.expectedSpendableBalance).toBe(30000);
    expect(reconAfter.directReceipts.unappliedAmount).toBe(30000);
  });

  it("13. Account reconciliation holds after sibling credit transfer execution", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    const sTrans1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-TRANS-1-${stamp}`,
        firstName: "T1",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });
    const sTrans2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-TRANS-2-${stamp}`,
        firstName: "T2",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });
    await db.studentGuardian.create({
      data: { studentId: sTrans1.id, guardianId: guardianA.id, isPrimary: true },
    });
    await db.studentGuardian.create({
      data: { studentId: sTrans2.id, guardianId: guardianA.id, isPrimary: true },
    });

    await createReceiptWithBalance(40000, sTrans1.id);

    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: sTrans1.id,
        destinationStudentId: sTrans2.id,
      },
      actorAccountant
    );
    await verifyGuardianConsentService({ consentId: consent.id, decision: "APPROVE" }, actorAdmin);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: sTrans1.id,
        targetStudentId: sTrans2.id,
        amount: 15000,
        reason: "Reconciliation transfer test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: consent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);
    await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);

    // Source reconciliation
    const reconSource = await reconcileStudentCreditAccount(tenantA.id, sTrans1.id);
    expect(reconSource.isReconciled).toBe(true);
    expect(reconSource.discrepancies).toHaveLength(0);
    expect(reconSource.spendableBalance).toBe(25000); // 40000 - 15000
    expect(reconSource.directReceipts.unappliedAmount).toBe(25000);
    expect(reconSource.directReceipts.transferredOutAmount).toBe(15000);
    expect(reconSource.transfers.totalTransferredOut).toBe(15000);

    // Destination reconciliation
    const reconTarget = await reconcileStudentCreditAccount(tenantA.id, sTrans2.id);
    expect(reconTarget.isReconciled).toBe(true);
    expect(reconTarget.discrepancies).toHaveLength(0);
    expect(reconTarget.spendableBalance).toBe(15000); // 0 + 15000
    expect(reconTarget.transfers.totalTransferredIn).toBe(15000);
    expect(reconTarget.transfers.outstandingTransferredIn).toBe(15000);
  });

  it("14. Account reconciliation holds with simulated transferred-in credit allocation (allocatedIn)", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    const sAlloc1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-ALLOC-1-${stamp}`,
        firstName: "AL1",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });
    const sAlloc2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-ALLOC-2-${stamp}`,
        firstName: "AL2",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });
    await db.studentGuardian.create({
      data: { studentId: sAlloc1.id, guardianId: guardianA.id, isPrimary: true },
    });
    await db.studentGuardian.create({
      data: { studentId: sAlloc2.id, guardianId: guardianA.id, isPrimary: true },
    });

    await createReceiptWithBalance(30000, sAlloc1.id);

    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: sAlloc1.id,
        destinationStudentId: sAlloc2.id,
      },
      actorAccountant
    );
    await verifyGuardianConsentService({ consentId: consent.id, decision: "APPROVE" }, actorAdmin);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: sAlloc1.id,
        targetStudentId: sAlloc2.id,
        amount: 20000,
        reason: "AllocatedIn reconciliation test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: consent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);
    await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);

    const acc = await db.studentCreditAccount.findFirst({
      where: { tenantId: tenantA.id, studentId: sAlloc2.id },
    });
    expect(acc).toBeDefined();
    expect(acc?.balance).toBe(20000);

    // Simulate allocating 8000 paise from transferred-in credit towards fees
    await db.studentCreditAccount.update({
      where: { id: acc!.id },
      data: {
        allocatedIn: { increment: 8000 },
        balance: { decrement: 8000 },
      },
    });

    const recon = await reconcileStudentCreditAccount(tenantA.id, sAlloc2.id);
    expect(recon.isReconciled).toBe(true);
    expect(recon.discrepancies).toHaveLength(0);
    expect(recon.transfers.allocatedIn).toBe(8000);
    expect(recon.spendableBalance).toBe(12000); // 20000 - 8000
    expect(recon.expectedSpendableBalance).toBe(12000);
  });

  it("15. Receipt balance conservation trigger fn_enforce_receipt_balance_conservation enforces reservedRefundAmount", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { receipt } = await createReceiptWithBalance(60000, studentA1.id);

    // 1. Valid modification conserving total amount (60000 = unapplied 40000 + reserved 20000)
    await db.paymentReceiptBalance.update({
      where: { receiptId: receipt.id },
      data: {
        unappliedAmount: 40000,
        reservedRefundAmount: 20000,
      },
    });

    const validBal = await db.paymentReceiptBalance.findUnique({ where: { receiptId: receipt.id } });
    expect(validBal?.unappliedAmount).toBe(40000);
    expect(validBal?.reservedRefundAmount).toBe(20000);

    // 2. Invalid modification violating conservation equation (40000 + 30000 = 70000 != 60000)
    await expect(
      db.paymentReceiptBalance.update({
        where: { receiptId: receipt.id },
        data: {
          reservedRefundAmount: 30000,
        },
      })
    ).rejects.toThrow(/Conservation violation on PaymentReceipt/);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Section D: Deadlock Freedom & Concurrency Interleaving (16–17)
  // ─────────────────────────────────────────────────────────────────────────────

  it("16. Transfer execution versus concurrent invoice allocation does not deadlock (Tier 3 receiptId ASC)", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { receipt: r1 } = await createReceiptWithBalance(30000, studentA1.id);
    const { receipt: r2 } = await createReceiptWithBalance(40000, studentA1.id);

    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA2.id,
      },
      actorAccountant
    );
    await verifyGuardianConsentService({ consentId: consent.id, decision: "APPROVE" }, actorAdmin);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 25000,
        reason: "Deadlock interleaving test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: consent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Interleave transfer execution and invoice allocation on the same receipts
    const [execRes, allocRes] = await Promise.allSettled([
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant),
      db.$transaction(async (tx) => {
        // Lock Tier 3 in receiptId ASC order
        const sortedIds = [r1.id, r2.id].sort();
        await tx.$queryRaw`
          SELECT "receiptId" FROM "PaymentReceiptBalance"
          WHERE "receiptId" IN (${sortedIds[0]}, ${sortedIds[1]})
          ORDER BY "receiptId" ASC
          FOR UPDATE
        `;
        return { locked: true };
      }),
    ]);

    expect(execRes.status).toBe("fulfilled");
    expect(allocRes.status).toBe("fulfilled");
  });

  it("17. Transfer execution versus concurrent receipt reversal adheres to lock hierarchy", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const { receipt } = await createReceiptWithBalance(50000, studentA1.id);

    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA2.id,
      },
      actorAccountant
    );
    await verifyGuardianConsentService({ consentId: consent.id, decision: "APPROVE" }, actorAdmin);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 20000,
        reason: "Reversal interleaving test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: consent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Concurrent execution and simulated reversal inspection
    const [execRes, revRes] = await Promise.allSettled([
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant),
      db.$transaction(async (tx) => {
        const bal = await tx.$queryRaw<any[]>`
          SELECT "receiptId", "unappliedAmount" FROM "PaymentReceiptBalance"
          WHERE "receiptId" = ${receipt.id}
          FOR UPDATE
        `;
        return bal[0];
      }),
    ]);

    expect(execRes.status).toBe("fulfilled");
    expect(revRes.status).toBe("fulfilled");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Section E: Stage 2.2.3 Mandatory Provenance, Onward Transfer & Audit Tests
  // ─────────────────────────────────────────────────────────────────────────

  it("18. Mandatory Three-Student Accounting Scenario (Document 32 Rev 1.7): A(5000) -> B(2000), B allocates 1500, B -> C(500)", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    // Create three sibling students under guardianA: A, B, C
    const studentA = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-3S-A-${stamp}`,
        firstName: "StudentA",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });
    const studentB = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-3S-B-${stamp}`,
        firstName: "StudentB",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });
    const studentC = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-3S-C-${stamp}`,
        firstName: "StudentC",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });

    // Link all 3 students to common guardian
    await db.studentGuardian.create({
      data: { studentId: studentA.id, guardianId: guardianA.id, isPrimary: true },
    });
    await db.studentGuardian.create({
      data: { studentId: studentB.id, guardianId: guardianA.id, isPrimary: true },
    });
    await db.studentGuardian.create({
      data: { studentId: studentC.id, guardianId: guardianA.id, isPrimary: true },
    });

    // Step 1: Student A has receipt of ₹5,000 (500000 paise)
    const { receipt: receiptA } = await createReceiptWithBalance(500000, studentA.id);

    // Initial student credit accounts
    await db.studentCreditAccount.create({
      data: { tenantId: tenantA.id, studentId: studentA.id, balance: 500000 },
    });
    await db.studentCreditAccount.create({
      data: { tenantId: tenantA.id, studentId: studentB.id, balance: 0 },
    });
    await db.studentCreditAccount.create({
      data: { tenantId: tenantA.id, studentId: studentC.id, balance: 0 },
    });

    // Count PaymentReceipt records before transfers
    const initialReceiptCount = await db.paymentReceipt.count({ where: { tenantId: tenantA.id } });

    // Step 2: Student A transfers ₹2,000 (200000 paise) to Student B
    const consentAB = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: studentA.id,
        destinationStudentId: studentB.id,
      },
      actorAccountant
    );
    await verifyGuardianConsentService({ consentId: consentAB.id, decision: "APPROVE" }, actorAdmin);

    const reqAB = await requestCreditTransferService(
      {
        sourceStudentId: studentA.id,
        targetStudentId: studentB.id,
        amount: 200000,
        reason: "A transfers 2000 to B",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: consentAB.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: reqAB.request.id }, actorPrincipal);
    await executeCreditTransferService({ requestId: reqAB.request.id }, actorAccountant);

    // Verify after A -> B:
    // Original receipt balance: unapplied=300000, transferredOut=200000, allocated=0
    const balAfterAB = await db.paymentReceiptBalance.findUnique({ where: { receiptId: receiptA.id } });
    expect(balAfterAB?.unappliedAmount).toBe(300000);
    expect(balAfterAB?.transferredOutAmount).toBe(200000);
    expect(balAfterAB?.allocatedAmount).toBe(0);

    // Account balances: A=300000, B=200000
    const accA1 = await db.studentCreditAccount.findUnique({ where: { studentId: studentA.id } });
    const accB1 = await db.studentCreditAccount.findUnique({ where: { studentId: studentB.id } });
    expect(accA1?.balance).toBe(300000);
    expect(accB1?.balance).toBe(200000);

    // Step 3: Student B allocates ₹1,500 (150000 paise) to an invoice
    // Create FeeInvoice for Student B of ₹2,500
    const invoiceB = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: studentB.id,
        number: `INV-B-${stamp}`,
        title: "Tuition Fee Term 1",
        amount: 250000,
        paidAmount: 0,
        status: "PENDING",
        dueDate: new Date(Date.now() + 86400000),
      },
    });

    const allocResult = await allocateTransferredCreditService(
      {
        studentId: studentB.id,
        feeInvoiceId: invoiceB.id,
        amount: 150000,
      },
      actorAccountant
    );
    expect(allocResult.success).toBe(true);
    expect(allocResult.allocatedAmount).toBe(150000);
    expect(allocResult.newInvoiceStatus).toBe("PARTIAL");

    // After allocation by B:
    // Original receipt: transferredOutAmount decreased from 200000 to 50000, allocatedAmount increased to 150000
    const balAfterAlloc = await db.paymentReceiptBalance.findUnique({ where: { receiptId: receiptA.id } });
    expect(balAfterAlloc?.unappliedAmount).toBe(300000);
    expect(balAfterAlloc?.transferredOutAmount).toBe(50000);
    expect(balAfterAlloc?.allocatedAmount).toBe(150000);
    // Conservation: 300000 + 50000 + 150000 = 500000
    expect(balAfterAlloc!.unappliedAmount + balAfterAlloc!.transferredOutAmount + balAfterAlloc!.allocatedAmount).toBe(500000);

    // Account B balance: 200000 - 150000 = 50000
    const accB2 = await db.studentCreditAccount.findUnique({ where: { studentId: studentB.id } });
    expect(accB2?.balance).toBe(50000);
    expect(accB2?.allocatedIn).toBe(150000);

    // Step 4: Student B transfers remaining ₹500 (50000 paise) onward to Student C
    const consentBC = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: studentB.id,
        destinationStudentId: studentC.id,
      },
      actorAccountant
    );
    await verifyGuardianConsentService({ consentId: consentBC.id, decision: "APPROVE" }, actorAdmin);

    const reqBC = await requestCreditTransferService(
      {
        sourceStudentId: studentB.id,
        targetStudentId: studentC.id,
        amount: 50000,
        reason: "B transfers remaining 500 onward to C",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: consentBC.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: reqBC.request.id }, actorPrincipal);
    await executeCreditTransferService({ requestId: reqBC.request.id }, actorAccountant);

    // Final Verifications:
    // 1. Original Receipt Balance components:
    const finalReceiptBal = await db.paymentReceiptBalance.findUnique({ where: { receiptId: receiptA.id } });
    expect(finalReceiptBal?.unappliedAmount).toBe(300000);
    expect(finalReceiptBal?.transferredOutAmount).toBe(50000);
    expect(finalReceiptBal?.allocatedAmount).toBe(150000);
    expect(finalReceiptBal?.reservedRefundAmount).toBe(0);
    expect(finalReceiptBal?.refundedAmount).toBe(0);
    expect(
      finalReceiptBal!.unappliedAmount +
      finalReceiptBal!.transferredOutAmount +
      finalReceiptBal!.allocatedAmount +
      finalReceiptBal!.reservedRefundAmount +
      finalReceiptBal!.refundedAmount
    ).toBe(500000);

    // 2. Final Student Balances:
    const finalAccA = await db.studentCreditAccount.findUnique({ where: { studentId: studentA.id } });
    const finalAccB = await db.studentCreditAccount.findUnique({ where: { studentId: studentB.id } });
    const finalAccC = await db.studentCreditAccount.findUnique({ where: { studentId: studentC.id } });

    expect(finalAccA?.balance).toBe(300000);
    expect(finalAccB?.balance).toBe(0);
    expect(finalAccC?.balance).toBe(50000);

    // Total available customer credit across all three students = 350000 (300000 + 0 + 50000)
    expect(finalAccA!.balance + finalAccB!.balance + finalAccC!.balance).toBe(350000);

    // 3. ZERO new PaymentReceipt records created (receipt count is identical):
    const finalReceiptCount = await db.paymentReceipt.count({ where: { tenantId: tenantA.id } });
    expect(finalReceiptCount).toBe(initialReceiptCount);

    // 4. Full mathematical reconciliation on all three students:
    const reconA = await reconcileStudentCreditAccount(tenantA.id, studentA.id);
    expect(reconA.isReconciled).toBe(true);
    expect(reconA.discrepancies).toHaveLength(0);
    expect(reconA.spendableBalance).toBe(300000);

    const reconB = await reconcileStudentCreditAccount(tenantA.id, studentB.id);
    expect(reconB.isReconciled).toBe(true);
    expect(reconB.discrepancies).toHaveLength(0);
    expect(reconB.spendableBalance).toBe(0);
    expect(reconB.transfers.allocatedIn).toBe(150000);
    expect(reconB.transfers.totalTransferredOnward).toBe(50000);

    const reconC = await reconcileStudentCreditAccount(tenantA.id, studentC.id);
    expect(reconC.isReconciled).toBe(true);
    expect(reconC.discrepancies).toHaveLength(0);
    expect(reconC.spendableBalance).toBe(50000);
  });

  it("19. Execution revalidation: transfer execution rejects when consent was revoked after approval", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    const sRev1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-REV-1-${stamp}`,
        firstName: "Rev1",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });
    const sRev2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-REV-2-${stamp}`,
        firstName: "Rev2",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });
    await db.studentGuardian.create({
      data: { studentId: sRev1.id, guardianId: guardianA.id, isPrimary: true },
    });
    await db.studentGuardian.create({
      data: { studentId: sRev2.id, guardianId: guardianA.id, isPrimary: true },
    });

    await createReceiptWithBalance(30000, sRev1.id);

    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: sRev1.id,
        destinationStudentId: sRev2.id,
      },
      actorAccountant
    );
    await verifyGuardianConsentService({ consentId: consent.id, decision: "APPROVE" }, actorAdmin);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: sRev1.id,
        targetStudentId: sRev2.id,
        amount: 10000,
        reason: "Revocation at execution test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: consent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Revoke consent AFTER approval but BEFORE execution
    await revokeGuardianConsentService(
      { consentId: consent.id, reason: "Guardian requested revocation" },
      actorAdmin
    );

    // Attempt to execute transfer
    await expect(
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant)
    ).rejects.toThrow(RevokedGuardianConsentError);
  });

  it("20. Execution revalidation: transfer execution rejects when consent expires before execution", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    const sExp1 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-EXP-1-${stamp}`,
        firstName: "Exp1",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });
    const sExp2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-EXP-2-${stamp}`,
        firstName: "Exp2",
        lastName: "Sharma",
        status: "ACTIVE",
      },
    });
    await db.studentGuardian.create({
      data: { studentId: sExp1.id, guardianId: guardianA.id, isPrimary: true },
    });
    await db.studentGuardian.create({
      data: { studentId: sExp2.id, guardianId: guardianA.id, isPrimary: true },
    });

    await createReceiptWithBalance(30000, sExp1.id);

    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: sExp1.id,
        destinationStudentId: sExp2.id,
        expiresAt: new Date(Date.now() + 60000), // expires in 1 minute
      },
      actorAccountant
    );
    await verifyGuardianConsentService({ consentId: consent.id, decision: "APPROVE" }, actorAdmin);

    const req = await requestCreditTransferService(
      {
        sourceStudentId: sExp1.id,
        targetStudentId: sExp2.id,
        amount: 10000,
        reason: "Expiry at execution test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: consent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Manually backdate expiry to the past
    await db.guardianConsent.update({
      where: { id: consent.id },
      data: { expiresAt: new Date(Date.now() - 5000) },
    });

    await expect(
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant)
    ).rejects.toThrow(ExpiredGuardianConsentError);
  });

  it("21. Immutable GuardianConsentEvent audit trail tracks CREATED, VERIFIED, REVOKED and blocks mutations", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const consent = await createGuardianConsentService(
      {
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA2.id,
      },
      actorAccountant
    );

    await verifyGuardianConsentService({ consentId: consent.id, decision: "APPROVE" }, actorAdmin);

    await revokeGuardianConsentService(
      { consentId: consent.id, reason: "Audit immutability test revocation" },
      actorAdmin
    );

    // Verify all 3 events were recorded in chronological order
    const events = await db.guardianConsentEvent.findMany({
      where: { consentId: consent.id },
      orderBy: { createdAt: "asc" },
    });

    expect(events).toHaveLength(3);
    expect(events[0].action).toBe("CREATED");
    expect(events[1].action).toBe("VERIFIED");
    expect(events[2].action).toBe("REVOKED");

    // Attempt to mutate GuardianConsentEvent (blocked by database trigger)
    await expect(
      db.guardianConsentEvent.update({
        where: { id: events[0].id },
        data: { notes: "tampered note" },
      })
    ).rejects.toThrow(/GuardianConsentEvent records are immutable audit logs/);

    // Attempt to delete GuardianConsentEvent (blocked by database trigger)
    await expect(
      db.guardianConsentEvent.delete({
        where: { id: events[0].id },
      })
    ).rejects.toThrow(/GuardianConsentEvent records are immutable audit logs/);
  });
});
