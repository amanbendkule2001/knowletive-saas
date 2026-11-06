"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  clearPendingLogin,
  clientMeta,
  createPasswordResetToken,
  createPendingLogin,
  createSession,
  destroySession,
  findPasswordResetToken,
  getSession,
  hashPassword,
  readPendingLogin,
  revokeOtherSessions,
  revokeSession,
  setActiveTenant,
  TENANT_COOKIE,
  verifyPassword,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { appUrl, passwordResetMessage, sendNotification } from "@/lib/notifications";
import { generateTotpSecret, verifyTotp } from "@/lib/two-factor";
import {
  changePasswordSchema,
  disableTwoFactorSchema,
  fieldErrors,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  twoFactorCodeSchema,
  type FormState,
} from "@/lib/validation";

const STAFF_ROLES = new Set([
  "INSTITUTE_ADMIN",
  "PRINCIPAL",
  "TEACHER",
  "ACCOUNTANT",
  "FRONT_DESK",
]);

function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

let dummyHash: string | null = null;
async function getDummyHash() {
  if (!dummyHash) dummyHash = await bcrypt.hash("invalid-password-placeholder", 10);
  return dummyHash;
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return fieldErrors(parsed.error);

  const { email, password } = parsed.data;
  const meta = await clientMeta();
  const limit = await rateLimit(`login:${meta.ip ?? "unknown"}:${email}`, 8, 10 * 60 * 1000);
  if (!limit.ok) {
    return {
      error: `Too many sign-in attempts. Try again in ${Math.ceil(limit.retryAfterMs / 60000)} minutes.`,
    };
  }

  const user = await db.user.findUnique({
    where: { email },
    include: {
      memberships: {
        where: { status: "ACTIVE", tenant: { status: { not: "CHURNED" } } },
        select: { tenantId: true, role: { select: { key: true } } },
      },
    },
  });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
    await writeAudit({
      actorId: user.id,
      actorType: user.isPlatformOwner ? "PLATFORM" : "TENANT",
      actorName: user.name,
      action: "auth.login_locked",
      entity: "User",
      entityId: user.id,
      ip: meta.ip,
    });
    return {
      error: `This account is temporarily locked due to too many failed sign-in attempts. Try again in ${minutesLeft} minute${minutesLeft > 1 ? "s" : ""}.`,
    };
  }

  const hash = user?.passwordHash ?? (await getDummyHash());
  const valid = await verifyPassword(password, hash);

  if (!user || !valid) {
    if (user) {
      const failedAttempts = (user.failedLoginAttempts ?? 0) + 1;
      const isNowLocked = failedAttempts >= 5;
      const lockedUntil = isNowLocked ? new Date(Date.now() + 15 * 60 * 1000) : null;

      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: failedAttempts,
          lockedUntil,
        },
      });

      await writeAudit({
        actorId: user.id,
        actorType: user.isPlatformOwner ? "PLATFORM" : "TENANT",
        actorName: user.name,
        action: isNowLocked ? "auth.account_locked" : "auth.login_failed",
        entity: "User",
        entityId: user.id,
        ip: meta.ip,
        meta: { failedAttempts },
      });

      if (isNowLocked) {
        return {
          error: "Too many failed sign-in attempts. Your account has been temporarily locked for 15 minutes for security.",
        };
      }
    }
    return { error: "Incorrect email or password." };
  }
  if (user.status !== "ACTIVE") {
    return { error: "This account is not active. Contact your platform administrator." };
  }

  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  const jar = await cookies();
  const currentTenantId = jar.get(TENANT_COOKIE)?.value;
  const validTenantCookie = user.memberships.find((m) => m.tenantId === currentTenantId);

  let targetTenantId: string | null = null;
  let targetNext = "/app";

  if (user.isPlatformOwner || user.platformRoleId) {
    targetNext = "/platform";
  } else if (validTenantCookie) {
    targetTenantId = validTenantCookie.tenantId;
    const isStaff = STAFF_ROLES.has(validTenantCookie.role.key);
    targetNext = isStaff ? "/app" : "/portal";
  } else if (user.memberships.length === 1) {
    targetTenantId = user.memberships[0].tenantId;
    const isStaff = STAFF_ROLES.has(user.memberships[0].role.key);
    targetNext = isStaff ? "/app" : "/portal";
  } else if (user.memberships.length > 1) {
    targetNext = "/select-institute";
  }

  if (user.twoFactorEnabled && user.twoFactorSecret) {
    await createPendingLogin(user.id, targetNext);
    redirect(`/login/2fa?next=${encodeURIComponent(targetNext)}`);
  }

  await createSession(user.id, meta);
  if (targetTenantId) {
    await setActiveTenant(targetTenantId);
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await writeAudit({
    tenantId: targetTenantId,
    actorId: user.id,
    actorType: user.isPlatformOwner ? "PLATFORM" : "TENANT",
    actorName: user.name,
    action: "auth.login",
    entity: "User",
    entityId: user.id,
    ip: meta.ip,
  });

  redirect(targetNext);
}

