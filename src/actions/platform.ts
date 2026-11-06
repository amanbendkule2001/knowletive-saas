"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import { hashPassword } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { slugify, sequenceNumber } from "@/lib/utils";
import { addDays, addMonths } from "@/lib/format";
import { createSubscriptionInvoice, markInvoicePaid } from "@/lib/billing";
import {
  PLATFORM_PERMISSION_KEYS,
  PLATFORM_ROLE_TEMPLATES,
  TENANT_ROLE_TEMPLATES,
  TENANT_PERMISSION_KEYS,
} from "@/lib/catalog";
import {
  fieldErrors,
  instituteSchema,
  planSchema,
  staffSchema,
  type FormState,
} from "@/lib/validation";
import { z } from "zod";

const PLATFORM_SETTINGS_KEY = "platform";

async function uniqueSlug(name: string) {
  const base = slugify(name) || "institute";
  let slug = base;
  let n = 1;
  while (await db.tenant.count({ where: { slug } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

// ─────────────────────────────── Institutes ───────────────────────────────

export async function createInstituteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePlatformPermission("platform.institutes.manage");
  const parsed = instituteSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    city: formData.get("city"),
    planKey: formData.get("planKey"),
    adminName: formData.get("adminName"),
    adminEmail: formData.get("adminEmail"),
    adminPassword: formData.get("adminPassword"),
    trialDays: formData.get("trialDays") ?? 14,
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const data = parsed.data;
  const plan = await db.plan.findUnique({ where: { key: data.planKey } });
  if (!plan || plan.isArchived) return { error: "That plan is not available. Pick another." };

  const existingUser = await db.user.findUnique({ where: { email: data.adminEmail } });
  if (existingUser?.isPlatformOwner) {
    return { error: "That email belongs to a platform owner. Use a different admin email." };
  }

  const slug = await uniqueSlug(data.name);
  const now = new Date();
  const trialEndsAt = data.trialDays > 0 ? addDays(now, data.trialDays) : null;

  let tenantId = "";

  await db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: data.name,
        slug,
        type: data.type,
        status: "TRIAL",
        email: data.email,
        phone: data.phone || null,
        city: data.city || null,
        logoInitials: data.name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0].toUpperCase())
          .join(""),
        trialEndsAt,
        notes: "Created from the platform console",
        settings: { academicYear: "2026-27" },
      },
    });
    tenantId = tenant.id;

    await tx.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: "TRIALING",
        billingCycle: "MONTHLY",
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt ?? addDays(now, 14),
        trialEndsAt,
        seats: plan.maxStaff,
        provider: process.env.BILLING_PROVIDER ?? "manual",
      },
    });

    const roleMap = new Map<string, string>();
    for (const template of TENANT_ROLE_TEMPLATES) {
      const role = await tx.role.create({
        data: {
          scope: "TENANT",
          tenantId: tenant.id,
          key: template.key,
          name: template.name,
          description: template.description,
          isSystem: true,
        },
      });
      roleMap.set(template.key, role.id);
      await tx.rolePermission.createMany({
        data: template.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
      });
    }

    const passwordHash = await hashPassword(data.adminPassword);
    const admin =
      existingUser ??
      (await tx.user.create({
        data: {
          email: data.adminEmail,
          name: data.adminName,
          passwordHash,
          status: "ACTIVE",
          avatarColor: "#4f46e5",
        },
      }));

    await tx.membership.create({
      data: {
        tenantId: tenant.id,
        userId: admin.id,
        roleId: roleMap.get("INSTITUTE_ADMIN")!,
        designation: "Institute Administrator",
        isOwner: true,
        status: "ACTIVE",
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        actorId: actor.id,
        actorType: "PLATFORM",
        actorName: actor.name,
        action: "institute.create",
        entity: "Tenant",
        entityId: tenant.id,
        meta: { name: data.name, plan: plan.key, trialDays: data.trialDays, admin: data.adminEmail },
      },
    });
  });

  revalidatePath("/platform");
  revalidatePath("/platform/institutes");
  redirect(`/platform/institutes/${tenantId}?created=1`);
}

async function setTenantStatus(tenantId: string, status: "ACTIVE" | "SUSPENDED") {
  const actor = await requirePlatformPermission("platform.institutes.manage");
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return;

  await db.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: tenantId }, data: { status } });
    const sub = await tx.tenantSubscription.findUnique({ where: { tenantId } });
    if (sub) {
      await tx.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: status === "SUSPENDED" ? "PAUSED" : sub.status === "PAUSED" ? "ACTIVE" : sub.status },
      });
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorType: "PLATFORM",
        actorName: actor.name,
        action: status === "SUSPENDED" ? "institute.suspend" : "institute.activate",
        entity: "Tenant",
        entityId: tenantId,
      },
    });
  });

  revalidatePath("/platform");
  revalidatePath("/platform/institutes");
  revalidatePath(`/platform/institutes/${tenantId}`);
}

