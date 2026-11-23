import "server-only";

import { createHash, randomBytes, createCipheriv, hkdfSync } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { TenantContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { PLATFORM_PERMISSION_KEYS, TENANT_OPERATIONAL_PERMISSION_KEYS } from "@/lib/catalog";
import { evaluateAiPermission, isVerifiedInstituteOwner, isVerifiedPlatformOwner } from "@/lib/ai-permissions";
import { resolveUserBranchScope } from "@/lib/branch";
import {
  APPROVED_TOOLS_REGISTRY,
  TOOL_PERMISSION_MAP,
  ApprovedToolName,
  ToolResponse,
  getStudentCount,
  getAttendanceSummary,
  getStudentAttendanceDetails,
  getOutstandingFeeSummary,
  getPlatformMetrics,
  StudentAttendanceDetailsResult,
} from "@/lib/ai-tools";
import { getActiveAiRuntimeConfig } from "@/lib/ai-credential-vault";

// ============================================================================
// SERVICE TOKEN CONTRACT (Short-Lived HMAC Authenticator)
// ============================================================================

export const SERVICE_TOKEN_ISSUER = "knowletive-gateway";
export const SERVICE_TOKEN_AUDIENCE = "knowletive-copilot-engine";

export const HKDF_SALT = Buffer.from("knowletive-ai-service-salt-v1", "utf-8");
export const HKDF_TRANSIT_INFO = Buffer.from("knowletive-copilot-aes-gcm-transit-v1", "utf-8");
export const HKDF_HMAC_INFO = Buffer.from("knowletive-copilot-hmac-auth-v1", "utf-8");

export type ServiceTokenPayload = {
  userId: string;
  tenantId: string;
  roleKey: string;
  isOwner: boolean;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
};

/**
 * Derives the HMAC key for short-lived inter-service authentication between
 * Next.js authorization gateway and the downstream Copilot Engine using HKDF-SHA256.
 */
export function getDerivedHmacAuthKey(): Uint8Array {
  const secret = process.env.AI_SERVICE_SECRET || process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
    throw new Error(
      "FATAL SECURITY VIOLATION: AI_SERVICE_SECRET or SESSION_SECRET with minimum 32 chars must be configured in production.",
    );
  }
  const root = secret || "dev-only-ai-internal-service-secret-key-32chars!";
  const derived = Buffer.from(hkdfSync("sha256", Buffer.from(root, "utf-8"), HKDF_SALT, HKDF_HMAC_INFO, 32));
  return new Uint8Array(derived);
}

/**
 * Derives the 32-byte AES-256-GCM key for encrypting credentials in transit between services using HKDF-SHA256.
 */
export function getDerivedTransitEncryptionKey(): Buffer {
  const secret = process.env.AI_SERVICE_SECRET || process.env.SESSION_SECRET || "dev-only-ai-internal-service-secret-key-32chars!";
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf-8"), HKDF_SALT, HKDF_TRANSIT_INFO, 32));
}

/**
 * Legacy secret accessor for backward compatibility.
 */
function getAiServiceSecret(): Uint8Array {
  const secret = process.env.AI_SERVICE_SECRET || process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32)) {
    throw new Error(
      "FATAL SECURITY VIOLATION: AI_SERVICE_SECRET or SESSION_SECRET with minimum 32 chars must be configured in production.",
    );
  }
  return new TextEncoder().encode(secret || "dev-only-ai-internal-service-secret-key-32chars!");
}

/**
 * Mints a short-lived internal service token (TTL: 60 seconds).
 * Sent by Next.js in the X-Copilot-Service-Token header to authenticate
 * tool invocations or streaming sessions with the Python Copilot microservice.
 */
