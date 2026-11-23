import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { NormalizedWebhookEvent, WebhookProcessResult } from "./types";
import { getPaymentProvider } from "./registry";

export interface IngestWebhookInput {
  provider: "DEMO" | "JODO";
  rawBody: string;
  headers: Record<string, string>;
  tenantId?: string | null;
  branchId?: string | null;
}

/**
 * Computes a deterministic SHA-256 hash of the raw payload string.
 */
export function hashPayload(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

/**
 * Ingests, validates, verifies, and idempotently processes an incoming webhook.
 * Guarantees durable inbox persistence, duplicate protection, payload tamper detection,
 * ambiguous branch quarantine, and atomic financial mutations.
 */
export async function processWebhookInbox(input: IngestWebhookInput): Promise<WebhookProcessResult> {
  const { provider, rawBody, headers } = input;
  const adapter = await getPaymentProvider(provider, input.tenantId || undefined, input.branchId || undefined);

  // 1. Verify Signature
  const isValidSig = adapter.verifyWebhook(rawBody, headers);
  if (!isValidSig) {
    return {
      success: false,
      status: "FAILED",
      eventId: "unverified",
      eventType: "unknown",
      error: "Invalid or missing webhook signature.",
    };
  }

  // 2. Normalize payload
  let normalized: NormalizedWebhookEvent;
  try {
    normalized = adapter.normalizeWebhookEvent(rawBody, headers);
  } catch (err: any) {
    return {
      success: false,
      status: "FAILED",
      eventId: "malformed",
      eventType: "unknown",
      error: `Malformed webhook body: ${err.message}`,
    };
  }

  const { eventId, eventType } = normalized;
  const currentPayloadHash = hashPayload(rawBody);

  // 3. Durable Inbox Check: Check for existing event
  const existing = await db.webhookEvent.findUnique({
    where: { provider_eventId: { provider, eventId } },
  });

  if (existing) {
    // 3a. Conflict Detection: Same event ID arriving with different payload hash
    const existingMeta = (existing.payload as Record<string, any>) || {};
    if (existingMeta.payloadHash && existingMeta.payloadHash !== currentPayloadHash) {
      await db.webhookEvent.update({
        where: { id: existing.id },
        data: {
          status: "FAILED",
          error: "Payload tamper detected: same eventId arrived with conflicting payload hash.",
        },
      });

      return {
        success: false,
        status: "FAILED",
        eventId,
        eventType,
        error: "Payload tamper detected: eventId already registered with differing payload fingerprint.",
      };
    }

    // 3b. Idempotency Check: Return immediately if already processed
    if (existing.status === "PROCESSED") {
      return {
        success: true,
        duplicate: true,
        status: "DUPLICATE",
        eventId,
        eventType,
        tenantId: existing.tenantId,
        branchId: existing.branchId,
      };
    }
  }

  // 4. Record event in durable inbox as PROCESSING
  const inboxRecord = await db.webhookEvent.upsert({
    where: { provider_eventId: { provider, eventId } },
    update: {
      eventType,
      rawPayload: normalized.rawPayload as any,
      payload: {
        payloadHash: currentPayloadHash,
        merchantAccountKey: normalized.merchantAccountKey,
      } as any,
      status: "PROCESSING",
      error: null,
    },
    create: {
      provider,
      eventId,
      eventType,
      rawPayload: normalized.rawPayload as any,
      payload: {
        payloadHash: currentPayloadHash,
        merchantAccountKey: normalized.merchantAccountKey,
      } as any,
      status: "PROCESSING",
    },
  });

  // 5. Branch & Tenant Attribution
  let tenantId = input.tenantId || null;
  let branchId = input.branchId || null;
  let isAmbiguous = false;

  // If collectorCode is present, check how many branches match
  if (normalized.collectorCode) {
    const matchingBranches = await db.branch.findMany({
      where: { collectorCode: normalized.collectorCode, isActive: true },
      select: { id: true, tenantId: true, parentBranchId: true },
    });

    if (matchingBranches.length === 1) {
      branchId = matchingBranches[0].id;
      tenantId = matchingBranches[0].tenantId;
    } else if (matchingBranches.length > 1) {
      // Multiple branches share this collector code! Check if payment metadata resolves it
      const metaBranch = (normalized.metadata?.branch_id as string) || null;
      if (metaBranch && matchingBranches.some((b) => b.id === metaBranch)) {
        branchId = metaBranch;
        tenantId = matchingBranches[0].tenantId;
      } else {
        isAmbiguous = true;
      }
    }
  }

  // 6. Quarantine Ambiguous Events (Never guess branch!)
  if (isAmbiguous) {
    await db.webhookEvent.update({
      where: { id: inboxRecord.id },
      data: {
        status: "QUARANTINED",
        error: "QUARANTINED: Shared collector code cannot be resolved unambiguously to a single branch.",
        payload: {
          quarantineReason: "Shared collector code cannot be resolved unambiguously to a single branch.",
        } as any,
      },
    });

    return {
      success: false,
      status: "QUARANTINED",
      eventId,
      eventType,
      quarantineReason: "Shared collector code matches multiple branches without explicit link attribution.",
      error: "Event quarantined due to ambiguous branch routing.",
    };
  }

  // 7. Atomic Financial Processing
  try {
    const result = await db.$transaction(async (tx) => {
      // In DEMO mode, do not perform genuine financial mutations
      if (provider === "DEMO") {
        await tx.webhookEvent.update({
          where: { id: inboxRecord.id },
          data: {
            status: "PROCESSED",
            processedAt: new Date(),
            tenantId,
            branchId,
          },
        });
        return {
          success: true,
          status: "PROCESSED" as const,
          eventId,
          eventType,
          tenantId,
          branchId,
        };
      }

      // In JODO mode, if invoice is identified, apply financial mutations
      let invoice = null;
      const orderOrInvoiceId = normalized.orderId || (normalized.rawPayload as any)?.data?.invoice_id;
      if (orderOrInvoiceId) {
        invoice = await tx.feeInvoice.findFirst({
          where: {
            OR: [{ id: orderOrInvoiceId }, { number: orderOrInvoiceId }],
          },
          include: { student: true },
        });
      }

      if (invoice && normalized.status === "SUCCESS") {
        tenantId = invoice.tenantId;
        branchId = invoice.branchId || invoice.student?.branchId || branchId;

        const amountPaise = normalized.amountPaise;
        const newPaid = invoice.paidAmount + amountPaise;
        const isFull = newPaid >= invoice.amount;

        await tx.feeInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: newPaid,
            status: isFull ? "PAID" : "PARTIAL",
            paidAt: isFull ? new Date() : invoice.paidAt,
          },
        });

        // Create FeePayment
        await tx.feePayment.create({
          data: {
            tenantId,
            feeInvoiceId: invoice.id,
            branchId,
            amount: amountPaise,
            method: "ONLINE_JODO",
            reference: normalized.utr || eventId,
            provider: "jodo",
            providerRef: normalized.paymentId || eventId,
          },
        });

        // Issue Layer 1 PaymentReceipt
        const count = await tx.paymentReceipt.count({ where: { tenantId } });
        const receiptNumber = `RCPT-JODO-${(count + 1).toString().padStart(6, "0")}`;

        const receipt = await tx.paymentReceipt.create({
          data: {
            tenantId,
            studentId: invoice.studentId,
            branchId,
            receiptNumber,
            amount: amountPaise,
            currency: normalized.currency,
            method: "ONLINE_JODO",
            reference: normalized.utr || eventId,
            provider: "jodo",
            providerRef: normalized.paymentId || eventId,
            merchantAccountKey: normalized.merchantAccountKey || "JODO_DEFAULT",
            payerName: normalized.payerName || `${invoice.student.firstName} ${invoice.student.lastName}`,
            payerPhone: normalized.payerPhone || invoice.student.phone || null,
            payerEmail: normalized.payerEmail || invoice.student.email || null,
          },
        });

        await tx.paymentReceiptBalance.create({
          data: {
            tenantId,
            receiptId: receipt.id,
            allocatedAmount: amountPaise,
            unappliedAmount: 0,
            status: "FULLY_ALLOCATED",
          },
        });

        await tx.paymentAllocation.create({
          data: {
            tenantId,
            receiptId: receipt.id,
            studentId: invoice.studentId,
            feeInvoiceId: invoice.id,
            amount: amountPaise,
          },
        });
      }

      await tx.webhookEvent.update({
        where: { id: inboxRecord.id },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
          tenantId,
          branchId,
        },
      });

      return {
        success: true,
        status: "PROCESSED" as const,
        eventId,
        eventType,
        tenantId,
        branchId,
        invoiceId: invoice?.id || null,
      };
    });

    return result;
  } catch (err: any) {
    // Leave event in FAILED status for safe retry
    await db.webhookEvent.update({
      where: { id: inboxRecord.id },
      data: {
        status: "FAILED",
        error: err.message || String(err),
      },
    });

    return {
      success: false,
      status: "FAILED",
      eventId,
      eventType,
      error: err.message || String(err),
    };
  }
}
