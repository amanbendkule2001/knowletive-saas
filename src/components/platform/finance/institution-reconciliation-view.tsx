"use client";

import { useState } from "react";
import {
  Scale,
  AlertTriangle,
  CheckCircle2,
  Filter,
  Building,
  School,
  ArrowRight,
  TrendingUp,
  AlertCircle,
  Coins,
  ShieldAlert,
  Search,
} from "lucide-react";
import { Badge, Card, StatCard } from "@/components/ui/primitives";
import { money, num } from "@/lib/format";
import type { ComparativeMetricRow, DiscrepancyItem } from "@/lib/finance-reconciliation";

interface InstitutionReconciliationViewProps {
  initialMetrics: {
    institutionConfiguredTotal: number;
    totalAssignedFees: number;
    totalInvoicesGenerated: number;
    totalDiscounts: number;
    totalRevisedPayableFees: number;
    totalPaymentsReceived: number;
    totalOutstandingFees: number;
    totalOverdueFees: number;
    totalExcessPayments: number;
    totalRefundsReversals: number;
    unexplainedDifferences: number;
  };
  initialComparativeRows: ComparativeMetricRow[];
  initialDiscrepancies: DiscrepancyItem[];
  tenants: Array<{ id: string; name: string }>;
  onSelectStudent?: (studentId: string) => void;
}

