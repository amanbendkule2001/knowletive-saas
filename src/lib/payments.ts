import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { markInvoicePaid } from "@/lib/billing";
import { appUrl, paymentReceiptMessage, sendNotification } from "@/lib/notifications";
import { money } from "@/lib/format";

/**
 * Online payment adapters for both school fees and platform subscriptions.
 *
 * Payments stay provider-agnostic: Razorpay and Stripe use the same
 * `createCheckout` contract, and `manual` remains the no-key fallback with an
 * internal tokenised payment page. Webhook signatures are always verified and
 * events are de-duplicated by provider event id.
 */

export type PaymentProviderId = "razorpay" | "stripe" | "manual";

export function paymentProviderId(): PaymentProviderId {
  const selected = (process.env.PAYMENT_PROVIDER ?? process.env.BILLING_PROVIDER ?? "manual").toLowerCase();
  if (selected === "razorpay" && razorpayConfigured()) return "razorpay";
  if (selected === "stripe" && stripeConfigured()) return "stripe";
  return "manual";
}

export function razorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function onlinePaymentsEnabled() {
  return paymentProviderId() !== "manual";
}

export function providerLabel() {
  const provider = paymentProviderId();
  return provider === "razorpay" ? "Razorpay" : provider === "stripe" ? "Stripe" : "Manual";
}

type CheckoutArgs = {
  referenceId: string;
  amount: number;
  currency: string;
  description: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  successUrl: string;
  cancelUrl: string;
};

type CheckoutCreated = {
  provider: PaymentProviderId;
  providerRef: string | null;
  url: string | null;
};

async function createRazorpayLink(args: CheckoutArgs): Promise<CheckoutCreated> {
  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
  ).toString("base64");
  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: args.amount,
      currency: args.currency.toUpperCase(),
      accept_partial: false,
      reference_id: args.referenceId,
      description: args.description,
      customer: {
        name: args.customerName,
        ...(args.customerEmail ? { email: args.customerEmail } : {}),
        ...(args.customerPhone ? { contact: args.customerPhone } : {}),
      },
      notify: {
        email: Boolean(args.customerEmail),
        sms: Boolean(args.customerPhone),
      },
      reminder_enable: true,
      callback_url: args.successUrl,
      callback_method: "get",
      expire_by: Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Razorpay error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const payload = (await response.json()) as { id: string; short_url: string };
  return { provider: "razorpay", providerRef: payload.id, url: payload.short_url };
}

async function createStripeSession(args: CheckoutArgs): Promise<CheckoutCreated> {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", args.successUrl);
  form.set("cancel_url", args.cancelUrl);
  form.set("client_reference_id", args.referenceId);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", args.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(args.amount));
  form.set("line_items[0][price_data][product_data][name]", args.description);
  form.set("metadata[reference_id]", args.referenceId);
  if (args.customerEmail) form.set("customer_email", args.customerEmail);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Stripe error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const payload = (await response.json()) as { id: string; url: string };
  return { provider: "stripe", providerRef: payload.id, url: payload.url };
}

export async function createCheckout(args: CheckoutArgs): Promise<CheckoutCreated> {
  const provider = paymentProviderId();
  if (provider === "razorpay") return createRazorpayLink(args);
  if (provider === "stripe") return createStripeSession(args);
  return { provider: "manual", providerRef: null, url: null };
}

// ─────────────────────────────── Fee payment links ───────────────────────────────

const LINK_TTL_DAYS = 14;