export async function mintServiceToken(payload: {
  userId: string;
  tenantId: string;
  roleKey: string;
  isOwner: boolean;
}): Promise<string> {
  const secret = getDerivedHmacAuthKey();
  const jti = randomBytes(16).toString("hex");

  return new SignJWT({
    userId: payload.userId,
    tenantId: payload.tenantId,
    roleKey: payload.roleKey,
    isOwner: payload.isOwner,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SERVICE_TOKEN_ISSUER)
    .setAudience(SERVICE_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setJti(jti)
    .setExpirationTime("60s")
    .sign(secret);
}

// In-memory nonce cache tracking consumed jti tokens to prevent replay attacks within the 60s TTL
const consumedJtiNonces = new Map<string, number>();

// In-memory counter for authorized tool callbacks within active token TTL (max 10 callbacks per token)
const toolCallbackInvocations = new Map<string, { count: number; expMs: number }>();
export const MAX_TOOL_CALLBACKS_PER_TOKEN = 10;

/**
 * Checks and records jti consumption for tool execution callbacks.
 * Allows multiple legitimate tool queries within the same request turn up to MAX_TOOL_CALLBACKS_PER_TOKEN.
 */
function recordToolCallbackInvocation(jti: string, expSeconds: number): { allowed: boolean; error?: string } {
  const now = Date.now();
  for (const [nonce, item] of toolCallbackInvocations.entries()) {
    if (item.expMs <= now) {
      toolCallbackInvocations.delete(nonce);
    }
  }

  const existing = toolCallbackInvocations.get(jti);
  if (!existing) {
    toolCallbackInvocations.set(jti, { count: 1, expMs: expSeconds * 1000 });
    return { allowed: true };
  }

  if (existing.count >= MAX_TOOL_CALLBACKS_PER_TOKEN) {
    return {
      allowed: false,
      error: `Tool invocation limit exceeded: nonce '${jti}' exceeded maximum of ${MAX_TOOL_CALLBACKS_PER_TOKEN} callbacks per turn.`,
    };
  }

  existing.count++;
  return { allowed: true };
}

/**
 * Checks and records jti consumption. Returns true if the token is a replay.
 */
function isTokenReplayed(jti: string, expSeconds: number): boolean {
  const now = Date.now();
  // Prune expired nonces
  for (const [nonce, expMs] of consumedJtiNonces.entries()) {
    if (expMs <= now) {
      consumedJtiNonces.delete(nonce);
    }
  }

  if (consumedJtiNonces.has(jti)) {
    return true; // Replay detected!
  }

  consumedJtiNonces.set(jti, expSeconds * 1000);
  return false;
}

export type VerifyServiceTokenOptions = {
  isToolCallback?: boolean;
};

/**
 * Verifies and decodes an internal service token.
 * Rejects expired tokens, tampered signatures, replayed tokens, or tokens missing mandatory tenant/user claims.
 */
export async function verifyServiceToken(
  token: string,
  options?: VerifyServiceTokenOptions,
): Promise<{ valid: boolean; payload?: ServiceTokenPayload; error?: string }> {
  try {
    const derivedSecret = getDerivedHmacAuthKey();
    let verifiedPayload: unknown;
    try {
      const res = await jwtVerify(token, derivedSecret, {
        algorithms: ["HS256"],
        issuer: SERVICE_TOKEN_ISSUER,
        audience: SERVICE_TOKEN_AUDIENCE,
      });
      verifiedPayload = res.payload;
    } catch {
      // Fallback for legacy raw secret signature during test transition
      const rawSecret = getAiServiceSecret();
      const res = await jwtVerify(token, rawSecret, {
        algorithms: ["HS256"],
        issuer: SERVICE_TOKEN_ISSUER,
        audience: SERVICE_TOKEN_AUDIENCE,
      });
      verifiedPayload = res.payload;
    }

    const typedPayload = verifiedPayload as unknown as ServiceTokenPayload;
    if (!typedPayload.userId || !typedPayload.tenantId || !typedPayload.jti) {
      return { valid: false, error: "Missing required tenant, user, or nonce claims in service token." };
    }

    if (options?.isToolCallback) {
      const toolCheck = recordToolCallbackInvocation(typedPayload.jti, typedPayload.exp);
      if (!toolCheck.allowed) {
        return { valid: false, error: toolCheck.error };
      }
    } else {
      // Replay attack prevention: verify that jti nonce has not already been consumed for single-use actions
      if (isTokenReplayed(typedPayload.jti, typedPayload.exp)) {
        return {
          valid: false,
          error: `Token replay detected: nonce '${typedPayload.jti}' has already been consumed within its validity period.`,
        };
      }
    }

    return { valid: true, payload: typedPayload };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Invalid or expired service token";
    return { valid: false, error: msg };
  }
}

/**
 * Resolves an authoritative TenantContext from a verified ServiceTokenPayload.
 * Ensures that downstream tool calls initiated by the Python Copilot microservice
 * are strictly bounded by the database-backed user, tenant, membership, and permission state.
 */
export async function resolveTenantContextFromServiceToken(
  payload: ServiceTokenPayload,
): Promise<TenantContext | null> {
  const user = await db.user.findUnique({
    where: { id: payload.userId },
    include: {
      platformRole: { include: { permissions: true } },
      memberships: {
        where: { tenantId: payload.tenantId, status: "ACTIVE" },
        include: {
          tenant: { include: { subscription: { include: { plan: true } } } },
          role: { include: { permissions: true } },
        },
      },
    },
  });

  if (!user || user.status !== "ACTIVE") return null;

  const platformPermissions = user.isPlatformOwner
    ? PLATFORM_PERMISSION_KEYS
    : (user.platformRole?.permissions.map((p) => p.permissionKey) ?? []);

  let access = user.memberships.find(
    (m) => m.tenantId === payload.tenantId && m.tenant.status !== "CHURNED",
  );

  let tenant = access?.tenant ?? null;

  if (!access && user.isPlatformOwner) {
    tenant = await db.tenant.findUnique({
      where: { id: payload.tenantId },
      include: { subscription: { include: { plan: true } } },
    });
    if (tenant && tenant.status !== "CHURNED") {
      access = {
        tenantId: tenant.id,
        tenant: tenant,
        tenantStatus: tenant.status,
        roleId: null,
        role: { name: "Platform Support View", key: "PLATFORM_SUPPORT", permissions: [] },
        isOwner: false,
        extraPermissions: TENANT_OPERATIONAL_PERMISSION_KEYS,
        denyPermissions: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: user.id,
        status: "ACTIVE",
      } as any;
    }
  }

  if (!tenant || !access) return null;

  const permissions = new Set<string>();
  if (access.role && (access.role as any).permissions) {
    for (const p of (access.role as any).permissions) {
      permissions.add(p.permissionKey);
    }
  }
  for (const extra of (access as any).extraPermissions || []) {
    permissions.add(extra);
  }
  for (const denied of (access as any).denyPermissions || []) {
    permissions.delete(denied);
  }

  const subscriptionBlocked =
    !!tenant.subscription &&
    !user.isPlatformOwner &&
    tenant.subscription.status !== "ACTIVE" &&
    tenant.subscription.status !== "TRIALING";

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarColor: user.avatarColor,
      isPlatformOwner: user.isPlatformOwner,
      platformPermissions,
      memberships: [],
    },
    tenant,
    membership: {
      tenantId: access.tenantId,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      tenantStatus: tenant.status,
      tenantType: tenant.type,
      roleId: access.roleId,
      roleName: (access as any).role?.name ?? "Member",
      roleKey: (access as any).role?.key ?? "UNKNOWN",
      isOwner: access.isOwner,
      permissions: [...permissions],
    },
    permissions,
    isOwnerView: access.isOwner || user.isPlatformOwner,
    subscriptionBlocked,
  };
}

