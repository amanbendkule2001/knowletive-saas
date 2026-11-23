"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { validateBranchParentHierarchy } from "@/lib/branch";
import { reconcileHistoricalRecord } from "@/lib/branch-reconciliation";
import type { FormState } from "@/lib/validation";
import type { BranchAssignmentScopeMode, BranchType } from "@prisma/client";
import { Prisma } from "@prisma/client";

/**
 * Creates a new branch (MAIN or SUB_BRANCH) within the active tenant under serialization lock.
 */
export async function createBranchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.settings.manage", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const rawParentId = String(formData.get("parentBranchId") ?? "").trim();
  const parentBranchId = rawParentId && rawParentId !== "none" ? rawParentId : null;
  const rawType = String(formData.get("branchType") ?? "").trim().toUpperCase();
  const collectorCode = String(formData.get("collectorCode") ?? "").trim() || null;
  const bankAccountName = String(formData.get("bankAccountName") ?? "").trim() || null;
  const bankAccountNumber = String(formData.get("bankAccountNumber") ?? "").trim() || null;
  const bankIfsc = String(formData.get("bankIfsc") ?? "").trim().toUpperCase() || null;
  const bankBankName = String(formData.get("bankBankName") ?? "").trim() || null;

  if (!name || name.length < 2) {
    return { error: "Branch name must be at least 2 characters." };
  }
  if (!code || code.length < 2) {
    return { error: "Branch code must be at least 2 characters." };
  }

  const branchType: BranchType = rawType === "SUB_BRANCH" || parentBranchId ? "SUB_BRANCH" : "MAIN";

  try {
    const branch = await db.$transaction(
      async (tx) => {
        // Serialize hierarchy mutations for this tenant
        const lockedTenants = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Tenant" WHERE id = ${ctx.tenant.id} FOR UPDATE
        `;
        if (!lockedTenants || lockedTenants.length === 0) {
          throw new Error("Tenant record not found or inaccessible for hierarchy lock.");
        }

        const existingCode = await tx.branch.findUnique({
        where: { tenantId_code: { tenantId: ctx.tenant.id, code } },
        select: { id: true },
      });
      if (existingCode) {
        throw new Error(`Branch code '${code}' is already used in this institute.`);
      }

      if (parentBranchId) {
        const parentValidation = await validateBranchParentHierarchy(ctx.tenant.id, "new", parentBranchId, tx);
        if (!parentValidation.valid) {
          throw new Error(parentValidation.error ?? "Invalid parent branch.");
        }
      }

      const created = await tx.branch.create({
        data: {
          tenantId: ctx.tenant.id,
          name,
          code,
          branchType,
          parentBranchId,
          collectorCode,
          bankAccountName,
          bankAccountNumber,
          bankIfsc,
          bankBankName,
          isActive: true,
        },
      });

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name || ctx.user.email,
          action: "branch.create",
          entity: "Branch",
          entityId: created.id,
          meta: { name: created.name, code: created.code, branchType: created.branchType, parentBranchId },
        },
        tx
      );

      return created;
    });

    revalidatePath("/app/settings");
    revalidatePath("/app/branches");
    revalidatePath("/app/fees");
    return { success: `Branch '${branch.name}' created successfully.` };
  } catch (err: any) {
    return { error: err.message || "Failed to create branch." };
  }
}

/**
 * Updates an existing branch's hierarchy and configuration under exclusive tenant serialization lock.
 * Prevents concurrent circular reparenting races.
 */
export async function updateBranchHierarchyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.settings.manage", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const branchId = String(formData.get("branchId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const rawParentId = String(formData.get("parentBranchId") ?? "").trim();
  const parentBranchId = rawParentId && rawParentId !== "none" ? rawParentId : null;
  const collectorCode = String(formData.get("collectorCode") ?? "").trim() || null;
  const rawType = String(formData.get("branchType") ?? "").trim().toUpperCase();

  if (!branchId) return { error: "Target branch ID is required." };

  try {
    const updated = await db.$transaction(
      async (tx) => {
        // 1. Exclusively lock the tenant to serialize concurrent hierarchy changes
        const lockedTenants = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Tenant" WHERE id = ${ctx.tenant.id} FOR UPDATE
        `;
        if (!lockedTenants || lockedTenants.length === 0) {
          throw new Error("Tenant record not found or inaccessible for hierarchy lock.");
        }

        const existingBranch = await tx.branch.findFirst({
        where: { id: branchId, tenantId: ctx.tenant.id },
      });
      if (!existingBranch) {
        throw new Error("Branch not found in this institute.");
      }

      // Check code uniqueness if changed
      if (code && code !== existingBranch.code) {
        const codeInUse = await tx.branch.findUnique({
          where: { tenantId_code: { tenantId: ctx.tenant.id, code } },
          select: { id: true },
        });
        if (codeInUse) {
          throw new Error(`Branch code '${code}' is already used in this institute.`);
        }
      }

      // Validate hierarchy under tenant lock if parent branch changed
      if (parentBranchId !== existingBranch.parentBranchId) {
        const parentValidation = await validateBranchParentHierarchy(ctx.tenant.id, branchId, parentBranchId, tx);
        if (!parentValidation.valid) {
          throw new Error(parentValidation.error ?? "Invalid parent branch hierarchy.");
        }
      }

      const branchType: BranchType =
        rawType === "MAIN" || rawType === "SUB_BRANCH"
          ? (rawType as BranchType)
          : parentBranchId
          ? "SUB_BRANCH"
          : existingBranch.branchType;

      const up = await tx.branch.update({
        where: { tenantId_id: { tenantId: ctx.tenant.id, id: branchId } },
        data: {
          name: name || existingBranch.name,
          code: code || existingBranch.code,
          parentBranchId,
          branchType,
          collectorCode,
        },
      });

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name || ctx.user.email,
          action: "branch.hierarchy.update",
          entity: "Branch",
          entityId: branchId,
          meta: {
            previousParent: existingBranch.parentBranchId,
            newParent: parentBranchId,
            previousType: existingBranch.branchType,
            newType: branchType,
          },
        },
        tx
      );

      return up;
    });

    revalidatePath("/app/settings");
    revalidatePath("/app/branches");
    revalidatePath("/app/fees");
    return { success: `Branch '${updated.name}' hierarchy updated successfully.` };
  } catch (err: any) {
    return { error: err.message || "Failed to update branch hierarchy." };
  }
}

