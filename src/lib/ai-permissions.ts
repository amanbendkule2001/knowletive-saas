import "server-only";

import { db } from "@/lib/db";
import { AuthUser, TenantContext, getSession, getTenantContext } from "@/lib/auth";
import { hasFeature } from "@/lib/entitlements";
import { writeAudit } from "@/lib/audit";
import { AI_PERMISSION_KEYS, AiPermissionKey, PLATFORM_PERMISSION_KEYS } from "@/lib/catalog";

/**
 * Master allowlist of recognized AI capabilities in Knowletive SaaS.
 * Any permission outside this explicit allowlist is rejected automatically.
 */
export const AI_PERMISSION_ALLOWLIST = new Set<string>(AI_PERMISSION_KEYS);

/**
 * Detects if a context is a support impersonation session.
 * In Knowletive, platform owners/support staff accessing a tenant workspace
 * without native membership receive roleKey: "PLATFORM_SUPPORT".
 */
export function isSupportImpersonation(ctx: TenantContext | null | undefined): boolean {
  if (!ctx) return false;
  return ctx.membership?.roleKey === "PLATFORM_SUPPORT";
}

/**
 * Checks if the user is a verified Platform Owner.
 */
export function isVerifiedPlatformOwner(user: AuthUser | null | undefined): boolean {
  return Boolean(user && user.isPlatformOwner);
}

/**
 * Resolves verified Institute Ownership.
 * CRITICAL SECURITY RULE:
 * - Checks that the user possesses `Membership.isOwner === true` for this specific tenant.
 * - Rejects role-name heuristics (`roleKey: INSTITUTE_ADMIN` alone is NOT an owner).
 * - Rejects support impersonation sessions (`roleKey: PLATFORM_SUPPORT` is NOT an owner).
 */
export function isVerifiedInstituteOwner(ctx: TenantContext | null | undefined): boolean {
  if (!ctx || isSupportImpersonation(ctx)) {
    return false;
  }
  return Boolean(ctx.membership && ctx.membership.isOwner === true);
}

export type AiAccessResult =
  | { ok: true; ctx: TenantContext; grantedVia: "PLATFORM_OWNER" | "INSTITUTE_OWNER" | "EXPLICIT_GRANT" }
  | { ok: false; error: string; code: "INVALID_KEY" | "SUPPORT_DENIED" | "SUBSCRIPTION_BLOCKED" | "PLAN_LOCKED" | "DENIED" };

/**
 * Centralized AI Authorization Service.
 * Evaluates access for both one-shot AI Studio and conversational AI Copilot.
 *
 * Explicit Security Hierarchy:
 * 1. Permission must be in AI_PERMISSION_ALLOWLIST.
 * 2. Support Impersonators: Strictly denied by default (Support users must not gain AI access via impersonation).
 * 3. Platform Owner: Granted by default (governs platform-level AI configurations and super-admin operations).
 * 4. Subscription Settlement: Tenant subscription must not be blocked (PAST_DUE, PAUSED, etc.).
 * 5. Plan Entitlement: Tenant plan must include the "ai" feature flag.
 * 6. Institute Owner: Granted by default within their own institute (Membership.isOwner === true).
 * 7. Everyone Else: Denied by default unless explicitly granted in Membership.extraPermissions.
 */
export function evaluateAiPermission(
  ctx: TenantContext,
  permissionKey: string,
): AiAccessResult {
  const isPlatformScopePerm = permissionKey.startsWith("platform.");

  if (!AI_PERMISSION_ALLOWLIST.has(permissionKey) && !isPlatformScopePerm) {
    return {
      ok: false,
      code: "INVALID_KEY",
      error: `Invalid AI capability '${permissionKey}'. Permission is not in the approved allowlist.`,
    };
  }

  // 1. Support Impersonation Boundary:
  // Support staff / platform owners impersonating an institute workspace MUST NOT access tenant AI data.
  if (isSupportImpersonation(ctx)) {
    return {
      ok: false,
      code: "SUPPORT_DENIED",
      error: "Support sessions do not have access to AI intelligence tools during impersonation.",
    };
  }

  // 2. Platform Owner check (direct access outside impersonation)
  // Explicit Policy: Platform Owners have root AI capabilities by default across the platform.
  if (isVerifiedPlatformOwner(ctx.user)) {
    return { ok: true, ctx, grantedVia: "PLATFORM_OWNER" };
  }

  // 2b. If this is a platform-scope capability, non-platform owners must possess explicit platform permission
  if (isPlatformScopePerm) {
    if (
      ctx.user.platformPermissions?.includes(permissionKey) ||
      ctx.user.platformPermissions?.includes("*")
    ) {
      return { ok: true, ctx, grantedVia: "EXPLICIT_GRANT" };
    }
    return {
      ok: false,
      code: "DENIED",
      error: `Access denied. Using '${permissionKey}' requires verified platform permissions.`,
    };
  }

  // 3. Subscription write-blocking check (for institutes)
  if (ctx.subscriptionBlocked) {
    return {
      ok: false,
      code: "SUBSCRIPTION_BLOCKED",
      error: "AI capabilities are paused because your institute subscription requires billing settlement.",
    };
  }

  // 4. Plan feature entitlement check (for institutes)
  const plan = ctx.tenant.subscription?.plan;
  if (!plan || !hasFeature(plan, "ai")) {
    return {
      ok: false,
      code: "PLAN_LOCKED",
      error: "AI Studio and Copilot are not included in your current SaaS plan. Please upgrade in Billing.",
    };
  }

  // 5. Verified Institute Owner check (Membership.isOwner === true)
  if (isVerifiedInstituteOwner(ctx)) {
    return { ok: true, ctx, grantedVia: "INSTITUTE_OWNER" };
  }

  // 6. Non-Owner (Teachers, Staff, regular Admins, Students, Parents):
  // Denied by default unless explicitly granted via Membership.extraPermissions
  const hasExplicitGrant =
    Boolean(ctx.membership?.permissions.includes(permissionKey)) ||
    Boolean(ctx.permissions && ctx.permissions.has(permissionKey)) ||
    Boolean(ctx.membership && (ctx.membership as { extraPermissions?: string[] }).extraPermissions?.includes(permissionKey));

  if (hasExplicitGrant) {
    return { ok: true, ctx, grantedVia: "EXPLICIT_GRANT" };
  }

  return {
    ok: false,
    code: "DENIED",
    error:
      permissionKey === "tenant.ai.copilot"
        ? "AI Copilot is not enabled for your account. Please contact your Institute Owner to request access."
        : "Access denied. AI capabilities are restricted to Institute Owners by default. An owner must grant explicit permission to your account.",
  };
}

