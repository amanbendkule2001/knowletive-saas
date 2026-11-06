import "server-only";

import type { BillingCycle, Plan, TenantSubscription } from "@prisma/client";
import { db } from "@/lib/db";
import { addMonths, addDays, startOfMonth } from "@/lib/format";

export const GST_RATE = 0.18;

export function getBillingGateway() {
  const provider = (process.env.BILLING_PROVIDER ?? process.env.PAYMENT_PROVIDER ?? "manual").toLowerCase();
  return {
    id: provider,
  };
}

export function planAmount(plan: Plan, cycle: BillingCycle) {
  return cycle === "YEARLY" ? plan.priceYearly : plan.priceMonthly;
}

export function quote(plan: Plan, cycle: BillingCycle) {
  const subtotal = planAmount(plan, cycle);
  const tax = plan.currency === "INR" ? Math.round(subtotal * GST_RATE) : 0;
  return { subtotal, tax, total: subtotal + tax };
}

async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const count = await db.invoice.count({ where: { number: { startsWith: `INV-${year}-` } } });
  return `INV-${year}-${String(count + 1).padStart(4, "0")}`;
}

/** Raises a platform subscription invoice for the next billing period. */
export async function createSubscriptionInvoice(
  subscription: TenantSubscription,
  plan: Plan,
  cycle: BillingCycle,
) {
  const { subtotal, tax, total } = quote(plan, cycle);
  const now = new Date();
  const periodEnd = cycle === "YEARLY" ? addMonths(now, 12) : addMonths(now, 1);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.invoice.create({
        data: {
          number: await nextInvoiceNumber(),
          tenantId: subscription.tenantId,
          subscriptionId: subscription.id,
          planId: plan.id,
          status: "OPEN",
          currency: plan.currency,
          subtotal,
          tax,
          total,
          periodStart: now,
          periodEnd,
          dueAt: addDays(now, 7),
          lines: [
            {
              description: `${plan.name} plan — ${cycle === "YEARLY" ? "annual" : "monthly"}`,
              amount: subtotal,
            },
            ...(tax ? [{ description: "GST (18%)", amount: tax }] : []),
          ],
        },
      });
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  throw new Error("Could not allocate an invoice number");
}

/**
 * Marks a platform invoice paid, records the payment and rolls the
 * subscription period forward. Safe to call twice (idempotent). Online
 * providers pass their name and reference so reconciliation is traceable.
 */
export async function markInvoicePaid(
  invoiceId: string,
  options: { provider?: string; providerRef?: string | null } = {},
) {
  const provider = options.provider ?? "manual";
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { subscription: { include: { plan: true } } },
    });
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "PAID") return invoice;

    const paid = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "PAID",
        paidAt: new Date(),
        provider,
        providerRef: options.providerRef ?? invoice.providerRef,
      },
    });

    await tx.payment.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceId: invoice.id,
        amount: invoice.total,
        currency: invoice.currency,
        status: "SUCCEEDED",
        provider,
        providerRef: options.providerRef ?? null,
        paidAt: new Date(),
      },
    });

    if (invoice.subscription) {
      const base =
        invoice.subscription.currentPeriodEnd > new Date()
          ? invoice.subscription.currentPeriodEnd
          : new Date();
      const nextEnd =
        invoice.subscription.billingCycle === "YEARLY" ? addMonths(base, 12) : addMonths(base, 1);
      await tx.tenantSubscription.update({
        where: { id: invoice.subscription.id },
        data: {
          status: "ACTIVE",
          currentPeriodStart: invoice.periodStart,
          currentPeriodEnd: nextEnd,
          trialEndsAt: null,
        },
      });
      await tx.tenant.update({
        where: { id: invoice.tenantId },
        data: { status: "ACTIVE" },
      });
    }

    return paid;
  });
}

export async function subscriptionMrr() {
  const subs = await db.tenantSubscription.findMany({
    where: { status: { in: ["ACTIVE", "TRIALING"] } },
    include: { plan: true },
  });
  return subs.reduce((total, s) => {
    if (s.status === "TRIALING") return total;
    const monthly =
      s.billingCycle === "YEARLY" ? Math.round(s.plan.priceYearly / 12) : s.plan.priceMonthly;
    return total + monthly;
  }, 0);
}

/** Usage record for the current month, created lazily on first AI call. */
export async function getAiUsage(tenantId: string, limit: number) {
  const periodStart = startOfMonth();
  const usage = await db.tenantUsage.findUnique({
    where: { tenantId_periodStart: { tenantId, periodStart } },
  });
  return {
    periodStart,
    used: usage?.aiCreditsUsed ?? 0,
    limit,
    remaining: Math.max(0, limit - (usage?.aiCreditsUsed ?? 0)),
  };
}

/** Live storage usage, measured from uploaded files rather than a counter. */
export async function getStorageUsage(tenantId: string) {
  const result = await db.fileAsset.aggregate({
    where: { tenantId },
    _sum: { size: true },
    _count: { _all: true },
  });
  const bytes = result._sum.size ?? 0;
  return { bytes, files: result._count._all, megabytes: bytes / (1024 * 1024) };
}