export async function suspendTenantAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  if (tenantId) await setTenantStatus(tenantId, "SUSPENDED");
}

export async function activateTenantAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  if (tenantId) await setTenantStatus(tenantId, "ACTIVE");
}

export async function openWorkspaceAction(formData: FormData) {
  await requirePlatformPermission("platform.institutes.read");
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) redirect("/platform/institutes");
  const { setActiveTenant } = await import("@/lib/auth");
  await setActiveTenant(tenantId);
  redirect("/app");
}

export async function extendTrialAction(formData: FormData) {
  const actor = await requirePlatformPermission("platform.subscriptions.manage");
  const tenantId = String(formData.get("tenantId") ?? "");
  const days = Math.min(90, Math.max(1, Number(formData.get("days") ?? 7)));
  if (!tenantId) return;

  const sub = await db.tenantSubscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
  if (!sub) return;

  const base = sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date();
  const trialEndsAt = addDays(base, days);

  await db.$transaction([
    db.tenantSubscription.update({
      where: { id: sub.id },
      data: { status: "TRIALING", trialEndsAt, currentPeriodEnd: trialEndsAt },
    }),
    db.tenant.update({ where: { id: tenantId }, data: { status: "TRIAL", trialEndsAt } }),
    db.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorType: "PLATFORM",
        actorName: actor.name,
        action: "subscription.extend_trial",
        entity: "TenantSubscription",
        entityId: sub.id,
        meta: { days, trialEndsAt: trialEndsAt.toISOString() },
      },
    }),
  ]);

  revalidatePath(`/platform/institutes/${tenantId}`);
  revalidatePath("/platform/subscriptions");
}

export async function changeTenantPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePlatformPermission("platform.subscriptions.manage");
  const tenantId = String(formData.get("tenantId") ?? "");
  const planId = String(formData.get("planId") ?? "");
  const cycle = formData.get("cycle") === "YEARLY" ? "YEARLY" : "MONTHLY";

  const [tenant, plan] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, include: { subscription: true } }),
    db.plan.findUnique({ where: { id: planId } }),
  ]);
  if (!tenant || !plan) return { error: "Institute or plan not found." };
  if (!tenant.subscription) return { error: "This institute has no subscription record." };

  const now = new Date();
  const periodEnd = cycle === "YEARLY" ? addMonths(now, 12) : addMonths(now, 1);

  const sub = await db.tenantSubscription.update({
    where: { id: tenant.subscription.id },
    data: {
      planId: plan.id,
      billingCycle: cycle,
      status: "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      trialEndsAt: null,
      seats: plan.maxStaff,
    },
  });

  const invoice = await createSubscriptionInvoice(sub, plan, cycle);

  await db.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE", trialEndsAt: null } });

  await writeAudit({
    tenantId,
    actorId: actor.id,
    actorType: "PLATFORM",
    actorName: actor.name,
    action: "subscription.plan_change",
    entity: "TenantSubscription",
    entityId: sub.id,
    meta: { plan: plan.key, cycle, invoice: invoice.number },
  });

  revalidatePath(`/platform/institutes/${tenantId}`);
  revalidatePath("/platform/subscriptions");
  return { success: `Plan changed to ${plan.name}. Invoice ${invoice.number} raised.` };
}

export async function markInvoicePaidAction(formData: FormData) {
  const actor = await requirePlatformPermission("platform.subscriptions.manage");
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim();
  const bankName = String(formData.get("bankName") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!invoiceId) return;

  const parts: string[] = [];
  if (reference) parts.push(`UTR:${reference}`);
  if (bankName) parts.push(`Bank:${bankName}`);
  if (notes) parts.push(`Note:${notes}`);
  const providerRef = parts.length > 0 ? parts.join(" | ") : `MANUAL-SETTLED-${Date.now()}`;

  try {
    await markInvoicePaid(invoiceId, { provider: "manual", providerRef });
    await writeAudit({
      actorId: actor.id,
      actorType: "PLATFORM",
      actorName: actor.name,
      action: "invoice.mark_paid",
      entity: "Invoice",
      entityId: invoiceId,
      meta: { reference, bankName, notes, providerRef },
    });
  } catch (error) {
    console.error("[billing] mark paid failed", error);
  }
  revalidatePath("/platform/subscriptions");
  revalidatePath("/platform");
}

