import "server-only";

import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/auth";
import { hasTenantPermission } from "@/lib/auth";
import type { BranchAssignmentScopeMode, BranchType, BranchVerificationStatus } from "@prisma/client";
import { resolvePaymentCollectorBranch } from "@/lib/payment-routing";

export { resolvePaymentCollectorBranch };
export type { CollectorRoutingInput, RoutingResolutionResult } from "@/lib/payment-routing";

export type BranchAccessMode = "TENANT_WIDE" | "RESTRICTED" | "NO_ACCESS";

export interface UserBranchScope {
  mode: BranchAccessMode;
  isBranchScoped: boolean;
  hasAccess: boolean;
  assignedBranchId: string | null;
  assignedBranch: {
    id: string;
    name: string;
    code: string;
    branchType: BranchType;
    collectorCode: string | null;
    verificationStatus: BranchVerificationStatus;
  } | null;
  allowedBranchIds: string[];
  assignedBranchIds?: string[];
  assignmentScopes?: {
    branchId: string;
    scopeMode: BranchAssignmentScopeMode;
  }[];
}

/**
 * Recursively resolves all active descendant branch IDs for the given root branch IDs within the specified tenant.
 * Guards against cycles and supports arbitrary depth traversal.
 */
export async function getBranchDescendantIds(
  tenantId: string,
  rootBranchIds: string[],
  options: { includeSelf?: boolean; client?: any } = {}
): Promise<string[]> {
  const { includeSelf = true, client = db } = options;
  if (!rootBranchIds || rootBranchIds.length === 0) return [];

  const allActiveBranches = await client.branch.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, parentBranchId: true },
  });

  // Build parent -> children adjacency map
  const childrenMap = new Map<string, string[]>();
  for (const b of allActiveBranches) {
    if (b.parentBranchId) {
      const list = childrenMap.get(b.parentBranchId) ?? [];
      list.push(b.id);
      childrenMap.set(b.parentBranchId, list);
    }
  }

  const result = new Set<string>();
  const visited = new Set<string>();
  const queue = [...rootBranchIds];

  if (includeSelf) {
    for (const id of rootBranchIds) {
      result.add(id);
    }
  }

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const children = childrenMap.get(currentId) ?? [];
    for (const childId of children) {
      result.add(childId);
      if (!visited.has(childId)) {
        queue.push(childId);
      }
    }
  }

  return Array.from(result);
}

/**
 * Validates branch hierarchy assignment to prevent cross-tenant parents, self-parenting, and circular dependencies.
 */
export async function validateBranchParentHierarchy(
  tenantId: string,
  branchId: string,
  candidateParentBranchId: string | null,
  client: any = db
): Promise<{ valid: boolean; error?: string }> {
  if (!candidateParentBranchId) {
    return { valid: true };
  }

  if (candidateParentBranchId === branchId) {
    return { valid: false, error: "A branch cannot be its own parent." };
  }

  const parent = await client.branch.findFirst({
    where: { id: candidateParentBranchId, tenantId },
    select: { id: true, parentBranchId: true, isActive: true },
  });

  if (!parent) {
    return { valid: false, error: "The selected parent branch does not exist in this tenant." };
  }

  // Traverse ancestor chain from candidateParentBranchId upwards to detect cycles
  let currentParentId: string | null = parent.parentBranchId;
  const visited = new Set<string>([candidateParentBranchId]);
  let depth = 0;
  const maxDepth = 50;

  while (currentParentId && depth < maxDepth) {
    if (currentParentId === branchId) {
      return {
        valid: false,
        error: "Circular branch hierarchy detected: a branch cannot have one of its descendants as its parent.",
      };
    }
    if (visited.has(currentParentId)) {
      return {
        valid: false,
        error: "Circular hierarchy detected in existing parent structure.",
      };
    }
    visited.add(currentParentId);

    const ancestor = await client.branch.findFirst({
      where: { id: currentParentId, tenantId },
      select: { parentBranchId: true },
    });
    currentParentId = ancestor?.parentBranchId ?? null;
    depth++;
  }

  return { valid: true };
}

/**
 * Resolves the hierarchical branch access scope for the authenticated user within their active tenant.
 * - Explicit authorization states:
 *   - TENANT_WIDE: explicit authorized institute-wide access (verified owner or explicit canonical permission).
 *   - RESTRICTED: staff explicitly assigned to one or more branches (evaluates EXACT_BRANCH vs BRANCH_AND_DESCENDANTS).
 *   - NO_ACCESS: no valid tenant membership, inactive membership, missing branch assignment for non-admin, or inactive/cross-tenant branch.
 */
