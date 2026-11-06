import "server-only";

import { redirect } from "next/navigation";
import {
  getSession,
  getTenantContext,
  hasPlatformPermission,
  hasTenantPermission,
} from "@/lib/auth";
import { STAFF_ROLE_KEYS } from "@/lib/catalog";

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
