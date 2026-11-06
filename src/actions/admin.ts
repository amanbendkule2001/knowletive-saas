"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireTenant, authorizeTenantWrite } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { createSubscriptionInvoice } from "@/lib/billing";
import { TENANT_PERMISSION_KEYS } from "@/lib/catalog";
import {
  fieldErrors,
  institutionSettingsSchema,
  type FormState,
} from "@/lib/validation";

const roleSchema = z.object({
  name: z.string().trim().min(2, "Role name is required").max(50),
  description: z.string().trim().max(200).optional().or(z.literal("")),
});

function roleKey(name: string) {
  return (
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "CUSTOM_ROLE"
  );
}

async function uniqueRoleKey(tenantId: string, name: string) {
  const base = roleKey(name);
  let key = base;
  let n = 1;
  while (await db.role.findFirst({ where: { tenantId, key }, select: { id: true } })) {
    n++;
    key = `${base}_${n}`;
  }
  return key;
}

function selectedPermissions(formData: FormData) {
  return [
    ...new Set(
      formData
        .getAll("permissions")
        .map(String)
        .filter((p) => TENANT_PERMISSION_KEYS.includes(p)),
    ),
  ];
}

// ─────────────────────────────── Tenant roles ───────────────────────────────

export async function createTenantRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.roles.manage", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const parsed = roleSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const permissions = selectedPermissions(formData);
  if (permissions.length === 0) return { error: "Choose at least one permission for the new role." };

  const key = await uniqueRoleKey(ctx.tenant.id, parsed.data.name);
  const role = await db.role.create({
    data: {
      scope: "TENANT",
      tenantId: ctx.tenant.id,
      key,
      name: parsed.data.name,
      description: parsed.data.description || null,
      isSystem: false,
      permissions: {
        createMany: { data: permissions.map((permissionKey) => ({ permissionKey })) },
      },
    },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "role.create",
    entity: "Role",
    entityId: role.id,
    meta: { key: role.key, permissions: permissions.length },
  });

  revalidatePath("/app/roles");
  return { success: `${role.name} created with ${permissions.length} permissions. Assign it to staff from the Staff page.` };
}

export async function saveTenantRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.roles.manage", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const roleId = String(formData.get("roleId") ?? "");
  const parsed = roleSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const role = await db.role.findFirst({
    where: { id: roleId, tenantId: ctx.tenant.id, scope: "TENANT" },
  });
  if (!role) return { error: "Role not found." };
  if (role.key === "INSTITUTE_ADMIN") {
    return { error: "The Institute Admin role always has full access and cannot be edited." };
  }

  const permissions = selectedPermissions(formData);

  await db.$transaction([
    db.role.update({
      where: { id: role.id },
      data: { name: parsed.data.name, description: parsed.data.description || null },
    }),
    db.rolePermission.deleteMany({ where: { roleId: role.id } }),
    db.rolePermission.createMany({
      data: permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
    }),
    db.auditLog.create({
      data: {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorType: "TENANT",
        actorName: ctx.user.name,
        action: "role.update",
        entity: "Role",
        entityId: role.id,
        meta: { permissions: permissions.length, key: role.key },
      },
    }),
  ]);

  revalidatePath("/app/roles");
  revalidatePath("/app/staff");
  return { success: `${parsed.data.name} now has ${permissions.length} permissions. Changes apply on the member's next request.` };
}

export async function deleteTenantRoleAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.roles.manage", "delete");
  if (!auth.ok) redirect("/app/roles?denied_action=delete");
  const ctx = auth.ctx;
  const roleId = String(formData.get("roleId") ?? "");
  if (!roleId) return;
  const role = await db.role.findFirst({
    where: { id: roleId, tenantId: ctx.tenant.id, scope: "TENANT" },
    include: { _count: { select: { memberships: true } } },
  });
  if (!role || role.isSystem || role._count.memberships > 0) return;

  await db.role.delete({ where: { id: roleId } });
  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "role.delete",
    entity: "Role",
    entityId: roleId,
    meta: { key: role.key },
  });
  revalidatePath("/app/roles");
}

// ─────────────────────────────── Institute settings ───────────────────────────────

