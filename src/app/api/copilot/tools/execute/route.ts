import { NextRequest, NextResponse } from "next/server";
import {
  verifyServiceToken,
  resolveTenantContextFromServiceToken,
  executeApprovedTool,
} from "@/lib/ai-gateway";

export const runtime = "nodejs";

/**
 * Tool Execution Callback Endpoint for the Python Copilot Engine.
 *
 * Security Pipeline:
 * 1. Validates X-Copilot-Service-Token (HMAC signature, issuer, audience, TTL, jti replay).
 * 2. Cross-checks X-Tenant-Id and X-User-Id against service token claims to prevent tenant spoofing.
 * 3. Resolves authoritative database-backed TenantContext.
 * 4. Checks tool whitelist (APPROVED_TOOLS_REGISTRY).
 * 5. Evaluates AI module capability (evaluateAiPermission).
 * 6. Evaluates underlying domain resource permissions (TOOL_DOMAIN_PERMISSION_MAP).
 * 7. Executes deterministic Prisma query with locked tenant boundary.
 */
export async function POST(req: NextRequest) {
  // 1. Service Token Authentication
  const token = req.headers.get("X-Copilot-Service-Token");
  if (!token) {
    return NextResponse.json(
      { success: false, error: "Missing required X-Copilot-Service-Token header.", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const tokenVerification = await verifyServiceToken(token, { isToolCallback: true });
  if (!tokenVerification.valid || !tokenVerification.payload) {
    return NextResponse.json(
      {
        success: false,
        error: tokenVerification.error || "Invalid or expired service token.",
        code: "INVALID_SERVICE_TOKEN",
      },
      { status: 401 },
    );
  }

  const payload = tokenVerification.payload;

  // 2. Tenant Boundary & Identity Spoofing Protection
  const headerTenantId = req.headers.get("X-Tenant-Id");
  const headerUserId = req.headers.get("X-User-Id");

  if (headerTenantId && headerTenantId !== payload.tenantId) {
    return NextResponse.json(
      {
        success: false,
        error: "Cross-tenant access violation: Header tenant does not match service token claim.",
        code: "CROSS_TENANT_FORBIDDEN",
      },
      { status: 403 },
    );
  }

  if (headerUserId && headerUserId !== payload.userId) {
    return NextResponse.json(
      {
        success: false,
        error: "User identity violation: Header user does not match service token claim.",
        code: "USER_MISMATCH_FORBIDDEN",
      },
      { status: 403 },
    );
  }

  // 3. Resolve Authoritative Tenant Context
  const ctx = await resolveTenantContextFromServiceToken(payload);
  if (!ctx) {
    return NextResponse.json(
      {
        success: false,
        error: "Tenant context could not be resolved from token claims. User or tenant may be inactive.",
        code: "CONTEXT_RESOLUTION_FAILED",
      },
      { status: 403 },
    );
  }

  // 4. Parse Tool Invocation Payload
  const body = await req.json().catch(() => null);
  if (!body || typeof body.toolName !== "string" || !body.toolName.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid request payload. 'toolName' string is required.",
        code: "INVALID_PAYLOAD",
      },
      { status: 400 },
    );
  }

  const toolName = body.toolName.trim();
  const rawParams = typeof body.params === "object" && body.params !== null ? body.params : {};

  // Security: Ignore / override any attempted tenantId parameter manipulation
  const toolParams: Record<string, unknown> = {
    ...rawParams,
    timezone: ctx.tenant.timezone || "Asia/Kolkata",
  };
  delete toolParams.tenantId;

  // 5. Execute Approved Tool via Security Gateway
  const execution = await executeApprovedTool(toolName, toolParams, ctx);

  if (!execution.success) {
    const statusCode =
      execution.code === "TOOL_NOT_APPROVED" || execution.code === "INVALID_PARAM"
        ? 400
        : execution.code.includes("DENIED") || execution.code === "PLAN_REQUIRED" || execution.code === "SUBSCRIPTION_BLOCKED"
          ? 403
          : 500;

    return NextResponse.json(execution, { status: statusCode });
  }

  return NextResponse.json(execution, { status: 200 });
}
