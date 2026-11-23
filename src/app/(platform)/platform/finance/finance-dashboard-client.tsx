"use client";

import { useState } from "react";
import {
  Wallet,
  Scale,
  Users,
  CreditCard,
  Building2,
  Landmark,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
  Coins,
  ChevronRight,
  Printer,
} from "lucide-react";
import { Badge, Card, StatCard } from "@/components/ui/primitives";
import { money, num, date } from "@/lib/format";
import {
  FinancePayableExplorerClient,
  type BranchPayableInfo,
  type InstitutePayableGroup,
} from "./finance-payable-explorer-client";
import { InstitutionReconciliationView } from "@/components/platform/finance/institution-reconciliation-view";
import { StudentFinancialExplorer } from "@/components/platform/finance/student-financial-explorer";
import { StudentFinancialDrawer } from "@/components/platform/finance/student-financial-drawer";
import type { ComparativeMetricRow, DiscrepancyItem } from "@/lib/finance-reconciliation";
import type { StudentFinancialListRow } from "@/actions/finance-reconciliation";

interface FinanceDashboardClientProps {
  instituteGroups: InstitutePayableGroup[];
  allBranches: BranchPayableInfo[];
  initialComparativeRows: ComparativeMetricRow[];
  initialMetrics: any;
  initialDiscrepancies: DiscrepancyItem[];
  initialStudents: StudentFinancialListRow[];
  tenants: Array<{ id: string; name: string }>;
  recentPayouts: any[];
  recentDemoTxs: any[];
  kpiSummary: {
    totalGrossCollected: number;
    totalSettledOnlinePayable: number;
    totalPayoutsDisbursed: number;
    totalPayoutsCount: number;
    totalCampusesCount: number;
    totalInstitutesCount: number;
  };
}