export async function verifyTwoFactorLoginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const pending = await readPendingLogin();
  if (!pending) return { error: "Your sign-in session expired. Start again from the sign-in page." };

  const parsed = twoFactorCodeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return fieldErrors(parsed.error);

  const limit = await rateLimit(`2fa:${pending.userId}`, 6, 10 * 60 * 1000);
  if (!limit.ok) {
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  const user = await db.user.findUnique({
    where: { id: pending.userId },
    include: { memberships: { take: 1, select: { tenantId: true } } },
  });
  if (!user || user.status !== "ACTIVE" || !user.twoFactorSecret) {
    await clearPendingLogin();
    return { error: "This account cannot complete two-factor sign-in. Contact support." };
  }

  const valid = verifyTotp(user.twoFactorSecret, parsed.data.code);
  if (!valid) return { error: "That code is not valid. Codes change every 30 seconds." };

  const meta = await clientMeta();
  await createSession(user.id, meta);
  await clearPendingLogin();
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await writeAudit({
    tenantId: user.memberships[0]?.tenantId ?? null,
    actorId: user.id,
    actorType: user.isPlatformOwner ? "PLATFORM" : "TENANT",
    actorName: user.name,
    action: "auth.login_2fa",
    entity: "User",
    entityId: user.id,
    ip: meta.ip,
  });

  redirect(safeNext(pending.next));
}

export async function logoutAction() {
  const user = await getSession();
  if (user) {
    await writeAudit({
      actorId: user.id,
      actorType: user.isPlatformOwner ? "PLATFORM" : "TENANT",
      actorName: user.name,
      action: "auth.logout",
      entity: "User",
      entityId: user.id,
    });
  }
  await destroySession();
  redirect("/login");
}

export async function switchTenantAction(formData: FormData) {
  const user = await getSession();
  if (!user) redirect("/login");

  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) redirect("/app");

  const isMember = user.memberships.some((m) => m.tenantId === tenantId);
  if (!isMember && !user.isPlatformOwner) redirect("/app");

  if (!isMember) {
    const exists = await db.tenant.count({ where: { id: tenantId, status: { not: "CHURNED" } } });
    if (!exists) redirect("/app");
  }

  await setActiveTenant(tenantId);
  const targetMembership = user.memberships.find((m) => m.tenantId === tenantId);
  const isStaff = user.isPlatformOwner || (targetMembership && STAFF_ROLES.has(targetMembership.roleKey));
  redirect(isStaff ? "/app" : "/portal");
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getSession();
  if (!user) return { error: "Session expired. Sign in again." };

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const record = await db.user.findUnique({ where: { id: user.id } });
  if (!record) return { error: "Account not found." };

  const valid = await verifyPassword(parsed.data.currentPassword, record.passwordHash);
  if (!valid) return { error: "Your current password is incorrect." };

  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return { error: "Choose a password that is different from your current one." };
  }

  const meta = await clientMeta();
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(parsed.data.newPassword) },
    }),
    // Rotate every session after a password change.
    db.session.deleteMany({ where: { userId: user.id } }),
  ]);

  await createSession(user.id, meta);
  await writeAudit({
    actorId: user.id,
    actorType: user.isPlatformOwner ? "PLATFORM" : "TENANT",
    actorName: user.name,
    action: "auth.password_change",
    entity: "User",
    entityId: user.id,
    ip: meta.ip,
  });

  return { success: "Password updated. Other devices have been signed out." };
}

