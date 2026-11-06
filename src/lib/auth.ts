import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  PLATFORM_PERMISSION_KEYS,
  STAFF_ROLE_KEYS,
  TENANT_PERMISSION_KEYS,
} from "@/lib/catalog";
import { addDays } from "@/lib/format";

export const SESSION_COOKIE = "kl_session";
export const TENANT_COOKIE = "kl_tenant";
export const PENDING_COOKIE = "kl_pending";
const SESSION_TTL_DAYS = 7;
const PENDING_TTL_MINUTES = 10;

const pendingSecret = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "dev-only-pending-secret-change-before-production",
);

export type TenantAccess = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  tenantType: string;
  roleId: string | null;
  roleName: string;
  roleKey: string;
  isOwner: boolean;
  permissions: string[];
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  isPlatformOwner: boolean;
  platformPermissions: string[];
  memberships: TenantAccess[];
};

export type TenantWithPlan = Prisma.TenantGetPayload<{
  include: { subscription: { include: { plan: true } } };
}>;

export type TenantContext = {
  user: AuthUser;
  tenant: TenantWithPlan;
  membership: TenantAccess | null;
  permissions: Set<string>;
  isOwnerView: boolean;
  subscriptionBlocked: boolean;
};

// ─────────────────────────────── Passwords ───────────────────────────────

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

// ─────────────────────────────── Sessions ───────────────────────────────

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export { tokenHash as hashToken };

export async function clientMeta() {
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const forwarded = h.get("x-forwarded-for");
  return {
    ip: forwarded?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
    tenantCookie: jar.get(TENANT_COOKIE)?.value ?? null,
  };
}

export async function createSession(userId: string, meta: { ip: string | null; userAgent: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = addDays(new Date(), SESSION_TTL_DAYS);

  await db.$transaction([
    db.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } }),
    db.session.create({
      data: {
        tokenHash: tokenHash(token),
        userId,
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    }),
  ]);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(TENANT_COOKIE);
}

/** Session id for the current request, without exposing the raw token. */
export async function currentSessionId() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function listUserSessions(userId: string) {
  return db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      ip: true,
      userAgent: true,
    },
  });
}

export async function revokeSession(userId: string, sessionId: string) {
  const current = await currentSessionId();
  if (current === sessionId) {
    return { error: "Use Sign out to end the session you are using now." };
  }
  await db.session.updateMany({
    where: { id: sessionId, userId },
    data: { revokedAt: new Date() },
  });
  return { success: "Device signed out." };
}

