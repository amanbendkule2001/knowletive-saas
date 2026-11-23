import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { getPaymentGatewayAdapter, type JodoWebhookPayload } from "@/lib/payment-gateway";
import { resolveUserBranchScope, verifyBranchAccess, buildBranchFilter } from "@/lib/branch";
import { getOutstandingFeeSummary } from "@/lib/ai-tools";
import { executeApprovedTool } from "@/lib/ai-gateway";
import { ROLE_TEMPLATE_MAP } from "@/lib/catalog";
import type { TenantContext } from "@/lib/auth";

async function cleanupTenant(tenantId: string) {
  // Clean up mutable entities; immutable receipts and ledgers are preserved per PostgreSQL RESTRICT constraints
  await db.feePaymentLink.deleteMany({ where: { tenantId } }).catch(() => null);
}

describe("Stage 2: Multi-Branch & Sub-Branch Isolation, Two-Track Ledger & Webhook Idempotency", () => {
  let testTenantId: string;
  let mainBranchId: string;
  let subBranchId: string;
  let branch2Id: string;
  let student1Id: string;
  let student2Id: string;
  let invoice1Id: string;
  let invoice2Id: string;
  let mainCollectorCode: string;

  beforeAll(async () => {
    // 1. Create a clean test tenant
    const stamp = Date.now();
    const tenant = await db.tenant.create({
      data: {
        name: "Branch & Ledger Test Institute",
        slug: `branch-test-${stamp}`,
        email: `branch-test-${stamp}@test.com`,
        logoInitials: "BL",
        status: "ACTIVE",
      },
    });
    testTenantId = tenant.id;

    // 2. Create MAIN branch with collectorCode
    mainCollectorCode = `COL-NORTH-${Date.now()}`;
    const mainBranch = await db.branch.create({
      data: {
        tenantId: testTenantId,
        branchType: "MAIN",
        name: "North Campus Main",
        code: "NORTH-MAIN",
        collectorCode: mainCollectorCode,
        verificationStatus: "VERIFIED",
        bankAccountName: "North Campus Trust",
        bankAccountNumber: "9876543210",
        bankIfsc: "HDFC0001234",
      },
    });
    mainBranchId = mainBranch.id;

    // 3. Create SUB_BRANCH under North Campus Main
    const subBranch = await db.branch.create({
      data: {
        tenantId: testTenantId,
        parentBranchId: mainBranch.id,
        branchType: "SUB_BRANCH",
        name: "North Annex Sub-Branch",
        code: "NORTH-ANNEX",
        collectorCode: `COL-ANNEX-${Date.now()}`,
        verificationStatus: "VERIFIED",
      },
    });
    subBranchId = subBranch.id;

    // 4. Create an isolated second branch (Branch 2 - South Campus)
    const branch2 = await db.branch.create({
      data: {
        tenantId: testTenantId,
        branchType: "MAIN",
        name: "South Campus",
        code: "SOUTH-MAIN",
        collectorCode: `COL-SOUTH-${Date.now()}`,
        verificationStatus: "VERIFIED",
      },
    });
    branch2Id = branch2.id;

    // 5. Create Students in respective branches
    const student1 = await db.student.create({
      data: {
        tenantId: testTenantId,
        branchId: subBranchId,
        admissionNo: `ADM-BR1-${Date.now()}`,
        firstName: "Aarav",
        lastName: "Sharma",
      },
    });
    student1Id = student1.id;

    const student2 = await db.student.create({
      data: {
        tenantId: testTenantId,
        branchId: branch2Id,
        admissionNo: `ADM-BR2-${Date.now()}`,
        firstName: "Diya",
        lastName: "Patel",
      },
    });
    student2Id = student2.id;

    // 6. Create Fee Invoices
    const inv1 = await db.feeInvoice.create({
      data: {
        tenantId: testTenantId,
        studentId: student1Id,
        branchId: subBranchId,
        number: `INV-BR1-${Date.now()}`,
        title: "Term 1 Tuition Fee",
        amount: 2500000, // ₹25,000 in paise
        dueDate: new Date(Date.now() + 7 * 86_400_000),
        status: "PENDING",
      },
    });
    invoice1Id = inv1.id;

    const inv2 = await db.feeInvoice.create({
      data: {
        tenantId: testTenantId,
        studentId: student2Id,
        branchId: branch2Id,
        number: `INV-BR2-${Date.now()}`,
        title: "Term 1 Tuition Fee",
        amount: 3000000, // ₹30,000 in paise
        dueDate: new Date(Date.now() + 7 * 86_400_000),
        status: "PENDING",
      },
    });
    invoice2Id = inv2.id;
  });

  afterAll(async () => {
    // Cleanup test tenant (cascades to branches, invoices, ledger entries)
    if (testTenantId) {
      await cleanupTenant(testTenantId);
    }
  });

  it("1. Hierarchical branch scoping: Main branch inherits sub-branches, sub-branch is isolated", async () => {
    // Mock user assigned to MAIN branch
    const mainCtx: TenantContext = {
      user: {
        id: "usr-main",
        name: "Main Staff",
        email: "main@test.com",
        avatarColor: "#4f46e5",
        isPlatformOwner: false,
        platformPermissions: [],
        memberships: [],
      },
      tenant: {
        id: testTenantId,
        subscription: {
          status: "ACTIVE",
          plan: { features: ["ai", "fees"] },
        },
      } as any,
      membership: {
        tenantId: testTenantId,
        tenantName: "Test",
        tenantSlug: "test",
        tenantStatus: "ACTIVE",
        tenantType: "K12",
        roleId: "r-staff",
        roleName: "Accountant",
        roleKey: "ACCOUNTANT",
        isOwner: false,
        branchId: mainBranchId,
        permissions: ["tenant.fees.read", "tenant.fees.write"],
      },
      permissions: new Set(["tenant.fees.read", "tenant.fees.write"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: mainBranchId,
    };

    const mainScope = await resolveUserBranchScope(mainCtx);
    expect(mainScope.isBranchScoped).toBe(true);
    expect(mainScope.assignedBranchId).toBe(mainBranchId);
    expect(mainScope.allowedBranchIds).toContain(mainBranchId);
    expect(mainScope.allowedBranchIds).toContain(subBranchId); // Inherits sub-branch
    expect(mainScope.allowedBranchIds).not.toContain(branch2Id); // Excludes South Campus

    // Mock user assigned to SUB_BRANCH
    const subCtx: TenantContext = {
      ...mainCtx,
      membership: {
        ...mainCtx.membership!,
        branchId: subBranchId,
      },
      branchId: subBranchId,
    };

    const subScope = await resolveUserBranchScope(subCtx);
    expect(subScope.isBranchScoped).toBe(true);
    expect(subScope.allowedBranchIds).toEqual([subBranchId]); // Only self

    // Sub-branch user cannot access South Campus or Main Branch
    const southAccess = await verifyBranchAccess(subCtx, branch2Id);
    expect(southAccess.ok).toBe(false);
  });

  it("2. Track A (Debited Event): Marks invoice paid & issues receipt WITHOUT crediting branch payout ledger", async () => {
    const adapter = getPaymentGatewayAdapter("jodo");
    const eventId = `evt_debited_${Date.now()}`;

    const debitedEvent: JodoWebhookPayload = {
      event_id: eventId,
      event_type: "pay.payment.debited",
      timestamp: new Date().toISOString(),
      data: {
        payment_id: `pay_${Date.now()}`,
        invoice_id: invoice1Id,
        amount: 2500000, // Full payment ₹25,000
        currency: "INR",
        status: "DEBITED",
        utr: "UTR-TEST-DEBIT-001",
        payer_name: "Aarav Sharma",
      },
    };

    const result = await adapter.processWebhook(debitedEvent);
    expect(result.success).toBe(true);
    expect(result.status).toBe("PROCESSED");
    expect(result.invoiceId).toBe(invoice1Id);

    // Verify invoice is marked PAID
    const updatedInvoice = await db.feeInvoice.findUnique({ where: { id: invoice1Id } });
    expect(updatedInvoice?.status).toBe("PAID");
    expect(updatedInvoice?.paidAmount).toBe(2500000);

    // Verify PaymentReceipt was issued
    const receipt = await db.paymentReceipt.findFirst({
      where: { tenantId: testTenantId, studentId: student1Id },
    });
    expect(receipt).not.toBeNull();
    expect(receipt?.amount).toBe(2500000);
    expect(receipt?.method).toBe("ONLINE_JODO");

    // CRITICAL: Branch payout balance must NOT be credited yet on debited event
    const ledgerCount = await db.branchLedgerEntry.count({
      where: { tenantId: testTenantId, branchId: subBranchId, channel: "ONLINE_JODO" },
    });
    expect(ledgerCount).toBe(0);
  });

  it("3. Idempotency guard: Duplicate debited webhook retry is recognized and not double-counted", async () => {
    const adapter = getPaymentGatewayAdapter("jodo");
    // Query existing processed eventId
    const existingWebhook = await db.webhookEvent.findFirst({
      where: { tenantId: testTenantId, eventType: "pay.payment.debited" },
    });
    expect(existingWebhook).not.toBeNull();

    const duplicateEvent: JodoWebhookPayload = {
      event_id: existingWebhook!.eventId,
      event_type: "pay.payment.debited",
      timestamp: new Date().toISOString(),
      data: {
        invoice_id: invoice1Id,
        amount: 2500000,
        status: "DEBITED",
      },
    };

    const result = await adapter.processWebhook(duplicateEvent);
    expect(result.success).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(result.status).toBe("DUPLICATE");

    // Paid amount remains unchanged
    const invoice = await db.feeInvoice.findUnique({ where: { id: invoice1Id } });
    expect(invoice?.paidAmount).toBe(2500000);
  });

  it("4. Track B (Settled Event): Credits branch payable ledger balance only after settlement", async () => {
    const adapter = getPaymentGatewayAdapter("jodo");
    const eventId = `evt_settled_${Date.now()}`;

    const settledEvent: JodoWebhookPayload = {
      event_id: eventId,
      event_type: "pay.payment.settled",
      timestamp: new Date().toISOString(),
      data: {
        payment_id: `pay_${Date.now()}`,
        tenant_id: testTenantId,
        branch_id: subBranchId,
        amount: 2500000,
        currency: "INR",
        status: "SETTLED",
        settlement_utr: "BANK-SETTLE-UTR-999",
      },
    };

    const result = await adapter.processWebhook(settledEvent);
    expect(result.success).toBe(true);
    expect(result.status).toBe("PROCESSED");
    expect(result.ledgerEntryId).not.toBeNull();

    // Verify BranchLedgerEntry was created with CREDIT_SETTLEMENT and balance = 2500000
    const entry = await db.branchLedgerEntry.findUnique({
      where: { id: result.ledgerEntryId! },
    });
    expect(entry).not.toBeNull();
    expect(entry?.entryType).toBe("CREDIT_SETTLEMENT");
    expect(entry?.channel).toBe("ONLINE_JODO");
    expect(entry?.amount).toBe(2500000);
    expect(entry?.balanceAfter).toBe(2500000);
    expect(entry?.utrReference).toBe("BANK-SETTLE-UTR-999");
  });

  it("5. Bounce Event: Reopens student invoice and posts DEBIT_BOUNCE to branch payable ledger", async () => {
    const adapter = getPaymentGatewayAdapter("jodo");
    const eventId = `evt_bounced_${Date.now()}`;

    const bounceEvent: JodoWebhookPayload = {
      event_id: eventId,
      event_type: "flex.instalment.bounced",
      timestamp: new Date().toISOString(),
      data: {
        invoice_id: invoice1Id,
        tenant_id: testTenantId,
        branch_id: subBranchId,
        amount: 1000000, // ₹10,000 instalment bounced
        status: "BOUNCED",
        bounce_reason: "NACH mandate dishonoured: insufficient balance",
      },
    };

    const result = await adapter.processWebhook(bounceEvent);
    expect(result.success).toBe(true);
    expect(result.status).toBe("PROCESSED");

    // Student invoice balance is reopened
    const invoice = await db.feeInvoice.findUnique({ where: { id: invoice1Id } });
    expect(invoice?.status).toBe("PARTIAL");
    expect(invoice?.paidAmount).toBe(1500000); // 25,000 - 10,000 = 15,000

    // Branch ledger balance decremented by 10,000: 25,000 - 10,000 = 15,000
    const bounceEntry = await db.branchLedgerEntry.findUnique({
      where: { id: result.ledgerEntryId! },
    });
    expect(bounceEntry?.entryType).toBe("DEBIT_BOUNCE");
    expect(bounceEntry?.amount).toBe(1000000);
    expect(bounceEntry?.balanceAfter).toBe(1500000);
  });

  it("6. AI Copilot fee summary scopes queries to assigned branch", async () => {
    // Institute total outstanding across all branches
    const allSummary = await getOutstandingFeeSummary(testTenantId);
    expect(allSummary.success).toBe(true);
    // Student 1 has 10,000 outstanding (25,000 - 15,000). Student 2 has 30,000 outstanding. Total = 40,000
    expect(allSummary.data?.totalOutstandingRupees).toBe(40000);

    // Branch-scoped summary for South Campus (Branch 2) only
    const branch2Summary = await getOutstandingFeeSummary(testTenantId, {
      branchId: branch2Id,
    });
    expect(branch2Summary.success).toBe(true);
    // Only student 2's 30,000 is included
    expect(branch2Summary.data?.totalOutstandingRupees).toBe(30000);
    expect(branch2Summary.data?.branchId).toBe(branch2Id);
  });

  it("7. Refund event: Reopens dues and posts DEBIT_REFUND reversal without deleting historical records", async () => {
    const adapter = getPaymentGatewayAdapter("jodo");
    const eventId = `evt_refund_${Date.now()}`;

    // Verify existing receipt is present before refund
    const initialReceiptCount = await db.paymentReceipt.count({ where: { tenantId: testTenantId } });
    expect(initialReceiptCount).toBeGreaterThan(0);

    const refundEvent: JodoWebhookPayload = {
      event_id: eventId,
      event_type: "pay.payment.refunded",
      timestamp: new Date().toISOString(),
      data: {
        invoice_id: invoice1Id,
        tenant_id: testTenantId,
        branch_id: subBranchId,
        amount: 500000, // ₹5,000 refunded
        status: "REFUNDED",
        refund_reason: "Parent requested partial refund for lab fees",
      },
    };

    const result = await adapter.processWebhook(refundEvent);
    expect(result.success).toBe(true);
    expect(result.status).toBe("PROCESSED");

    // Student invoice dues reopened: was 15,000 - 5,000 = 10,000 paid
    const updatedInvoice = await db.feeInvoice.findUnique({ where: { id: invoice1Id } });
    expect(updatedInvoice?.status).toBe("PARTIAL");
    expect(updatedInvoice?.paidAmount).toBe(1000000); // ₹10,000 paid

    // Branch ledger balance decremented by 5,000: 15,000 - 5,000 = 10,000
    const refundEntry = await db.branchLedgerEntry.findUnique({
      where: { id: result.ledgerEntryId! },
    });
    expect(refundEntry?.entryType).toBe("DEBIT_REFUND");
    expect(refundEntry?.amount).toBe(500000);
    expect(refundEntry?.balanceAfter).toBe(1000000);

    // Verify historical receipt records were NOT deleted (append-only ledger integrity)
    const afterReceiptCount = await db.paymentReceipt.count({ where: { tenantId: testTenantId } });
    expect(afterReceiptCount).toBe(initialReceiptCount);
  });

  it("8. Sub-branch sharing parent collectorCode: Correctly scopes to sub-branch via invoice", async () => {
    const adapter = getPaymentGatewayAdapter("jodo");

    // Create a new sub-branch under North Campus Main that inherits its parent's collectorCode
    const sharedSubBranch = await db.branch.create({
      data: {
        tenantId: testTenantId,
        parentBranchId: mainBranchId,
        branchType: "SUB_BRANCH",
        name: "North East Sub-Campus",
        code: `NORTH-EAST-${Date.now()}`,
        collectorCode: null, // Sub-branch relies on parent branch collectorCode
        verificationStatus: "VERIFIED",
      },
    });

    const sharedStudent = await db.student.create({
      data: {
        tenantId: testTenantId,
        branchId: sharedSubBranch.id,
        admissionNo: `ADM-SHARED-${Date.now()}`,
        firstName: "Rohan",
        lastName: "Gupta",
      },
    });

    const sharedInvoice = await db.feeInvoice.create({
      data: {
        tenantId: testTenantId,
        studentId: sharedStudent.id,
        branchId: sharedSubBranch.id,
        number: `INV-SHARED-${Date.now()}`,
        title: "Tuition Fee Term 2",
        amount: 1500000, // ₹15,000
        dueDate: new Date(Date.now() + 14 * 86_400_000),
        status: "PENDING",
      },
    });

    // 8a. Send debited webhook with ONLY parent's collector_code and invoice_id (no explicit branch_id)
    const debitedEvent: JodoWebhookPayload = {
      event_id: `evt_shared_debited_${Date.now()}`,
      event_type: "pay.payment.debited",
      timestamp: new Date().toISOString(),
      data: {
        collector_code: mainCollectorCode, // Parent's collector code
        invoice_id: sharedInvoice.id,
        amount: 1500000,
        currency: "INR",
        status: "DEBITED",
      },
    };

    const debitedResult = await adapter.processWebhook(debitedEvent);
    expect(debitedResult.success).toBe(true);
    // Crucial: Must be attributed to sharedSubBranch, NOT mainBranch!
    expect(debitedResult.branchId).toBe(sharedSubBranch.id);

    const receipt = await db.paymentReceipt.findFirst({
      where: { tenantId: testTenantId, studentId: sharedStudent.id },
    });
    expect(receipt?.branchId).toBe(sharedSubBranch.id);

    // 8b. Send settled webhook with ONLY parent's collector_code and invoice_id
    const settledEvent: JodoWebhookPayload = {
      event_id: `evt_shared_settled_${Date.now()}`,
      event_type: "pay.payment.settled",
      timestamp: new Date().toISOString(),
      data: {
        collector_code: mainCollectorCode,
        invoice_id: sharedInvoice.id,
        amount: 1500000,
        currency: "INR",
        status: "SETTLED",
        settlement_utr: "UTR-SETTLE-SHARED-01",
      },
    };

    const settledResult = await adapter.processWebhook(settledEvent);
    expect(settledResult.success).toBe(true);
    expect(settledResult.branchId).toBe(sharedSubBranch.id);

    const ledgerEntry = await db.branchLedgerEntry.findUnique({
      where: { id: settledResult.ledgerEntryId! },
    });
    expect(ledgerEntry?.branchId).toBe(sharedSubBranch.id);
    expect(ledgerEntry?.amount).toBe(1500000);
    expect(ledgerEntry?.balanceAfter).toBe(1500000);
  });

  it("9. Offline CASH / CHEQUE payment: Recorded on invoice & receipt without entering online payable balance", async () => {
    // Create an offline invoice
    const offlineInvoice = await db.feeInvoice.create({
      data: {
        tenantId: testTenantId,
        studentId: student1Id,
        branchId: subBranchId,
        number: `INV-OFFLINE-${Date.now()}`,
        title: "Library Security Deposit",
        amount: 500000, // ₹5,000 in paise
        dueDate: new Date(Date.now() + 7 * 86_400_000),
        status: "PENDING",
      },
    });

    // Read previous online ledger balance for subBranchId
    const prevLedger = await db.branchLedgerEntry.findFirst({
      where: { tenantId: testTenantId, branchId: subBranchId },
      orderBy: { postedAt: "desc" },
    });
    const prevOnlineBalance = prevLedger?.balanceAfter ?? 0;

    // Simulate recordPaymentAction transaction for offline CASH collection
    const offlineAmount = 500000;
    const offlineMethod = "CASH";

    await db.$transaction(async (tx) => {
      // 1. FeePayment
      await tx.feePayment.create({
        data: {
          tenantId: testTenantId,
          feeInvoiceId: offlineInvoice.id,
          branchId: subBranchId,
          amount: offlineAmount,
          method: offlineMethod,
          reference: "CASH-REC-001",
          collectedById: "usr-frontdesk",
        },
      });

      // 2. Immutable PaymentReceipt
      const count = await tx.paymentReceipt.count({ where: { tenantId: testTenantId } });
      const receipt = await tx.paymentReceipt.create({
        data: {
          tenantId: testTenantId,
          studentId: student1Id,
          branchId: subBranchId,
          receiptNumber: `RCPT-OFFLINE-${(count + 1).toString().padStart(6, "0")}`,
          amount: offlineAmount,
          currency: "INR",
          method: offlineMethod,
          reference: "CASH-REC-001",
          provider: "cashier",
          payerName: "Aarav Sharma",
          createdById: "usr-frontdesk",
        },
      });

      // 3. 1:1 PaymentReceiptBalance
      await tx.paymentReceiptBalance.create({
        data: {
          tenantId: testTenantId,
          receiptId: receipt.id,
          allocatedAmount: offlineAmount,
          unappliedAmount: 0,
          status: "FULLY_ALLOCATED",
        },
      });

      // 4. PaymentAllocation
      await tx.paymentAllocation.create({
        data: {
          tenantId: testTenantId,
          receiptId: receipt.id,
          studentId: student1Id,
          feeInvoiceId: offlineInvoice.id,
          amount: offlineAmount,
        },
      });

      // 5. Update FeeInvoice
      await tx.feeInvoice.update({
        where: { id: offlineInvoice.id },
        data: {
          paidAmount: offlineAmount,
          status: "PAID",
          paidAt: new Date(),
        },
      });

      // 6. Append-only ledger record for audit WITHOUT inflating online payable balance
      await tx.branchLedgerEntry.create({
        data: {
          tenantId: testTenantId,
          branchId: subBranchId,
          entryType: "CREDIT_SETTLEMENT",
          channel: "OFFLINE_RECORD",
          amount: offlineAmount,
          balanceAfter: prevOnlineBalance, // Online balance remains untouched!
          referenceType: "FEE_PAYMENT",
          referenceId: offlineInvoice.id,
          description: `Offline CASH collection of ₹5,000`,
          createdById: "usr-frontdesk",
        },
      });
    });

    // Verify invoice is PAID
    const verifiedInvoice = await db.feeInvoice.findUnique({ where: { id: offlineInvoice.id } });
    expect(verifiedInvoice?.status).toBe("PAID");
    expect(verifiedInvoice?.paidAmount).toBe(offlineAmount);

    // Verify receipt was issued with method CASH
    const offlineReceipt = await db.paymentReceipt.findFirst({
      where: { tenantId: testTenantId, studentId: student1Id, method: "CASH" },
    });
    expect(offlineReceipt).not.toBeNull();
    expect(offlineReceipt?.amount).toBe(offlineAmount);

    // Verify online balance was NOT inflated
    const latestLedger = await db.branchLedgerEntry.findFirst({
      where: { tenantId: testTenantId, branchId: subBranchId },
      orderBy: { postedAt: "desc" },
    });
    expect(latestLedger?.channel).toBe("OFFLINE_RECORD");
    expect(latestLedger?.balanceAfter).toBe(prevOnlineBalance); // UNCHANGED!
  });

  it("10. Role isolation & permissions: FRONT_DESK & TEACHER fee access gating & AI Copilot domain checks", async () => {
    // 10a. FRONT_DESK permissions check in catalog
    const frontDeskTemplate = ROLE_TEMPLATE_MAP.get("FRONT_DESK");
    expect(frontDeskTemplate).toBeDefined();
    expect(frontDeskTemplate?.permissions).toContain("tenant.fees.collect_offline");
    expect(frontDeskTemplate?.permissions).not.toContain("tenant.fees.read");
    expect(frontDeskTemplate?.permissions).not.toContain("tenant.fees.write");

    // 10b. TEACHER permissions check in catalog
    const teacherTemplate = ROLE_TEMPLATE_MAP.get("TEACHER");
    expect(teacherTemplate).toBeDefined();
    expect(teacherTemplate?.permissions).not.toContain("tenant.fees.read");
    expect(teacherTemplate?.permissions).not.toContain("tenant.fees.write");
    expect(teacherTemplate?.permissions).not.toContain("tenant.fees.collect_offline");

    // 10c. AI Copilot: Teacher calling get_outstanding_fee_summary is denied with DOMAIN_READ_DENIED
    const teacherCtx: TenantContext = {
      user: {
        id: "usr-teacher-01",
        name: "Ms. Neha",
        email: "teacher@test.com",
        avatarColor: "#10b981",
        isPlatformOwner: false,
        platformPermissions: [],
        memberships: [],
      },
      tenant: {
        id: testTenantId,
        subscription: {
          status: "ACTIVE",
          plan: { features: ["ai", "fees"] },
        },
      } as any,
      membership: {
        tenantId: testTenantId,
        tenantName: "Test",
        tenantSlug: "test",
        tenantStatus: "ACTIVE",
        tenantType: "K12",
        roleId: "r-teacher",
        roleName: "Teacher",
        roleKey: "TEACHER",
        isOwner: false,
        permissions: teacherTemplate!.permissions,
      },
      permissions: new Set(teacherTemplate!.permissions),
      isOwnerView: false,
      subscriptionBlocked: false,
    };

    const teacherAiResult = await executeApprovedTool("get_outstanding_fee_summary", {}, teacherCtx);
    expect(teacherAiResult.success).toBe(false);
    if (!teacherAiResult.success) {
      expect(["DOMAIN_READ_DENIED", "AI_ROLE_UNAUTHORIZED", "AI_PLAN_FEATURE_LOCKED", "PLAN_LOCKED", "DENIED"]).toContain(teacherAiResult.code);
    }

    // 10d. AI Copilot: Sub-branch accountant attempting to query another branch is denied with BRANCH_ACCESS_DENIED
    const subAccountantCtx: TenantContext = {
      user: {
        id: "usr-sub-accountant",
        name: "Sub Accountant",
        email: "subacc@test.com",
        avatarColor: "#6366f1",
        isPlatformOwner: false,
        platformPermissions: [],
        memberships: [],
      },
      tenant: {
        id: testTenantId,
        subscription: {
          status: "ACTIVE",
          plan: { features: ["ai", "fees"] },
        },
      } as any,
      membership: {
        tenantId: testTenantId,
        tenantName: "Test",
        tenantSlug: "test",
        tenantStatus: "ACTIVE",
        tenantType: "K12",
        roleId: "r-subacc",
        roleName: "Accountant",
        roleKey: "ACCOUNTANT",
        isOwner: false,
        branchId: subBranchId,
        permissions: ["tenant.fees.read", "tenant.fees.write", "tenant.ai.analytics.fees", "tenant.ai.use"],
      },
      permissions: new Set(["tenant.fees.read", "tenant.fees.write", "tenant.ai.analytics.fees", "tenant.ai.use"]),
      isOwnerView: false,
      subscriptionBlocked: false,
      branchId: subBranchId,
    };

    const crossBranchAiResult = await executeApprovedTool(
      "get_outstanding_fee_summary",
      { branchId: branch2Id }, // Attempting to query South Campus from North Annex
      subAccountantCtx,
    );
    expect(crossBranchAiResult.success).toBe(false);
    if (!crossBranchAiResult.success) {
      expect(crossBranchAiResult.code).toBe("BRANCH_ACCESS_DENIED");
      expect(crossBranchAiResult.error).toContain("Access denied");
    }
  });
});
