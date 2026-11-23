import { NextRequest, NextResponse } from "next/server";
import { getPaymentGatewayAdapter, type JodoWebhookPayload } from "@/lib/payment-gateway";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!rawBody || !rawBody.trim()) {
      return NextResponse.json({ error: "Empty request body" }, { status: 400 });
    }

    const signature =
      req.headers.get("x-jodo-signature") ||
      req.headers.get("x-signature") ||
      req.headers.get("x-webhook-signature") ||
      "";

    const adapter = getPaymentGatewayAdapter("jodo");

    // In production, reject unsigned webhooks
    if (process.env.NODE_ENV === "production" && !signature) {
      return NextResponse.json({ error: "Missing webhook signature header" }, { status: 401 });
    }

    if (signature && !adapter.verifySignature(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    let payload: JodoWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Malformed JSON payload" }, { status: 400 });
    }

    const result = await adapter.processWebhook(payload);

    if (result.duplicate) {
      return NextResponse.json(
        { message: "Duplicate event safely acknowledged", eventId: result.eventId, status: "DUPLICATE" },
        { status: 200 },
      );
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Webhook processing failed", eventId: result.eventId },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        message: "Webhook processed successfully",
        eventId: result.eventId,
        status: result.status,
        tenantId: result.tenantId,
        branchId: result.branchId,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("[webhooks/jodo] Internal error:", error);
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
