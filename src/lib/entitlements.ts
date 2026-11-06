import "server-only";

import type { Plan, Prisma } from "@prisma/client";
import { FEATURE_MAP } from "@/lib/catalog";
import type { TenantContext } from "@/lib/auth";
import { db } from "@/lib/db";

export function planFeatures(plan: Plan | null | undefined): Set<string> {
  return new Set(plan?.features ?? []);
}

export function hasFeature(plan: Plan | null | undefined, key: string) {
  return planFeatures(plan).has(key);
}

export function featureLabel(key: string) {
  return FEATURE_MAP.get(key)?.label ?? key;
}

/** Inclusive limits: returns the headroom left before the plan cap. */
export function remainingStudents(plan: Plan, current: number) {
  return Math.max(0, plan.maxStudents - current);
}

/**
 * Called by write actions that create student/staff records. Fails closed so a
 * plan change or billing lapse can never silently exceed contracted limits.
 */
export async function assertStudentCapacity(ctx: TenantContext) {
  const plan = ctx.tenant.subscription?.plan;
  if (!plan) throw new Error("No active plan. Choose a plan in Billing first.");
  const count = await db.student.count({
    where: { tenantId: ctx.tenant.id, status: { not: "ALUMNI" } },
  });
  if (count >= plan.maxStudents) {
    throw new Error(
      `Student limit reached (${plan.maxStudents} on the ${plan.name} plan). Upgrade to add more students.`,
    );
  }
}

/**
 * Concurrency-safe student capacity assertion for transactional operations.
 * Must be executed inside a Prisma transaction (tx).
 * Acquires a row-level lock on the Tenant record to serialize concurrent admissions.
 */
export async function assertStudentCapacityTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  additionalCount: number = 1
): Promise<{ planId: string; maxStudents: number; currentCount: number }> {
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;

  const sub = await tx.tenantSubscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
  if (!sub || !sub.plan) {
    throw new Error("No active subscription plan found. Please select a plan in Billing.");
  }

  const currentCount = await tx.student.count({
    where: { tenantId, status: { not: "ALUMNI" } },
  });

  if (currentCount + additionalCount > sub.plan.maxStudents) {
    throw new Error(
      `Cannot add ${additionalCount} student${additionalCount > 1 ? "s" : ""}. Limit reached (${currentCount}/${sub.plan.maxStudents} on ${sub.plan.name} plan). Please upgrade your plan.`
    );
  }

  return { planId: sub.plan.id, maxStudents: sub.plan.maxStudents, currentCount };
}

export async function assertStaffCapacity(ctx: TenantContext) {
  const plan = ctx.tenant.subscription?.plan;
  if (!plan) throw new Error("No active plan. Choose a plan in Billing first.");
  const count = await db.membership.count({
    where: { tenantId: ctx.tenant.id, status: { not: "SUSPENDED" } },
  });
  if (count >= plan.maxStaff) {
    throw new Error(
      `Staff limit reached (${plan.maxStaff} on the ${plan.name} plan). Upgrade to invite more staff.`,
    );
  }
}

export async function usageSnapshot(tenantId: string) {
  const [students, staff, aiJobs, storage] = await Promise.all([
    db.student.count({ where: { tenantId, status: { not: "ALUMNI" } } }),
    db.membership.count({ where: { tenantId, status: { not: "SUSPENDED" } } }),
    db.aiJob.count({ where: { tenantId } }),
    Promise.resolve(0), // Storage metering lands with document uploads.
  ]);
  return { students, staff, aiJobs, storageMb: storage };
}