export function FinanceDashboardClient({
  instituteGroups,
  allBranches,
  initialComparativeRows,
  initialMetrics,
  initialDiscrepancies,
  initialStudents,
  tenants,
  recentPayouts,
  recentDemoTxs,
  kpiSummary,
}: FinanceDashboardClientProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "reconciliation" | "students">("overview");
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Top Main Navigation Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-[var(--surface-2)] rounded-2xl w-fit border border-[var(--border)] shadow-xs">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 ${
            activeTab === "overview"
              ? "bg-[var(--surface)] text-foreground shadow-xs"
              : "text-muted hover:text-foreground"
          }`}
        >
          <Wallet className="size-4 text-indigo-600" />
          <span>Overview & Campus Payouts</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("reconciliation")}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 ${
            activeTab === "reconciliation"
              ? "bg-[var(--surface)] text-foreground shadow-xs"
              : "text-muted hover:text-foreground"
          }`}
        >
          <Scale className="size-4 text-brand" />
          <span>Institution Fee Reconciliation</span>
          {initialDiscrepancies.length > 0 && (
            <Badge tone="warning" className="text-[9px] py-0 px-1.5">
              {initialDiscrepancies.length} Discrepancies
            </Badge>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("students")}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 ${
            activeTab === "students"
              ? "bg-[var(--surface)] text-foreground shadow-xs"
              : "text-muted hover:text-foreground"
          }`}
        >
          <Users className="size-4 text-emerald-600" />
          <span>Student Financial Explorer</span>
          <Badge tone="neutral" className="text-[9px] py-0 px-1.5">
            {initialStudents.length} Students
          </Badge>
        </button>
      </div>

      {/* VIEW 1: Overview & Campus Payouts */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Jodo Gateway Settlement Explainer Banner */}
          <Card className="p-5 border-l-4 border-l-indigo-600 bg-gradient-to-r from-indigo-50/50 via-white to-white dark:from-indigo-950/20 dark:via-slate-900 dark:to-slate-900 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground text-sm flex items-center gap-1.5">
                    <Landmark className="size-4 text-indigo-600" /> Jodo Payment Lifecycle Engine
                  </span>
                  <Badge tone="brand" className="text-[10px]">
                    Active Simulation
                  </Badge>
                </div>
                <p className="text-xs text-muted max-w-3xl">
                  Parent payments through Jodo Gateway are instantly relieved against student invoices.
                  Net settlement tranches credit the respective Campus Ledger. The platform owner can
                  then audit balances and disburse payouts directly to verified school bank accounts.
                </p>
              </div>
            </div>

            {/* 4-Step Settlement Process Workflow Graphic */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold text-xs mb-1">
                  <CheckCircle2 className="size-3.5" /> 1. Fee Collection
                </div>
                <p className="text-[11px] text-muted">
                  Parent pays fee &bull; Student invoice relieved &bull; Receipt issued.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-bold text-xs mb-1">
                  <CheckCircle2 className="size-3.5" /> 2. Gateway Settlement
                </div>
                <p className="text-[11px] text-muted">
                  Jodo settles net funds at T+1 &bull; Branch ledger credited.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-bold text-xs mb-1">
                  <CheckCircle2 className="size-3.5" /> 3. Bank Reconciled
                </div>
                <p className="text-[11px] text-muted">
                  Lump-sum bank UTR matched against nodal deposit.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800">
                <div className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300 font-bold text-xs mb-1">
                  <Landmark className="size-3.5" /> 4. Institution Payout
                </div>
                <p className="text-[11px] text-indigo-900/80 dark:text-indigo-300/80">
                  Manual disbursement recorded &bull; Campus ledger debited.
                </p>
              </div>
            </div>
          </Card>

          {/* Platform Treasury KPI Summary */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total Student Collections"
              value={money(kpiSummary.totalGrossCollected)}
              sub="Gross verified payments across all schools"
              icon={<CreditCard className="size-4" />}
              tone="success"
            />
            <StatCard
              label="Settled Online Balance"
              value={money(kpiSummary.totalSettledOnlinePayable)}
              sub="Payable to campus operating accounts"
              icon={<Wallet className="size-4 text-indigo-600" />}
            />
            <StatCard
              label="Total Payouts Disbursed"
              value={money(kpiSummary.totalPayoutsDisbursed)}
              sub={`${num(kpiSummary.totalPayoutsCount)} manual transfers recorded`}
              icon={<Landmark className="size-4" />}
              tone="neutral"
            />
            <StatCard
              label="Active Campuses"
              value={num(kpiSummary.totalCampusesCount)}
              sub={`${kpiSummary.totalInstitutesCount} institutes monitored`}
              icon={<Building2 className="size-4" />}
            />
          </div>

          {/* Hierarchical Institute Explorer & Auto-filling Payout Form */}
          <FinancePayableExplorerClient
            instituteGroups={instituteGroups}
            allBranches={allBranches}
          />

          {/* Payout History Log & Live Payment Feed */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card className="p-6 shadow-sm border-[var(--border)]">
                <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
                  <div>
                    <h3 className="text-base font-bold text-foreground">
                      Disbursed Institution Payouts
                    </h3>
                    <p className="text-xs text-muted mt-0.5">
                      Audit log of all treasury transfers from master nodal account to campus accounts.
                    </p>
                  </div>
                  <Landmark className="size-5 text-muted" />
                </div>

                <div className="divide-y divide-[var(--border)] mt-2">
                  {recentPayouts.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted">
                      No institution payouts recorded yet. Use the form above to disburse a simulated payout.
                    </div>
                  ) : (
                    recentPayouts.map((p) => (
                      <div
                        key={p.id}
                        className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground">{p.payoutNumber}</span>
                            <Badge tone="success">{p.status}</Badge>
                            <span className="font-medium text-muted">
                              &bull; {p.tenant.name} ({p.branch.name})
                            </span>
                          </div>
                          <p className="text-muted mt-0.5">
                            Bank UTR: <span className="font-mono font-medium">{p.utrReference || "—"}</span> &bull; A/C:{" "}
                            <span className="font-mono">{p.bankAccountNumber}</span> ({p.bankIfsc})
                          </p>
                          <p className="text-[10px] text-muted">{date(p.createdAt)}</p>
                        </div>

                        <div className="text-left sm:text-right shrink-0">
                          <span className="font-bold text-foreground text-sm">{money(p.amount)}</span>
                          <span className="text-[10px] text-emerald-600 block">Settled</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>

            <div>
              <Card className="p-5 space-y-3 shadow-sm border-[var(--border)]">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <TrendingUp className="size-3.5 text-brand" /> Live Payment Inflow Feed
                </h3>

                <div className="space-y-3 pt-1 text-xs">
                  {recentDemoTxs.length === 0 ? (
                    <p className="text-muted text-xs py-4 text-center">No recent payment transactions.</p>
                  ) : (
                    recentDemoTxs.slice(0, 5).map((tx) => (
                      <div
                        key={tx.id}
                        className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1"
                      >
                        <div className="flex justify-between font-semibold">
                          <span>
                            {tx.session.student.firstName} {tx.session.student.lastName}
                          </span>
                          <span className="text-emerald-600 font-bold">{money(tx.amount)}</span>
                        </div>
                        <div className="flex justify-between text-[10px] text-muted">
                          <span>{tx.session.tenant.name}</span>
                          <span className="font-mono">{tx.reference}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: Institution Fee Reconciliation & Discrepancies */}
      {activeTab === "reconciliation" && (
        <InstitutionReconciliationView
          initialMetrics={initialMetrics}
          initialComparativeRows={initialComparativeRows}
          initialDiscrepancies={initialDiscrepancies}
          tenants={tenants}
          onSelectStudent={(studentId) => setActiveStudentId(studentId)}
        />
      )}

      {/* VIEW 3: Student Financial Explorer & Audit Directory */}
      {activeTab === "students" && (
        <StudentFinancialExplorer
          initialStudents={initialStudents}
          tenants={tenants}
        />
      )}

      {/* Global Slide-Over Drawer for student inspection */}
      <StudentFinancialDrawer
        studentId={activeStudentId}
        onClose={() => setActiveStudentId(null)}
      />
    </div>
  );
}
