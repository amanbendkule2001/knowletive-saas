"use client";

import { useEffect, useState } from "react";
import {
  X,
  User,
  FileText,
  Calendar,
  CreditCard,
  Receipt,
  Scale,
  GitCommit,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Building,
  School,
  Shield,
  Download,
  Printer,
  ChevronRight,
  Landmark,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  Coins,
} from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { money, date } from "@/lib/format";
import { getStudentFinancialProfileAction } from "@/actions/finance-reconciliation";

interface StudentFinancialDrawerProps {
  studentId: string | null;
  onClose: () => void;
}

type TabKey =
  | "profile"
  | "fee-structure"
  | "invoices"
  | "installments"
  | "payments"
  | "receipts"
  | "reconciliation"
  | "traceability";

export function StudentFinancialDrawer({ studentId, onClose }: StudentFinancialDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("profile");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) {
      setData(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    getStudentFinancialProfileAction(studentId)
      .then((res) => {
        if (isMounted) setData(res);
      })
      .catch((err) => {
        if (isMounted) setError(err.message || "Failed to load student profile");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [studentId]);

  if (!studentId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs transition-opacity duration-200">
      <div className="relative w-full max-w-3xl bg-[var(--surface)] text-[var(--foreground)] h-full shadow-2xl flex flex-col border-l border-[var(--border)] overflow-hidden animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-[var(--border)] bg-[var(--surface-2)]/40 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
              {data ? data.student.name.charAt(0) : <User className="size-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold text-base text-foreground truncate">
                  {loading ? "Loading Student Financial Profile…" : data?.student.name}
                </h2>
                {data && (
                  <Badge tone={data.aggregates.status === "PAID" ? "success" : data.aggregates.status === "OVERDUE" ? "danger" : "brand"}>
                    {data.aggregates.status}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted truncate mt-0.5">
                {data ? `${data.student.admissionNo} • ${data.student.classGrade} (${data.student.section}) • ${data.student.tenantName}` : "Student Profile"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-[var(--surface-3)] text-muted hover:text-foreground transition"
              title="Close drawer"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* 8-Tab Bar */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] overflow-x-auto text-xs font-medium no-scrollbar">
          {[
            { key: "profile", label: "1. Profile", icon: User },
            { key: "fee-structure", label: "2. Fee Structure", icon: Coins },
            { key: "invoices", label: `3. Invoices (${data?.invoices.length || 0})`, icon: FileText },
            { key: "installments", label: "4. Installments", icon: Calendar },
            { key: "payments", label: "5. Payments", icon: CreditCard },
            { key: "receipts", label: "6. Receipts", icon: Receipt },
            { key: "reconciliation", label: "7. Reconciliation", icon: Scale },
            { key: "traceability", label: "8. Payout Trace", icon: GitCommit },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as TabKey)}
                className={`px-2.5 py-1.5 rounded-lg whitespace-nowrap transition flex items-center gap-1.5 ${
                  isActive
                    ? "bg-indigo-600 text-white font-semibold shadow-xs"
                    : "text-muted hover:bg-[var(--surface-2)] hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {loading && (
            <div className="py-20 text-center text-xs text-muted space-y-2">
              <div className="size-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p>Auditing and fetching complete student financial ledger…</p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="size-4" /> Error loading financial records
              </p>
              <p>{error}</p>
            </div>
          )}

          {!loading && data && (
            <>
              {/* Financial KPI Summary Header */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/60 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted block">Agreed Plan Fee</span>
                  <span className="font-extrabold text-sm text-foreground">{money(data.aggregates.planPayable)}</span>
                  {data.aggregates.planDiscount > 0 && (
                    <span className="text-[10px] text-emerald-600 block">(-{money(data.aggregates.planDiscount)} waiver)</span>
                  )}
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted block">Invoiced Billed</span>
                  <span className="font-extrabold text-sm text-foreground">{money(data.aggregates.totalBilled)}</span>
                  <span className="text-[10px] text-muted block">{data.invoices.length} invoices generated</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted block">Verified Collected</span>
                  <span className="font-extrabold text-sm text-emerald-600">{money(data.aggregates.totalPaid)}</span>
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400 block font-medium">
                    {data.aggregates.paymentRatio.toFixed(0)}% settled
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted block">Outstanding Balance</span>
                  <span className={`font-extrabold text-sm ${data.aggregates.totalOutstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600"}`}>
                    {money(data.aggregates.totalOutstanding)}
                  </span>
                  <span className="text-[10px] text-muted block">
                    {data.aggregates.totalOutstanding === 0 ? "No pending dues" : "Active payable"}
                  </span>
                </div>
              </div>

              {/* TAB 1: Profile & Academic Identity */}
              {activeTab === "profile" && (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Card className="p-4 space-y-2.5 border-[var(--border)]">
                      <h4 className="font-bold text-foreground flex items-center gap-1.5 pb-2 border-b border-[var(--border)]">
                        <User className="size-3.5 text-indigo-600" /> Academic & Personal Identity
                      </h4>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-muted">Admission No:</span><span className="font-mono font-bold">{data.student.admissionNo}</span></div>
                        <div className="flex justify-between"><span className="text-muted">Full Name:</span><span className="font-semibold">{data.student.name}</span></div>
                        <div className="flex justify-between"><span className="text-muted">Class & Grade:</span><span>{data.student.classGrade} ({data.student.section})</span></div>
                        <div className="flex justify-between"><span className="text-muted">Academic Year:</span><span>{data.student.academicYear}</span></div>
                        <div className="flex justify-between"><span className="text-muted">Admission Date:</span><span>{date(data.student.admissionDate)}</span></div>
                        <div className="flex justify-between"><span className="text-muted">Gender / Blood:</span><span>{data.student.gender} • {data.student.bloodGroup}</span></div>
                      </div>
                    </Card>

                    <Card className="p-4 space-y-2.5 border-[var(--border)]">
                      <h4 className="font-bold text-foreground flex items-center gap-1.5 pb-2 border-b border-[var(--border)]">
                        <Building className="size-3.5 text-indigo-600" /> Campus & Attribution
                      </h4>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-muted">Institution:</span><span className="font-semibold">{data.student.tenantName}</span></div>
                        <div className="flex justify-between"><span className="text-muted">Current Campus:</span><span className="font-bold text-indigo-600">{data.student.branchName}</span></div>
                        <div className="flex justify-between"><span className="text-muted">Campus Type:</span><Badge tone="neutral" className="text-[10px]">{data.student.branchType}</Badge></div>
                        <div className="flex justify-between"><span className="text-muted">Jodo Collector Code:</span><span className="font-mono">{data.student.collectorCode}</span></div>
                        <div className="flex justify-between"><span className="text-muted">Status:</span><Badge tone="brand" className="text-[10px]">{data.student.status}</Badge></div>
                      </div>
                    </Card>
                  </div>

                  <Card className="p-4 space-y-2.5 border-[var(--border)]">
                    <h4 className="font-bold text-foreground flex items-center gap-1.5 pb-2 border-b border-[var(--border)]">
                      <Shield className="size-3.5 text-indigo-600" /> Guardian & Portal Link (Privacy Masked)
                    </h4>
                    {data.student.guardians.length === 0 ? (
                      <p className="text-muted text-xs">No guardian linked yet.</p>
                    ) : (
                      data.student.guardians.map((g: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center py-1">
                          <div>
                            <span className="font-semibold text-foreground">{g.name}</span>
                            <span className="text-muted text-[11px] ml-1.5">({g.relationship})</span>
                          </div>
                          <div className="text-right text-[11px] text-muted font-mono">
                            <span>{g.phoneMasked}</span> • <span>{g.emailMasked}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </Card>
                </div>
              )}

              {/* TAB 2: Fee Structure Assigned */}
              {activeTab === "fee-structure" && (
                <div className="space-y-4 text-xs">
                  {data.feePlans.length === 0 ? (
                    <div className="py-12 text-center text-muted">No formal fee plan assigned to this student.</div>
                  ) : (
                    data.feePlans.map((plan: any) => (
                      <Card key={plan.id} className="p-4 space-y-3 border-[var(--border)]">
                        <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                          <div>
                            <h4 className="font-bold text-foreground text-sm">{plan.title}</h4>
                            <p className="text-[11px] text-muted">Schedule Type: {plan.scheduleType} • Status: {plan.status}</p>
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-bold text-foreground block">{money(plan.payableAmount)}</span>
                            {plan.discountAmount > 0 && (
                              <span className="text-[10px] text-emerald-600 block">Waiver: -{money(plan.discountAmount)}</span>
                            )}
                          </div>
                        </div>

                        {/* Breakdown of Installment Obligations */}
                        <div className="space-y-2 pt-1">
                          <span className="font-bold text-[11px] text-muted uppercase tracking-wider block">Scheduled Tranches</span>
                          <div className="divide-y divide-[var(--border)]">
                            {plan.installments.map((inst: any) => (
                              <div key={inst.id} className="py-2 flex items-center justify-between">
                                <div>
                                  <span className="font-semibold text-foreground">
                                    Tranche #{inst.installmentNumber}: {inst.title}
                                  </span>
                                  <p className="text-[10px] text-muted">Due: {date(inst.dueDate)}</p>
                                </div>
                                <div className="text-right">
                                  <span className="font-mono font-bold">{money(inst.originalAmount)}</span>
                                  <Badge tone={inst.status === "PAID" ? "success" : "neutral"} className="ml-2 text-[9px]">
                                    {inst.status}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              )}

              {/* TAB 3: Invoices */}
              {activeTab === "invoices" && (
                <div className="space-y-3 text-xs">
                  {data.invoices.length === 0 ? (
                    <div className="py-12 text-center text-muted">No invoices generated for this student.</div>
                  ) : (
                    data.invoices.map((inv: any) => {
                      const outstanding = Math.max(0, inv.amount - inv.paidAmount);
                      return (
                        <div key={inv.id} className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-foreground font-mono">{inv.number}</span>
                              <Badge tone={inv.status === "PAID" ? "success" : inv.status === "PARTIAL" ? "brand" : "neutral"}>
                                {inv.status}
                              </Badge>
                              <span className="font-semibold text-foreground">{inv.title}</span>
                            </div>
                            <p className="text-[11px] text-muted">
                              Issued: {date(inv.issuedAt)} • Due Date: <span className="font-medium text-foreground">{date(inv.dueDate)}</span>
                            </p>
                            {inv.branch && (
                              <p className="text-[10px] text-muted">Campus: {inv.branch.name} ({inv.branch.code})</p>
                            )}
                          </div>

                          <div className="text-left sm:text-right shrink-0">
                            <div className="text-sm font-bold text-foreground">{money(inv.amount)}</div>
                            <div className="text-[11px] text-emerald-600">Paid: {money(inv.paidAmount)}</div>
                            {outstanding > 0 && (
                              <div className="text-[11px] text-amber-600 font-bold">Unpaid: {money(outstanding)}</div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* TAB 4: Installments */}
              {activeTab === "installments" && (
                <div className="space-y-3 text-xs">
                  {data.feePlans[0]?.installments.length === 0 ? (
                    <div className="py-12 text-center text-muted">No scheduled installments found.</div>
                  ) : (
                    data.feePlans[0]?.installments.map((inst: any) => (
                      <div key={inst.id} className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground">Tranche #{inst.installmentNumber}: {inst.title}</span>
                            <Badge tone={inst.status === "PAID" ? "success" : "brand"}>{inst.status}</Badge>
                          </div>
                          <p className="text-[11px] text-muted">Due: {date(inst.dueDate)}</p>
                          {inst.feeInvoice && (
                            <p className="text-[10px] text-muted">Linked Invoice: <span className="font-mono">{inst.feeInvoice.number}</span></p>
                          )}
                        </div>

                        <div className="text-left sm:text-right shrink-0">
                          <span className="text-sm font-bold font-mono">{money(inst.originalAmount)}</span>
                          <span className="text-[10px] text-muted block">Partial Allowed: {inst.allowPartial ? "Yes" : "No"}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 5: Payments */}
              {activeTab === "payments" && (
                <div className="space-y-3 text-xs">
                  {data.invoices.flatMap((i: any) => i.payments).length === 0 ? (
                    <div className="py-12 text-center text-muted">No payment transactions recorded for this student.</div>
                  ) : (
                    data.invoices.flatMap((i: any) => i.payments).map((pay: any) => (
                      <div key={pay.id} className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground font-mono">{pay.reference || "PAID"}</span>
                            <Badge tone="success">CAPTURED</Badge>
                            <span className="text-muted font-medium">via {pay.method} ({pay.provider || "JODO"})</span>
                          </div>
                          <p className="text-[11px] text-muted">Payment Date: {date(pay.paidAt)}</p>
                          {pay.providerRef && (
                            <p className="text-[10px] text-muted font-mono">Provider Ref: {pay.providerRef}</p>
                          )}
                        </div>

                        <div className="text-left sm:text-right shrink-0">
                          <span className="text-sm font-extrabold text-emerald-600">{money(pay.amount)}</span>
                          <span className="text-[10px] text-muted block">Direct Invoice Settlement</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 6: Receipts */}
              {activeTab === "receipts" && (
                <div className="space-y-4 text-xs">
                  <div className="p-5 rounded-2xl border border-indigo-200 dark:border-indigo-900 bg-gradient-to-b from-indigo-50/40 via-white to-white dark:from-indigo-950/20 dark:via-slate-900 dark:to-slate-900 space-y-4">
                    <div className="flex justify-between items-start pb-3 border-b border-[var(--border)]">
                      <div>
                        <span className="font-bold text-sm text-foreground block">{data.student.tenantName}</span>
                        <span className="text-muted text-[11px]">{data.student.branchName} • Jodo Collector: {data.student.collectorCode}</span>
                      </div>
                      <div className="text-right">
                        <Badge tone="brand">OFFICIAL RECEIPT</Badge>
                        <p className="text-[10px] text-muted font-mono mt-1">RCPT-2026-SUN-{data.student.admissionNo}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-muted">Student:</span> <span className="font-bold">{data.student.name}</span></div>
                      <div><span className="text-muted">Admission No:</span> <span className="font-mono">{data.student.admissionNo}</span></div>
                      <div><span className="text-muted">Class & Section:</span> <span>{data.student.classGrade} ({data.student.section})</span></div>
                      <div><span className="text-muted">Date:</span> <span>{date(new Date())}</span></div>
                    </div>

                    <div className="p-3 rounded-xl bg-[var(--surface-2)] flex justify-between items-center font-bold text-sm">
                      <span>Total Amount Settled:</span>
                      <span className="text-emerald-600 font-extrabold">{money(data.aggregates.totalPaid)}</span>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="btn btn-secondary text-xs inline-flex items-center gap-1.5"
                      >
                        <Printer className="size-3.5" /> Print Receipt
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 7: Reconciliation */}
              {activeTab === "reconciliation" && (
                <div className="space-y-4 text-xs">
                  <Card className="p-4 space-y-3 border-[var(--border)]">
                    <h4 className="font-bold text-foreground flex items-center gap-1.5 pb-2 border-b border-[var(--border)]">
                      <Scale className="size-3.5 text-indigo-600" /> Individual Student Fee Account Audit
                    </h4>

                    <div className="space-y-2">
                      <div className="flex justify-between py-1 border-b border-[var(--border)]">
                        <span className="text-muted">1. Final Approved Fee Obligation (Plan):</span>
                        <span className="font-bold">{money(data.aggregates.planPayable)}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-[var(--border)]">
                        <span className="text-muted">2. Total Invoices Issued:</span>
                        <span className="font-bold">{money(data.aggregates.totalBilled)}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-[var(--border)]">
                        <span className="text-muted">3. Net Payments Allocated to Invoices:</span>
                        <span className="font-bold text-emerald-600">{money(data.aggregates.totalPaid)}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-[var(--border)]">
                        <span className="text-muted">4. Outstanding Dues:</span>
                        <span className="font-bold text-amber-600">{money(data.aggregates.totalOutstanding)}</span>
                      </div>
                      <div className="flex justify-between py-1 font-bold">
                        <span>Account Reconciliation Status:</span>
                        <span className={data.aggregates.totalOutstanding === 0 ? "text-emerald-600" : "text-indigo-600"}>
                          {data.aggregates.totalOutstanding === 0 ? "FULLY RECONCILED (CLEARED)" : "NORMAL OUTSTANDING"}
                        </span>
                      </div>
                    </div>
                  </Card>
                </div>
              )}

              {/* TAB 8: Payment-to-Payout Traceability Flow */}
              {activeTab === "traceability" && (
                <div className="space-y-4 text-xs">
                  <p className="text-muted">
                    Full end-to-end audit lifecycle tracing student payment from billing to campus bank payout eligibility:
                  </p>

                  {data.traces.length === 0 ? (
                    <div className="py-12 text-center text-muted">No billing traces recorded.</div>
                  ) : (
                    data.traces.map((trace: any, tIdx: number) => (
                      <Card key={tIdx} className="p-4 space-y-3 border-[var(--border)]">
                        <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                          <span className="font-bold text-foreground">
                            Invoice #{trace.invoiceNumber} {trace.installmentTitle ? `(${trace.installmentTitle})` : ""}
                          </span>
                          <Badge tone="brand">LIFECYCLE TRACE</Badge>
                        </div>

                        {/* Step-by-step Timeline Stages */}
                        <div className="space-y-3 pt-2">
                          {trace.stages.map((stage: any, sIdx: number) => {
                            const isDone = stage.status === "COMPLETED";
                            return (
                              <div key={sIdx} className="flex items-start gap-3 relative">
                                {sIdx < trace.stages.length - 1 && (
                                  <div className="absolute left-3.5 top-7 bottom-0 w-0.5 bg-indigo-200 dark:bg-indigo-900 -z-0" />
                                )}
                                <div className={`size-7 rounded-full flex items-center justify-center shrink-0 z-10 ${isDone ? "bg-emerald-600 text-white" : "bg-slate-200 dark:bg-slate-800 text-muted"}`}>
                                  {isDone ? <CheckCircle2 className="size-4" /> : <Clock className="size-4" />}
                                </div>
                                <div className="min-w-0 flex-1 space-y-0.5">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-foreground text-xs">{stage.title}</span>
                                    <Badge tone={isDone ? "success" : "neutral"} className="text-[9px]">
                                      {stage.status}
                                    </Badge>
                                  </div>
                                  <p className="text-[11px] text-muted">{stage.details}</p>
                                  {stage.reference && (
                                    <p className="text-[10px] font-mono text-muted">Ref: {stage.reference}</p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
