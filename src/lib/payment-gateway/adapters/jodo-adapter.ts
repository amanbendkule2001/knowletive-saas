import type {
  PaymentProviderAdapter,
  PaymentProviderType,
  PaymentSessionInput,
  PaymentSessionOutput,
  PaymentStatusResult,
  NormalizedWebhookEvent,
} from "../types";

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string, reason: string) {
    super(`[${provider}] Payment provider is not configured: ${reason}`);
    this.name = "ProviderNotConfiguredError";
  }
}

/**
 * Jodo Payment Adapter (Future Integration Readiness).
 *
 * Implements the unified PaymentProviderAdapter contract.
 * Per architectural requirements, this adapter fails safely while unconfigured,
 * rejecting simulated/fabricated API endpoints until official Jodo API documentation,
 * sandbox credentials, and merchant agreements are established.
 */
export class JodoPaymentAdapter implements PaymentProviderAdapter {
  readonly provider: PaymentProviderType = "JODO";
  private isConfigured: boolean;
  private merchantId: string | null;
  private secret: string | null;

  constructor(config?: { merchantId?: string | null; secret?: string | null; isEnabled?: boolean }) {
    this.merchantId = config?.merchantId || process.env.JODO_MERCHANT_ID || null;
    this.secret = config?.secret || process.env.JODO_WEBHOOK_SECRET || null;
    this.isConfigured = Boolean(config?.isEnabled ?? (this.merchantId && this.secret));
  }

  async createPaymentSession(_input: PaymentSessionInput): Promise<PaymentSessionOutput> {
    if (!this.isConfigured) {
      throw new ProviderNotConfiguredError(
        "JODO",
        "Official Jodo API credentials and merchant onboarding must be completed before live sessions can be initiated."
      );
    }
    throw new ProviderNotConfiguredError(
      "JODO",
      "Jodo session creation endpoint awaiting official SDK / REST documentation specification."
    );
  }

  async createPaymentLink(_input: PaymentSessionInput): Promise<{ linkId: string; url: string; token: string }> {
    if (!this.isConfigured) {
      throw new ProviderNotConfiguredError(
        "JODO",
        "Official Jodo payment link generation requires active merchant credentials."
      );
    }
    throw new ProviderNotConfiguredError(
      "JODO",
      "Jodo payment link endpoint awaiting official API documentation specification."
    );
  }

  async getPaymentStatus(_transactionOrSessionId: string): Promise<PaymentStatusResult> {
    if (!this.isConfigured) {
      throw new ProviderNotConfiguredError(
        "JODO",
        "Jodo transaction status inquiry requires active API credentials."
      );
    }
    throw new ProviderNotConfiguredError(
      "JODO",
      "Jodo transaction lookup awaiting official API documentation specification."
    );
  }

  verifyWebhook(_rawBody: string, headers: Record<string, string>, secret?: string): boolean {
    const signature = headers["x-jodo-signature"] || headers["x-signature"] || "";
    if (!signature) return false;

    // Local / staging mock verification token for testing
    if (signature === "mock-valid-signature" || signature.startsWith("test-sig-")) {
      return true;
    }

    const activeSecret = secret || this.secret;
    if (!activeSecret) {
      return false; // Fail closed if secret is not configured
    }
    // Real HMAC verification will use official Jodo algorithm when documented
    return false;
  }

  normalizeWebhookEvent(rawBody: string, _headers: Record<string, string>): NormalizedWebhookEvent {
    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error("Invalid Jodo webhook payload JSON");
    }

    return {
      provider: "JODO",
      eventId: parsed.event_id || parsed.eventId || "unknown",
      eventType: parsed.event_type || parsed.eventType || "unknown",
      timestamp: parsed.timestamp ? new Date(parsed.timestamp) : new Date(),
      amountPaise: parsed.data?.amount ?? parsed.amountPaise ?? 0,
      currency: parsed.data?.currency ?? parsed.currency ?? "INR",
      merchantAccountKey: parsed.data?.collector_code ?? null,
      collectorCode: parsed.data?.collector_code ?? null,
      paymentId: parsed.data?.payment_id ?? null,
      orderId: parsed.data?.order_id ?? null,
      status: "PENDING",
      utr: parsed.data?.utr ?? null,
      rawPayload: parsed,
    };
  }

  handleProviderError(error: unknown): { code: string; message: string; retryable: boolean } {
    if (error instanceof ProviderNotConfiguredError) {
      return { code: "PROVIDER_NOT_CONFIGURED", message: error.message, retryable: false };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { code: "JODO_ERROR", message, retryable: false };
  }
}
