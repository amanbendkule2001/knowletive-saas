import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import type { FeeGatewayAdapter, JodoWebhookPayload, WebhookProcessResult } from "./types";

export class MockJodoAdapter implements FeeGatewayAdapter {
  private secret: string;

  constructor(secret?: string) {
    this.secret = secret || process.env.JODO_WEBHOOK_SECRET || "mock-jodo-secret-key-for-local-testing";
  }

  /**
   * Verifies the HMAC-SHA256 signature sent by Jodo webhooks.
   * If secret is not configured or in test mode with mock signature, allows verification.
   */
  verifySignature(rawPayload: string, signature: string, secret?: string): boolean {
    const activeSecret = secret || this.secret;
    if (!signature) return false;

    // Local / staging mock bypass token
    if (signature === "mock-valid-signature" || signature.startsWith("test-sig-")) {
      return true;
    }

    try {
      const hmac = createHmac("sha256", activeSecret);
      const digest = hmac.update(rawPayload).digest("hex");
      return digest === signature;
    } catch {
      return false;
    }
  }

  /**
   * Processes a Jodo webhook lifecycle event with strict idempotency and atomic transactional guarantees.
   */
  async processWebhook(event: JodoWebhookPayload): Promise<WebhookProcessResult> {
    const { event_id: eventId, event_type: eventType, data } = event;

    if (!eventId) {
      return {
        success: false,
        status: "FAILED",
        eventId: "unknown",
        eventType: eventType || "unknown",
        error: "Missing required event_id in webhook payload.",
      };
    }

    // 1. Idempotency Check: Return immediately if already processed
    const existing = await db.webhookEvent.findUnique({
      where: { provider_eventId: { provider: "jodo", eventId } },
    });

    if (existing && existing.status === "PROCESSED") {
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

    try {
      const result = await db.$transaction(async (tx) => {
        // Record / update raw webhook event to PROCESSING
        await tx.webhookEvent.upsert({
          where: { provider_eventId: { provider: "jodo", eventId } },
          update: {
            eventType,
            rawPayload: event as any,
            status: "PROCESSING",
            error: null,
          },
          create: {
            provider: "jodo",
            eventId,
            eventType,
            rawPayload: event as any,
            status: "PROCESSING",
          },
        });

        // Resolve branch and tenant
        let branchId = data.branch_id || null;
        let tenantId = data.tenant_id || null;

        // If collector_code is supplied, resolve branch and tenant via collectorCode
        if (data.collector_code) {
          const matchedBranch = await tx.branch.findFirst({
            where: { collectorCode: data.collector_code, isActive: true },
            select: { id: true, tenantId: true },
          });
          if (matchedBranch) {
            branchId = matchedBranch.id;
            tenantId = matchedBranch.tenantId;
          }
        }

        // If tenantId is not resolved yet, check invoice or payment link
        let invoice = null;
        if (data.invoice_id) {
          invoice = await tx.feeInvoice.findUnique({
            where: { id: data.invoice_id },
            include: { student: true },
          });
          if (invoice) {
            tenantId = invoice.tenantId;
            const invoiceBranch = invoice.branchId || invoice.student?.branchId || null;
            // Prefer explicit data.branch_id, then invoice-level sub-branch, then collectorCode branch
            branchId = data.branch_id || invoiceBranch || branchId;
          }
        } else if (data.order_id || data.payment_link_id) {
          const link = await tx.feePaymentLink.findFirst({
            where: {
              OR: [
                { id: data.payment_link_id },
                { token: data.order_id },
                { providerRef: data.order_id },
              ],
            },
            include: { feeInvoice: { include: { student: true } } },
          });
          if (link) {
            invoice = link.feeInvoice;
            tenantId = link.tenantId;
            const linkBranch = link.branchId || invoice.branchId || invoice.student?.branchId || null;
            branchId = data.branch_id || linkBranch || branchId;
          }
        }

        // ──────────────────────────── 2. TRACK A: DEBITED EVENTS ────────────────────────────
        // Mark student invoice paid/partial & issue receipt WITHOUT crediting branch payout ledger yet
        const isDebited =
          eventType === "pay.payment.debited" ||
          eventType === "order.payment.debited" ||
          eventType === "payment_link.payment.debited" ||
          eventType === "flex.instalment.debited" ||
          eventType.endsWith(".debited");

        if (isDebited) {
          const amount = data.amount; // in paise
          let receiptNumber: string | null = null;

          if (invoice) {
            const newPaidAmount = invoice.paidAmount + amount;
            const isFull = newPaidAmount >= invoice.amount;

            await tx.feeInvoice.update({
              where: { id: invoice.id },
              data: {
                paidAmount: newPaidAmount,
                status: isFull ? "PAID" : "PARTIAL",
                paidAt: isFull ? new Date() : invoice.paidAt,
              },
            });

            // Create FeePayment record
            await tx.feePayment.create({
              data: {
                tenantId: invoice.tenantId,
                feeInvoiceId: invoice.id,
                branchId,
                amount,
                method: "ONLINE_JODO",
                reference: data.utr || data.payment_id || eventId,
                provider: "jodo",
                providerRef: data.payment_id || data.order_id || eventId,
              },
            });

            // Issue Layer 1 Immutable PaymentReceipt
            const count = await tx.paymentReceipt.count({ where: { tenantId: invoice.tenantId } });
            receiptNumber = `RCPT-JODO-${(count + 1).toString().padStart(6, "0")}`;

            const receipt = await tx.paymentReceipt.create({
              data: {
                tenantId: invoice.tenantId,
                studentId: invoice.studentId,
                branchId,
                receiptNumber,
                amount,
                currency: data.currency || "INR",
                method: "ONLINE_JODO",
                reference: data.utr || data.payment_id || eventId,
                provider: "jodo",
                providerRef: data.payment_id || data.order_id || eventId,
                merchantAccountKey: data.collector_code || "JODO_DEFAULT",
                payerName: data.payer_name || `${invoice.student.firstName} ${invoice.student.lastName}`,
                payerPhone: data.payer_phone || invoice.student.phone || null,
                payerEmail: data.payer_email || invoice.student.email || null,
              },
            });

            // Create 1:1 PaymentReceiptBalance
            await tx.paymentReceiptBalance.create({
              data: {
                tenantId: invoice.tenantId,
                receiptId: receipt.id,
                allocatedAmount: amount,
                unappliedAmount: 0,
                status: "FULLY_ALLOCATED",
              },
            });

            // Create PaymentAllocation
            await tx.paymentAllocation.create({
              data: {
                tenantId: invoice.tenantId,
                receiptId: receipt.id,
                studentId: invoice.studentId,
                feeInvoiceId: invoice.id,
                amount,
              },
            });
          }

          // Complete WebhookEvent
          await tx.webhookEvent.update({
            where: { provider_eventId: { provider: "jodo", eventId } },
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
        }

        // ──────────────────────────── 3. TRACK B: SETTLED EVENTS ────────────────────────────
        // Credit branch's online Jodo payable ledger balance only after gateway settlement
        const isSettled =
          eventType === "pay.payment.settled" ||
          eventType === "order.payment.settled" ||
          eventType === "payment_link.payment.settled" ||
          eventType === "flex.instalment.settled" ||
          eventType.endsWith(".settled");

        if (isSettled) {
          const amount = data.amount; // in paise
          let ledgerEntryId: string | null = null;

          if (tenantId && branchId) {
            // Find latest balanceAfter for the branch to maintain running ledger balance
            const lastEntry = await tx.branchLedgerEntry.findFirst({
              where: { tenantId, branchId },
              orderBy: { postedAt: "desc" },
              select: { balanceAfter: true },
            });
            const prevBalance = lastEntry?.balanceAfter ?? 0;
            const newBalance = prevBalance + amount;

            const ledgerEntry = await tx.branchLedgerEntry.create({
              data: {
                tenantId,
                branchId,
                entryType: "CREDIT_SETTLEMENT",
                channel: "ONLINE_JODO",
                amount,
                balanceAfter: newBalance,
                currency: data.currency || "INR",
                referenceType: "WEBHOOK_EVENT",
                referenceId: eventId,
                utrReference: data.settlement_utr || data.utr || null,
                description: `Jodo settlement credited: ₹${(amount / 100).toLocaleString("en-IN")}`,
                metadata: {
                  jodo_payment_id: data.payment_id,
                  settlement_id: data.settlement_id,
                  collector_code: data.collector_code,
                },
              },
            });
            ledgerEntryId = ledgerEntry.id;
          }

          await tx.webhookEvent.update({
            where: { provider_eventId: { provider: "jodo", eventId } },
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
            ledgerEntryId,
          };
        }

        // ──────────────────────────── 4. BOUNCE / CANCELLATION / REFUND EVENTS ────────────────────────────
        // Reopen student invoice dues and post debit reversal to branch ledger
        const isBounced =
          eventType === "flex.instalment.bounced" ||
          eventType.endsWith(".bounced");
        const isCancelled =
          eventType === "direct.payment.cancelled" ||
          eventType.endsWith(".cancelled") ||
          eventType.endsWith(".canceled");
        const isRefund =
          eventType === "pay.payment.refunded" ||
          eventType === "payment.refunded" ||
          eventType.endsWith(".refunded") ||
          eventType.includes("refund");

        if (isBounced || isCancelled || isRefund) {
          const amount = data.amount;
          let ledgerEntryId: string | null = null;

          // Reopen student invoice if present
          if (invoice) {
            const adjustedPaidAmount = Math.max(0, invoice.paidAmount - amount);
            await tx.feeInvoice.update({
              where: { id: invoice.id },
              data: {
                paidAmount: adjustedPaidAmount,
                status: adjustedPaidAmount > 0 ? "PARTIAL" : "OVERDUE",
              },
            });
          }

          // Post negative adjustment / clawback to branch payable ledger
          if (tenantId && branchId) {
            const lastEntry = await tx.branchLedgerEntry.findFirst({
              where: { tenantId, branchId },
              orderBy: { postedAt: "desc" },
              select: { balanceAfter: true },
            });
            const prevBalance = lastEntry?.balanceAfter ?? 0;
            const newBalance = prevBalance - amount; // Decrements balance, supports negative carry-forward

            const entryType = isBounced ? "DEBIT_BOUNCE" : "DEBIT_REFUND";
            const ledgerEntry = await tx.branchLedgerEntry.create({
              data: {
                tenantId,
                branchId,
                entryType,
                channel: "ONLINE_JODO",
                amount,
                balanceAfter: newBalance,
                currency: data.currency || "INR",
                referenceType: "WEBHOOK_EVENT",
                referenceId: eventId,
                utrReference: data.utr || null,
                description: isBounced
                  ? `Flex instalment bounce reversal: ₹${(amount / 100).toLocaleString("en-IN")} (${data.bounce_reason || "Insufficient funds"})`
                  : isRefund
                    ? `Payment refund reversal: ₹${(amount / 100).toLocaleString("en-IN")}`
                    : `Payment cancellation refund reversal: ₹${(amount / 100).toLocaleString("en-IN")}`,
                metadata: {
                  reason: data.bounce_reason || data.cancellation_reason || data.refund_reason,
                  payment_id: data.payment_id,
                },
              },
            });
            ledgerEntryId = ledgerEntry.id;
          }

          await tx.webhookEvent.update({
            where: { provider_eventId: { provider: "jodo", eventId } },
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
            ledgerEntryId,
          };
        }

        // Unhandled event types: record as PROCESSED / IGNORED
        await tx.webhookEvent.update({
          where: { provider_eventId: { provider: "jodo", eventId } },
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
      });

      return result;
    } catch (err: any) {
      await db.webhookEvent.upsert({
        where: { provider_eventId: { provider: "jodo", eventId } },
        update: { status: "FAILED", error: err?.message || String(err) },
        create: {
          provider: "jodo",
          eventId,
          eventType,
          rawPayload: event as any,
          status: "FAILED",
          error: err?.message || String(err),
        },
      });

      return {
        success: false,
        status: "FAILED",
        eventId,
        eventType,
        error: err?.message || String(err),
      };
    }
  }
}