export async function saveInstitutionSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.settings.manage", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const parsed = institutionSettingsSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    website: formData.get("website"),
    address: formData.get("address"),
    city: formData.get("city"),
    state: formData.get("state"),
    timezone: formData.get("timezone"),
    currency: formData.get("currency"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const accent = String(formData.get("accentColor") ?? "").trim();
  const accentColor = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ctx.tenant.accentColor;
  const existingSettings =
    ctx.tenant.settings && typeof ctx.tenant.settings === "object" && !Array.isArray(ctx.tenant.settings)
      ? (ctx.tenant.settings as Record<string, unknown>)
      : {};
  const academicYear = String(formData.get("academicYear") ?? "").trim();

  await db.tenant.update({
    where: { id: ctx.tenant.id },
    data: {
      ...parsed.data,
      accentColor,
      logoInitials:
        parsed.data.name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase() ?? "")
          .join("") || ctx.tenant.logoInitials,
      settings: {
        ...existingSettings,
        ...(academicYear ? { academicYear } : {}),
        ...(String(formData.get("upiVpa") ?? "").trim() ? { upiVpa: String(formData.get("upiVpa")).trim() } : {}),
        ...(String(formData.get("bankName") ?? "").trim() ? { bankName: String(formData.get("bankName")).trim() } : {}),
        ...(String(formData.get("accountNumber") ?? "").trim() ? { accountNumber: String(formData.get("accountNumber")).trim() } : {}),
        ...(String(formData.get("ifscCode") ?? "").trim() ? { ifscCode: String(formData.get("ifscCode")).trim() } : {}),
        ...(String(formData.get("accountHolder") ?? "").trim() ? { accountHolder: String(formData.get("accountHolder")).trim() } : {}),
      },
    },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "settings.update",
    entity: "Tenant",
    entityId: ctx.tenant.id,
  });

  revalidatePath("/app/settings");
  revalidatePath("/app");
  return { success: "Institute settings saved." };
}

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireTenant();
  const name = String(formData.get("name") ?? "").trim();
  const accent = String(formData.get("avatarColor") ?? "").trim();
  const avatarColor = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : ctx.user.avatarColor;

  if (name.length < 2) return { error: "Enter your full name." };
  if (name.length > 80) return { error: "Keep your name under 80 characters." };

  await db.user.update({ where: { id: ctx.user.id }, data: { name, avatarColor } });
  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: name,
    action: "profile.update",
    entity: "User",
    entityId: ctx.user.id,
  });
  revalidatePath("/app/settings");
  return { success: "Your profile was updated." };
}

// ─────────────────────────────── Tenant billing ───────────────────────────────

export async function changeTenantPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.billing.manage", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const planId = String(formData.get("planId") ?? "");
  const cycle = formData.get("cycle") === "YEARLY" ? "YEARLY" : "MONTHLY";

  const [plan, subscription] = await Promise.all([
    db.plan.findUnique({ where: { id: planId } }),
    db.tenantSubscription.findUnique({ where: { tenantId: ctx.tenant.id } }),
  ]);
  if (!plan || plan.isArchived) return { error: "That plan is not available." };
  if (!subscription) return { error: "This institute has no subscription record. Contact support." };

  if (
    subscription.planId === plan.id &&
    subscription.billingCycle === cycle &&
    subscription.status === "ACTIVE"
  ) {
    return { error: "You are already on this plan and billing cycle." };
  }

  const now = new Date();
  const updated = await db.tenantSubscription.update({
    where: { id: subscription.id },
    data: {
      planId: plan.id,
      billingCycle: cycle,
      status: "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd:
        cycle === "YEARLY"
          ? new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()))
          : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate())),
      trialEndsAt: null,
      seats: plan.maxStaff,
    },
  });

  const invoice = await createSubscriptionInvoice(updated, plan, cycle);
  await db.tenant.update({
    where: { id: ctx.tenant.id },
    data: { status: "ACTIVE", trialEndsAt: null },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "billing.plan_change",
    entity: "TenantSubscription",
    entityId: updated.id,
    meta: { plan: plan.key, cycle, invoice: invoice.number },
  });

  revalidatePath("/app/billing");
  revalidatePath("/app");
  return {
    success: `Plan changed to ${plan.name}. Invoice ${invoice.number} has been raised — pay by bank transfer, and the platform team will activate the period.`,
  };
}
