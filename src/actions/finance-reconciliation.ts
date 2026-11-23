"use server";

import { requirePlatformPermission } from "@/lib/rbac";
import { db } from "@/lib/db";
import {
  calculateReconciliationMetrics,
  detectFinancialDiscrepancies,
  getStudentFinancialProfile,
  type ReconciliationScope,
} from "@/lib/finance-reconciliation";

export interface StudentFinancialListRow {
  id: string;
  admissionNo: string;
  name: string;
  tenantName: string;
  tenantId: string;
  branchName: string;
  branchType: string;
  classGrade: string;
  section: string;
  assignedFeePaise: number;
  invoicedFeePaise: number;
  paidFeePaise: number;
  outstandingPaise: number;
  status: "PAID" | "PARTIAL" | "DUE" | "OVERDUE" | "UNBILLED";
  invoicesCount: number;
  hasActivePlan: boolean;
}

/**
 * Server action to fetch students with financial metrics for the Student Explorer.
 */
export async function getStudentFinancialListAction(filters: {
  tenantId?: string;
  branchId?: string;
  search?: string;
  status?: string;
  limit?: number;
}): Promise<StudentFinancialListRow[]> {
  await requirePlatformPermission("platform.overview.read");

  const q = filters.search?.trim().toLowerCase();
  const whereTenant = filters.tenantId ? { tenantId: filters.tenantId } : {};
  const whereBranch = filters.branchId ? { branchId: filters.branchId } : {};

  const students = await db.student.findMany({
    where: {
      ...whereTenant,
      ...whereBranch,
      ...(q
        ? {
            OR: [
              { admissionNo: { contains: q, mode: "insensitive" } },
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      tenant: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true, branchType: true } },
      section: {
        include: { class: { select: { name: true } } },
      },
      feePlans: {
        where: { status: "ACTIVE" },
        select: { payableAmount: true, totalAmount: true },
        take: 1,
      },
      feeInvoices: {
        where: { status: { not: "WAIVED" } },
        select: {
          id: true,
          amount: true,
          paidAmount: true,
          status: true,
          dueDate: true,
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: filters.limit || 50,
  });

  const now = new Date();

  const rows: StudentFinancialListRow[] = students.map((s) => {
    const activePlan = s.feePlans[0] || null;
    const assignedFeePaise = activePlan ? activePlan.payableAmount : 0;
    const invoicedFeePaise = s.feeInvoices.reduce((sum, inv) => sum + inv.amount, 0);
    const paidFeePaise = s.feeInvoices.reduce((sum, inv) => sum + inv.paidAmount, 0);
    const outstandingPaise = Math.max(0, invoicedFeePaise - paidFeePaise);

    let status: StudentFinancialListRow["status"] = "UNBILLED";
    const hasOverdue = s.feeInvoices.some((i) => i.dueDate < now && i.status !== "PAID");

    if (invoicedFeePaise > 0) {
      if (outstandingPaise === 0) {
        status = "PAID";
      } else if (hasOverdue) {
        status = "OVERDUE";
      } else if (paidFeePaise > 0) {
        status = "PARTIAL";
      } else {
        status = "DUE";
      }
    }

    return {
      id: s.id,
      admissionNo: s.admissionNo,
      name: `${s.firstName} ${s.lastName}`,
      tenantName: s.tenant.name,
      tenantId: s.tenant.id,
      branchName: s.branch?.name || "Main Campus",
      branchType: s.branch?.branchType || "MAIN",
      classGrade: s.section?.class?.name || "Grade 10",
      section: s.section?.name || "A",
      assignedFeePaise,
      invoicedFeePaise,
      paidFeePaise,
      outstandingPaise,
      status,
      invoicesCount: s.feeInvoices.length,
      hasActivePlan: !!activePlan,
    };
  });

  if (filters.status && filters.status !== "ALL") {
    return rows.filter((r) => r.status === filters.status);
  }

  return rows;
}

/**
 * Server action to fetch a student's complete 8-tab financial profile.
 */
export async function getStudentFinancialProfileAction(studentId: string) {
  await requirePlatformPermission("platform.overview.read");
  return await getStudentFinancialProfile(studentId);
}

/**
 * Server action to fetch comparative reconciliation data and discrepancy list.
 */
export async function getReconciliationDataAction(scope: ReconciliationScope = {}) {
  await requirePlatformPermission("platform.overview.read");
  const [metricsResult, discrepancies] = await Promise.all([
    calculateReconciliationMetrics(scope),
    detectFinancialDiscrepancies(scope),
  ]);

  return {
    metrics: metricsResult.metrics,
    comparativeRows: metricsResult.comparativeRows,
    discrepancies,
  };
}