export async function getOrCreateFeePaymentLink(invoiceId: string, tenantId: string) {
  const invoice = await db.feeInvoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: {
      student: { select: { firstName: true, lastName: true } },
      tenant: { select: { name: true, currency: true } },
      paymentLinks: {
        where: { status: "OPEN", expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!invoice) throw new Error("Fee invoice not found");
  const outstanding = invoice.amount - invoice.paidAmount;
  if (outstanding <= 0) throw new Error("This invoice has no outstanding balance");

  const reusable = invoice.paymentLinks.find((link) => link.amount === outstanding);
  if (reusable) {
    return { link: reusable, url: reusable.url ?? appUrl(`/pay/${reusable.token}`) };
  }

  const token = randomBytes(24).toString("base64url");
  const studentName = `${invoice.student.firstName} ${invoice.student.lastName}`;
  const description = `${invoice.title} — ${studentName} (${invoice.number})`;
  const successUrl = appUrl(`/pay/${token}`);

  const link = await db.feePaymentLink.create({
    data: {
      tenantId,
      feeInvoiceId: invoice.id,
      token,
      amount: outstanding,
      currency: invoice.currency,
      expiresAt: new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000),
      provider: "manual",
      url: appUrl(`/pay/${token}`),
    },
  });

  if (!onlinePaymentsEnabled()) {
    return { link, url: appUrl(`/pay/${token}`) };
  }

  const primaryGuardian = await db.studentGuardian.findFirst({
    where: { studentId: invoice.studentId },
    orderBy: { isPrimary: "desc" },
    include: { guardian: { select: { name: true, email: true, phone: true } } },
  });

  try {
    const checkout = await createCheckout({
      referenceId: link.id,
      amount: outstanding,
      currency: invoice.currency,
      description,
      customerName: primaryGuardian?.guardian.name ?? studentName,
      customerEmail: primaryGuardian?.guardian.email,
      customerPhone: primaryGuardian?.guardian.phone,
      successUrl,
      cancelUrl: successUrl,
    });
    const updated = await db.feePaymentLink.update({
      where: { id: link.id },
      data: {
        provider: checkout.provider,
        providerRef: checkout.providerRef,
        url: checkout.url ?? appUrl(`/pay/${token}`),
      },
    });
    return { link: updated, url: updated.url! };
  } catch (error) {
    console.error("[payments] could not create online link, falling back to manual", error);
    return { link, url: appUrl(`/pay/${token}`) };
  }
}

export async function settleFeePaymentLink(input: {
  provider: string;
  providerRef?: string | null;
  referenceId?: string | null;
  providerPaymentId?: string | null;
  amountPaid?: number | null;
}) {
  const link =
    (input.providerRef
      ? await db.feePaymentLink.findFirst({
          where: { provider: input.provider, providerRef: input.providerRef },
        })
      : null) ??
    (input.referenceId
      ? await db.feePaymentLink.findFirst({ where: { id: input.referenceId } })
      : null);

  if (!link) return null;
  if (link.status === "PAID") return link;

  const invoice = await db.feeInvoice.findFirst({
    where: { id: link.feeInvoiceId, tenantId: link.tenantId },
    include: {
      student: { select: { firstName: true, lastName: true } },
      tenant: { select: { name: true } },
    },
  });
  if (!invoice) return null;

  const outstanding = invoice.amount - invoice.paidAmount;
  const amount = Math.min(
    input.amountPaid && input.amountPaid > 0 ? input.amountPaid : link.amount,
    outstanding,
  );
  if (amount <= 0) {
    await db.feePaymentLink.update({
      where: { id: link.id },
      data: { status: "PAID", paidAt: new Date() },
    });
    return link;
  }

  const paidAmount = invoice.paidAmount + amount;
  const fullyPaid = paidAmount >= invoice.amount;

  const updated = await db.$transaction(async (tx) => {
    await tx.feePayment.create({
      data: {
        tenantId: link.tenantId,
        feeInvoiceId: invoice.id,
        amount,
        method: input.provider === "razorpay" ? "UPI" : "CARD",
        reference: input.providerPaymentId ?? input.providerRef ?? null,
        provider: input.provider,
        providerRef: input.providerRef ?? null,
      },
    });
    await tx.feeInvoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount,
        status: fullyPaid ? "PAID" : "PARTIAL",
        paidAt: fullyPaid ? new Date() : null,
      },
    });
    return tx.feePaymentLink.update({
      where: { id: link.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        providerRef: input.providerRef ?? link.providerRef,
      },
    });
  });

  const guardian = await db.studentGuardian.findFirst({
    where: { studentId: invoice.studentId, guardian: { email: { not: null } } },
    orderBy: { isPrimary: "desc" },
    include: { guardian: { select: { name: true, email: true } } },
  });
  if (guardian?.guardian.email) {
    const receipt = paymentReceiptMessage({
      institute: invoice.tenant.name,
      guardianName: guardian.guardian.name,
      studentName: `${invoice.student.firstName} ${invoice.student.lastName}`,
      amount: money(amount, invoice.currency),
      invoiceTitle: invoice.title,
      reference: input.providerPaymentId ?? input.providerRef ?? invoice.number,
    });
    await sendNotification({
      tenantId: invoice.tenantId,
      channel: "EMAIL",
      template: "payment_receipt",
      to: guardian.guardian.email,
      subject: receipt.subject,
      body: receipt.body,
      meta: { invoiceId: invoice.id, provider: input.provider },
    });
  }

  return updated;
}