// ─────────────────────────────── Recovery ───────────────────────────────

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return fieldErrors(parsed.error);

  const meta = await clientMeta();
  const limit = await rateLimit(`forgot:${meta.ip ?? "unknown"}`, 6, 15 * 60 * 1000);
  if (!limit.ok) {
    return { error: "Too many reset requests. Try again in a few minutes." };
  }

  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    include: { memberships: { take: 1, select: { tenantId: true } } },
  });

  // Always answer the same way so the form cannot enumerate accounts.
  const success = {
    success:
      "If an account exists for that email, a reset link is on its way. It expires in 60 minutes.",
  };
  if (!user || user.status !== "ACTIVE") return success;

  const token = await createPasswordResetToken(user.id, meta.ip);
  const message = passwordResetMessage(user.name, appUrl(`/reset-password?token=${token}`));
  await sendNotification({
    tenantId: user.memberships[0]?.tenantId ?? null,
    recipientUserId: user.id,
    channel: "EMAIL",
    template: "auth.password_reset",
    to: user.email,
    subject: message.subject,
    body: message.body,
    meta: { userId: user.id },
  });

  await writeAudit({
    tenantId: user.memberships[0]?.tenantId ?? null,
    actorId: user.id,
    actorType: "SYSTEM",
    actorName: user.name,
    action: "auth.password_reset_requested",
    entity: "User",
    entityId: user.id,
    ip: meta.ip,
  });

  return success;
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const record = await findPasswordResetToken(parsed.data.token);
  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    return { error: "This reset link is invalid or has expired. Request a new one." };
  }
  if (record.user.status !== "ACTIVE") {
    return { error: "This account is not active. Contact your platform administrator." };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await db.$transaction([
    db.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    db.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    db.passwordResetToken.deleteMany({
      where: { userId: record.userId, id: { not: record.id } },
    }),
    db.session.deleteMany({ where: { userId: record.userId } }),
  ]);

  const meta = await clientMeta();
  await writeAudit({
    actorId: record.userId,
    actorType: "SYSTEM",
    actorName: record.user.name,
    action: "auth.password_reset",
    entity: "User",
    entityId: record.userId,
    ip: meta.ip,
  });

  return {
    success: "Password updated. Every device has been signed out — sign in with your new password.",
  };
}

// ─────────────────────────────── Sessions & 2FA ───────────────────────────────

export async function revokeSessionAction(formData: FormData) {
  const user = await getSession();
  if (!user) redirect("/login");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;
  const result = await revokeSession(user.id, sessionId);
  if ("success" in result) {
    await writeAudit({
      actorId: user.id,
      actorType: user.isPlatformOwner ? "PLATFORM" : "TENANT",
      actorName: user.name,
      action: "auth.session_revoke",
      entity: "Session",
      entityId: sessionId,
    });
  }
  revalidatePath("/app/settings");
}

export async function revokeOtherSessionsAction() {
  const user = await getSession();
  if (!user) redirect("/login");
  await revokeOtherSessions(user.id);
  await writeAudit({
    actorId: user.id,
    actorType: user.isPlatformOwner ? "PLATFORM" : "TENANT",
    actorName: user.name,
    action: "auth.sessions_revoke_others",
    entity: "User",
    entityId: user.id,
  });
  revalidatePath("/app/settings");
}

export async function beginTwoFactorAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getSession();
  if (!user) return { error: "Session expired. Sign in again." };
  const password = String(formData.get("password") ?? "");
  const record = await db.user.findUnique({ where: { id: user.id } });
  if (!record || !(await verifyPassword(password, record.passwordHash))) {
    return { error: "Your password is incorrect." };
  }
  if (record.twoFactorEnabled) {
    return { error: "Two-factor authentication is already enabled." };
  }
  await db.user.update({
    where: { id: user.id },
    data: { twoFactorSecret: generateTotpSecret() },
  });
  revalidatePath("/app/settings");
  return { success: "Scan the secret in your authenticator app, then confirm the 6-digit code." };
}

export async function confirmTwoFactorAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getSession();
  if (!user) return { error: "Session expired. Sign in again." };
  const parsed = twoFactorCodeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return fieldErrors(parsed.error);

  const record = await db.user.findUnique({ where: { id: user.id } });
  if (!record?.twoFactorSecret) {
    return { error: "Start setup again from the settings page." };
  }
  if (!verifyTotp(record.twoFactorSecret, parsed.data.code)) {
    return { error: "That code is not valid yet. Check your device clock and try the next code." };
  }

  await db.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: true },
  });
  await writeAudit({
    actorId: user.id,
    actorType: user.isPlatformOwner ? "PLATFORM" : "TENANT",
    actorName: user.name,
    action: "auth.2fa_enabled",
    entity: "User",
    entityId: user.id,
  });
  revalidatePath("/app/settings");
  return { success: "Two-factor authentication is on. Keep your authenticator app safe." };
}

export async function disableTwoFactorAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getSession();
  if (!user) return { error: "Session expired. Sign in again." };
  const parsed = disableTwoFactorSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) return fieldErrors(parsed.error);

  const record = await db.user.findUnique({ where: { id: user.id } });
  if (!record || !(await verifyPassword(parsed.data.password, record.passwordHash))) {
    return { error: "Your password is incorrect." };
  }

  await db.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
  await writeAudit({
    actorId: user.id,
    actorType: user.isPlatformOwner ? "PLATFORM" : "TENANT",
    actorName: user.name,
    action: "auth.2fa_disabled",
    entity: "User",
    entityId: user.id,
  });
  revalidatePath("/app/settings");
  return { success: "Two-factor authentication is off." };
}
