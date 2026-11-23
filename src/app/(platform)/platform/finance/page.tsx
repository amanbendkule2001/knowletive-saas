import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import {
  PageHeader,
  Badge,
} from "@/components/ui/primitives";
import {
  FinanceDashboardClient,
} from "./finance-dashboard-client";
import {
  FinancePayableExplorerClient,
  type BranchPayableInfo,
  type InstitutePayableGroup,
} from "./finance-payable-explorer-client";
import {
  calculateReconciliationMetrics,
  detectFinancialDiscrepancies,
} from "@/lib/finance-reconciliation";
import { getStudentFinancialListAction } from "@/actions/finance-reconciliation";

export const metadata = { title: "Fee Gateway & Platform Finance" };

export default async function PlatformFinancePage() {
  const user = await requirePlatformPermission("platform.overview.read");

  // 1. Fetch all tenants with their branches and fee aggregates
  const tenants = await db.tenant.findMany({
    include: {
      _count: { select: { students: true } },
      branches: {
        where: { isActive: true },
        include: {
          parent: { select: { id: true, name: true, code: true } },
          ledgerEntries: {
            orderBy: { postedAt: "desc" },
            take: 1,
          },
          payouts: {
            orderBy: { requestedAt: "desc" },
          },
          _count: { select: { students: true, feeInvoices: true } },
        },
        orderBy: [{ branchType: "asc" }, { name: "asc" }],
      },
      paymentCollectorRoutes: {
        where: { isActive: true },
      },
    },
    orderBy: { name: "asc" },
  });

  // 2. Fetch platform-wide totals
  const [invoicesAgg, paymentsAgg, demoTxAgg, payoutsAgg] = await Promise.all([
    db.feeInvoice.aggregate({
      where: { status: { not: "WAIVED" } },
      _sum: { amount: true, paidAmount: true },
    }),
    db.paymentReceipt.aggregate({
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.demoPaymentTransaction.aggregate({
      where: { status: "SUCCESS" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.branchPayout.aggregate({
      where: { status: "PAID" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const totalInvoiced = invoicesAgg._sum.amount ?? 0;
  const totalCollectedReal = paymentsAgg._sum.amount ?? 0;
  const totalCollectedDemo = demoTxAgg._sum.amount ?? 0;
  const totalGrossCollected = totalCollectedReal + totalCollectedDemo;
  const totalPayoutsDisbursed = payoutsAgg._sum.amount ?? 0;

  // Compile hierarchical institute groups & flat branch list
  const instituteGroups: InstitutePayableGroup[] = [];
  const allBranchesList: BranchPayableInfo[] = [];
  let totalSettledOnlinePayable = 0;

  for (const t of tenants) {
    let tenantTotalSettledBalance = 0;
    let mainBranchInfo: BranchPayableInfo | null = null;
    const subBranchesList: BranchPayableInfo[] = [];
    const tenantBranchesList: BranchPayableInfo[] = [];

    for (const b of t.branches) {
      const balance = b.ledgerEntries[0]?.balanceAfter ?? 0;
      tenantTotalSettledBalance += balance;
      totalSettledOnlinePayable += balance;

      const branchInfo: BranchPayableInfo = {
        tenantId: t.id,
        tenantName: t.name,
        branchId: b.id,
        branchName: b.name,
        branchCode: b.code,
        branchType: b.branchType,
        parentBranchName: b.parent?.name || null,
        collectorCode: b.collectorCode,
        bankAccount: b.bankAccountNumber,
        bankIfsc: b.bankIfsc,
        bankBankName: b.bankBankName,
        studentCount: b._count.students,
        invoicedCount: b._count.feeInvoices,
        settledPayableBalance: balance,
      };

      tenantBranchesList.push(branchInfo);
      allBranchesList.push(branchInfo);

      if (b.branchType === "MAIN" && !mainBranchInfo) {
        mainBranchInfo = branchInfo;
      } else {
        subBranchesList.push(branchInfo);
      }
    }

    if (t.branches.length > 0) {
      instituteGroups.push({
        tenantId: t.id,
        tenantName: t.name,
        tenantSlug: t.slug,
        tenantType: t.type,
        totalSettledBalance: tenantTotalSettledBalance,
        mainBranch: mainBranchInfo,
        subBranches: subBranchesList,
        allBranches: tenantBranchesList,
      });
    }
  }

  // 3. Fetch recent payout history
  const recentPayouts = await db.branchPayout.findMany({
    include: {
      tenant: { select: { name: true } },
      branch: { select: { name: true, code: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  // 4. Fetch recent live/demo transactions
  const recentDemoTxs = await db.demoPaymentTransaction.findMany({
    where: { status: "SUCCESS" },
    include: {
      session: {
        include: {
          tenant: { select: { name: true } },
          student: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // 5. Fetch reconciliation metrics, discrepancies, and initial students
  const [reconciliationResult, discrepancies, initialStudents] = await Promise.all([
    calculateReconciliationMetrics(),
    detectFinancialDiscrepancies(),
    getStudentFinancialListAction({ limit: 100 }),
  ]);

  const tenantSelectList = tenants
    .filter((t) => t.branches.length > 0 || t._count.students > 0)
    .map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Financial Operations & Integrity"
        title="Fee Gateway & Platform Finance"
        description="Comprehensive treasury tracking: Student accounts, Institution fee reconciliation, and Campus settlements"
        actions={
          <div className="flex items-center gap-2">
            <Link href="/platform" className="btn btn-secondary text-xs">
              Platform Console
            </Link>
          </div>
        }
      />

      {/* Main Unified Finance Dashboard with 3 Views & Global Student Drawer */}
      <FinanceDashboardClient
        instituteGroups={instituteGroups}
        allBranches={allBranchesList}
        initialComparativeRows={reconciliationResult.comparativeRows}
        initialMetrics={reconciliationResult.metrics}
        initialDiscrepancies={discrepancies}
        initialStudents={initialStudents}
        tenants={tenantSelectList}
        recentPayouts={recentPayouts}
        recentDemoTxs={recentDemoTxs}
        kpiSummary={{
          totalGrossCollected,
          totalSettledOnlinePayable,
          totalPayoutsDisbursed,
          totalPayoutsCount: payoutsAgg._count._all,
          totalCampusesCount: allBranchesList.length,
          totalInstitutesCount: instituteGroups.length,
        }}
      />
    </div>
  );
}