export async function createTenantInvoiceAction(formData: FormData) {
  const actor = await requirePlatformPermission("platform.subscriptions.manage");
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;

  const sub = await db.tenantSubscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
  if (!sub) return;

  const invoice = await createSubscriptionInvoice(sub, sub.plan, sub.billingCycle);
  await writeAudit({
    tenantId,
    actorId: actor.id,
    actorType: "PLATFORM",
    actorName: actor.name,
    action: "invoice.create",
    entity: "Invoice",
    entityId: invoice.id,
    meta: { number: invoice.number, total: invoice.total },
  });
  revalidatePath("/platform/subscriptions");
  revalidatePath(`/platform/institutes/${tenantId}`);
}

// ─────────────────────────────── Plans ───────────────────────────────

function planData(formData: FormData) {
  const parsed = planSchema.safeParse({
    key: formData.get("key"),
    name: formData.get("name"),
    description: formData.get("description"),
    priceMonthly: formData.get("priceMonthly"),
    priceYearly: formData.get("priceYearly"),
    maxStudents: formData.get("maxStudents"),
    maxStaff: formData.get("maxStaff"),
    maxStorageMb: formData.get("maxStorageMb"),
    aiCreditsMonthly: formData.get("aiCreditsMonthly"),
    trialDays: formData.get("trialDays"),
    highlighted: formData.get("highlighted") ?? undefined,
    isPublic: formData.get("isPublic") ?? undefined,
  });
  const features = formData
    .getAll("features")
    .map(String)
    .filter((f) => f.length > 0);
  if (!parsed.success) return { parsed, features } as const;
  return { parsed, features } as const;
}

export async function createPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePlatformPermission("platform.plans.manage");
  const result = planData(formData);
  if (!result.parsed.success) return fieldErrors(result.parsed.error);

  const d = result.parsed.data;
  const exists = await db.plan.count({ where: { key: d.key } });
  if (exists) return { error: "A plan with that key already exists.", fieldErrors: { key: ["Already in use"] } };

  const plan = await db.plan.create({
    data: {
      key: d.key,
      name: d.name,
      description: d.description || null,
      priceMonthly: Math.round(d.priceMonthly * 100),
      priceYearly: Math.round(d.priceYearly * 100),
      maxStudents: d.maxStudents,
      maxStaff: d.maxStaff,
      maxStorageMb: Math.round(d.maxStorageMb * 1024),
      aiCreditsMonthly: d.aiCreditsMonthly,
      trialDays: d.trialDays,
      highlighted: !!d.highlighted,
      isPublic: d.isPublic !== false,
      features: result.features,
      sortOrder: (await db.plan.count()) + 1,
    },
  });

  await writeAudit({
    actorId: actor.id,
    actorType: "PLATFORM",
    actorName: actor.name,
    action: "plan.create",
    entity: "Plan",
    entityId: plan.id,
    meta: { key: plan.key },
  });

  revalidatePath("/platform/plans");
  redirect(`/platform/plans/${plan.id}?created=1`);
}

export async function savePlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePlatformPermission("platform.plans.manage");
  const planId = String(formData.get("planId") ?? "");
  const result = planData(formData);
  if (!result.parsed.success) return fieldErrors(result.parsed.error);

  const existing = await db.plan.findUnique({ where: { id: planId } });
  if (!existing) return { error: "Plan not found." };

  const d = result.parsed.data;
  if (d.key !== existing.key) {
    const clash = await db.plan.count({ where: { key: d.key, NOT: { id: planId } } });
    if (clash) return { error: "Another plan already uses that key." };
  }

  await db.plan.update({
    where: { id: planId },
    data: {
      key: d.key,
      name: d.name,
      description: d.description || null,
      priceMonthly: Math.round(d.priceMonthly * 100),
      priceYearly: Math.round(d.priceYearly * 100),
      maxStudents: d.maxStudents,
      maxStaff: d.maxStaff,
      maxStorageMb: Math.round(d.maxStorageMb * 1024),
      aiCreditsMonthly: d.aiCreditsMonthly,
      trialDays: d.trialDays,
      highlighted: !!d.highlighted,
      isPublic: d.isPublic !== false,
      features: result.features,
    },
  });

  await writeAudit({
    actorId: actor.id,
    actorType: "PLATFORM",
    actorName: actor.name,
    action: "plan.update",
    entity: "Plan",
    entityId: planId,
    meta: { key: d.key, features: result.features.length },
  });

  revalidatePath("/platform/plans");
  revalidatePath(`/platform/plans/${planId}`);
  return { success: "Plan updated. Entitlements apply to every institute on this plan." };
}