/**
 * Server Action helper to grant an AI capability to a specific staff member.
 * Restricted strictly to verified Institute Owners.
 */
export async function grantAiPermission(
  ctx: TenantContext,
  targetMembershipId: string,
  permissionKey: string,
): Promise<{ ok: boolean; error?: string; success?: string }> {
  // Only verified Institute Owner or Platform Owner can grant permissions
  if (!isVerifiedInstituteOwner(ctx) && !isVerifiedPlatformOwner(ctx.user)) {
    return { ok: false, error: "Only verified Institute Owners can grant AI permissions." };
  }

  if (!AI_PERMISSION_ALLOWLIST.has(permissionKey)) {
    return { ok: false, error: `Invalid AI permission key: ${permissionKey}` };
  }

  const membership = await db.membership.findFirst({
    where: { id: targetMembershipId, tenantId: ctx.tenant.id },
  });

  if (!membership) {
    return { ok: false, error: "Staff membership record not found in this institute." };
  }

  if (membership.extraPermissions.includes(permissionKey)) {
    return { ok: true, success: "Permission is already granted." };
  }

  const updatedExtras = [...membership.extraPermissions, permissionKey];

  await db.membership.update({
    where: { id: targetMembershipId },
    data: { extraPermissions: updatedExtras },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "ai.permission.grant",
    entity: "Membership",
    entityId: targetMembershipId,
    meta: { permissionKey, targetUserId: membership.userId },
  });

  return { ok: true, success: `Granted ${permissionKey} to staff member successfully.` };
}

/**
 * Server Action helper to revoke an AI capability from a staff member.
 * Restricted strictly to verified Institute Owners.
 */
export async function revokeAiPermission(
  ctx: TenantContext,
  targetMembershipId: string,
  permissionKey: string,
): Promise<{ ok: boolean; error?: string; success?: string }> {
  if (!isVerifiedInstituteOwner(ctx) && !isVerifiedPlatformOwner(ctx.user)) {
    return { ok: false, error: "Only verified Institute Owners can revoke AI permissions." };
  }

  const membership = await db.membership.findFirst({
    where: { id: targetMembershipId, tenantId: ctx.tenant.id },
  });

  if (!membership) {
    return { ok: false, error: "Staff membership record not found in this institute." };
  }

  const updatedExtras = membership.extraPermissions.filter((p) => p !== permissionKey);

  await db.membership.update({
    where: { id: targetMembershipId },
    data: { extraPermissions: updatedExtras },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "ai.permission.revoke",
    entity: "Membership",
    entityId: targetMembershipId,
    meta: { permissionKey, targetUserId: membership.userId },
  });

  return { ok: true, success: `Revoked ${permissionKey} from staff member successfully.` };
}

/**
 * Resolves the effective AI authorization context for the current request.
 * - For institute users or Platform Owners on an institute workspace: resolves TenantContext via getTenantContext().
 * - For Platform Owners on the Platform Console (/platform): resolves a system Platform Owner context,
 *   safely binding Prisma foreign keys to a platform/primary tenant without redirecting to an institute dashboard.
 */
export async function getEffectiveAiContext(): Promise<TenantContext | null> {
  const ctx = await getTenantContext();
  if (ctx) return ctx;

  const session = await getSession();
  if (!session || !session.isPlatformOwner) return null;

  // Platform Owner operating in platform console scope:
  let tenant = session.memberships[0]?.tenantId
    ? await db.tenant.findUnique({
        where: { id: session.memberships[0].tenantId },
        include: { subscription: { include: { plan: true } } },
      })
    : null;

  if (!tenant) {
    tenant = await db.tenant.findFirst({
      where: { status: { not: "CHURNED" } },
      include: { subscription: { include: { plan: true } } },
    });
  }

  if (!tenant) return null;

  const platformMembership: any = {
    tenantId: tenant.id,
    tenantName: "Platform Console",
    tenantSlug: "platform",
    tenantStatus: "ACTIVE",
    tenantType: "SYSTEM",
    roleId: null,
    roleName: "Platform Owner",
    roleKey: "PLATFORM_OWNER",
    isOwner: false,
    permissions: PLATFORM_PERMISSION_KEYS,
  };

  return {
    user: session,
    tenant,
    membership: platformMembership,
    permissions: new Set(PLATFORM_PERMISSION_KEYS),
    isOwnerView: true,
    subscriptionBlocked: false,
  };
}