/**
 * Classifies whether a tool is scoped to cross-tenant platform level or local institute level.
 */
export function isPlatformScopedTool(toolName: string): boolean {
  return toolName === "get_platform_metrics";
}

/**
 * Deterministic mapping of failed tool authorization/execution to safe user-facing message.
 */
export function resolveToolDeniedMessage(toolResult: { toolName: string; code?: string; error?: string }): string {
  const isPlatform = isPlatformScopedTool(toolResult.toolName);
  if (toolResult.code === "DENIED" || toolResult.code === "DOMAIN_READ_DENIED" || toolResult.code === "BATCH_ACCESS_DENIED") {
    if (isPlatform) {
      return "You don't have access to platform-wide information. Please contact your Platform Administrator.";
    }
    return "You don't have access to this institute information. Please contact your Institute Owner to request access.";
  }
  return "I couldn't retrieve this information right now. Please try again later.";
}

// ============================================================================
// APPROVED TOOL DISPATCHER (With RBAC & Strict Tenant Isolation)
// ============================================================================

/**
 * Mapping of AI tools to their mandatory underlying domain read permission.
 * Security Invariant: AI permissions NEVER override or bypass underlying domain permissions.
 */
export const TOOL_DOMAIN_PERMISSION_MAP: Record<ApprovedToolName, string | string[]> = {
  get_student_count: "tenant.students.read",
  get_attendance_summary: "tenant.attendance.read",
  get_student_attendance_details: ["tenant.attendance.read", "tenant.students.read"],
  get_outstanding_fee_summary: "tenant.fees.read",
  get_platform_metrics: "platform.overview.read",
};

export type ToolExecutionResult =
  | { success: true; toolName: ApprovedToolName; data: unknown }
  | { success: false; toolName: string; error: string; code: string };

/**
 * Resolves teacher batch assignments and active student IDs strictly from authoritative database records.
 * Invariant: Never trust client-supplied or model-supplied batchId or teacherId.
 */
async function resolveAttendanceScope(
  ctx: TenantContext,
  requestedBatchId?: string,
): Promise<
  | { ok: true; studentIds?: string[]; scopeDescription: string; batchId?: string }
  | { ok: false; code: string; error: string }
