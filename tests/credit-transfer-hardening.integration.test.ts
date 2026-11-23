import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  requestCreditTransferService,
  approveCreditTransferService,
  rejectCreditTransferService,
  cancelCreditTransferService,
  executeCreditTransferService,
  reconcileStudentCreditAccount,
  InvalidGuardianConsentEvidenceError,
  InvalidRequestStateTransitionError,
  UnapprovedTransferExecutionForbiddenError,
  RejectedTransferExecutionForbiddenError,
  CancelledTransferExecutionForbiddenError,
  type ActorContext,
} from "@/lib/credit-transfers";

describe("Stage 2.2.1: Credit Transfer Service Acceptance & Security Hardening Integration Tests", () => {
  let isDbAvailable = false;
  let tenantA: any;
  let tenantB: any;
  let studentA1: any; // Sibling 1
  let studentA2: any; // Sibling 2
  let studentA3: any; // Unrelated student in Tenant A
  let guardianA: any;  // Common guardian linking A1 and A2
  let accountantUser: any;
  let principalUser: any;
  let adminUser: any;
  let validConsentAssetA: any;
  let crossTenantConsentAssetB: any;
  let logoAssetA: any;
  let unrelatedStudentConsentAssetA: any;
  let expiredConsentAssetA: any;

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
        name: `Tenant Hardening A ${stamp}`,
        slug: `tenant-hrd-a-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-hrd-a-${stamp}@example.com`,
        logoInitials: "THA",
      },
    });

    tenantB = await db.tenant.create({
      data: {
        name: `Tenant Hardening B ${stamp}`,
        slug: `tenant-hrd-b-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `tenant-hrd-b-${stamp}@example.com`,
        logoInitials: "THB",
      },
    });

    accountantUser = await db.user.create({
      data: {
        email: `accountant-hrd-${stamp}@example.com`,
        name: "Adam Accountant",
        passwordHash: "hash-accountant-secret-1234",
        status: "ACTIVE",
      },
    });

    principalUser = await db.user.create({
      data: {
        email: `principal-hrd-${stamp}@example.com`,
        name: "Patricia Principal",
        passwordHash: "hash-principal-secret-1234",
        status: "ACTIVE",
      },
    });

    adminUser = await db.user.create({
      data: {
        email: `admin-hrd-${stamp}@example.com`,
        name: "Alan Admin",
        passwordHash: "hash-admin-secret-1234",
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
        admissionNo: `ADM-HRD-A1-${stamp}`,
        firstName: "Aarav",
        lastName: "Verma",
        status: "ACTIVE",
      },
    });

    studentA2 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-HRD-A2-${stamp}`,
        firstName: "Ananya",
        lastName: "Verma",
        status: "ACTIVE",
      },
    });

    studentA3 = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-HRD-A3-${stamp}`,
        firstName: "Suresh",
        lastName: "Mehta",
        status: "ACTIVE",
      },
    });

    guardianA = await db.guardian.create({
      data: {
        tenantId: tenantA.id,
        name: "Vinod Verma",
        phone: `+9198755${Math.floor(10000 + Math.random() * 90000)}`,
        relation: "Father",
      },
    });

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

    // 1. Valid verified consent form
    validConsentAssetA = await db.fileAsset.create({
      data: {
        tenantId: tenantA.id,
        kind: "DOCUMENT",
        name: "verified_sibling_consent.pdf",
        mime: "application/pdf",
        size: 4096,
        storageKey: `consents/verified_${stamp}.pdf`,
      },
    });

    await db.guardianConsent.create({
      data: {
        id: validConsentAssetA.id,
        tenantId: tenantA.id,
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA2.id,
        scope: "SIBLING_CREDIT_TRANSFER",
        fileAssetId: validConsentAssetA.id,
        status: "VERIFIED",
        verifiedById: adminUser.id,
        verifiedAt: new Date(),
        isRevoked: false,
      },
    });

    // 2. Cross-tenant consent asset (belongs to Tenant B)
    crossTenantConsentAssetB = await db.fileAsset.create({
      data: {
        tenantId: tenantB.id,
        kind: "DOCUMENT",
        name: "tenant_b_consent.pdf",
        mime: "application/pdf",
        size: 4096,
        storageKey: `consents/tenant_b_${stamp}.pdf`,
      },
    });

    // 3. Non-document asset (e.g. LOGO)
    logoAssetA = await db.fileAsset.create({
      data: {
        tenantId: tenantA.id,
        kind: "LOGO",
        name: "school_logo.png",
        mime: "image/png",
        size: 10240,
        storageKey: `logos/school_logo_${stamp}.png`,
      },
    });

    // 4. Consent document attached to unrelated third student (studentA3)
    unrelatedStudentConsentAssetA = await db.fileAsset.create({
      data: {
        tenantId: tenantA.id,
        studentId: studentA3.id,
        kind: "DOCUMENT",
        name: "unrelated_student_consent.pdf",
        mime: "application/pdf",
        size: 2048,
        storageKey: `consents/unrelated_${stamp}.pdf`,
      },
    });

    await db.guardianConsent.create({
      data: {
        id: unrelatedStudentConsentAssetA.id,
        tenantId: tenantA.id,
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA3.id,
        scope: "SIBLING_CREDIT_TRANSFER",
        fileAssetId: unrelatedStudentConsentAssetA.id,
        status: "VERIFIED",
        verifiedById: adminUser.id,
        verifiedAt: new Date(),
        isRevoked: false,
      },
    });

    // 5. Expired consent document (>180 days old)
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    expiredConsentAssetA = await db.fileAsset.create({
      data: {
        tenantId: tenantA.id,
        kind: "DOCUMENT",
        name: "expired_consent.pdf",
        mime: "application/pdf",
        size: 2048,
        storageKey: `consents/expired_${stamp}.pdf`,
        createdAt: oldDate,
      },
    });

    await db.guardianConsent.create({
      data: {
        id: expiredConsentAssetA.id,
        tenantId: tenantA.id,
        guardianId: guardianA.id,
        sourceStudentId: studentA1.id,
        destinationStudentId: studentA2.id,
        scope: "SIBLING_CREDIT_TRANSFER",
        fileAssetId: expiredConsentAssetA.id,
        status: "VERIFIED",
        verifiedById: adminUser.id,
        verifiedAt: new Date(),
        expiresAt: oldDate,
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
    } catch {
      // Best effort cleanup
    }
  });

  async function createReceiptWithBalance(amount: number, studentId: string = studentA1.id) {
    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    return db.$transaction(async (tx) => {
      const receipt = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId,
          receiptNumber: `RCPT-HRD-${stamp}`,
          amount,
          method: "BANK_TRANSFER",
          reference: `UTR-${stamp}`,
        },
      });

      const balance = await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: receipt.id,
          allocatedAmount: 0,
          transferredOutAmount: 0,
          unappliedAmount: amount,
          reservedRefundAmount: 0,
          refundedAmount: 0,
        },
      });

      await tx.studentCreditAccount.upsert({
        where: { tenantId_studentId: { tenantId: tenantA.id, studentId } },
        create: {
          tenantId: tenantA.id,
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
  // Section A: Actual Guardian Consent Reference Verification (1–6)
  // ─────────────────────────────────────────────────────────────────────────────

  it("1. Valid consent reference: existing FileAsset of kind DOCUMENT in tenant accepted", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await createReceiptWithBalance(50000);

    const result = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 10000,
        reason: "Valid consent verification test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: validConsentAssetA.id,
      },
      actorAccountant
    );

    expect(result.success).toBe(true);
    expect(result.request.status).toBe("PENDING_APPROVAL");
    expect(result.request.guardianConsentRef).toBe(validConsentAssetA.id);
  });

  it("2. Nonexistent consent reference rejected with InvalidGuardianConsentEvidenceError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 10000,
          reason: "Fabricated reference test",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: "arbitrary-fabricated-consent-string-12345",
        },
        actorAccountant
      )
    ).rejects.toThrow(InvalidGuardianConsentEvidenceError);
  });

  it("3. Cross-tenant consent reference rejected with InvalidGuardianConsentEvidenceError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 10000,
          reason: "Cross tenant consent test",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: crossTenantConsentAssetB.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(InvalidGuardianConsentEvidenceError);
  });

  it("4. Non-document consent reference (e.g. LOGO) rejected with InvalidGuardianConsentEvidenceError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 10000,
          reason: "Non document asset test",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: logoAssetA.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(InvalidGuardianConsentEvidenceError);
  });

  it("5. Consent document attached to unrelated third student rejected with InvalidGuardianConsentEvidenceError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 10000,
          reason: "Unrelated student consent test",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: unrelatedStudentConsentAssetA.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(InvalidGuardianConsentEvidenceError);
  });

  it("6. Expired consent reference (>180 days old) rejected with InvalidGuardianConsentEvidenceError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await expect(
      requestCreditTransferService(
        {
          sourceStudentId: studentA1.id,
          targetStudentId: studentA2.id,
          amount: 10000,
          reason: "Expired consent test",
          authorizedGuardianId: guardianA.id,
          guardianConsentRef: expiredConsentAssetA.id,
        },
        actorAccountant
      )
    ).rejects.toThrow(InvalidGuardianConsentEvidenceError);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Section B: Request Lifecycle Concurrency & Races (7–14)
  // ─────────────────────────────────────────────────────────────────────────────

  it("7. Concurrent approval race: two administrators approve same pending request simultaneously; exactly one succeeds, other fails", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await createReceiptWithBalance(50000);
    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 5000,
        reason: "Concurrent approval race",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: validConsentAssetA.id,
      },
      actorAccountant
    );

    // Two distinct admins attempt approval simultaneously
    const results = await Promise.allSettled([
      approveCreditTransferService({ requestId: req.request.id, notes: "Admin 1" }, actorPrincipal),
      approveCreditTransferService({ requestId: req.request.id, notes: "Admin 2" }, actorAdmin),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    // Exactly one APPROVED event created
    const events = await db.creditTransferApprovalEvent.findMany({
      where: { requestId: req.request.id, action: "APPROVED" },
    });
    expect(events.length).toBe(1);
  });

  it("8. Concurrent rejection race: two administrators reject same pending request simultaneously; exactly one succeeds, other fails", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 5000,
        reason: "Concurrent rejection race",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: validConsentAssetA.id,
      },
      actorAccountant
    );

    const results = await Promise.allSettled([
      rejectCreditTransferService({ requestId: req.request.id, reason: "Rejection 1" }, actorPrincipal),
      rejectCreditTransferService({ requestId: req.request.id, reason: "Rejection 2" }, actorAdmin),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const events = await db.creditTransferApprovalEvent.findMany({
      where: { requestId: req.request.id, action: "REJECTED" },
    });
    expect(events.length).toBe(1);
  });

  it("9. Concurrent approval/rejection race: approval and rejection race; exactly one wins, other fails", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 5000,
        reason: "Approval vs rejection race",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: validConsentAssetA.id,
      },
      actorAccountant
    );

    const results = await Promise.allSettled([
      approveCreditTransferService({ requestId: req.request.id }, actorPrincipal),
      rejectCreditTransferService({ requestId: req.request.id, reason: "Rejected" }, actorAdmin),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    // Verify request is in either APPROVED or REJECTED, never both
    const checkReq = await db.creditTransferRequest.findUnique({ where: { id: req.request.id } });
    expect(["APPROVED", "REJECTED"]).toContain(checkReq?.status);

    const events = await db.creditTransferApprovalEvent.findMany({
      where: { requestId: req.request.id, action: { in: ["APPROVED", "REJECTED"] } },
    });
    expect(events.length).toBe(1);
  });

  it("10. Approval races against cancellation: exactly one wins, other fails", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 5000,
        reason: "Approval vs cancellation race",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: validConsentAssetA.id,
      },
      actorAccountant
    );

    const results = await Promise.allSettled([
      approveCreditTransferService({ requestId: req.request.id }, actorPrincipal),
      cancelCreditTransferService({ requestId: req.request.id, reason: "Cancelling" }, actorAccountant),
    ]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const failures = results.filter((r) => r.status === "rejected");

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const checkReq = await db.creditTransferRequest.findUnique({ where: { id: req.request.id } });
    expect(["APPROVED", "CANCELLED"]).toContain(checkReq?.status);
  });

  it("11. Approval races against execution: unapproved execution rejected, approved execution succeeds", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 5000,
        reason: "Approval vs execution race",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: validConsentAssetA.id,
      },
      actorAccountant
    );

    // Attempt execute before approval -> must fail
    await expect(
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant)
    ).rejects.toThrow(UnapprovedTransferExecutionForbiddenError);

    // Now approve
    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Now execute -> succeeds
    const exec = await executeCreditTransferService({ requestId: req.request.id }, actorAccountant);
    expect(exec.success).toBe(true);
    expect(exec.request.status).toBe("EXECUTED");
  });

  it("12. Duplicate concurrent execution attempts: exactly one creates journal, second replayed safely without double-debit", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    await createReceiptWithBalance(50000);
    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 5000,
        reason: "Concurrent duplicate execution test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: validConsentAssetA.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Launch 3 simultaneous execution calls
    const [e1, e2, e3] = await Promise.all([
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant),
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant),
      executeCreditTransferService({ requestId: req.request.id }, actorAccountant),
    ]);

    expect(e1.success).toBe(true);
    expect(e2.success).toBe(true);
    expect(e3.success).toBe(true);

    // All share exact same journal ID
    expect(e1.journal?.id).toBe(e2.journal?.id);
    expect(e2.journal?.id).toBe(e3.journal?.id);

    // Exactly 1 journal in DB
    const journals = await db.creditTransferJournal.findMany({
      where: { requestId: req.request.id },
    });
    expect(journals.length).toBe(1);
  });

  it("13. Repeated approval request after successful approval rejected with InvalidRequestStateTransitionError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 5000,
        reason: "Repeated approval test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: validConsentAssetA.id,
      },
      actorAccountant
    );

    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Second approval must fail with clear domain error
    await expect(
      approveCreditTransferService({ requestId: req.request.id }, actorAdmin)
    ).rejects.toThrow(InvalidRequestStateTransitionError);
  });

  it("14. Repeated rejection request after terminal rejection rejected with InvalidRequestStateTransitionError", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const req = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 5000,
        reason: "Repeated rejection test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: validConsentAssetA.id,
      },
      actorAccountant
    );

    await rejectCreditTransferService({ requestId: req.request.id, reason: "First rejection" }, actorPrincipal);

    // Second rejection must fail
    await expect(
      rejectCreditTransferService({ requestId: req.request.id, reason: "Second rejection" }, actorAdmin)
    ).rejects.toThrow(InvalidRequestStateTransitionError);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Section C: Lock Ordering, Concurrency with Invoices, & Reconciliation (15–18)
  // ─────────────────────────────────────────────────────────────────────────────

  it("15. Request coordination lock ordering (Tier 0 -> Tier 3 -> Tier 4 -> Tier 5) prevents deadlock", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    // Sibling 1 transfers to Sibling 2, and Sibling 2 transfers to Sibling 1
    await createReceiptWithBalance(50000, studentA1.id);
    await createReceiptWithBalance(50000, studentA2.id);

    const r1 = await requestCreditTransferService(
      {
        sourceStudentId: studentA1.id,
        targetStudentId: studentA2.id,
        amount: 10000,
        reason: "Cross direction 1->2",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: validConsentAssetA.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: r1.request.id }, actorPrincipal);

    const r2 = await requestCreditTransferService(
      {
        sourceStudentId: studentA2.id,
        targetStudentId: studentA1.id,
        amount: 10000,
        reason: "Cross direction 2->1",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: validConsentAssetA.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: r2.request.id }, actorPrincipal);

    // Execute both concurrently
    const [res1, res2] = await Promise.allSettled([
      executeCreditTransferService({ requestId: r1.request.id }, actorAccountant),
      executeCreditTransferService({ requestId: r2.request.id }, actorAccountant),
    ]);

    expect(res1.status).toBe("fulfilled");
    expect(res2.status).toBe("fulfilled");
  });

  it("16. Transfer versus concurrent invoice allocation on shared receipt balance serializes cleanly without deadlock", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    const sConc = await db.student.create({
      data: {
        tenantId: tenantA.id,
        admissionNo: `ADM-CONC-${stamp}`,
        firstName: "ConcSource",
        lastName: "Verma",
        status: "ACTIVE",
      },
    });

    await db.studentGuardian.create({
      data: {
        studentId: sConc.id,
        guardianId: guardianA.id,
        isPrimary: true,
      },
    });

    const concConsent = await db.guardianConsent.create({
      data: {
        tenantId: tenantA.id,
        guardianId: guardianA.id,
        sourceStudentId: sConc.id,
        destinationStudentId: studentA2.id,
        scope: "SIBLING_CREDIT_TRANSFER",
        status: "VERIFIED",
        verifiedById: adminUser.id,
        verifiedAt: new Date(),
        isRevoked: false,
      },
    });

    // Create receipt of ₹1,000 for sConc (only receipt for sConc)
    const { receipt } = await createReceiptWithBalance(100000, sConc.id);

    // Create an invoice for sConc for ₹500
    const invoice = await db.feeInvoice.create({
      data: {
        tenantId: tenantA.id,
        studentId: sConc.id,
        number: `INV-CONC-${stamp}`,
        title: "Tuition Fee",
        amount: 50000, // ₹500
        dueDate: new Date(),
      },
    });

    // Create credit transfer request for ₹300
    const req = await requestCreditTransferService(
      {
        sourceStudentId: sConc.id,
        targetStudentId: studentA2.id,
        amount: 30000, // ₹300
        reason: "Concurrent invoice allocation test",
        authorizedGuardianId: guardianA.id,
        guardianConsentRef: concConsent.id,
      },
      actorAccountant
    );
    await approveCreditTransferService({ requestId: req.request.id }, actorPrincipal);

    // Run credit transfer execution and simulated invoice allocation concurrently against the same receipt
    const transferPromise = executeCreditTransferService({ requestId: req.request.id }, actorAccountant);

    const allocationPromise = db.$transaction(
      async (tx) => {
        // Tier 1: Lock invoice
        await tx.$queryRaw`SELECT id FROM "FeeInvoice" WHERE id = ${invoice.id} FOR UPDATE`;

        // Tier 3: Lock receipt balance in receiptId order
        const [bal] = await tx.$queryRaw<any[]>`
          SELECT "receiptId", "unappliedAmount", "allocatedAmount", "transferredOutAmount"
          FROM "PaymentReceiptBalance"
          WHERE "receiptId" = ${receipt.id}
          FOR UPDATE
        `;

        // Allocate ₹400
        const allocAmount = 40000;
        await tx.paymentReceiptBalance.update({
          where: { receiptId: receipt.id },
          data: {
            unappliedAmount: bal.unappliedAmount - allocAmount,
            allocatedAmount: bal.allocatedAmount + allocAmount,
          },
        });

        // Insert Tier 4 PaymentAllocation
        await tx.paymentAllocation.create({
          data: {
            tenantId: tenantA.id,
            studentId: sConc.id,
            receiptId: receipt.id,
            feeInvoiceId: invoice.id,
            amount: allocAmount,
          },
        });

        // Tier 5: Update StudentCreditAccount projection
        await tx.studentCreditAccount.update({
          where: { tenantId_studentId: { tenantId: tenantA.id, studentId: sConc.id } },
          data: {
            balance: { decrement: allocAmount },
          },
        });

        return { allocated: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    const [tRes, aRes] = await Promise.allSettled([transferPromise, allocationPromise]);

    expect(tRes.status).toBe("fulfilled");
    expect(aRes.status).toBe("fulfilled");

    // Both succeeded; total drawn = 300 + 400 = 700; unapplied = 300
    const finalBal = await db.paymentReceiptBalance.findUnique({ where: { receiptId: receipt.id } });
    expect(finalBal?.unappliedAmount).toBe(30000);
    expect(finalBal?.transferredOutAmount).toBe(30000);
    expect(finalBal?.allocatedAmount).toBe(40000);
  });

  it("17. Student credit account reconciliation equation holds: balance = unapplied + (transferredIn - allocatedIn)", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const accounts = await db.studentCreditAccount.findMany({
      where: { tenantId: tenantA.id },
    });

    for (const acc of accounts) {
      const recon = await reconcileStudentCreditAccount(tenantA.id, acc.studentId);
      expect(recon.isReconciled).toBe(true);
      expect(recon.discrepancies).toHaveLength(0);
      expect(acc.balance).toBe(recon.expectedSpendableBalance);
      expect(acc.balance).toBeGreaterThanOrEqual(0);
      expect(acc.transferredIn).toBeGreaterThanOrEqual(0);
      expect(acc.transferredOut).toBeGreaterThanOrEqual(0);
    }
  });

  it("18. Receipt conservation trigger fn_enforce_receipt_balance_conservation enforces reservedRefundAmount component", async (ctx) => {
    if (!isDbAvailable) return ctx.skip();

    const stamp = Date.now() + Math.floor(Math.random() * 1000000);
    const gross = 50000; // ₹500

    // 1. Create receipt and balance with reservedRefundAmount = 20000, unapplied = 30000 (Sum = 50000 = gross)
    const { receipt } = await db.$transaction(async (tx) => {
      const r = await tx.paymentReceipt.create({
        data: {
          tenantId: tenantA.id,
          studentId: studentA1.id,
          receiptNumber: `RCPT-RES-${stamp}`,
          amount: gross,
          method: "BANK_TRANSFER",
          reference: `UTR-RES-${stamp}`,
        },
      });

      const b = await tx.paymentReceiptBalance.create({
        data: {
          tenantId: tenantA.id,
          receiptId: r.id,
          allocatedAmount: 0,
          transferredOutAmount: 0,
          unappliedAmount: 30000,
          reservedRefundAmount: 20000, // Explicit reserved refund
          refundedAmount: 0,
        },
      });

      return { receipt: r, balance: b };
    });

    // Verify it succeeded and conservation holds
    const bal = await db.paymentReceiptBalance.findUnique({ where: { receiptId: receipt.id } });
    expect(bal?.reservedRefundAmount).toBe(20000);
    expect(bal?.unappliedAmount).toBe(30000);
    expect(
      bal!.allocatedAmount +
      bal!.transferredOutAmount +
      bal!.unappliedAmount +
      bal!.reservedRefundAmount +
      bal!.refundedAmount
    ).toBe(gross);

    // 2. Now attempt to violate conservation by tampering reservedRefundAmount without adjusting other components
    await expect(
      db.paymentReceiptBalance.update({
        where: { receiptId: receipt.id },
        data: {
          reservedRefundAmount: 10000, // Sum becomes 40000 != 50000 gross
        },
      })
    ).rejects.toThrow(/Conservation violation/);
  });
});
