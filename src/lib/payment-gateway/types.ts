export type PaymentProviderType = "DEMO" | "JODO";
export type PaymentEnvironment = "DEMO" | "TEST" | "LIVE";
export type PaymentStatus = "OPEN" | "PENDING" | "SUCCESS" | "FAILED" | "CANCELLED" | "EXPIRED";

export interface PaymentSessionInput {
  tenantId: string;
  branchId?: string | null;
  studentId: string;
  amountPaise: number;
  currency?: string;
  description: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  returnUrl?: string;
  metadata?: Record<string, unknown>;
  installmentIds?: string[];
  isDemo?: boolean;
}

export interface PaymentSessionOutput {
  provider: PaymentProviderType;
  sessionId: string;
  sessionToken: string;
  redirectUrl: string;
  expiresAt: Date;
  status: PaymentStatus;
}

export interface PaymentStatusResult {
  provider: PaymentProviderType;
  transactionId: string;
  status: PaymentStatus;
  amountPaise: number;
  currency: string;
  utr?: string | null;
  rawResponse?: Record<string, unknown>;
}

export interface NormalizedWebhookEvent {
  provider: PaymentProviderType;
  eventId: string;
  eventType: string;
  timestamp: Date;
  amountPaise: number;
  currency: string;
  merchantAccountKey?: string | null;
  collectorCode?: string | null;
  paymentId?: string | null;
  orderId?: string | null;
  status: PaymentStatus;
  utr?: string | null;
  payerName?: string | null;
  payerPhone?: string | null;
  payerEmail?: string | null;
  metadata?: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
}

export interface PaymentProviderAdapter {
  readonly provider: PaymentProviderType;
  createPaymentSession(input: PaymentSessionInput): Promise<PaymentSessionOutput>;
  createPaymentLink(input: PaymentSessionInput): Promise<{ linkId: string; url: string; token: string }>;
  getPaymentStatus(transactionOrSessionId: string): Promise<PaymentStatusResult>;
  verifyWebhook(rawBody: string, headers: Record<string, string>, secret?: string): boolean;
  normalizeWebhookEvent(rawBody: string, headers: Record<string, string>): NormalizedWebhookEvent;
  handleProviderError(error: unknown): { code: string; message: string; retryable: boolean };
}

// ─────────────────────────────── Backward-Compatible Jodo Definitions ───────────────────────────────

export type JodoEventType =
  | "pay.payment.debited"
  | "pay.payment.settled"
  | "order.payment.debited"
  | "order.payment.settled"
  | "payment_link.payment.debited"
  | "payment_link.payment.settled"
  | "flex.instalment.debited"
  | "flex.instalment.settled"
  | "flex.instalment.bounced"
  | "direct.payment.cancelled";

export interface JodoWebhookPayload {
  event_id: string;
  event_type: JodoEventType | string;
  timestamp: string;
  data: {
    payment_id?: string;
    order_id?: string;
    payment_link_id?: string;
    invoice_id?: string;
    collector_code?: string;
    tenant_id?: string;
    branch_id?: string;
    amount: number; // in paise
    currency?: string;
    status: string;
    utr?: string;
    settlement_utr?: string;
    settlement_id?: string;
    bounce_reason?: string;
    cancellation_reason?: string;
    refund_reason?: string;
    payer_name?: string;
    payer_phone?: string;
    payer_email?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface WebhookProcessResult {
  success: boolean;
  duplicate?: boolean;
  status: "PROCESSED" | "DUPLICATE" | "FAILED" | "IGNORED" | "QUARANTINED";
  eventId: string;
  eventType: string;
  tenantId?: string | null;
  branchId?: string | null;
  invoiceId?: string | null;
  ledgerEntryId?: string | null;
  quarantineReason?: string | null;
  error?: string;
}

export interface FeeGatewayAdapter {
  verifySignature(rawPayload: string, signature: string, secret?: string): boolean;
  processWebhook(event: JodoWebhookPayload): Promise<WebhookProcessResult>;
}
