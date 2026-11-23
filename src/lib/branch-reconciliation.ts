import "server-only";

import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/auth";

export const IMMUTABLE_FINANCIAL_RECORD_TYPES = [
  "PaymentReceipt",
  "PaymentAllocation",
  "PaymentAllocationReversal",
  "CreditTransferJournal",
  "FeePayment",
] as const;

export type ImmutableFinancialRecordType = (typeof IMMUTABLE_FINANCIAL_RECORD_TYPES)[number];

export const MUTABLE_OPERATIONAL_RECORD_TYPES = ["Student", "Lead", "FileAsset", "FeeInvoice"] as const;

export type MutableOperationalRecordType = (typeof MUTABLE_OPERATIONAL_RECORD_TYPES)[number];

export type ReconcilableRecordType = ImmutableFinancialRecordType | MutableOperationalRecordType;

export interface AmbiguousRecordSummary {
  recordType: ReconcilableRecordType;
  recordId: string;
  description: string;
  suggestedBranchId: string | null;
  candidateEvidence: string | null;
  isImmutableEvent: boolean;
  createdAt: Date;
}

/**
 * Scans for historical records within a tenant that have null branch attribution.
 * Adheres strictly to the financial safety rule: do NOT assume the student's current branch
 * represents historical event attribution.
 */
