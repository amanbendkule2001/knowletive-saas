import "server-only";

import { redirect } from "next/navigation";
import {
  getSession,
  getTenantContext,
  hasPlatformPermission,
  hasTenantPermission,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  PERMISSIONS,
  PERMISSION_MAP,
  STAFF_ROLE_KEYS,
  AI_PERMISSION_KEYS,
  AiPermissionKey,
} from "@/lib/catalog";

/** Guard for pages that any active institute member can read. */
export async function requireTenant() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Guard for pages/actions inside the institute workspace. */
export async function requireTenantPermission(permission: string) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  if (!hasTenantPermission(ctx, permission)) {
    redirect(`/app/forbidden?p=${encodeURIComponent(permission)}&denied=page`);
  }
  return ctx;
}

/**
 * Same as requireTenantPermission, but rejects writes while a subscription is
 * unpaid/paused. Reading billing data stays available so the admin can recover.
 */
export async function requireTenantWrite(permission: string) {
  const ctx = await requireTenantPermission(permission);
  if (ctx.subscriptionBlocked) {
    redirect("/app/billing?blocked=1");
  }
  return ctx;
}

export async function requirePlatformPermission(permission?: string) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!hasPlatformPermission(user, permission ?? "platform.overview.read")) {
    if (user.memberships.length) {
      const isStaff = user.memberships.some((m) => STAFF_ROLE_KEYS.has(m.roleKey));
      redirect(isStaff ? "/app?denied=page" : "/portal?denied=page");
    }
    redirect("/login");
  }
  return user;
}

export const ACCESS_DENIED_MESSAGES = {
  page: "Access denied. You do not have permission to view this page.",
  create: "Permission denied. You are not authorized to create this record.",
  update: "Permission denied. You do not have permission to modify this information.",
  delete: "Access denied. You are not authorized to delete this record.",
  general: "You do not have permission to perform this action.",
  module: "You do not have access to this module. Please contact your administrator.",
} as const;

export type ActionType = "create" | "update" | "delete" | "general" | "page" | "module";

export function getAccessDeniedMessage(actionType: ActionType = "general"): string {
  switch (actionType) {
    case "create":
      return ACCESS_DENIED_MESSAGES.create;
    case "update":
      return ACCESS_DENIED_MESSAGES.update;
    case "delete":
      return ACCESS_DENIED_MESSAGES.delete;
    case "page":
      return ACCESS_DENIED_MESSAGES.page;
    case "module":
      return ACCESS_DENIED_MESSAGES.module;
    default:
      return ACCESS_DENIED_MESSAGES.general;
  }
}

/** Non-redirecting permission check for server actions so forms show professional toasts without losing page context. */
export async function authorizeTenantWrite(
  permission: string,
  actionType: ActionType = "general"
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return { ok: false as const, error: "Access denied. You do not have permission to view this page." };
  }

  if (!hasTenantPermission(ctx, permission)) {
    return { ok: false as const, error: getAccessDeniedMessage(actionType) };
  }

  if (ctx.subscriptionBlocked) {
    return { ok: false as const, error: "Your subscription writes are paused. Please restore billing to continue." };
  }

  return { ok: true as const, ctx };
}

export async function authorizePlatformWrite(
  permission: string,
  actionType: ActionType = "general"
) {
  const user = await getSession();
  if (!user) {
    return { ok: false as const, error: "Access denied. You do not have permission to view this page." };
  }

  if (!hasPlatformPermission(user, permission)) {
    return { ok: false as const, error: getAccessDeniedMessage(actionType) };
  }

  return { ok: true as const, user };
}

/**
 * Validates a list of submitted permission keys against canonical catalog definitions,
 * target role scope (TENANT vs PLATFORM), and caller authorization for elevated permissions.
 *
 * Rules:
 * 1. At least one permission must be chosen.
 * 2. Every permission key must exist in the canonical `PERMISSION_MAP`.
 * 3. Tenant roles accept only tenant-scoped permissions.
 * 4. Platform roles accept only platform-scoped permissions.
 * 5. Elevated AI capabilities (`AI_PERMISSION_KEYS`) require Institute Owner or Platform Owner status.
 * 6. Duplicates are cleanly removed.
 */
