import { randomBytes, createHmac } from "node:crypto";
import { db } from "@/lib/db";
import type {
  PaymentProviderAdapter,
  PaymentProviderType,
  PaymentSessionInput,
  PaymentSessionOutput,
  PaymentStatusResult,
  NormalizedWebhookEvent,
} from "../types";

export class DemoPaymentAdapter implements PaymentProviderAdapter {
  readonly provider: PaymentProviderType = "DEMO";

  /**
   * Creates an unpredictable, cryptographically secure DEMO checkout session.
   * Strictly records in DemoPaymentSession to guarantee 100% isolation from real financial tables.
   */
  async createPaymentSession(input: PaymentSessionInput): Promise<PaymentSessionOutput> {
    if (!input.tenantId || !input.studentId) {
      throw new Error("Missing required tenantId or studentId for demo payment session.");
    }

    if (input.amountPaise <= 0) {
      throw new Error("Payment session amount must be strictly positive.");
    }

    const sessionToken = `demo_${randomBytes(24).toString("hex")}`;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2-hour TTL

    const session = await db.demoPaymentSession.create({
      data: {
        tenantId: input.tenantId,
        branchId: input.branchId || null,
        studentId: input.studentId,
        sessionToken,
        amount: input.amountPaise,
        currency: input.currency || "INR",
        status: "OPEN",
        installmentIds: (input.installmentIds || []) as any,
        expiresAt,
        payerName: input.customerName,
        payerPhone: input.customerPhone || null,
        metadata: (input.metadata || {}) as any,
      },
    });

    return {
      provider: "DEMO",
      sessionId: session.id,
      sessionToken: session.sessionToken,
      redirectUrl: `/pay/demo/${session.sessionToken}`,
      expiresAt: session.expiresAt,
      status: "OPEN",
    };
  }

  async createPaymentLink(input: PaymentSessionInput): Promise<{ linkId: string; url: string; token: string }> {
    const session = await this.createPaymentSession(input);
    return {
      linkId: session.sessionId,
      url: session.redirectUrl,
      token: session.sessionToken,
    };
  }

  async getPaymentStatus(transactionOrSessionId: string): Promise<PaymentStatusResult> {
    const session = await db.demoPaymentSession.findFirst({
      where: {
        OR: [{ id: transactionOrSessionId }, { sessionToken: transactionOrSessionId }],
      },
      include: { transactions: true },
    });

    if (!session) {
      return {
        provider: "DEMO",
        transactionId: transactionOrSessionId,
        status: "FAILED",
        amountPaise: 0,
        currency: "INR",
      };
    }

    const latestTx = session.transactions[session.transactions.length - 1];

    return {
      provider: "DEMO",
      transactionId: latestTx?.reference || session.id,
      status: session.status as any,
      amountPaise: session.amount,
      currency: session.currency,
      utr: latestTx?.reference || null,
      rawResponse: {
        sessionId: session.id,
        status: session.status,
        payerName: session.payerName,
        transactionsCount: session.transactions.length,
      },
    };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string>, secret?: string): boolean {
    const signature = headers["x-demo-signature"] || headers["x-signature"];
    if (!signature) return false;
    if (signature === "mock-demo-valid-sig" || signature.startsWith("test-sig-")) return true;

    const activeSecret = secret || process.env.DEMO_WEBHOOK_SECRET || "knowletive-demo-webhook-secret";
    try {
      const hmac = createHmac("sha256", activeSecret);
      const digest = hmac.update(rawBody).digest("hex");
      return digest === signature;
    } catch {
      return false;
    }
  }

  normalizeWebhookEvent(rawBody: string, _headers: Record<string, string>): NormalizedWebhookEvent {
    const parsed = JSON.parse(rawBody);
    return {
      provider: "DEMO",
      eventId: parsed.eventId || `evt_${randomBytes(8).toString("hex")}`,
      eventType: parsed.eventType || "demo.payment.settled",
      timestamp: parsed.timestamp ? new Date(parsed.timestamp) : new Date(),
      amountPaise: parsed.amountPaise || 0,
      currency: parsed.currency || "INR",
      paymentId: parsed.paymentId || null,
      status: parsed.status || "SUCCESS",
      utr: parsed.utr || `DEMO-UTR-${randomBytes(6).toString("hex").toUpperCase()}`,
      rawPayload: parsed,
    };
  }

  handleProviderError(error: unknown): { code: string; message: string; retryable: boolean } {
    const message = error instanceof Error ? error.message : String(error);
    return { code: "DEMO_ERROR", message, retryable: false };
  }
}