> {
  const tenantId = ctx.tenant.id;
  const roleKey = ctx.membership?.roleKey;
  const isTeacher =
    roleKey === "TEACHER" &&
    !ctx.membership?.isOwner &&
    !isVerifiedPlatformOwner(ctx.user);

  if (isTeacher) {
    // 1. Resolve teacher's assigned batches from database
    const teacherBatches = await db.batchTeacher.findMany({
      where: {
        batch: { tenantId },
        teacher: {
          tenantId,
          userId: ctx.user.id,
          status: "ACTIVE",
        },
      },
      select: {
        batchId: true,
        batch: { select: { id: true, name: true, code: true } },
      },
    });

    if (teacherBatches.length === 0) {
      return {
        ok: true,
        studentIds: [],
        scopeDescription: "No batches are currently assigned to your teacher account.",
      };
    }

    const assignedBatchIds = teacherBatches.map((b) => b.batchId);

    // If caller requested a specific batch, verify assignment
    let targetBatchIds = assignedBatchIds;
    let targetBatchName: string | undefined;

    if (requestedBatchId) {
      const matchingBatch = teacherBatches.find((b) => b.batchId === requestedBatchId);
      if (!matchingBatch) {
        return {
          ok: false,
          code: "BATCH_ACCESS_DENIED",
          error: "Access denied. You are not assigned to the requested batch.",
        };
      }
      targetBatchIds = [matchingBatch.batchId];
      targetBatchName = matchingBatch.batch.name;
    }

    // Resolve active students enrolled in these batches
    const batchStudents = await db.batchStudent.findMany({
      where: {
        batchId: { in: targetBatchIds },
        status: "ACTIVE",
        student: { tenantId },
      },
      select: { studentId: true },
    });

    const studentIds = Array.from(new Set(batchStudents.map((s) => s.studentId)));
    const scopeDesc = targetBatchName
      ? `Teacher Batch: ${targetBatchName} (${studentIds.length} enrolled students)`
      : `All Assigned Batches (${teacherBatches.length} batches, ${studentIds.length} students)`;

    return {
      ok: true,
      studentIds,
      scopeDescription: scopeDesc,
      batchId: requestedBatchId,
    };
  }

  // Non-teacher role (Owner, Principal, Institute Admin, etc.):
  if (requestedBatchId) {
    const batch = await db.batch.findFirst({
      where: { id: requestedBatchId, tenantId },
      select: { id: true, name: true },
    });
    if (!batch) {
      return {
        ok: false,
        code: "BATCH_NOT_FOUND",
        error: "Requested batch was not found in this institute.",
      };
    }

    const batchStudents = await db.batchStudent.findMany({
      where: {
        batchId: batch.id,
        status: "ACTIVE",
        student: { tenantId },
      },
      select: { studentId: true },
    });
    const studentIds = Array.from(new Set(batchStudents.map((s) => s.studentId)));

    return {
      ok: true,
      studentIds,
      scopeDescription: `Batch: ${batch.name} (${studentIds.length} enrolled students)`,
      batchId: batch.id,
    };
  }

  // Tenant-wide scope for Owners/Admins/Principals
  return {
    ok: true,
    scopeDescription: "Institute-wide attendance register",
  };
}

/**
 * Executes a whitelisted tool through the Next.js security gateway.
 *
 * Security Enforcement:
 * 1. Tool name must exist in APPROVED_TOOLS_REGISTRY.
 * 2. Mandatory permission check via evaluateAiPermission against TOOL_PERMISSION_MAP.
 * 3. Mandatory underlying domain permission check via TOOL_DOMAIN_PERMISSION_MAP (non-owners cannot bypass).
 * 4. Strict tenant isolation: Tenant ID is locked from ctx.tenant.id (caller params cannot override).
 * 5. Error boundaries prevent unhandled exceptions or stack leaks.
 */