/**
 * Soft-archives a branch, preserving all historical financial attribution records.
 */
export async function archiveBranchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.settings.manage", "delete");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const branchId = String(formData.get("branchId") ?? "").trim();
  if (!branchId) return { error: "Branch ID is required." };

  const branch = await db.branch.findFirst({
    where: { id: branchId, tenantId: ctx.tenant.id },
    select: { id: true, name: true, isActive: true },
  });
  if (!branch) {
    return { error: "Branch not found in this institute." };
  }

  // Check if branch has active children
  const activeChildren = await db.branch.count({
    where: { tenantId: ctx.tenant.id, parentBranchId: branchId, isActive: true },
  });
  if (activeChildren > 0) {
    return {
      error: `Cannot archive '${branch.name}'. It has ${activeChildren} active sub-branch(es). Reassign or archive children first.`,
    };
  }

  await db.branch.update({
    where: { tenantId_id: { tenantId: ctx.tenant.id, id: branchId } },
    data: { isActive: false },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name || ctx.user.email,
    action: "branch.archive",
    entity: "Branch",
    entityId: branchId,
    meta: { name: branch.name },
  });

  revalidatePath("/app/settings");
  revalidatePath("/app/branches");
  return { success: `Branch '${branch.name}' has been archived.` };
}

/**
 * Activates an archived or inactive branch, restoring it to active operations.
 */
export async function activateBranchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.settings.manage", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const branchId = String(formData.get("branchId") ?? "").trim();
  if (!branchId) return { error: "Branch ID is required." };

  const branch = await db.branch.findFirst({
    where: { id: branchId, tenantId: ctx.tenant.id },
    select: { id: true, name: true, isActive: true, parentBranchId: true },
  });
  if (!branch) {
    return { error: "Branch not found in this institute." };
  }

  // If this is a sub-branch, ensure parent branch is active
  if (branch.parentBranchId) {
    const parent = await db.branch.findFirst({
      where: { id: branch.parentBranchId, tenantId: ctx.tenant.id, isActive: true },
      select: { id: true },
    });
    if (!parent) {
      return { error: "Parent branch must be active before activating this sub-branch." };
    }
  }

  await db.branch.update({
    where: { tenantId_id: { tenantId: ctx.tenant.id, id: branchId } },
    data: { isActive: true },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name || ctx.user.email,
    action: "branch.activate",
    entity: "Branch",
    entityId: branchId,
    meta: { name: branch.name },
  });

  revalidatePath("/app/branches");
  revalidatePath("/app/settings");
  revalidatePath("/app/fees");
  revalidatePath("/platform/finance");
  return { success: `Branch '${branch.name}' has been activated.` };
}

/**
 * Assigns or updates a staff member's branch assignment with explicit scope mode.
 * Strictly permits only EXACT_BRANCH and BRANCH_AND_DESCENDANTS.
 */