export function InstitutionReconciliationView({
  initialMetrics,
  initialComparativeRows,
  initialDiscrepancies,
  tenants,
  onSelectStudent,
}: InstitutionReconciliationViewProps) {
  const [selectedTenantId, setSelectedTenantId] = useState<string>("ALL");
  const [discrepancyFilter, setDiscrepancyFilter] = useState<string>("ALL");
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyItem[]>(initialDiscrepancies);

  const filteredDiscrepancies = discrepancies.filter((d) => {
    if (discrepancyFilter !== "ALL" && d.severity !== discrepancyFilter) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* 1. Reconciliation Executive Metrics KPI Grid */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Assigned Fee Plans"
          value={money(initialMetrics.totalAssignedFees)}
          sub={`Total net agreed obligations across students`}
          icon={<School className="size-4 text-indigo-600" />}
        />
        <StatCard
          label="Billed Invoices"
          value={money(initialMetrics.totalInvoicesGenerated)}
          sub={`Backing fee invoices generated`}
          icon={<Coins className="size-4 text-brand" />}
        />
        <StatCard
          label="Verified Payments"
          value={money(initialMetrics.totalPaymentsReceived)}
          sub={`Collected into institution operating ledger`}
          icon={<CheckCircle2 className="size-4 text-emerald-600" />}
          tone="success"
        />
        <StatCard
          label="Total Outstanding Dues"
          value={money(initialMetrics.totalOutstandingFees)}
          sub={`Includes ${money(initialMetrics.totalOverdueFees)} overdue`}
          icon={<AlertCircle className="size-4 text-amber-600" />}
          tone={initialMetrics.totalOverdueFees > 0 ? "warning" : "neutral"}
        />
      </div>

      {/* 2. Comparative Reconciliation Table */}
      <Card className="p-5 sm:p-6 shadow-sm border-[var(--border)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Scale className="size-4.5 text-indigo-600" />
              Institution Fees vs. Student Accounts Comparison
            </h3>
            <p className="text-xs text-muted mt-0.5">
              Audits what institutions expect to collect against actual student billed and collected accounts.
            </p>
          </div>
          <Badge tone="brand">Deterministic Integer Audit</Badge>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-[var(--border)] text-muted font-semibold uppercase text-[10px] tracking-wider">
                <th className="py-2.5 pr-4">Reconciliation Metric</th>
                <th className="py-2.5 px-4 text-right">Institution Records</th>
                <th className="py-2.5 px-4 text-right">Student Records</th>
                <th className="py-2.5 px-4 text-right">Variance / Difference</th>
                <th className="py-2.5 px-4 text-center">Status</th>
                <th className="py-2.5 pl-4">Audit Note & Explanation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {initialComparativeRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-[var(--surface-2)]/40 transition">
                  <td className="py-3 pr-4 font-semibold text-foreground">
                    {row.metric}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-medium">
                    {money(row.institutionRecord)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-medium">
                    {money(row.studentRecords)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold">
                    <span className={row.difference === 0 ? "text-muted" : "text-amber-600 dark:text-amber-400"}>
                      {row.difference === 0 ? "₹0" : money(Math.abs(row.difference))}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <Badge
                      tone={
                        row.status === "MATCHED"
                          ? "success"
                          : row.status === "DISCREPANCY"
                          ? "danger"
                          : "warning"
                      }
                      className="text-[9px]"
                    >
                      {row.status}
                    </Badge>
                  </td>
                  <td className="py-3 pl-4 text-muted text-[11px] max-w-xs truncate" title={row.explanation}>
                    {row.explanation}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 3. Discrepancy & Anomaly Detector */}
      <Card className="p-5 sm:p-6 shadow-sm border-[var(--border)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <ShieldAlert className="size-4.5 text-amber-600" />
              Detected Financial Discrepancies & Anomalies ({filteredDiscrepancies.length})
            </h3>
            <p className="text-xs text-muted mt-0.5">
              Live audit scanning for missing invoices, unapplied credits, and severely overdue accounts.
            </p>
          </div>

          {/* Severity Filter Pills */}
          <div className="flex items-center gap-1 text-xs">
            {["ALL", "HIGH", "MEDIUM", "LOW"].map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setDiscrepancyFilter(sev)}
                className={`px-2.5 py-1 rounded-lg font-medium transition text-[11px] ${
                  discrepancyFilter === sev
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-[var(--surface-2)] text-muted hover:text-foreground"
                }`}
              >
                {sev === "ALL" ? "All" : sev}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 divide-y divide-[var(--border)]">
          {filteredDiscrepancies.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted flex flex-col items-center gap-2">
              <CheckCircle2 className="size-8 text-emerald-600" />
              <p className="font-semibold text-foreground">Zero Discrepancies Detected</p>
              <p>All student obligations, invoices, and collected payments are fully reconciled.</p>
            </div>
          ) : (
            filteredDiscrepancies.map((d) => (
              <div
                key={d.id}
                className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs hover:bg-[var(--surface-2)]/30 transition rounded-xl px-2"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-foreground text-sm">{d.title}</span>
                    <Badge tone={d.severity === "HIGH" ? "danger" : d.severity === "MEDIUM" ? "warning" : "neutral"} className="text-[9px]">
                      {d.severity} SEVERITY
                    </Badge>
                    <Badge tone="brand" className="text-[9px]">
                      {d.reviewStatus}
                    </Badge>
                  </div>
                  <p className="text-muted text-xs">{d.description}</p>
                  <p className="text-[11px] text-muted">
                    <span>{d.tenantName}</span>
                    {d.branchName && <span> • Campus: {d.branchName}</span>}
                    {d.studentName && <span> • Student: <strong className="text-foreground">{d.studentName}</strong> ({d.admissionNo})</span>}
                  </p>
                  <p className="text-[10px] text-indigo-700 dark:text-indigo-400 font-medium">
                    Suggested Action: {d.suggestedAction}
                  </p>
                </div>

                <div className="flex md:flex-col items-center md:items-end justify-between gap-2 shrink-0">
                  <div className="text-left md:text-right">
                    <span className="text-[10px] uppercase font-bold text-muted block">Affected Amount</span>
                    <span className="text-sm font-bold text-foreground font-mono">{money(d.affectedAmountPaise)}</span>
                  </div>

                  {d.studentId && onSelectStudent && (
                    <button
                      type="button"
                      onClick={() => onSelectStudent(d.studentId!)}
                      className="btn btn-secondary text-[11px] py-1 px-2.5 inline-flex items-center gap-1 shadow-xs"
                    >
                      Audit Student <ArrowRight className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