// ─────────────────────────────── Roles & team ───────────────────────────────

export async function savePlatformRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePlatformPermission("platform.roles.manage");
  const roleId = String(formData.get("roleId") ?? "");
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role || role.scope !== "PLATFORM") return { error: "Role not found." };
  if (role.key === "PLATFORM_OWNER") {
    return { error: "The owner role always has every permission and cannot be edited." };
  }

  const permissions = formData
    .getAll("permissions")
    .map(String)
    .filter((p) => PLATFORM_PERMISSION_KEYS.includes(p));

  await db.$transaction([
    db.rolePermission.deleteMany({ where: { roleId } }),
    db.rolePermission.createMany({
      data: permissions.map((permissionKey) => ({ roleId, permissionKey })),
    }),
    db.auditLog.create({
      data: {
        actorId: actor.id,
        actorType: "PLATFORM",
        actorName: actor.name,
        action: "role.update",
        entity: "Role",
        entityId: roleId,
        meta: { permissions: permissions.length },
      },
    }),
  ]);

  revalidatePath("/platform/roles");
  return { success: `${role.name} now has ${permissions.length} permissions.` };
}

export async function invitePlatformUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePlatformPermission("platform.users.manage");
  const parsed = staffSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    roleId: formData.get("roleId"),
    designation: formData.get("designation"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const role = await db.role.findUnique({ where: { id: parsed.data.roleId } });
  if (!role || role.scope !== "PLATFORM") return { error: "Choose a valid platform role." };

  const existing = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return { error: "A user with that email already exists." };

  const user = await db.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
      platformRoleId: role.id,
      status: "ACTIVE",
    },
  });

  await writeAudit({
    actorId: actor.id,
    actorType: "PLATFORM",
    actorName: actor.name,
    action: "platform_user.invite",
    entity: "User",
    entityId: user.id,
    meta: { email: user.email, role: role.key },
  });

  revalidatePath("/platform/team");
  return { success: `${user.name} can now sign in with the platform role ${role.name}.` };
}

export async function updatePlatformUserStatusAction(formData: FormData) {
  const actor = await requirePlatformPermission("platform.users.manage");
  const userId = String(formData.get("userId") ?? "");
  const status = formData.get("status") === "ACTIVE" ? "ACTIVE" : "SUSPENDED";
  if (!userId || userId === actor.id) return;

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target || target.isPlatformOwner) return;

  await db.user.update({ where: { id: userId }, data: { status } });
  if (status === "SUSPENDED") {
    await db.session.deleteMany({ where: { userId } });
  }
  await writeAudit({
    actorId: actor.id,
    actorType: "PLATFORM",
    actorName: actor.name,
    action: "platform_user.status",
    entity: "User",
    entityId: userId,
    meta: { status },
  });
  revalidatePath("/platform/team");
}

// ─────────────────────────────── Settings ───────────────────────────────

export async function savePlatformSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requirePlatformPermission("platform.settings.manage");
  const name = String(formData.get("name") ?? "").trim();
  const supportEmail = String(formData.get("supportEmail") ?? "").trim().toLowerCase();
  const defaultTrialDays = Math.min(90, Math.max(0, Number(formData.get("defaultTrialDays") ?? 14)));

  if (name.length < 2) return { error: "Platform name is required." };
  if (!z.string().email().safeParse(supportEmail).success) return { error: "Enter a valid support email." };

  await db.setting.upsert({
    where: { key: PLATFORM_SETTINGS_KEY },
    update: { value: { name, supportEmail, defaultTrialDays, billingProvider: process.env.BILLING_PROVIDER ?? "manual", aiMode: process.env.AI_PROVIDER ?? "mock" } },
    create: { key: PLATFORM_SETTINGS_KEY, value: { name, supportEmail, defaultTrialDays, billingProvider: process.env.BILLING_PROVIDER ?? "manual", aiMode: process.env.AI_PROVIDER ?? "mock" } },
  });

  await writeAudit({
    actorId: actor.id,
    actorType: "PLATFORM",
    actorName: actor.name,
    action: "platform.settings.update",
    entity: "Setting",
    entityId: PLATFORM_SETTINGS_KEY,
  });

  revalidatePath("/platform/settings");
  return { success: "Platform settings saved." };
}

// Keep the compiler honest about intentionally unused helpers.
void sequenceNumber;
void PLATFORM_ROLE_TEMPLATES;
void TENANT_PERMISSION_KEYS;