export async function resolveUserBranchScope(ctx: TenantContext): Promise<UserBranchScope> {
  const tenantId = ctx.tenant?.id;
  if (!tenantId || !ctx.membership) {
    return {
      mode: "NO_ACCESS",
      isBranchScoped: true,
      hasAccess: false,
      assignedBranchId: null,
      assignedBranch: null,
      allowedBranchIds: [],
    };
  }

  // Inactive memberships must receive NO_ACCESS
  let membershipId = (ctx.membership as any)?.id;
  let membershipStatus = (ctx.membership as any)?.status;

  if (!membershipId && ctx.user?.id) {
    const dbMember = await db.membership.findFirst({
      where: { tenantId, userId: ctx.user.id },
      select: { id: true, status: true, branchId: true },
    });
    if (dbMember) {
      membershipId = dbMember.id;
      membershipStatus = dbMember.status;
    }
  }

  if (membershipStatus && membershipStatus !== "ACTIVE") {
    return {
      mode: "NO_ACCESS",
      isBranchScoped: true,
      hasAccess: false,
      assignedBranchId: null,
      assignedBranch: null,
      allowedBranchIds: [],
    };
  }

  const isAuthorizedTenantWide =
    Boolean(ctx.user?.isPlatformOwner) ||
    Boolean(ctx.isOwnerView) ||
    Boolean(ctx.membership.isOwner) ||
    ctx.membership.roleKey === "INSTITUTE_ADMIN" ||
    Boolean(ctx.permissions && hasTenantPermission(ctx, "tenant.settings.manage"));

  // Check multi-branch assignments in MembershipBranch
  const memberAssignments = membershipId
    ? await db.membershipBranch
        .findMany({
          where: { tenantId, membershipId },
          include: {
            branch: {
              select: {
                id: true,
                name: true,
                code: true,
                branchType: true,
                collectorCode: true,
                verificationStatus: true,
                isActive: true,
              },
            },
          },
        })
        .catch(() => [])
    : [];

  if (memberAssignments.length > 0) {
    const activeAssignments = memberAssignments.filter((a) => a.branch && a.branch.isActive);

    // If all assigned branches are inactive/deleted
    if (activeAssignments.length === 0) {
      if (isAuthorizedTenantWide) {
        const allBranches = await db.branch
          .findMany({
            where: { tenantId, isActive: true },
            select: { id: true },
          })
          .catch(() => []);
        return {
          mode: "TENANT_WIDE",
          isBranchScoped: false,
          hasAccess: true,
          assignedBranchId: null,
          assignedBranch: null,
          allowedBranchIds: allBranches.map((b) => b.id),
        };
      }
      return {
        mode: "NO_ACCESS",
        isBranchScoped: true,
        hasAccess: false,
        assignedBranchId: null,
        assignedBranch: null,
        allowedBranchIds: [],
      };
    }

    // If user is verified tenant-wide authority (Owner/Institute Admin), grant TENANT_WIDE regardless of branch assignments
    if (isAuthorizedTenantWide) {
      const allBranches = await db.branch
        .findMany({
          where: { tenantId, isActive: true },
          select: { id: true },
        })
        .catch(() => []);
      return {
        mode: "TENANT_WIDE",
        isBranchScoped: false,
        hasAccess: true,
        assignedBranchId: null,
        assignedBranch: null,
        allowedBranchIds: allBranches.map((b) => b.id),
      };
    }

    // Resolve allowed branch IDs across all assignments
    // Ordinary branch assignments can NEVER manufacture TENANT_WIDE access
    const allowedBranchSet = new Set<string>();
    for (const assignment of activeAssignments) {
      if (assignment.scopeMode === "EXACT_BRANCH") {
        allowedBranchSet.add(assignment.branchId);
      } else if (assignment.scopeMode === "BRANCH_AND_DESCENDANTS") {
        const descendantIds = await getBranchDescendantIds(tenantId, [assignment.branchId], {
          includeSelf: true,
          client: db,
        });
        for (const id of descendantIds) {
          allowedBranchSet.add(id);
        }
      }
    }

    const allowedBranchIds = Array.from(allowedBranchSet);
    const primaryBranch = activeAssignments[0].branch;

    return {
      mode: "RESTRICTED",
      isBranchScoped: true,
      hasAccess: allowedBranchIds.length > 0,
      assignedBranchId: primaryBranch?.id ?? null,
      assignedBranch: primaryBranch ?? null,
      allowedBranchIds,
      assignedBranchIds: activeAssignments.map((a) => a.branchId),
      assignmentScopes: activeAssignments.map((a) => ({
        branchId: a.branchId,
        scopeMode: a.scopeMode,
      })),
    };
  }

  // Backwards compatibility: Fallback to legacy single Membership.branchId
  const membershipBranchId = ctx.membership.branchId ?? null;

  if (!membershipBranchId) {
    if (isAuthorizedTenantWide) {
      const allBranches = await db.branch
        .findMany({
          where: { tenantId, isActive: true },
          select: { id: true },
        })
        .catch(() => []);
      return {
        mode: "TENANT_WIDE",
        isBranchScoped: false,
        hasAccess: true,
        assignedBranchId: null,
        assignedBranch: null,
        allowedBranchIds: allBranches.map((b) => b.id),
      };
    }

    // A user with no branch assignment and without tenant-wide authority has NO_ACCESS
    return {
      mode: "NO_ACCESS",
      isBranchScoped: true,
      hasAccess: false,
      assignedBranchId: null,
      assignedBranch: null,
      allowedBranchIds: [],
    };
  }

  // User has legacy branch assigned
  const assignedBranch = await db.branch
    .findFirst({
      where: { id: membershipBranchId, tenantId, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        branchType: true,
        collectorCode: true,
        verificationStatus: true,
      },
    })
    .catch(() => null);

  if (!assignedBranch) {
    return {
      mode: "NO_ACCESS",
      isBranchScoped: true,
      hasAccess: false,
      assignedBranchId: membershipBranchId,
      assignedBranch: null,
      allowedBranchIds: [],
    };
  }

  if (assignedBranch.branchType === "MAIN") {
    // MAIN branch includes self + all recursive active child descendants
    const descendantIds = await getBranchDescendantIds(tenantId, [assignedBranch.id], {
      includeSelf: true,
      client: db,
    });
    return {
      mode: "RESTRICTED",
      isBranchScoped: true,
      hasAccess: true,
      assignedBranchId: assignedBranch.id,
      assignedBranch,
      allowedBranchIds: descendantIds,
    };
  }

  // SUB_BRANCH is strictly restricted to its own branch ID
  return {
    mode: "RESTRICTED",
    isBranchScoped: true,
    hasAccess: true,
    assignedBranchId: assignedBranch.id,
    assignedBranch,
    allowedBranchIds: [assignedBranch.id],
  };
}