export async function settlePlatformInvoice(input: {
  invoiceId: string;
  provider: string;
  providerRef: string;
}) {
  const invoice = await db.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!invoice || invoice.status === "PAID") return false;
  await markInvoicePaid(invoice.id, {
    provider: input.provider,
    providerRef: input.providerRef,
  });
  await db.invoice.update({
    where: { id: invoice.id },
    data: { provider: input.provider, providerRef: input.providerRef, checkoutUrl: null },
  });
  return true;
}

// ─────────────────────────────── Webhooks ───────────────────────────────

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyRazorpayWebhook(rawBody: string, signature: string | null) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

export function verifyStripeWebhook(rawBody: string, header: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return safeEqual(expected, parts.v1 ?? "");
}

type RazorpayWebhook = {
  event: string;
  payload?: {
    payment_link?: { entity?: { id?: string; reference_id?: string; amount?: number; status?: string } };
    payment?: { entity?: { id?: string; amount?: number } };
  };
};

export async function processRazorpayWebhook(rawBody: string) {
  const body = JSON.parse(rawBody) as RazorpayWebhook;
  if (body.event !== "payment_link.paid" && body.event !== "payment_link.cancelled") {
    return { handled: false, detail: `ignored ${body.event}` };
  }
  const link = body.payload?.payment_link?.entity;
  if (!link?.id) return { handled: false, detail: "no payment link" };

  if (body.event === "payment_link.cancelled") {
    await db.feePaymentLink.updateMany({
      where: { provider: "razorpay", providerRef: link.id },
      data: { status: "CANCELED" },
    });
    return { handled: true, detail: "link cancelled" };
  }

  const payment = body.payload?.payment?.entity;
  const fee = await settleFeePaymentLink({
    provider: "razorpay",
    providerRef: link.id,
    referenceId: link.reference_id,
    providerPaymentId: payment?.id ?? null,
    amountPaid: payment?.amount ?? link.amount ?? null,
  });
  if (fee) return { handled: true, detail: `fee invoice settled ${fee.feeInvoiceId}` };

  if (link.reference_id) {
    const platform = await settlePlatformInvoice({
      invoiceId: link.reference_id,
      provider: "razorpay",
      providerRef: link.id,
    });
    if (platform) return { handled: true, detail: "platform invoice settled" };
  }
  return { handled: false, detail: "reference not found" };
}

type StripeWebhook = {
  type: string;
  data?: {
    object?: {
      id?: string;
      client_reference_id?: string | null;
      payment_intent?: string | null;
      amount_total?: number | null;
      metadata?: Record<string, string> | null;
    };
  };
};

export async function processStripeWebhook(rawBody: string) {
  const body = JSON.parse(rawBody) as StripeWebhook;
  if (body.type !== "checkout.session.completed") {
    return { handled: false, detail: `ignored ${body.type}` };
  }
  const session = body.data?.object;
  if (!session?.id) return { handled: false, detail: "no session" };
  const reference = session.client_reference_id ?? session.metadata?.reference_id ?? null;

  const fee = await settleFeePaymentLink({
    provider: "stripe",
    providerRef: session.id,
    referenceId: reference,
    providerPaymentId:
      typeof session.payment_intent === "string" ? session.payment_intent : null,
    amountPaid: session.amount_total ?? null,
  });
  if (fee) return { handled: true, detail: `fee invoice settled ${fee.feeInvoiceId}` };

  if (reference) {
    const platform = await settlePlatformInvoice({
      invoiceId: reference,
      provider: "stripe",
      providerRef: session.id,
    });
    if (platform) return { handled: true, detail: "platform invoice settled" };
  }
  return { handled: false, detail: "reference not found" };
}

export function webhookStatus(provider: PaymentProviderId) {
  if (provider === "razorpay") {
    return {
      configured: razorpayConfigured(),
      webhook: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
    };
  }
  if (provider === "stripe") {
    return {
      configured: stripeConfigured(),
      webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    };
  }
  return { configured: false, webhook: false };
}
