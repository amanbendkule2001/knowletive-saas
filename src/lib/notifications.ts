import "server-only";

import { db } from "@/lib/db";
import type { NotificationChannel } from "@prisma/client";

/**
 * Provider-agnostic outbound notifications.
 *
 * Every message is written to `NotificationLog` (the outbox) before delivery,
 * so the UI can show what was sent, to whom, and why it failed. Real providers
 * activate from env vars; with no keys the development build logs to the server
 * console and production marks the row SKIPPED instead of leaking PII.
 */

export type NotificationInput = {
  tenantId?: string | null;
  recipientUserId?: string | null;
  channel: NotificationChannel;
  template: string;
  to: string;
  subject?: string;
  body: string;
  meta?: Record<string, unknown>;
};

export type DeliveryResult = {
  provider: string;
  providerRef?: string | null;
};

export function appUrl(path = "/") {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function configured(keys: string[]) {
  return keys.every((key) => Boolean(process.env[key]));
}

async function deliverEmail(to: string, subject: string, body: string): Promise<DeliveryResult> {
  // 1. Zero-cost SMTP delivery (Hostinger Mail or VPS Postfix)
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const nodemailer = await import("nodemailer");
      const port = Number(process.env.SMTP_PORT ?? 587);
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM ?? process.env.EMAIL_FROM ?? process.env.SMTP_USER,
        to,
        subject,
        text: body,
      });
      return { provider: "smtp", providerRef: info.messageId ?? null };
    } catch (err) {
      console.error("[notifications:smtp] Delivery error:", err);
      throw err;
    }
  }

  // 2. Fallback to Resend API if credentials exist
  if (configured(["RESEND_API_KEY", "EMAIL_FROM"])) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        text: body,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Resend rejected the email (${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    const payload = (await response.json()) as { id?: string };
    return { provider: "resend", providerRef: payload.id ?? null };
  }

  return deliverToConsole("email", to, subject, body);
}

function normalisePhone(phone: string) {
  const trimmed = phone.replace(/[^\d+]/g, "");
  if (trimmed.startsWith("+")) return trimmed;
  if (trimmed.length === 10) return `+91${trimmed}`;
  return `+${trimmed}`;
}

