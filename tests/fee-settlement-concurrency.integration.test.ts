import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

// Mock Next.js navigation, headers, cache
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Map()),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock RBAC to authorize tenant writes
vi.mock("@/lib/rbac", () => ({
  authorizeTenantWrite: vi.fn(),
}));

// Mock notifications to prevent external delivery side-effects
vi.mock("@/lib/notifications", () => ({
  sendNotification: vi.fn(async () => ({})),
  paymentReceiptMessage: vi.fn(() => ({ subject: "Test Subject", body: "Test Body" })),
  appUrl: vi.fn((path) => `http://localhost:3000${path}`),
}));

import { db } from "@/lib/db";
import { PrismaClient } from "@prisma/client";
import { authorizeTenantWrite } from "@/lib/rbac";
import {
  recordFeePaymentAction,
  submitPaymentProofAction,
  verifyFeePaymentLinkAction,
  waiveFeeInvoiceAction,
} from "@/actions/operations";
import { getOrCreateFeePaymentLink, settleFeePaymentLink } from "@/lib/payments";
import * as payments from "@/lib/payments";

describe("GAP-FIN-01: Financial Settlement Concurrency Regression Suite", () => {
  let testTenant: any;
  let testUser: any;
  let testStudent: any;
  let secondaryClient: PrismaClient;

  beforeAll(async () => {
    const stamp = Date.now();
    secondaryClient = new PrismaClient();

    // 1. Create isolated test tenant
    testTenant = await db.tenant.create({
      data: {
        name: `Concurrency Regression School ${stamp}`,
        slug: `concurrency-regression-${stamp}`,
        type: "SCHOOL",
        status: "ACTIVE",
        email: `regression-${stamp}@example.com`,
        country: "IN",
        timezone: "Asia/Kolkata",
        currency: "INR",
        logoInitials: "CR",
        accentColor: "#4f46e5",
      },
    });

    // 2. Create test user (cashier/accountant)
    testUser = await db.user.create({
      data: {
        name: "Test Accountant",
        email: `accountant-${stamp}@example.com`,
        passwordHash: "test_hash_regression",
      },
    });

    // 3. Create test student
    testStudent = await db.student.create({
      data: {
        tenantId: testTenant.id,
        admissionNo: `ADM-REG-${stamp}`,
        firstName: "Aarav",
        lastName: "Sharma",
        status: "ACTIVE",
        admissionDate: new Date(),
      },
    });

    // 4. Configure RBAC mock
    (authorizeTenantWrite as any).mockImplementation(async () => ({
      ok: true,
      ctx: {
        tenant: testTenant,
        user: testUser,
      },
    }));
  });

  afterAll(async () => {
    if (secondaryClient) {
      await secondaryClient.$disconnect();
    }
    // Cascade delete tenant and all related records
    if (testTenant?.id) {
      await db.tenant.delete({ where: { id: testTenant.id } }).catch(() => {});
    }
    if (testUser?.id) {
      await db.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
    await db.$disconnect();
  });

  /** Helper to generate a fresh invoice with an active payment link */
  async function createFixture(amount = 1000000) {
    const stamp = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const invoice = await db.feeInvoice.create({
      data: {
        tenantId: testTenant.id,
        studentId: testStudent.id,
        number: `INV-${stamp}`,
        title: "Tuition Fee ₹10,000",
        amount, // 1000000 paise = ₹10,000
        paidAmount: 0,
        currency: "INR",
        status: "PENDING",
        dueDate: new Date(Date.now() + 30 * 86400000),
      },
    });

    const link = await db.feePaymentLink.create({
      data: {
        tenantId: testTenant.id,
        feeInvoiceId: invoice.id,
        token: randomUUID(),
        amount,
        status: "OPEN",
        provider: "manual",
        expiresAt: new Date(Date.now() + 7 * 86400000),
        utrReference: `UTR${stamp}`,
        payerName: "Parent Aarav",
        payerPhone: "9876543210",
        submittedAt: new Date(),
      },
    });

    return { invoice, link };
  }

  // =========================================================================
  // CASE D: Normal Sequential Cash Settlement
  // =========================================================================
  it("Case D: Normal sequential cash payment completes with exact ledger reconciliation", async () => {
    const { invoice } = await createFixture(1000000);

    const formData = new FormData();
    formData.append("invoiceId", invoice.id);
    formData.append("amount", "10000"); // ₹10,000
    formData.append("method", "CASH");
    formData.append("reference", "CASH-SEQ-01");

    const res = await recordFeePaymentAction({} as any, formData);
    expect(res.error).toBeUndefined();
    expect(res.success).toContain("recorded");

    // Verify DB state
    const updatedInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updatedInvoice.paidAmount).toBe(1000000);
    expect(updatedInvoice.status).toBe("PAID");

    const payments = await db.feePayment.findMany({ where: { feeInvoiceId: invoice.id } });
    expect(payments.length).toBe(1);
    expect(payments[0].amount).toBe(1000000);
    expect(payments[0].method).toBe("CASH");

    // Invariant: paidAmount === SUM(FeePayment.amount) === amount
    expect(updatedInvoice.paidAmount).toBe(payments[0].amount);
    expect(updatedInvoice.paidAmount).toBe(updatedInvoice.amount);
  });

  // =========================================================================
  // CASE E: Normal Sequential Manual Payment-Link Settlement
  // =========================================================================
  it("Case E: Normal sequential manual payment-link verification completes with exact ledger reconciliation", async () => {
    const { invoice, link } = await createFixture(1000000);

    const formData = new FormData();
    formData.append("linkId", link.id);

    await verifyFeePaymentLinkAction(formData);

    // Verify DB state
    const updatedInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updatedInvoice.paidAmount).toBe(1000000);
    expect(updatedInvoice.status).toBe("PAID");

    const updatedLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.status).toBe("PAID");

    const payments = await db.feePayment.findMany({ where: { feeInvoiceId: invoice.id } });
    expect(payments.length).toBe(1);
    expect(payments[0].amount).toBe(1000000);
    expect(payments[0].provider).toBe("manual");

    // Invariant: paidAmount === SUM(FeePayment.amount) === amount
    expect(updatedInvoice.paidAmount).toBe(payments[0].amount);
  });

  // =========================================================================
  // CASE F: Second Payment Attempt After Invoice Is Fully Paid
  // =========================================================================
  it("Case F: Second payment attempt after invoice is fully paid is rejected safely", async () => {
    const { invoice, link } = await createFixture(1000000);

    // Initial settlement via cash
    const cashFormData = new FormData();
    cashFormData.append("invoiceId", invoice.id);
    cashFormData.append("amount", "10000");
    cashFormData.append("method", "CASH");
    cashFormData.append("reference", "CASH-FIRST");

    const firstRes = await recordFeePaymentAction({} as any, cashFormData);
    expect(firstRes.error).toBeUndefined();

    // 1. Second cash payment attempt must be rejected with error
    const retryCashRes = await recordFeePaymentAction({} as any, cashFormData);
    expect(retryCashRes.error).toBe("This invoice is already fully paid.");

    // 2. Second manual link settlement attempt must NOT create a payment
    const linkFormData = new FormData();
    linkFormData.append("linkId", link.id);
    await verifyFeePaymentLinkAction(linkFormData);

    // 3. Direct settleFeePaymentLink call must also return without creating a payment
    await settleFeePaymentLink({
      provider: "manual",
      referenceId: link.id,
      amountPaid: 1000000,
    });

    // Invariant checks
    const finalInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const payments = await db.feePayment.findMany({ where: { feeInvoiceId: invoice.id } });
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    expect(payments.length).toBe(1);
    expect(finalInvoice.paidAmount).toBe(1000000);
    expect(totalPaid).toBe(1000000);
    expect(totalPaid).toBe(finalInvoice.paidAmount);
  });

  // =========================================================================
  // CASE A: Cash Payment Racing With Manual Payment-Link Verification
  // =========================================================================
  it("Case A (Fixed GAP-FIN-01): Cash payment racing with manual payment-link verification maintains exact ledger invariants", async () => {
    const { invoice, link } = await createFixture(1000000); // ₹10,000

    const cashFormData = new FormData();
    cashFormData.append("invoiceId", invoice.id);
    cashFormData.append("amount", "10000"); // ₹10,000
    cashFormData.append("method", "CASH");
    cashFormData.append("reference", "CASH-RACE-01");

    const linkFormData = new FormData();
    linkFormData.append("linkId", link.id);

    // Execute concurrently across independent database requests
    const [cashRes] = await Promise.all([
      recordFeePaymentAction({} as any, cashFormData),
      verifyFeePaymentLinkAction(linkFormData),
    ]);

    // Inspect database after both operations complete
    const finalInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const finalLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link.id } });
    const payments = await db.feePayment.findMany({
      where: { feeInvoiceId: invoice.id },
      orderBy: { paidAt: "asc" },
    });
    const totalPaidInLedger = payments.reduce((sum, p) => sum + p.amount, 0);

    console.log("\n========================================================");
    console.log("=== CASE A: CONCURRENT CASH VS LINK SETTLEMENT RESULT ===");
    console.log("========================================================");
    console.log(`Invoice Amount:             ₹${invoice.amount / 100}`);
    console.log(`Final Invoice paidAmount:   ₹${finalInvoice.paidAmount / 100}`);
    console.log(`Final Invoice Status:       ${finalInvoice.status}`);
    console.log(`Payment Link Status:        ${finalLink.status}`);
    console.log(`FeePayment Records Count:   ${payments.length}`);
    console.log(`Total Collected in Ledger:  ₹${totalPaidInLedger / 100}`);
    payments.forEach((p, idx) => {
      console.log(`  [${idx + 1}] ID: ${p.id} | Method: ${p.method} | Amount: ₹${p.amount / 100} | Provider: ${p.provider ?? "cashier"}`);
    });
    console.log("========================================================\n");

    // CORE FINANCIAL INVARIANTS:
    // 1. FeeInvoice.paidAmount must never exceed FeeInvoice.amount
    expect(finalInvoice.paidAmount).toBeLessThanOrEqual(finalInvoice.amount);
    expect(finalInvoice.paidAmount).toBe(1000000); // Exactly ₹10,000

    // 2. The successful settlement ledger must not exceed the invoice's outstanding amount
    expect(totalPaidInLedger).toBe(1000000); // Exactly ₹10,000, NEVER ₹20,000!

    // 3. Exactly ONE payment record created (no double collection!)
    expect(payments.length).toBe(1);

    // 4. Exact Ledger Synchronization: FeeInvoice.paidAmount === SUM(FeePayment.amount)
    expect(finalInvoice.paidAmount).toBe(totalPaidInLedger);

    // 5. Invoice status must be PAID
    expect(finalInvoice.status).toBe("PAID");

    // 6. Payment link status is marked PAID or CANCELED (not left actionable)
    expect(["PAID", "CANCELED"]).toContain(finalLink.status);
  });

  // =========================================================================
  // CASE B: Two Concurrent Attempts to Settle the Same Payment Link
  // =========================================================================
  it("Case B: Two concurrent attempts to settle the same payment link produce exactly one ledger entry", async () => {
    const { invoice, link } = await createFixture(1000000);

    // Concurrently invoke settleFeePaymentLink for the exact same link
    await Promise.all([
      settleFeePaymentLink({
        provider: "manual",
        referenceId: link.id,
        amountPaid: link.amount,
      }),
      settleFeePaymentLink({
        provider: "manual",
        referenceId: link.id,
        amountPaid: link.amount,
      }),
    ]);

    const finalInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const finalLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link.id } });
    const payments = await db.feePayment.findMany({ where: { feeInvoiceId: invoice.id } });
    const totalPaidInLedger = payments.reduce((sum, p) => sum + p.amount, 0);

    // FINANCIAL INVARIANTS:
    // 1. Exactly one payment record created for this link
    expect(payments.length).toBe(1);
    expect(totalPaidInLedger).toBe(1000000);

    // 2. Link is marked PAID
    expect(finalLink.status).toBe("PAID");

    // 3. Ledger synchronization
    expect(finalInvoice.paidAmount).toBe(1000000);
    expect(finalInvoice.paidAmount).toBe(totalPaidInLedger);
  });

  // =========================================================================
  // CASE C: Two Different Payment Links Racing for the Same Invoice Balance
  // =========================================================================
  it("Case C: Two different payment links racing for the same outstanding balance do not over-collect", async () => {
    const { invoice, link: link1 } = await createFixture(1000000);

    // Create a second active payment link for the same ₹10,000 invoice
    const link2 = await db.feePaymentLink.create({
      data: {
        tenantId: testTenant.id,
        feeInvoiceId: invoice.id,
        token: randomUUID(),
        amount: 1000000,
        status: "OPEN",
        provider: "manual",
        expiresAt: new Date(Date.now() + 7 * 86400000),
        utrReference: `UTR-SECOND-${Date.now()}`,
        payerName: "Parent Aarav (Secondary)",
        submittedAt: new Date(),
      },
    });

    const link1FormData = new FormData();
    link1FormData.append("linkId", link1.id);

    // Concurrently settle link 1 and link 2
    await Promise.all([
      verifyFeePaymentLinkAction(link1FormData),
      settleFeePaymentLink({
        provider: "manual",
        referenceId: link2.id,
        amountPaid: link2.amount,
      }),
    ]);

    const finalInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const finalLink1 = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link1.id } });
    const finalLink2 = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link2.id } });
    const payments = await db.feePayment.findMany({ where: { feeInvoiceId: invoice.id } });
    const totalPaidInLedger = payments.reduce((sum, p) => sum + p.amount, 0);

    // FINANCIAL INVARIANTS:
    // 1. Exactly one payment row created (the winner)
    expect(payments.length).toBe(1);
    expect(totalPaidInLedger).toBe(1000000);

    // 2. Invoice paidAmount strictly matches total collected
    expect(finalInvoice.paidAmount).toBe(1000000);
    expect(finalInvoice.paidAmount).toBe(totalPaidInLedger);
    expect(finalInvoice.status).toBe("PAID");

    // 3. The competing link is neutralized (marked PAID or CANCELED)
    expect(["PAID", "CANCELED"]).toContain(finalLink1.status);
    expect(["PAID", "CANCELED"]).toContain(finalLink2.status);
  });

  // =========================================================================
  // ADDITIONAL: Stale Payment Links Invalidation on Cash Settlement & Waiver
  // =========================================================================
  it("Stale links protection: Full cash settlement and invoice waiver cancel open payment links", async () => {
    // 1. Full cash settlement cancels open links
    const fixture1 = await createFixture(1000000);
    const cashForm = new FormData();
    cashForm.append("invoiceId", fixture1.invoice.id);
    cashForm.append("amount", "10000");
    cashForm.append("method", "CASH");
    cashForm.append("reference", "CASH-STALE-01");
    const cashRes = await recordFeePaymentAction({} as any, cashForm);
    expect(cashRes.error).toBeUndefined();

    const linkAfterCash = await db.feePaymentLink.findUniqueOrThrow({ where: { id: fixture1.link.id } });
    expect(linkAfterCash.status).toBe("CANCELED");

    // 2. Invoice waiver cancels open links
    const fixture2 = await createFixture(1000000);
    const waiveForm = new FormData();
    waiveForm.append("invoiceId", fixture2.invoice.id);
    await waiveFeeInvoiceAction(waiveForm);

    const invoiceAfterWaive = await db.feeInvoice.findUniqueOrThrow({ where: { id: fixture2.invoice.id } });
    expect(invoiceAfterWaive.status).toBe("WAIVED");

    const linkAfterWaive = await db.feePaymentLink.findUniqueOrThrow({ where: { id: fixture2.link.id } });
    expect(linkAfterWaive.status).toBe("CANCELED");
  });

  // =========================================================================
  // ADDITIONAL: PostgreSQL CHECK Constraint Verification
  // =========================================================================
  it("Database-Level CHECK Constraint: PostgreSQL rejects direct invalid write exceeding invoice amount", async () => {
    const { invoice } = await createFixture(1000000);

    // Attempt direct SQL update violating the CHECK constraint: paidAmount (2000000) > amount (1000000)
    let caughtError: any = null;
    try {
      await db.$executeRaw`
        UPDATE "FeeInvoice"
        SET "paidAmount" = 2000000
        WHERE id = ${invoice.id}
      `;
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    // PostgreSQL error code 23514 is check_violation
    expect(String(caughtError)).toContain("fee_invoice_paid_amount_check");
  });

  // =========================================================================
  // TASK 4: GAP-SEC-02 Payment-Link Lifecycle and Settlement Validation
  // =========================================================================

  // 1. Public proof submission after expiry (rejected)
  it("Lifecycle 1: Public proof submission after expiry is rejected and marks link EXPIRED", async () => {
    const { link } = await createFixture(1000000);
    // Set link as expired 2 hours ago with no submission
    await db.feePaymentLink.update({
      where: { id: link.id },
      data: {
        expiresAt: new Date(Date.now() - 2 * 3600 * 1000),
        submittedAt: null,
        utrReference: null,
      },
    });

    const formData = new FormData();
    formData.append("token", link.token);
    formData.append("utrReference", "UTR-EXPIRED-SUBMISSION");
    formData.append("payerName", "Late Payer");

    const res = await submitPaymentProofAction({} as any, formData);
    expect(res.error).toBeDefined();
    expect(res.error).toContain("expired");

    const updatedLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.status).toBe("EXPIRED");
    expect(updatedLink.submittedAt).toBeNull();
  });

  // 2. Manual verification of an expired link (rejected)
  it("Lifecycle 2: Manual verification of an expired link without timely proof is rejected", async () => {
    const { invoice, link } = await createFixture(1000000);
    // Link expired 2 hours ago, unsubmitted
    await db.feePaymentLink.update({
      where: { id: link.id },
      data: {
        expiresAt: new Date(Date.now() - 2 * 3600 * 1000),
        submittedAt: null,
        utrReference: null,
      },
    });

    const formData = new FormData();
    formData.append("linkId", link.id);

    await verifyFeePaymentLinkAction(formData);

    const updatedLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.status).toBe("EXPIRED");

    const updatedInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updatedInvoice.paidAmount).toBe(0);
    expect(updatedInvoice.status).toBe("PENDING");

    const payments = await db.feePayment.findMany({ where: { feeInvoiceId: invoice.id } });
    expect(payments.length).toBe(0);
  });

  // 3. Proof submitted before expiry and reviewed afterward (succeeds)
  it("Lifecycle 3: Proof submitted before expiry and reviewed afterward succeeds", async () => {
    const { invoice, link } = await createFixture(1000000);
    const pastExpiry = new Date(Date.now() - 2 * 3600 * 1000); // 2 hours ago
    const timelySubmission = new Date(pastExpiry.getTime() - 15 * 60 * 1000); // 15 mins before expiry

    await db.feePaymentLink.update({
      where: { id: link.id },
      data: {
        expiresAt: pastExpiry,
        submittedAt: timelySubmission,
        utrReference: "UTR-TIMELY-BEFORE-EXPIRY",
        payerName: "Timely Payer",
      },
    });

    const formData = new FormData();
    formData.append("linkId", link.id);

    await verifyFeePaymentLinkAction(formData);

    const updatedLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.status).toBe("PAID");

    const updatedInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updatedInvoice.paidAmount).toBe(1000000);
    expect(updatedInvoice.status).toBe("PAID");

    const payments = await db.feePayment.findMany({ where: { feeInvoiceId: invoice.id } });
    expect(payments.length).toBe(1);
    expect(payments[0].amount).toBe(1000000);
  });

  // 4. Canceled link submission (rejected)
  it("Lifecycle 4: Public proof submission on a canceled link is rejected", async () => {
    const { link } = await createFixture(1000000);
    await db.feePaymentLink.update({
      where: { id: link.id },
      data: { status: "CANCELED", utrReference: null },
    });

    const formData = new FormData();
    formData.append("token", link.token);
    formData.append("utrReference", "UTR-CANCELED-LINK");
    formData.append("payerName", "Canceled Payer");

    const res = await submitPaymentProofAction({} as any, formData);
    expect(res.error).toBe("This payment link has been canceled.");

    const updatedLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.status).toBe("CANCELED");
    expect(updatedLink.utrReference).toBeNull();
  });

  // 5. Fully paid invoice link generation (rejected)
  it("Lifecycle 5: Link generation on a fully paid invoice is rejected", async () => {
    const { invoice } = await createFixture(1000000);
    // Settle invoice via cash
    const cashForm = new FormData();
    cashForm.append("invoiceId", invoice.id);
    cashForm.append("amount", "10000");
    cashForm.append("method", "CASH");
    cashForm.append("reference", "CASH-FULL-PAID");
    await recordFeePaymentAction({} as any, cashForm);

    await expect(getOrCreateFeePaymentLink(invoice.id, testTenant.id)).rejects.toThrow(
      "Invoice is already fully paid"
    );
  });

  // 6. Waived invoice link generation through direct service invocation (rejected)
  it("Lifecycle 6: Link generation on a waived invoice is rejected", async () => {
    const { invoice } = await createFixture(1000000);
    const waiveForm = new FormData();
    waiveForm.append("invoiceId", invoice.id);
    await waiveFeeInvoiceAction(waiveForm);

    await expect(getOrCreateFeePaymentLink(invoice.id, testTenant.id)).rejects.toThrow(
      "Invoice has been waived"
    );
  });

  // 7. Link creation racing with full cash payment (handled safely)
  it("Lifecycle 7: Link creation racing with full cash payment is serialized and safe", async () => {
    const { invoice } = await createFixture(1000000);

    const cashForm = new FormData();
    cashForm.append("invoiceId", invoice.id);
    cashForm.append("amount", "10000");
    cashForm.append("method", "CASH");
    cashForm.append("reference", "CASH-RACE-01");

    // Concurrently trigger cash payment and link creation
    const [cashResult, linkResult] = await Promise.allSettled([
      recordFeePaymentAction({} as any, cashForm),
      getOrCreateFeePaymentLink(invoice.id, testTenant.id),
    ]);

    expect(cashResult.status).toBe("fulfilled");

    // Invariant: Invoice MUST be fully paid
    const updatedInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updatedInvoice.paidAmount).toBe(1000000);
    expect(updatedInvoice.status).toBe("PAID");

    // Invariant: ZERO open payment links remain for this settled invoice
    const openLinks = await db.feePaymentLink.findMany({
      where: { feeInvoiceId: invoice.id, status: "OPEN" },
    });
    expect(openLinks.length).toBe(0);
  });

  // =========================================================================
  // TASK 5: Overpayment Reconciliation & External Checkout Race Audit
  // =========================================================================

  // A. ₹10,000 received against ₹8,000 outstanding (Overpayment accounting)
  it("Task 5 - Case A: ₹10,000 received against ₹8,000 outstanding records full funds and unapplied credit", async () => {
    // Invoice ₹10,000, with initial ₹2,000 paid (outstanding ₹8,000)
    const { invoice } = await createFixture(1000000);

    // Initial ₹2,000 cash payment leaves ₹8,000 outstanding
    const partialCash = new FormData();
    partialCash.append("invoiceId", invoice.id);
    partialCash.append("amount", "2000");
    partialCash.append("method", "CASH");
    partialCash.append("reference", "CASH-INIT-2K");
    await recordFeePaymentAction({} as any, partialCash);

    const invoiceBefore = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(invoiceBefore.paidAmount).toBe(200000);
    const outstanding = invoiceBefore.amount - invoiceBefore.paidAmount;
    expect(outstanding).toBe(800000); // ₹8,000

    // Generate active link for ₹8,000 balance
    const { link: activeLink } = await getOrCreateFeePaymentLink(invoice.id, testTenant.id);
    expect(activeLink.amount).toBe(800000);

    // Parent transfers ₹10,000 (1,000,000 paise)
    const settledLink = await settleFeePaymentLink({
      provider: "manual",
      referenceId: activeLink.id,
      amountPaid: 1000000,
    });
    expect(settledLink).not.toBeNull();
    expect(settledLink?.status).toBe("PAID");

    // 1. Inspect Persisted Invoice:
    // paidAmount is capped at invoice.amount (₹10,000) to satisfy DB CHECK constraint
    const finalInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(finalInvoice.paidAmount).toBe(1000000);
    expect(finalInvoice.status).toBe("PAID");
    expect(finalInvoice.notes).toContain("[OVERPAYMENT]");
    expect(finalInvoice.notes).toContain("2000.00");

    // 2. Inspect Payment Ledger:
    // The payment record has the FULL ₹10,000 received (never silently truncated!)
    const payments = await db.feePayment.findMany({
      where: { feeInvoiceId: invoice.id },
      orderBy: { paidAt: "asc" },
    });
    expect(payments.length).toBe(2);
    expect(payments[0].amount).toBe(200000); // initial cash
    expect(payments[1].amount).toBe(1000000); // ₹10,000 full received amount
    const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
    expect(totalCollected).toBe(1200000); // ₹12,000 total funds received

    // 3. Inspect Payment-link status:
    const finalLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: activeLink.id } });
    expect(finalLink.status).toBe("PAID");
    expect(finalLink.payerNotes).toContain("[OVERPAYMENT]");

    // 4. Inspect Reconciliation Records:
    // AuditLog records unapplied credit / refund obligation
    const audit = await db.auditLog.findFirst({
      where: {
        action: "fee.payment.overpayment_recorded",
        entityId: invoice.id,
      },
    });
    expect(audit).not.toBeNull();
    const meta = audit?.meta as any;
    expect(meta.totalReceived).toBe(1000000);
    expect(meta.appliedToInvoice).toBe(800000);
    expect(meta.overpaymentAmount).toBe(200000);
    expect(meta.reconciliationStatus).toBe("UNAPPLIED_CREDIT_REFUND_DUE");
  });

  // B. Exact payment matching the outstanding balance
  it("Task 5 - Case B: Exact payment matching the outstanding balance completes cleanly", async () => {
    const { invoice } = await createFixture(800000); // ₹8,000 invoice
    const { link } = await getOrCreateFeePaymentLink(invoice.id, testTenant.id);
    expect(link.amount).toBe(800000);

    const settled = await settleFeePaymentLink({
      provider: "manual",
      referenceId: link.id,
      amountPaid: 800000,
    });
    expect(settled).not.toBeNull();
    expect(settled?.status).toBe("PAID");

    // 1. Persisted Invoice
    const finalInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(finalInvoice.paidAmount).toBe(800000);
    expect(finalInvoice.status).toBe("PAID");

    // 2. Payment Ledger
    const payments = await db.feePayment.findMany({ where: { feeInvoiceId: invoice.id } });
    expect(payments.length).toBe(1);
    expect(payments[0].amount).toBe(800000);

    // 3. Payment link
    const finalLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(finalLink.status).toBe("PAID");

    // 4. Reconciliation: No overpayment audit log
    const overpayAudit = await db.auditLog.findFirst({
      where: { action: "fee.payment.overpayment_recorded", entityId: invoice.id },
    });
    expect(overpayAudit).toBeNull();
  });

  // C. Normal partial payment
  it("Task 5 - Case C: Normal partial payment records exact partial credit without overpayment flag", async () => {
    const { invoice } = await createFixture(800000); // ₹8,000 invoice
    const { link } = await getOrCreateFeePaymentLink(invoice.id, testTenant.id);

    const settled = await settleFeePaymentLink({
      provider: "manual",
      referenceId: link.id,
      amountPaid: 400000, // ₹4,000 partial
    });
    expect(settled).not.toBeNull();
    expect(settled?.status).toBe("PAID");

    // 1. Persisted Invoice
    const finalInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(finalInvoice.paidAmount).toBe(400000);
    expect(finalInvoice.status).toBe("PARTIAL");
    expect(finalInvoice.amount - finalInvoice.paidAmount).toBe(400000);

    // 2. Payment Ledger
    const payments = await db.feePayment.findMany({ where: { feeInvoiceId: invoice.id } });
    expect(payments.length).toBe(1);
    expect(payments[0].amount).toBe(400000);

    // 3. Payment link
    const finalLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(finalLink.status).toBe("PAID");

    // 4. Reconciliation: No overpayment audit log
    const overpayAudit = await db.auditLog.findFirst({
      where: { action: "fee.payment.overpayment_recorded", entityId: invoice.id },
    });
    expect(overpayAudit).toBeNull();
  });

  // D. Payment-link creation racing with full cashier settlement
  it("Task 5 - Case D: Payment-link creation racing with full cashier settlement triggers provider cancellation and audit", async () => {
    const { invoice } = await createFixture(1000000);

    // Invalidate pre-existing fixture link so getOrCreateFeePaymentLink generates a fresh link
    await db.feePaymentLink.updateMany({
      where: { feeInvoiceId: invoice.id },
      data: { status: "CANCELED" },
    });

    const prevProvider = process.env.PAYMENT_PROVIDER;
    const prevKey = process.env.RAZORPAY_KEY_ID;
    const prevSecret = process.env.RAZORPAY_KEY_SECRET;

    process.env.PAYMENT_PROVIDER = "razorpay";
    process.env.RAZORPAY_KEY_ID = "rzp_test_123";
    process.env.RAZORPAY_KEY_SECRET = "secret_123";

    // Intercept provider HTTP fetch to simulate network delay & concurrent cashier settlement
    let cancelCalled = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/v1/payment_links/plink_race_test_123/cancel")) {
        cancelCalled = true;
        return new Response(JSON.stringify({ id: "plink_race_test_123", status: "cancelled" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/v1/payment_links")) {
        // While external checkout creation is in flight, cashier fully settles invoice
        const cashForm = new FormData();
        cashForm.append("invoiceId", invoice.id);
        cashForm.append("amount", "10000");
        cashForm.append("method", "CASH");
        cashForm.append("reference", "CASH-DURING-CHECKOUT-RACE");
        const cashRes = await recordFeePaymentAction({} as any, cashForm);
        expect(cashRes.error).toBeUndefined();

        return new Response(
          JSON.stringify({ id: "plink_race_test_123", short_url: "https://rzp.io/i/test_race_123" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      return new Response("{}", { status: 200 });
    });

    try {
      await expect(getOrCreateFeePaymentLink(invoice.id, testTenant.id)).rejects.toThrow(
        "Invoice was settled while payment link was being created"
      );

      // Verify cancellation was invoked
      expect(cancelCalled).toBe(true);

      // Verify persisted link state
      const links = await db.feePaymentLink.findMany({ where: { feeInvoiceId: invoice.id } });
      expect(links.length).toBeGreaterThan(0);
      const raceLink = links.find((l) => l.providerRef === "plink_race_test_123");
      expect(raceLink).toBeDefined();
      expect(raceLink?.status).toBe("CANCELED");

      // Verify audit log
      const audit = await db.auditLog.findFirst({
        where: {
          action: "fee.payment_link.checkout_canceled_race",
          entityId: raceLink?.id,
        },
      });
      expect(audit).not.toBeNull();
      expect((audit?.meta as any)?.providerRef).toBe("plink_race_test_123");

      // Verify invoice is fully paid and has ZERO open payment links
      const finalInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(finalInvoice.paidAmount).toBe(1000000);
      expect(finalInvoice.status).toBe("PAID");

      const openLinks = await db.feePaymentLink.findMany({
        where: { feeInvoiceId: invoice.id, status: "OPEN" },
      });
      expect(openLinks.length).toBe(0);
    } finally {
      fetchSpy.mockRestore();
      if (prevProvider !== undefined) process.env.PAYMENT_PROVIDER = prevProvider;
      else delete process.env.PAYMENT_PROVIDER;
      if (prevKey !== undefined) process.env.RAZORPAY_KEY_ID = prevKey;
      else delete process.env.RAZORPAY_KEY_ID;
      if (prevSecret !== undefined) process.env.RAZORPAY_KEY_SECRET = prevSecret;
      else delete process.env.RAZORPAY_KEY_SECRET;
    }
  });

  // E. External checkout success arriving after local link is canceled
  it("Task 5 - Case E: External checkout success arriving after local link is canceled rejects stale callback and audits refund requirement", async () => {
    const { invoice, link } = await createFixture(1000000);

    // Full cash payment cancels the link
    const cashForm = new FormData();
    cashForm.append("invoiceId", invoice.id);
    cashForm.append("amount", "10000");
    cashForm.append("method", "CASH");
    cashForm.append("reference", "CASH-STALE-SETUP");
    await recordFeePaymentAction({} as any, cashForm);

    const canceledLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(canceledLink.status).toBe("CANCELED");

    // Delayed webhook callback arrives from external provider for this canceled link
    const settleResult = await settleFeePaymentLink({
      provider: "stripe",
      providerRef: "cs_stale_callback_999",
      referenceId: link.id,
      amountPaid: 1000000,
    });

    // Settlement must reject (return null)
    expect(settleResult).toBeNull();

    // 1. Persisted Invoice: paidAmount remains ₹10,000 (from cash), NOT ₹20,000
    const finalInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(finalInvoice.paidAmount).toBe(1000000);

    // 2. Payment Ledger: exactly 1 payment (the cash payment), NO duplicate payment
    const payments = await db.feePayment.findMany({ where: { feeInvoiceId: invoice.id } });
    expect(payments.length).toBe(1);
    expect(payments[0].method).toBe("CASH");

    // 3. Payment-link status: remains CANCELED
    const finalLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(finalLink.status).toBe("CANCELED");

    // 4. Reconciliation Record: AuditLog must record stale_callback_rejected with refund notice
    const audit = await db.auditLog.findFirst({
      where: {
        action: "fee.payment.stale_callback_rejected",
        entityId: link.id,
      },
    });
    expect(audit).not.toBeNull();
    expect((audit?.meta as any)?.reason).toContain("refund");
  });

  // F. Repeated provider response or retry for the same local link
  it("Task 5 - Case F: Repeated provider response or retry for the same local link is handled idempotently without duplicate ledger entries", async () => {
    const { invoice, link } = await createFixture(1000000);

    // 1. First provider callback arrives and settles link
    const firstSettle = await settleFeePaymentLink({
      provider: "stripe",
      providerRef: "cs_idempotent_test_01",
      referenceId: link.id,
      amountPaid: 1000000,
    });
    expect(firstSettle).not.toBeNull();
    expect(firstSettle?.status).toBe("PAID");

    // 2. Second provider callback arrives (webhook retry or network re-send)
    const secondSettle = await settleFeePaymentLink({
      provider: "stripe",
      providerRef: "cs_idempotent_test_01",
      referenceId: link.id,
      amountPaid: 1000000,
    });
    expect(secondSettle).not.toBeNull();

    // 1. Persisted Invoice: exactly ₹10,000 paidAmount, status PAID
    const finalInvoice = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(finalInvoice.paidAmount).toBe(1000000);
    expect(finalInvoice.status).toBe("PAID");

    // 2. Payment Ledger: strictly 1 payment record, NO duplicate
    const payments = await db.feePayment.findMany({ where: { feeInvoiceId: invoice.id } });
    expect(payments.length).toBe(1);
    expect(payments[0].amount).toBe(1000000);

    // 3. Payment-link status: PAID
    const finalLink = await db.feePaymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(finalLink.status).toBe("PAID");
  });

  // 9. Normal partial and full payment (succeeds)
  it("Lifecycle 9: Normal partial settlement followed by full settlement succeeds cleanly", async () => {
    const { invoice, link } = await createFixture(1000000);

    // Step 1: Settle ₹4,000 partial payment
    const partialLink = await settleFeePaymentLink({
      provider: "manual",
      referenceId: link.id,
      amountPaid: 400000,
    });
    expect(partialLink).not.toBeNull();
    expect(partialLink?.status).toBe("PAID");

    const invoiceStep1 = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(invoiceStep1.paidAmount).toBe(400000);
    expect(invoiceStep1.status).toBe("PARTIAL");

    // Step 2: Generate link for remaining ₹6,000 balance
    const linkResult = await getOrCreateFeePaymentLink(invoice.id, testTenant.id);
    expect(linkResult.link.amount).toBe(600000);
    expect(linkResult.link.status).toBe("OPEN");

    // Step 3: Settle the remaining ₹6,000
    const fullLink = await settleFeePaymentLink({
      provider: "manual",
      referenceId: linkResult.link.id,
      amountPaid: 600000,
    });
    expect(fullLink).not.toBeNull();
    expect(fullLink?.status).toBe("PAID");

    const invoiceStep2 = await db.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(invoiceStep2.paidAmount).toBe(1000000);
    expect(invoiceStep2.status).toBe("PAID");

    const allPayments = await db.feePayment.findMany({
      where: { feeInvoiceId: invoice.id },
      orderBy: { paidAt: "asc" },
    });
    expect(allPayments.length).toBe(2);
    expect(allPayments[0].amount).toBe(400000);
    expect(allPayments[1].amount).toBe(600000);
    expect(allPayments[0].amount + allPayments[1].amount).toBe(invoice.amount);
  });
});