/**
 * Validates whether an authenticated user is authorized to perform queries or mutations
 * on the target branchId.
 */
export async function verifyBranchAccess(
  ctx: TenantContext,
  targetBranchId?: string | null,
): Promise<{ ok: true; effectiveBranchIds: string[] } | { ok: false; error: string }> {
  const scope = await resolveUserBranchScope(ctx);

  if (scope.mode === "NO_ACCESS" || !scope.hasAccess) {
    return {
      ok: false,
      error: "Access denied. You do not have an active branch assignment or authorization.",
    };
  }

  if (!targetBranchId) {
    if (scope.mode === "TENANT_WIDE") {
      return { ok: true, effectiveBranchIds: [] }; // Unrestricted tenant-wide
    }
    return { ok: true, effectiveBranchIds: scope.allowedBranchIds };
  }

  // Verify target branch exists in the current tenant
  const targetBranch = await db.branch.findFirst({
    where: { id: targetBranchId, tenantId: ctx.tenant.id },
    select: { id: true, isActive: true },
  });

  if (!targetBranch) {
    return { ok: false, error: "The requested branch does not exist in this institute." };
  }

  if (scope.mode === "TENANT_WIDE") {
    return { ok: true, effectiveBranchIds: [targetBranchId] };
  }

  if (!scope.allowedBranchIds.includes(targetBranchId)) {
    return {
      ok: false,
      error: "Access denied. You do not have authorization to view or alter records for this branch.",
    };
  }

  return { ok: true, effectiveBranchIds: [targetBranchId] };
}

/**
 * Resolves a branch by collector code within a tenant for webhook routing.
 * Delegates to the provider-neutral resolvePaymentCollectorBranch service.
 */
export async function resolveBranchByCollectorCode(
  tenantId: string,
  collectorCode: string,
  client: any = db,
  provider: string = "DEMO",
  environment: string = "DEMO"
): Promise<{ status: "MATCHED" | "AMBIGUOUS" | "NOT_FOUND"; branchId: string | null }> {
  const result = await resolvePaymentCollectorBranch(
    {
      tenantId,
      provider,
      environment,
      collectorCode,
    },
    client
  );

  if (result.status === "RESOLVED") {
    return { status: "MATCHED", branchId: result.branchId };
  }
  if (result.status === "QUARANTINED" && result.reason === "AMBIGUOUS_SHARED_CODE") {
    return { status: "AMBIGUOUS", branchId: null };
  }
  return { status: "NOT_FOUND", branchId: null };
}

/**
 * Builds a Prisma WHERE filter enforcing branch isolation.
 * Fails closed with empty array when no branches are permitted.
 */
export function buildBranchFilter(effectiveBranchIds: string[]): { branchId: { in: string[] } } | { branchId?: string } {
  if (effectiveBranchIds.length === 1) {
    return { branchId: effectiveBranchIds[0] };
  }
  if (effectiveBranchIds.length > 1) {
    return { branchId: { in: effectiveBranchIds } };
  }
  // Fail closed: match nothing if no branches allowed
  return { branchId: { in: [] } };
}