export async function executeApprovedTool(
  toolName: string,
  params: Record<string, unknown> = {},
  ctx: TenantContext,
): Promise<ToolExecutionResult> {
  // 1. Registry validation
  if (!(toolName in APPROVED_TOOLS_REGISTRY)) {
    return {
      success: false,
      toolName,
      code: "TOOL_NOT_APPROVED",
      error: `Tool '${toolName}' is not in the approved AI tool registry.`,
    };
  }

  const approvedTool = toolName as ApprovedToolName;
  const requiredPermission = TOOL_PERMISSION_MAP[approvedTool];

  // 2. Centralized AI authorization check
  const authCheck = evaluateAiPermission(ctx, requiredPermission);
  if (!authCheck.ok) {
    return {
      success: false,
      toolName: approvedTool,
      code: authCheck.code,
      error: `Permission denied for tool '${approvedTool}': ${authCheck.error}`,
    };
  }

  // 3. Underlying domain resource check:
  // AI capability does NOT grant bypass to underlying resource permissions.
  // An authorized user must hold the underlying domain read permission(s).
  if (!isVerifiedPlatformOwner(ctx.user) && !isVerifiedInstituteOwner(ctx)) {
    const domainPerms = Array.isArray(TOOL_DOMAIN_PERMISSION_MAP[approvedTool])
      ? (TOOL_DOMAIN_PERMISSION_MAP[approvedTool] as string[])
      : [TOOL_DOMAIN_PERMISSION_MAP[approvedTool] as string];

    for (const domainPerm of domainPerms) {
      if (!ctx.permissions || !ctx.permissions.has(domainPerm)) {
        return {
          success: false,
          toolName: approvedTool,
          code: "DOMAIN_READ_DENIED",
          error: `Access denied. Using '${approvedTool}' requires underlying domain permission '${domainPerm}'.`,
        };
      }
    }
  }

  // 4. Strict tenant isolation dispatch
  const tenantId = ctx.tenant.id;

  try {
    switch (approvedTool) {
      case "get_student_count": {
        const result = await getStudentCount(tenantId, {
          status: params.status as "ACTIVE" | "INACTIVE" | "ALUMNI" | undefined,
          classId: typeof params.classId === "string" ? params.classId : undefined,
        });
        if (!result.success) {
          return { success: false, toolName: approvedTool, code: "EXEC_FAIL", error: result.error };
        }
        return { success: true, toolName: approvedTool, data: result.data };
      }

      case "get_attendance_summary": {
        const requestedBatchId = typeof params.batchId === "string" && params.batchId.trim() ? params.batchId.trim() : undefined;
        const scope = await resolveAttendanceScope(ctx, requestedBatchId);
        if (!scope.ok) {
          return { success: false, toolName: approvedTool, code: scope.code, error: scope.error };
        }

        const result = await getAttendanceSummary(tenantId, {
          date: typeof params.date === "string" ? params.date : undefined,
          sectionId: typeof params.sectionId === "string" ? params.sectionId : undefined,
          batchId: scope.batchId,
          studentIds: scope.studentIds,
          scopeDescription: scope.scopeDescription,
          timezone: typeof params.timezone === "string" ? params.timezone : undefined,
        });
        if (!result.success) {
          return { success: false, toolName: approvedTool, code: "EXEC_FAIL", error: result.error };
        }
        return { success: true, toolName: approvedTool, data: result.data };
      }

      case "get_student_attendance_details": {
        const requestedBatchId = typeof params.batchId === "string" && params.batchId.trim() ? params.batchId.trim() : undefined;
        const scope = await resolveAttendanceScope(ctx, requestedBatchId);
        if (!scope.ok) {
          return { success: false, toolName: approvedTool, code: scope.code, error: scope.error };
        }

        const thresholdVal = typeof params.thresholdPercentage === "number"
          ? params.thresholdPercentage
          : typeof params.thresholdPercentage === "string" && !isNaN(Number(params.thresholdPercentage))
          ? Number(params.thresholdPercentage)
          : undefined;

        const result = await getStudentAttendanceDetails(tenantId, {
          batchId: scope.batchId,
          studentIds: scope.studentIds,
          thresholdPercentage: thresholdVal,
          startDate: typeof params.startDate === "string" ? params.startDate : undefined,
          endDate: typeof params.endDate === "string" ? params.endDate : undefined,
          sectionId: typeof params.sectionId === "string" ? params.sectionId : undefined,
          scopeDescription: scope.scopeDescription,
          timezone: typeof params.timezone === "string" ? params.timezone : undefined,
        });
        if (!result.success) {
          return { success: false, toolName: approvedTool, code: "EXEC_FAIL", error: result.error };
        }
        return { success: true, toolName: approvedTool, data: result.data };
      }

      case "get_outstanding_fee_summary": {
        const branchScope = await resolveUserBranchScope(ctx);
        const requestedBranchId =
          typeof params.branchId === "string" && params.branchId.trim()
            ? params.branchId.trim()
            : undefined;

        if (requestedBranchId && branchScope.isBranchScoped && !branchScope.allowedBranchIds.includes(requestedBranchId)) {
          return {
            success: false,
            toolName: approvedTool,
            code: "BRANCH_ACCESS_DENIED",
            error: "Access denied. You do not have authorization to query financial metrics for this branch.",
          };
        }

        const result = await getOutstandingFeeSummary(tenantId, {
          branchId: requestedBranchId,
          allowedBranchIds: branchScope.isBranchScoped ? branchScope.allowedBranchIds : undefined,
        });
        if (!result.success) {
          return { success: false, toolName: approvedTool, code: "EXEC_FAIL", error: result.error };
        }
        return { success: true, toolName: approvedTool, data: result.data };
      }

      case "get_platform_metrics": {
        if (
          !isVerifiedPlatformOwner(ctx.user) &&
          !ctx.user.platformPermissions?.includes("platform.overview.read") &&
          !ctx.user.platformPermissions?.includes("*")
        ) {
          return {
            success: false,
            toolName: approvedTool,
            code: "DOMAIN_READ_DENIED",
            error: "Access denied. Using 'get_platform_metrics' requires platform ownership or 'platform.overview.read'.",
          };
        }
        const result = await getPlatformMetrics();
        if (!result.success) {
          return { success: false, toolName: approvedTool, code: "EXEC_FAIL", error: result.error };
        }
        return { success: true, toolName: approvedTool, data: result.data };
      }

      default:
        return {
          success: false,
          toolName: approvedTool,
          code: "NOT_IMPLEMENTED",
          error: `Tool execution handler for '${approvedTool}' is not wired.`,
        };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal database execution error";
    return {
      success: false,
      toolName: approvedTool,
      code: "INTERNAL_ERROR",
      error: errorMsg,
    };
  }
}

/**
 * Envelope-encrypts sensitive credentials transmitted across the internal network to the Python Copilot microservice.
 * Uses AES-256-GCM authenticated encryption with HKDF-derived key and configuration version bound as AAD.
 * Format: enc:aesgcm:v<version>:<iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function encryptPayloadForEngine(plaintext: string, version: number = 0): string {
  const key = getDerivedTransitEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`v=${version}`, "utf-8"));
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `enc:aesgcm:v${version}:${iv.toString("hex")}:${tag}:${encrypted}`;
}

/**
 * Sends an authenticated configuration push to the downstream Python Copilot Engine.
 * Securely updates runtime API keys and model selection across service instances.
 */
export async function syncProviderConfigToEngine(payload: {
  provider: string;
  apiKey?: string | null;
  model: string;
  version: number;
}): Promise<{ success: boolean; error?: string }> {
  const engineBaseUrl = process.env.COPILOT_ENGINE_URL;
  if (!engineBaseUrl) return { success: false, error: "COPILOT_ENGINE_URL not configured" };

  try {
    const serviceToken = await mintServiceToken({
      userId: "platform-system",
      tenantId: "platform-system",
      roleKey: "PLATFORM_OWNER",
      isOwner: true,
    });

    const res = await fetch(`${engineBaseUrl.replace(/\/$/, "")}/api/v1/copilot/provider/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Copilot-Service-Token": serviceToken,
      },
      body: JSON.stringify({
        provider: payload.provider,
        api_key: payload.apiKey ? encryptPayloadForEngine(payload.apiKey, payload.version) : undefined,
        model: payload.model,
        version: payload.version,
        perform_validation: false, // Already verified upstream by Next.js
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      return { success: true };
    }
    const text = await res.text();
    return { success: false, error: `Engine sync rejected (${res.status}): ${text}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================================
// DOWNSTREAM COPILOT ENGINE DISPATCHER
// ============================================================================

export type CopilotGatewayRequest = {
  message: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  requestedTools?: ApprovedToolName[];
};

export type CopilotGatewayResult = {
  text: string;
  toolResults?: ToolExecutionResult[];
  engineUsed: "python_service" | "nextjs_grounded_fallback";
  tokens?: number;
  durationMs?: number;
};

/**
 * Dispatches a prompt to the downstream Python Copilot Engine if available,
 * passing short-lived HMAC service tokens and tenant headers over a private network connection.
 * If the microservice is offline or unconfigured, gracefully falls back to the Next.js AI pipeline.
 */
export async function forwardToCopilotEngine(
  req: CopilotGatewayRequest,
  ctx: TenantContext,
  toolResults?: ToolExecutionResult[],
): Promise<CopilotGatewayResult> {
  const startMs = Date.now();
  const engineBaseUrl = process.env.COPILOT_ENGINE_URL;
  const activeConfig = await getActiveAiRuntimeConfig();

  if (engineBaseUrl) {
    try {
      const serviceToken = await mintServiceToken({
        userId: ctx.user.id,
        tenantId: ctx.tenant.id,
        roleKey: ctx.membership?.roleKey || "UNKNOWN",
        isOwner: Boolean(ctx.membership?.isOwner),
      });

      const response = await fetch(`${engineBaseUrl.replace(/\/$/, "")}/api/v1/copilot/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Copilot-Service-Token": serviceToken,
          "X-Tenant-Id": ctx.tenant.id,
          "X-User-Id": ctx.user.id,
          "X-Provider-Config-Version": String(activeConfig.version),
        },
        body: JSON.stringify({
          message: req.message,
          history: req.conversationHistory ?? [],
          tool_context: toolResults ?? [],
          model: activeConfig.activeModel,
          provider_config: activeConfig.apiKey
            ? {
                version: activeConfig.version,
                provider: activeConfig.provider,
                api_key: encryptPayloadForEngine(activeConfig.apiKey, activeConfig.version),
                model: activeConfig.activeModel,
              }
            : undefined,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          text: data.response || data.text || "No response received from Copilot Engine.",
          toolResults: data.tool_results || toolResults,
          engineUsed: "python_service",
          tokens: typeof data.tokens === "number" ? data.tokens : undefined,
          durationMs: typeof data.duration_ms === "number" ? data.duration_ms : Date.now() - startMs,
        };
      }
    } catch (err) {
      console.warn("[ai-gateway] Python Copilot Engine request failed, falling back to Next.js pipeline:", err);
    }
  }

  // Graceful grounded synthesis using local database metrics
  const successfulTools = (toolResults ?? []).filter((r) => r.success);
  const failedTools = (toolResults ?? []).filter((r) => !r.success);

  let answer = "";
  if (successfulTools.length > 0) {
    answer = `Here is the current institute information:\n\n` +
      successfulTools
        .map((r) => {
          if (r.toolName === "get_student_count") {
            const d = r.data as { activeStudents: number; totalStudents: number; byClassBreakdown: Array<{ className?: string; count: number }> };
            const classes = d.byClassBreakdown.map((b) => `${b.className}: ${b.count}`).join(", ");
            return `• **Students:** ${d.activeStudents} active students enrolled (Total: ${d.totalStudents}). Classes: ${classes || "None"}.`;
          }
          if (r.toolName === "get_attendance_summary") {
            const d = r.data as {
              targetDate: string;
              attendanceRatePercentage: number;
              present: number;
              absent: number;
              totalMarked: number;
              isFallbackDate: boolean;
              scopeDescription?: string;
            };
            const fallbackNotice = d.isFallbackDate
              ? ` [NOTICE: No register marked for today; displaying latest register from ${d.targetDate}]`
              : "";
            const scopeInfo = d.scopeDescription ? ` [Scope: ${d.scopeDescription}]` : "";
            return `• **Attendance for ${d.targetDate}:** Rate is ${d.attendanceRatePercentage}%. Marked: ${d.totalMarked} (Present: ${d.present}, Absent: ${d.absent}).${fallbackNotice}${scopeInfo}`;
          }
          if (r.toolName === "get_student_attendance_details") {
            const d = r.data as StudentAttendanceDetailsResult;
            const below = d.students.filter((s) => s.isBelowThreshold);
            const withRecords = d.students.filter((s) => s.totalEligibleSessions > 0 && !s.isBelowThreshold);
            const zeroSessions = d.students.filter((s) => s.totalEligibleSessions === 0);
            let detail = `• **Student Attendance Details (${d.scopeDescription}):**\n`;
            detail += `  - **Total Students Evaluated:** ${d.totalStudentsAnalyzed} (${withRecords.length + below.length} with records, ${zeroSessions.length} without records)\n`;
            detail += `  - **Reporting Period:** ${d.reportingPeriod.description} | **Threshold:** ${d.thresholdPercentage}%\n`;
            detail += `  - **Students Below ${d.thresholdPercentage}%:** ${below.length}\n`;

            if (below.length > 0) {
              detail += `\n  ⚠️ **Students Below ${d.thresholdPercentage}% Threshold (${below.length}):**\n`;
              for (const s of below) {
                const datesStr = s.supportingDates.map((sd) => `${sd.date} (${sd.status})`).join(", ");
                detail += `  - **${s.studentName}** (Adm: ${s.admissionNo}): **${s.attendancePercentage}%** (${s.presentCount} present, ${s.lateCount} late, ${s.absentCount} absent, ${s.excusedCount} excused / ${s.totalEligibleSessions} sessions) ⚠️ [BELOW THRESHOLD]. Records: [${datesStr || "None"}].\n`;
              }
            } else {
              detail += `  - ✅ **Threshold Status:** No students are below the ${d.thresholdPercentage}% threshold.\n`;
            }

            if (withRecords.length > 0) {
              detail += `\n  📋 **Students Meeting/Exceeding ${d.thresholdPercentage}% (${withRecords.length}):**\n`;
              const maxActive = 15;
              for (const s of withRecords.slice(0, maxActive)) {
                detail += `  - ${s.studentName} (Adm: ${s.admissionNo}): ${s.attendancePercentage}% (${s.presentCount} present, ${s.lateCount} late, ${s.absentCount} absent, ${s.excusedCount} excused / ${s.totalEligibleSessions} sessions)\n`;
              }
              if (withRecords.length > maxActive) {
                detail += `  - ...and ${withRecords.length - maxActive} more students meeting threshold.\n`;
              }
            }

            if (zeroSessions.length > 0) {
              detail += `\n  ℹ️ **Students Without Attendance Records (${zeroSessions.length}):**\n`;
              const maxZero = 10;
              for (const s of zeroSessions.slice(0, maxZero)) {
                detail += `  - ${s.studentName} (Adm: ${s.admissionNo}): N/A — No attendance records (0 sessions marked)\n`;
              }
              if (zeroSessions.length > maxZero) {
                detail += `  - ...and ${zeroSessions.length - maxZero} more students without records.\n`;
              }
            }

            return detail.trimEnd();
          }
          if (r.toolName === "get_outstanding_fee_summary") {
            const d = r.data as { totalOutstandingRupees: number; pendingInvoicesCount: number; overdueInvoicesCount: number; currency: string };
            return `• **Fee Finances:** Outstanding balance is ₹${d.totalOutstandingRupees.toLocaleString("en-IN")}. Pending invoices: ${d.pendingInvoicesCount} (${d.overdueInvoicesCount} overdue).`;
          }
          if (r.toolName === "get_platform_metrics") {
            const d = r.data as {
              totalTenants: number;
              activeTenants: number;
              trialTenants: number;
              suspendedTenants: number;
              totalStudentsAcrossPlatform: number;
              monthlyAiCreditsUsed: number;
              monthlyAiCreditsAllocated: number;
              plansCount: number;
              recentAuditCount: number;
            };
            return `• **Platform Overview:** Total Institutes: ${d.totalTenants} (${d.activeTenants} active, ${d.trialTenants} trial, ${d.suspendedTenants} suspended). Total students across platform: ${d.totalStudentsAcrossPlatform}. AI credits used this month: ${d.monthlyAiCreditsUsed} of ${d.monthlyAiCreditsAllocated} allocated. Active plans: ${d.plansCount}.`;
          }
          return `• **${r.toolName}:** ${JSON.stringify(r.data)}`;
        })
        .join("\n\n");

    // Partial access limitation notice
    if (failedTools.length > 0) {
      const hasPlatformDenied = failedTools.some((t) => isPlatformScopedTool(t.toolName) && (t.code === "DENIED" || t.code === "DOMAIN_READ_DENIED"));
      const hasInstituteDenied = failedTools.some((t) => !isPlatformScopedTool(t.toolName) && (t.code === "DENIED" || t.code === "DOMAIN_READ_DENIED" || t.code === "BATCH_ACCESS_DENIED"));
      const hasExecFail = failedTools.some((t) => t.code === "EXEC_FAIL" || (!t.code && !t.success));

      let notice = "\n\n⚠️ **Access Notice:** I retrieved the information you are authorized to view. Some requested information is unavailable because your account does not have the required access.";
      if (hasPlatformDenied && hasInstituteDenied) {
        notice += " For platform-wide statistics, please contact your Platform Administrator. For institute permissions, please contact your Institute Owner.";
      } else if (hasPlatformDenied) {
        notice += " You don't have access to platform-wide information. Please contact your Platform Administrator.";
      } else if (hasInstituteDenied) {
        notice += " You don't have access to this institute information. Please contact your Institute Owner to request access.";
      } else if (hasExecFail) {
        notice = "\n\n⚠️ **Notice:** Some requested information couldn't be retrieved right now. Please try again later.";
      }
      answer += notice;
    }
  } else if (failedTools.length > 0) {
    // Every requested tool failed or was denied
    const hasPlatformDenied = failedTools.some((t) => isPlatformScopedTool(t.toolName) && (t.code === "DENIED" || t.code === "DOMAIN_READ_DENIED"));
    const hasInstituteDenied = failedTools.some((t) => !isPlatformScopedTool(t.toolName) && (t.code === "DENIED" || t.code === "DOMAIN_READ_DENIED" || t.code === "BATCH_ACCESS_DENIED"));
    const hasExecFail = failedTools.some((t) => t.code === "EXEC_FAIL" || (!t.code && !t.success));

    if (hasPlatformDenied && hasInstituteDenied) {
      answer = "You don't have access to the requested information. For platform-wide statistics, please contact your Platform Administrator. For institute information, please contact your Institute Owner to request access.";
    } else if (hasPlatformDenied) {
      answer = "You don't have access to platform-wide information. Please contact your Platform Administrator.";
    } else if (hasInstituteDenied) {
      answer = "You don't have access to this institute information. Please contact your Institute Owner to request access.";
    } else if (hasExecFail) {
      answer = "I couldn't retrieve this information right now. Please try again later.";
    } else {
      answer = "I couldn't retrieve this information right now. Please try again later.";
    }
  } else {
    answer = `I am your Knowletive AI Copilot. I can assist you with student records, attendance metrics, and fee financial reports. How can I assist you with your institute today?`;
  }

  return {
    text: answer,
    toolResults,
    engineUsed: "nextjs_grounded_fallback",
    durationMs: Date.now() - startMs,
  };
}