export async function getAmbiguousHistoricalRecords(tenantId: string): Promise<AmbiguousRecordSummary[]> {
  const [invoices, payments, receipts, students, leads, assets] = await Promise.all([
    db.feeInvoice.findMany({
      where: { tenantId, branchId: null },
      select: {
        id: true,
        number: true,
        createdAt: true,
        student: { select: { branchId: true, firstName: true, lastName: true } },
      },
      take: 50,
      orderBy: { createdAt: "desc" },
    }),
    db.feePayment.findMany({
      where: { tenantId, branchId: null },
      select: {
        id: true,
        amount: true,
        paidAt: true,
        feeInvoice: {
          select: {
            branchId: true,
            student: { select: { branchId: true, firstName: true, lastName: true } },
          },
        },
      },
      take: 50,
      orderBy: { paidAt: "desc" },
    }),
    db.paymentReceipt.findMany({
      where: { tenantId, branchId: null },
      select: {
        id: true,
        receiptNumber: true,
        createdAt: true,
        student: { select: { branchId: true, firstName: true, lastName: true } },
      },
      take: 50,
      orderBy: { createdAt: "desc" },
    }),
    db.student.findMany({
      where: { tenantId, branchId: null },
      select: { id: true, firstName: true, lastName: true, createdAt: true },
      take: 50,
      orderBy: { createdAt: "desc" },
    }),
    db.lead.findMany({
      where: { tenantId, branchId: null },
      select: { id: true, studentName: true, createdAt: true },
      take: 50,
      orderBy: { createdAt: "desc" },
    }),
    db.fileAsset.findMany({
      where: { tenantId, branchId: null },
      select: { id: true, name: true, createdAt: true, student: { select: { branchId: true } } },
      take: 50,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const summaries: AmbiguousRecordSummary[] = [];

  for (const inv of invoices) {
    summaries.push({
      recordType: "FeeInvoice",
      recordId: inv.id,
      description: `Invoice ${inv.number} for ${inv.student.firstName} ${inv.student.lastName}`,
      suggestedBranchId: null, // Unresolved: historical invoice attribution cannot be inferred solely from current student branch
      candidateEvidence: "Unresolved: Requires verified historical registration or fee schedule evidence",
      isImmutableEvent: false,
      createdAt: inv.createdAt,
    });
  }

  for (const p of payments) {
    summaries.push({
      recordType: "FeePayment",
      recordId: p.id,
      description: `Payment ${p.id} of ₹${(p.amount / 100).toFixed(2)}`,
      suggestedBranchId: null,
      candidateEvidence: "Unresolved: Requires bank statement or cashier drawer reconciliation",
      isImmutableEvent: true,
      createdAt: p.paidAt,
    });
  }

  for (const r of receipts) {
    summaries.push({
      recordType: "PaymentReceipt",
      recordId: r.id,
      description: `Receipt ${r.receiptNumber} for ${r.student.firstName} ${r.student.lastName}`,
      suggestedBranchId: null,
      candidateEvidence: "Unresolved: Requires bank statement or receipt counter verification",
      isImmutableEvent: true,
      createdAt: r.createdAt,
    });
  }

  for (const s of students) {
    summaries.push({
      recordType: "Student",
      recordId: s.id,
      description: `Student ${s.firstName} ${s.lastName}`,
      suggestedBranchId: null,
      candidateEvidence: "Requires owner branch assignment",
      isImmutableEvent: false,
      createdAt: s.createdAt,
    });
  }

  for (const l of leads) {
    summaries.push({
      recordType: "Lead",
      recordId: l.id,
      description: `Lead ${l.studentName}`,
      suggestedBranchId: null,
      candidateEvidence: "Requires owner branch assignment",
      isImmutableEvent: false,
      createdAt: l.createdAt,
    });
  }

  for (const a of assets) {
    summaries.push({
      recordType: "FileAsset",
      recordId: a.id,
      description: `Asset ${a.name}`,
      suggestedBranchId: null,
      candidateEvidence: "Requires owner branch assignment",
      isImmutableEvent: false,
      createdAt: a.createdAt,
    });
  }

  return summaries;
}

/**
 * Reconciles an unassigned or misattributed historical record to a verified branch.
 * IMMUTABILITY GUARANTEE:
 * - Immutable financial events (PaymentReceipt, PaymentAllocation, CreditTransferJournal, FeePayment)
 *   are NEVER mutated in place. Their raw database rows remain 100% untouched.
 * - An append-only BranchReconciliationAudit entry is committed as the authoritative attribution correction.
 * - Mutable operational entities (Student, Lead, FileAsset, FeeInvoice) are updated in place with full audit logging.
 */
export async function reconcileHistoricalRecord(
  ctx: TenantContext,
  params: {
    recordType: ReconcilableRecordType;
    recordId: string;
    newBranchId: string;
    reason: string;
    candidateEvidence?: string;
  },
  client: any = db
): Promise<{ success: boolean; auditId?: string; error?: string; isImmutablePreserved?: boolean }> {
  const tenantId = ctx.tenant?.id;
  if (!tenantId) {
    return { success: false, error: "Unauthorized: Missing active tenant context." };
  }

  const isOwner =
    Boolean(ctx.user?.isPlatformOwner) ||
    Boolean(ctx.isOwnerView) ||
    Boolean(ctx.membership?.isOwner);

  if (!isOwner) {
    return {
      success: false,
      error: "Forbidden: Historical branch reconciliation is strictly restricted to Institute Owners.",
    };
  }

  let reconcilerMembershipId = (ctx.membership as any)?.id;
  if (!reconcilerMembershipId && ctx.user?.id) {
    const member = await client.membership.findFirst({
      where: { tenantId, userId: ctx.user.id },
      select: { id: true },
    });
    reconcilerMembershipId = member?.id;
  }

  if (!reconcilerMembershipId) {
    return {
      success: false,
      error: "Unauthorized: Reconciler must have a valid membership within this tenant.",
    };
  }

  // Validate target branch exists in tenant and is active
  const targetBranch = await client.branch.findFirst({
    where: { id: params.newBranchId, tenantId, isActive: true },
    select: { id: true, name: true },
  });

  if (!targetBranch) {
    return { success: false, error: "The target branch does not exist or is inactive." };
  }

  const isImmutable = (IMMUTABLE_FINANCIAL_RECORD_TYPES as readonly string[]).includes(params.recordType);

  return await client.$transaction(async (tx: any) => {
    // Serialize concurrent reconciliation attempts for this tenant
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;

    let previousBranchId: string | null = null;

    if (isImmutable) {
      // ──────────────── Immutable Financial Events ────────────────
      // Verify record exists and capture its current branchId.
      // THE ROW IS NEVER MUTATED!
      switch (params.recordType) {
        case "PaymentReceipt": {
          const rcpt = await tx.paymentReceipt.findFirst({
            where: { id: params.recordId, tenantId },
            select: { id: true, branchId: true },
          });
          if (!rcpt) throw new Error("Payment receipt not found in this tenant.");
          previousBranchId = rcpt.branchId;
          break;
        }
        case "FeePayment": {
          const pay = await tx.feePayment.findFirst({
            where: { id: params.recordId, tenantId },
            select: { id: true, branchId: true },
          });
          if (!pay) throw new Error("Fee payment not found in this tenant.");
          previousBranchId = pay.branchId;
          break;
        }
        case "PaymentAllocation": {
          const alloc = await tx.paymentAllocation.findFirst({
            where: { id: params.recordId, tenantId },
            select: { id: true, branchId: true },
          });
          if (!alloc) throw new Error("Payment allocation not found in this tenant.");
          previousBranchId = alloc.branchId;
          break;
        }
        case "CreditTransferJournal": {
          const j = await tx.creditTransferJournal.findFirst({
            where: { id: params.recordId, tenantId },
            select: { id: true, sourceBranchId: true },
          });
          if (!j) throw new Error("Credit transfer journal not found in this tenant.");
          previousBranchId = j.sourceBranchId;
          break;
        }
        default:
          throw new Error(`Unsupported immutable record type: ${params.recordType}`);
      }
    } else {
      // ──────────────── Mutable Operational Projections ────────────────
      switch (params.recordType) {
        case "FeeInvoice": {
          const inv = await tx.feeInvoice.findFirst({
            where: { id: params.recordId, tenantId },
            select: { id: true, branchId: true },
          });
          if (!inv) throw new Error("Fee invoice not found in this tenant.");
          previousBranchId = inv.branchId;
          await tx.feeInvoice.update({
            where: { id: params.recordId },
            data: { branchId: params.newBranchId },
          });
          break;
        }
        case "Student": {
          const stu = await tx.student.findFirst({
            where: { id: params.recordId, tenantId },
            select: { id: true, branchId: true },
          });
          if (!stu) throw new Error("Student not found in this tenant.");
          previousBranchId = stu.branchId;
          await tx.student.update({
            where: { id: params.recordId },
            data: { branchId: params.newBranchId },
          });
          break;
        }
        case "Lead": {
          const lead = await tx.lead.findFirst({
            where: { id: params.recordId, tenantId },
            select: { id: true, branchId: true },
          });
          if (!lead) throw new Error("Lead not found in this tenant.");
          previousBranchId = lead.branchId;
          await tx.lead.update({
            where: { id: params.recordId },
            data: { branchId: params.newBranchId },
          });
          break;
        }
        case "FileAsset": {
          const file = await tx.fileAsset.findFirst({
            where: { id: params.recordId, tenantId },
            select: { id: true, branchId: true },
          });
          if (!file) throw new Error("File asset not found in this tenant.");
          previousBranchId = file.branchId;
          await tx.fileAsset.update({
            where: { id: params.recordId },
            data: { branchId: params.newBranchId },
          });
          break;
        }
        default:
          throw new Error(`Unsupported mutable record type: ${params.recordType}`);
      }
    }

    // Commit append-only audit trail
    const audit = await tx.branchReconciliationAudit.create({
      data: {
        tenantId,
        recordType: params.recordType,
        recordId: params.recordId,
        previousBranchId,
        newBranchId: params.newBranchId,
        reason: params.reason,
        candidateEvidence: params.candidateEvidence ?? "Verified owner reconciliation",
        reconciledById: reconcilerMembershipId,
      },
    });

    return {
      success: true,
      auditId: audit.id,
      isImmutablePreserved: isImmutable,
    };
  });
}

/**
 * Returns the effective branch attribution for any record, projecting any owner
 * reconciliation correction over the raw record's attribution.
 */
export async function getEffectiveBranchAttribution(
  tenantId: string,
  recordType: ReconcilableRecordType,
  recordId: string,
  rawBranchId: string | null,
  client: any = db
): Promise<{ effectiveBranchId: string | null; isCorrected: boolean; auditRecord?: any }> {
  const latestAudit = await client.branchReconciliationAudit.findFirst({
    where: { tenantId, recordType, recordId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      newBranch: { select: { id: true, name: true, code: true } },
      reconciledBy: { select: { id: true, user: { select: { name: true, email: true } } } },
    },
  });

  if (latestAudit && latestAudit.newBranchId) {
    return {
      effectiveBranchId: latestAudit.newBranchId,
      isCorrected: true,
      auditRecord: latestAudit,
    };
  }

  return {
    effectiveBranchId: rawBranchId,
    isCorrected: false,
  };
}

/**
 * Retrieves audit history for branch reconciliation in a tenant.
 */
export async function getReconciliationAudits(tenantId: string, limit = 100) {
  return await db.branchReconciliationAudit.findMany({
    where: { tenantId },
    include: {
      reconciledBy: {
        select: {
          id: true,
          user: { select: { name: true, email: true } },
        },
      },
      previousBranch: { select: { id: true, name: true, code: true } },
      newBranch: { select: { id: true, name: true, code: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Calculates total collected fees within a date range taking into account
 * historical branch reconciliation corrections via v_effective_fee_payment.
 */
export async function getEffectiveFeeCollectedSum(
  tenantId: string,
  sinceDate: Date,
  allowedBranchIds?: string[] | null,
  client: any = db
): Promise<number> {
  if (allowedBranchIds && allowedBranchIds.length > 0) {
    const rows = await client.$queryRaw<{ total: string | number | null }[]>`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM "v_effective_fee_payment"
      WHERE "tenantId" = ${tenantId}
        AND "paidAt" >= ${sinceDate}
        AND "effectiveBranchId" = ANY(${allowedBranchIds}::text[])
    `;
    const val = rows[0]?.total;
    return val ? Number(val) : 0;
  }

  const rows = await client.$queryRaw<{ total: string | number | null }[]>`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM "v_effective_fee_payment"
    WHERE "tenantId" = ${tenantId}
      AND "paidAt" >= ${sinceDate}
  `;
  const val = rows[0]?.total;
  return val ? Number(val) : 0;
}