export async function revokeOtherSessions(userId: string) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const keep = token ? tokenHash(token) : null;
  await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(keep ? { tokenHash: { not: keep } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return { success: "All other devices have been signed out." };
}

// ─────────────────────────────── Pending 2FA login ───────────────────────────────

export async function createPendingLogin(userId: string, next: string) {
  const token = await new SignJWT({ userId, next })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_MINUTES}m`)
    .sign(pendingSecret);

  const jar = await cookies();
  jar.set(PENDING_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PENDING_TTL_MINUTES * 60,
  });
}

export async function readPendingLogin(): Promise<{ userId: string; next: string } | null> {
  const jar = await cookies();
  const token = jar.get(PENDING_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, pendingSecret);
    if (typeof payload.userId !== "string") return null;
    return {
      userId: payload.userId,
      next: typeof payload.next === "string" ? payload.next : "/app",
    };
  } catch {
    return null;
  }
}

export async function clearPendingLogin() {
  const jar = await cookies();
  jar.delete(PENDING_COOKIE);
}

// ─────────────────────────────── Password reset ───────────────────────────────

export async function createPasswordResetToken(userId: string, ip: string | null) {
  const token = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.passwordResetToken.deleteMany({ where: { userId } }),
    db.passwordResetToken.create({
      data: {
        userId,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        ip,
      },
    }),
  ]);
  return token;
}

export async function findPasswordResetToken(token: string) {
  return db.passwordResetToken.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: { select: { id: true, name: true, email: true, status: true } } },
  });
}

/**
 * Reads and validates the session on every request. Cached per request with
 * React `cache`, so layouts, pages and actions share one lookup.
 */
export const getSession = cache(async (): Promise<AuthUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: {
      user: {
        include: {
          platformRole: { include: { permissions: true } },
          memberships: {
            include: {
              tenant: { select: { id: true, name: true, slug: true, status: true, type: true } },
              role: { include: { permissions: true } },
            },
          },
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  if (session.user.status !== "ACTIVE") return null;

  const u = session.user;
  const platformPermissions = u.isPlatformOwner
    ? PLATFORM_PERMISSION_KEYS
    : (u.platformRole?.permissions.map((p) => p.permissionKey) ?? []);

  const memberships: TenantAccess[] = u.memberships
    .filter((m) => m.status === "ACTIVE" && m.tenant.status !== "CHURNED")
    .map((m) => {
      const permissions = new Set(m.role.permissions.map((p) => p.permissionKey));
      for (const extra of m.extraPermissions) permissions.add(extra);
      for (const denied of m.denyPermissions) permissions.delete(denied);
      return {
        tenantId: m.tenantId,
        tenantName: m.tenant.name,
        tenantSlug: m.tenant.slug,
        tenantStatus: m.tenant.status,
        tenantType: m.tenant.type,
        roleId: m.roleId,
        roleName: m.role.name,
        roleKey: m.role.key,
        isOwner: m.isOwner,
        permissions: [...permissions],
      };
    });

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarColor: u.avatarColor,
    isPlatformOwner: u.isPlatformOwner,
    platformPermissions,
    memberships,
  };
});

export async function requireUser() {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

/** Platform-console guard. Accepts an optional permission key. */
export async function requirePlatform(permission?: string) {
  const user = await requireUser();
  if (!user.isPlatformOwner && !user.platformPermissions.length) {
    const isStaff = user.memberships.some((m) => STAFF_ROLE_KEYS.has(m.roleKey));
    redirect(isStaff ? "/app?denied=page" : user.memberships.length ? "/portal?denied=page" : "/app");
  }
  if (permission && !user.platformPermissions.includes(permission)) {
    redirect(`/platform?denied=${encodeURIComponent(permission)}`);
  }
  return user;
}

export function hasPlatformPermission(user: AuthUser, permission: string) {
  return user.isPlatformOwner || user.platformPermissions.includes(permission);
}

/** Resolves the institute the user is currently working in. */
export const getTenantContext = cache(async (): Promise<TenantContext | null> => {
  const user = await getSession();
  if (!user) return null;

  const jar = await cookies();
  const selectedId = jar.get(TENANT_COOKIE)?.value;

  let access = user.memberships.find((m) => m.tenantId === selectedId);

  if (!access && !user.isPlatformOwner) {
    if (user.memberships.length === 1) {
      access = user.memberships[0];
    }
  }

  let tenant: TenantWithPlan | null = null;

  if (access) {
    tenant = await db.tenant.findUnique({
      where: { id: access.tenantId },
      include: { subscription: { include: { plan: true } } },
    });
  } else if (selectedId && user.isPlatformOwner) {
    // Support access: platform owner can open any institute workspace.
    tenant = await db.tenant.findUnique({
      where: { id: selectedId },
      include: { subscription: { include: { plan: true } } },
    });
    if (tenant && tenant.status !== "CHURNED") {
      access = {
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        tenantStatus: tenant.status,
        tenantType: tenant.type,
        roleId: null,
        roleName: "Platform Owner",
        roleKey: "PLATFORM_OWNER",
        isOwner: true,
        permissions: TENANT_PERMISSION_KEYS,
      };
    }
  }

  if (!tenant || !access) return null;
  if (tenant.status === "SUSPENDED" && !user.isPlatformOwner) {
    // Suspended institutes can still see the read-only billing ground truth.
    // Write access is blocked by requireTenantPermission.
  }

  const subscriptionBlocked =
    !!tenant.subscription &&
    ["PAST_DUE", "PAUSED", "EXPIRED", "CANCELED"].includes(tenant.subscription.status);

  return {
    user,
    tenant,
    membership: access,
    permissions: new Set(access.permissions),
    isOwnerView: user.isPlatformOwner,
    subscriptionBlocked,
  };
});

export function hasTenantPermission(ctx: TenantContext, permission: string) {
  if (ctx.isOwnerView) return true;
  return ctx.permissions.has(permission);
}

export function isStaffMember(ctx: TenantContext): boolean {
  if (ctx.isOwnerView) return true;
  if (!ctx.membership) return false;
  return STAFF_ROLE_KEYS.has(ctx.membership.roleKey);
}

export async function setActiveTenant(tenantId: string) {
  const jar = await cookies();
  jar.set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}
