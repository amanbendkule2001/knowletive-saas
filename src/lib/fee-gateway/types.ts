// All Jodo-compatible event types
export type JodoEventType =
  | "pay.payment.debited"             // Student paid, funds in transit
  | "pay.payment.settled"             // Funds settled to branch
  | "order.payment.debited"
  | "order.payment.settled"
  | "payment_link.payment.debited"
  | "payment_link.payment.settled"
  | "flex.instalment.debited"
  | "flex.instalment.settled"
  | "flex.instalment.bounced"         // Cheque/mandate bounce
  | "direct.payment.cancelled";

export type WebhookStatus = "PENDING" | "PROCESSED" | "FAILED" | "DUPLICATE";

export interface JodoWebhookPayload {
  eventId: string;
  eventType: JodoEventType;
  timestamp: string; // ISO string
  tenantId?: string;  // mapped from collector_code
  branchId?: string;  // resolved from collectorCode
  collectorCode?: string;
  amountPaise: number;
  currency: string;
  paymentId?: string;
  orderId?: string;
  paymentLinkId?: string;
  studentRef?: string;      // external reference
  metadata?: Record<string, unknown>;
}

export interface WebhookIngestionResult {
  eventId: string;
  status: WebhookStatus;
  isDuplicate: boolean;
  error?: string;
}

export interface FeeGatewayAdapter {
  /**
   * Ingest a raw webhook payload. Must be idempotent: duplicate eventIds return { isDuplicate: true }
   */
  ingestWebhookEvent(payload: JodoWebhookPayload): Promise<WebhookIngestionResult>;

  /**
   * Process a debited event: mark FeeInvoice as partially/fully paid, create FeePayment record.
   * Does NOT credit payout balance.
   */
  processDebitedEvent(eventId: string, tenantId: string, branchId: string): Promise<{ ok: boolean; error?: string }>;

  /**
   * Process a settled event: credit BranchLedger payout balance after bank settlement.
   */
  processSettledEvent(eventId: string, tenantId: string, branchId: string): Promise<{ ok: boolean; error?: string }>;

  /**
   * Process a bounced/cancelled event: reverse prior debit, reopen dues.
   */
  processBounceOrCancelEvent(eventId: string, tenantId: string, branchId: string): Promise<{ ok: boolean; error?: string }>;

  /**
   * Verify HMAC signature of incoming webhook. MockAdapter always returns true.
   */
  verifySignature(rawBody: string, signature: string, secret: string): boolean;
}