async function deliverSms(to: string, body: string): Promise<DeliveryResult> {
  if (!configured(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"])) {
    return deliverToConsole("sms", to, undefined, body);
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const form = new URLSearchParams({
    From: process.env.TWILIO_FROM!,
    To: normalisePhone(to),
    Body: body,
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Twilio rejected the SMS (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const payload = (await response.json()) as { sid?: string };
  return { provider: "twilio", providerRef: payload.sid ?? null };
}

async function deliverWhatsApp(to: string, body: string): Promise<DeliveryResult> {
  if (!configured(["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"])) {
    return deliverToConsole("whatsapp", to, undefined, body);
  }
  const response = await fetch(
    `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalisePhone(to).replace("+", ""),
        type: "text",
        text: { body },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error(`WhatsApp rejected the message (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const payload = (await response.json()) as { messages?: { id?: string }[] };
  return { provider: "whatsapp", providerRef: payload.messages?.[0]?.id ?? null };
}

function deliverToConsole(
  channel: string,
  to: string,
  subject: string | undefined,
  body: string,
): DeliveryResult {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${channel} provider is not configured. Set the provider env vars to enable live delivery.`,
    );
  }
  console.info(
    `\n[notifications:${channel}] to=${to}${subject ? ` subject=${JSON.stringify(subject)}` : ""}\n${body}\n`,
  );
  return { provider: "console", providerRef: null };
}

export async function sendNotification(input: NotificationInput) {
  const log = await db.notificationLog.create({
    data: {
      tenantId: input.tenantId ?? null,
      recipientUserId: input.recipientUserId ?? null,
      channel: input.channel,
      template: input.template,
      to: input.to,
      subject: input.subject,
      body: input.body,
      status: "QUEUED",
      meta: input.meta as never,
    },
  });

  if (!input.to.trim()) {
    await db.notificationLog.update({
      where: { id: log.id },
      data: { status: "SKIPPED", error: "No destination address on file." },
    });
    return { id: log.id, status: "SKIPPED" as const, error: "No destination address on file." };
  }

  try {
    if (input.channel === "IN_APP") {
      await db.notificationLog.update({
        where: { id: log.id },
        data: { status: "SENT", provider: "in_app", sentAt: new Date() },
      });
      return { id: log.id, status: "SENT" as const };
    }

    const result =
      input.channel === "EMAIL"
        ? await deliverEmail(input.to, input.subject ?? "Knowletive update", input.body)
        : input.channel === "SMS"
          ? await deliverSms(input.to, input.body)
          : await deliverWhatsApp(input.to, input.body);

    await db.notificationLog.update({
      where: { id: log.id },
      data: {
        status: "SENT",
        provider: result.provider,
        providerRef: result.providerRef ?? null,
        attempts: 1,
        sentAt: new Date(),
      },
    });
    return { id: log.id, status: "SENT" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delivery failed.";
    const status = message.includes("not configured") ? "SKIPPED" : "FAILED";
    await db.notificationLog.update({
      where: { id: log.id },
      data: { status, attempts: 1, error: message.slice(0, 500) },
    });
    return { id: log.id, status: status as "SKIPPED" | "FAILED", error: message };
  }
}

export async function retryNotification(id: string) {
  const log = await db.notificationLog.findUnique({ where: { id } });
  if (!log || log.status === "SENT") return;
  await db.notificationLog.delete({ where: { id } });
  await sendNotification({
    tenantId: log.tenantId,
    recipientUserId: log.recipientUserId,
    channel: log.channel,
    template: log.template,
    to: log.to,
    subject: log.subject ?? undefined,
    body: log.body,
    meta: (log.meta as Record<string, unknown> | null) ?? undefined,
  });
}

// ─────────────────────────────── Templates ───────────────────────────────

export function passwordResetMessage(name: string, resetUrl: string) {
  return {
    subject: "Reset your Knowletive password",
    body: `Hi ${name},

We received a request to reset your Knowletive password. Open the link below to choose a new one. It expires in 60 minutes and can be used once.

${resetUrl}

If you did not request this, you can ignore this email. Your password will not change until the link is used.

— Knowletive`,
  };
}

export function feeReminderMessage(input: {
  institute: string;
  guardianName: string;
  studentName: string;
  invoiceTitle: string;
  balance: string;
  dueDate: string;
  payUrl?: string;
}) {
  return {
    subject: `Fee reminder — ${input.studentName} (${input.invoiceTitle})`,
    body: `Dear ${input.guardianName},

This is a reminder from ${input.institute} that ${input.balance} is pending for ${input.studentName}'s ${input.invoiceTitle}. The due date was ${input.dueDate}.

${input.payUrl ? `Pay securely online: ${input.payUrl}\n\n` : ""}You can also pay at the accounts office during working hours. If you need a payment plan, reply to this message and we will help.

Thank you,
${input.institute}`,
  };
}

export function paymentReceiptMessage(input: {
  institute: string;
  guardianName: string;
  studentName: string;
  amount: string;
  invoiceTitle: string;
  reference: string;
}) {
  return {
    subject: `Payment received — ${input.studentName}`,
    body: `Dear ${input.guardianName},

We have received ${input.amount} towards ${input.studentName}'s ${input.invoiceTitle}. Reference: ${input.reference}.

Thank you,
${input.institute}`,
  };
}

export function absenceAlertMessage(input: {
  institute: string;
  guardianName: string;
  studentName: string;
  dateLabel: string;
  status: string;
}) {
  return {
    subject: `${input.studentName} was marked ${input.status.toLowerCase()} today`,
    body: `Dear ${input.guardianName},

${input.studentName} was marked ${input.status.toLowerCase()} in the attendance register for ${input.dateLabel} at ${input.institute}.

If this is unexpected, please contact the class teacher or the school office.

— ${input.institute}`,
  };
}