export async function assignMembershipBranchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.settings.manage", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const membershipId = String(formData.get("membershipId") ?? "").trim();
  const branchId = String(formData.get("branchId") ?? "").trim();
  const rawScopeMode = String(formData.get("scopeMode") ?? "EXACT_BRANCH").trim().toUpperCase();

  if (!membershipId || !branchId) {
    return { error: "Both Membership ID and Branch ID are required." };
  }

  // Strictly disallow TENANT_WIDE as a branch assignment mode
  if (rawScopeMode === "TENANT_WIDE") {
    return { error: "Tenant-wide authorization cannot be granted through a branch assignment." };
  }

  const validScopeModes: BranchAssignmentScopeMode[] = ["EXACT_BRANCH", "BRANCH_AND_DESCENDANTS"];
  const scopeMode: BranchAssignmentScopeMode = validScopeModes.includes(rawScopeMode as BranchAssignmentScopeMode)
    ? (rawScopeMode as BranchAssignmentScopeMode)
    : "EXACT_BRANCH";

  // Verify membership belongs to tenant
  const targetMember = await db.membership.findFirst({
    where: { id: membershipId, tenantId: ctx.tenant.id },
    select: { id: true, userId: true },
  });
  if (!targetMember) {
    return { error: "Staff member not found in this institute." };
  }

  // Verify branch belongs to tenant and is active
  const targetBranch = await db.branch.findFirst({
    where: { id: branchId, tenantId: ctx.tenant.id, isActive: true },
    select: { id: true, name: true },
  });
  if (!targetBranch) {
    return { error: "Target branch not found or is inactive." };
  }

  let actorMembershipId = (ctx.membership as any)?.id;
  if (!actorMembershipId && ctx.user?.id) {
    const m = await db.membership.findFirst({
      where: { tenantId: ctx.tenant.id, userId: ctx.user.id },
      select: { id: true },
    });
    actorMembershipId = m?.id;
  }

  const assignment = await db.$transaction(async (tx) => {
    const asgn = await tx.membershipBranch.upsert({
      where: {
        tenantId_membershipId_branchId: {
          tenantId: ctx.tenant.id,
          membershipId,
          branchId,
        },
      },
      update: {
        scopeMode,
        assignedById: actorMembershipId ?? null,
        updatedAt: new Date(),
      },
      create: {
        tenantId: ctx.tenant.id,
        membershipId,
        branchId,
        scopeMode,
        assignedById: actorMembershipId ?? null,
      },
    });

    // Synchronize Membership.branchId with primary assigned branch
    await tx.membership.update({
      where: { id: membershipId },
      data: { branchId },
    });

    return asgn;
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name || ctx.user.email,
    action: "membership.branch.assign",
    entity: "MembershipBranch",
    entityId: assignment.id,
    meta: { membershipId, branchId, scopeMode },
  });

  revalidatePath("/app/staff");
  return { success: `Assigned to '${targetBranch.name}' with scope '${scopeMode}'.` };
}

/**
 * Revokes a staff member's branch assignment.
 * Clears legacy fallback column to ensure revoked assignment cannot restore broader access.
 */
export async function removeMembershipBranchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.settings.manage", "delete");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const membershipId = String(formData.get("membershipId") ?? "").trim();
  const branchId = String(formData.get("branchId") ?? "").trim();

  if (!membershipId || !branchId) {
    return { error: "Both Membership ID and Branch ID are required." };
  }

  const deletedCount = await db.$transaction(async (tx) => {
    const result = await tx.membershipBranch.deleteMany({
      where: {
        tenantId: ctx.tenant.id,
        membershipId,
        branchId,
      },
    });

    // Clear legacy Membership.branchId if it references this branch or if no assignments remain
    const remainingAssignments = await tx.membershipBranch.findFirst({
      where: { tenantId: ctx.tenant.id, membershipId },
      select: { branchId: true },
    });

    await tx.membership.update({
      where: { id: membershipId },
      data: { branchId: remainingAssignments?.branchId ?? null },
    });

    return result.count;
  });

  if (deletedCount === 0) {
    return { error: "Assignment not found." };
  }

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name || ctx.user.email,
    action: "membership.branch.revoke",
    entity: "MembershipBranch",
    entityId: `${membershipId}_${branchId}`,
    meta: { membershipId, branchId },
  });

  revalidatePath("/app/staff");
  return { success: "Branch assignment revoked." };
}

/**
 * Server action for historical record reconciliation by Institute Owner.
 */
export async function reconcileHistoricalRecordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.settings.manage", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const recordType = String(formData.get("recordType") ?? "").trim() as any;
  const recordId = String(formData.get("recordId") ?? "").trim();
  const newBranchId = String(formData.get("newBranchId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const candidateEvidence = String(formData.get("candidateEvidence") ?? "").trim();

  if (!recordType || !recordId || !newBranchId || !reason) {
    return { error: "Record type, record ID, target branch, and reason are required." };
  }

  const result = await reconcileHistoricalRecord(ctx, {
    recordType,
    recordId,
    newBranchId,
    reason,
    candidateEvidence,
  });

  if (!result.success) {
    return { error: result.error ?? "Failed to reconcile record." };
  }

  revalidatePath("/app/settings");
  return { success: "Record successfully reconciled to branch." };
}