export function validateRolePermissions(
  permissions: string[],
  targetScope: "TENANT" | "PLATFORM",
  isOwnerOrSuperAdmin: boolean = false,
): { ok: true; validatedKeys: string[] } | { ok: false; error: string } {
  const unique = [
    ...new Set(
      permissions
        .map((p) => String(p).trim())
        .filter(Boolean),
    ),
  ];

  if (unique.length === 0) {
    return { ok: false, error: "Choose at least one permission for the role." };
  }

  for (const key of unique) {
    const canonical = PERMISSION_MAP.get(key);
    if (!canonical) {
      return {
        ok: false,
        error: `Unknown permission: '${key}'. Only valid permissions from the system catalog may be assigned.`,
      };
    }

    if (canonical.scope !== targetScope) {
      return {
        ok: false,
        error: `Invalid permission scope: '${key}' is a ${canonical.scope.toLowerCase()} permission and cannot be assigned to a ${targetScope.toLowerCase()} role.`,
      };
    }

    if (
      targetScope === "TENANT" &&
      AI_PERMISSION_KEYS.includes(key as AiPermissionKey) &&
      !isOwnerOrSuperAdmin
    ) {
      return {
        ok: false,
        error: "Elevated access denied. Only verified Institute Owners can grant AI capabilities to roles.",
      };
    }
  }

  return { ok: true, validatedKeys: unique };
}

/**
 * Ensures that all given permission keys exist in the database `Permission` table.
 * Strictly validates every key against canonical catalog definitions.
 *
 * Security & Integrity Guarantees:
 * 1. Fails closed on any unknown permission key (throws clear validation error).
 * 2. Only canonical catalog definitions are synchronized — NEVER creates arbitrary or fallback permissions.
 * 3. Enforces target scope matching if `expectedScope` is provided.
 * 4. Uses `skipDuplicates` for concurrency-safe insertion.
 * 5. Preserves existing permission metadata and does not mutate existing records.
 */
export async function ensurePermissionsInDb(
  keys: string[],
  expectedScope?: "TENANT" | "PLATFORM",
): Promise<{ inserted: number; existing: number }> {
  if (!keys.length) return { inserted: 0, existing: 0 };

  // 1. Strict catalog validation - fail closed on any unknown key
  for (const key of keys) {
    const canonical = PERMISSION_MAP.get(key);
    if (!canonical) {
      throw new Error(
        `Unknown permission key: '${key}'. Only canonical permissions from the RBAC catalog can be synchronized or assigned.`,
      );
    }
    if (expectedScope && canonical.scope !== expectedScope) {
      throw new Error(
        `Invalid permission scope: '${key}' belongs to ${canonical.scope} scope, but target requires ${expectedScope} scope.`,
      );
    }
  }

  // 2. Query existing records from DB
  const existing = await db.permission.findMany({
    where: { key: { in: keys } },
    select: { key: true, scope: true },
  });
  const existingSet = new Set(existing.map((p) => p.key));
  const missingKeys = keys.filter((k) => !existingSet.has(k));

  if (missingKeys.length === 0) {
    return { inserted: 0, existing: existing.length };
  }

  // 3. Construct records strictly from canonical PERMISSIONS catalog
  const toCreate = missingKeys.map((key) => {
    const canonical = PERMISSION_MAP.get(key)!;
    return {
      key: canonical.key,
      group: canonical.group,
      label: canonical.label,
      scope: canonical.scope,
      description: null,
    };
  });

  // 4. Concurrency-safe insertion via skipDuplicates
  const result = await db.permission.createMany({
    data: toCreate,
    skipDuplicates: true,
  });

  return { inserted: result.count, existing: existing.length };
}
