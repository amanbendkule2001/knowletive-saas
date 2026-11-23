"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getTenantContext } from "@/lib/auth";
import {
  isVerifiedInstituteOwner,
  isVerifiedPlatformOwner,
  AI_PERMISSION_ALLOWLIST,
} from "@/lib/ai-permissions";
import { AI_PERMISSION_KEYS, AiPermissionKey } from "@/lib/catalog";
import { writeAudit } from "@/lib/audit";

export interface TenantAiMemberSummary {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleName: string;
  roleKey: string;
  isOwner: boolean;
  isPlatformOwner: boolean;
  extraPermissions: string[];
  aiPermissions: string[];
  hasCopilotAccess: boolean;
}

export interface ListTenantAiUsersResult {
  ok: boolean;
  error?: string;
  members?: TenantAiMemberSummary[];
}

export interface UpdateAiPermissionsResult {
  ok: boolean;
  error?: string;
  updatedPermissions?: string[];
}

/**
 * Lists tenant members with their AI permission grant status.
 * Strictly restricted to verified Institute Owners or Platform Owners.
 */
export async function listTenantAiUsersAction(
  search?: string,
  roleFilter?: string,
): Promise<ListTenantAiUsersResult> {
  const ctx = await getTenantContext();
  if (!ctx) {
    return { ok: false, error: "Unauthorized. Valid session required." };
  }

  const isOwner = isVerifiedInstituteOwner(ctx);
  const isPlatform = isVerifiedPlatformOwner(ctx.user);

  if (!isOwner && !isPlatform) {
    return {
      ok: false,
      error: "Access denied. Only Institute Owners or Platform Owners may view AI permissions.",
    };
  }

  const whereClause: Record<string, unknown> = {
    tenantId: ctx.tenant.id,
  };

  if (search && search.trim()) {
    const q = search.trim();
    whereClause.user = {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    };
  }

  if (roleFilter && roleFilter.trim() && roleFilter !== "ALL") {
    whereClause.role = {
      key: roleFilter.trim(),
    };
  }

  const memberships = await db.membership.findMany({
    where: whereClause,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          isPlatformOwner: true,
        },
      },
      role: {
        select: {
          id: true,
          name: true,
          key: true,
        },
      },
    },
    orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
  });

  const members: TenantAiMemberSummary[] = memberships.map((m) => {
    const aiPerms = m.extraPermissions.filter((p) => AI_PERMISSION_ALLOWLIST.has(p));
    const hasCopilot =
      m.isOwner ||
      m.user.isPlatformOwner ||
      m.extraPermissions.includes("tenant.ai.copilot");

    return {
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      roleName: m.role.name,
      roleKey: m.role.key,
      isOwner: m.isOwner,
      isPlatformOwner: m.user.isPlatformOwner,
      extraPermissions: m.extraPermissions,
      aiPermissions: aiPerms,
      hasCopilotAccess: hasCopilot,
    };
  });

  return { ok: true, members };
}

/**
 * Updates AI module permissions for a target membership.
 * Preserves all existing non-AI extraPermissions.
 * Strictly restricted to verified Institute Owners or Platform Owners.
 */
export async function updateAiPermissionsAction(
  membershipId: string,
  newAiPermissions: string[],
): Promise<UpdateAiPermissionsResult> {
  const ctx = await getTenantContext();
  if (!ctx) {
    return { ok: false, error: "Unauthorized. Valid session required." };
  }

  const isOwner = isVerifiedInstituteOwner(ctx);
  const isPlatform = isVerifiedPlatformOwner(ctx.user);

  if (!isOwner && !isPlatform) {
    return {
      ok: false,
      error: "Access denied. Only Institute Owners or Platform Owners may configure AI permissions.",
    };
  }

  if (ctx.subscriptionBlocked) {
    return {
      ok: false,
      error: "Subscription is paused or past due. Update billing before modifying permissions.",
    };
  }

  const target = await db.membership.findFirst({
    where: {
      id: membershipId,
      tenantId: ctx.tenant.id,
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!target) {
    return { ok: false, error: "Member not found in current institute." };
  }

  // Filter incoming permissions strictly to valid AI permissions
  const validAiToSet = Array.from(
    new Set(newAiPermissions.filter((p) => AI_PERMISSION_ALLOWLIST.has(p))),
  );

  // Preserve non-AI extra permissions
  const nonAiPermissions = target.extraPermissions.filter(
    (p) => !AI_PERMISSION_ALLOWLIST.has(p),
  );

  const updatedExtraPermissions = [...nonAiPermissions, ...validAiToSet];

  await db.membership.update({
    where: { id: membershipId },
    data: { extraPermissions: updatedExtraPermissions },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "ai.permission.update",
    entity: "Membership",
    entityId: membershipId,
    meta: {
      targetUserId: target.userId,
      targetUserEmail: target.user.email,
      grantedAiPermissions: validAiToSet,
      previousAiPermissions: target.extraPermissions.filter((p) =>
        AI_PERMISSION_ALLOWLIST.has(p),
      ),
    },
  });

  revalidatePath("/app/settings/ai");
  revalidatePath("/app/staff");

  return { ok: true, updatedPermissions: validAiToSet };
}

/**
 * Revokes all explicit AI module permissions for a target membership.
 * Preserves all non-AI extraPermissions.
 */
export async function revokeAllAiPermissionsAction(
  membershipId: string,
): Promise<UpdateAiPermissionsResult> {
  return updateAiPermissionsAction(membershipId, []);
}
