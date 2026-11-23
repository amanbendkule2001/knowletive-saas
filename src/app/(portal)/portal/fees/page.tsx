import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getTenantContext } from "@/lib/auth";
import {
  Card,
  CardHeader,
  Badge,
  Callout,
  PageHeader,
  StatCard,
} from "@/components/ui/primitives";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  DollarSign,
  Download,
  FileText,
  HelpCircle,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { date, money } from "@/lib/format";
import { DemoCheckoutButton } from "@/components/portal/demo-checkout-button";
import { StudentReceiptModal, type ReceiptData } from "@/components/portal/student-receipt-modal";

export const metadata = { title: "Fees & Payment Portal" };

export default async function PortalFeesPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  // Query students linked to this parent/student user
  const linkedStudents = await db.student.findMany({
    where: {
      tenantId: ctx.tenant.id,
      OR: [
        {
          guardians: {
            some: {
              guardian: {
                userId: ctx.user.id,
              },
            },
          },
        },
        {
          userId: ctx.user.id,
        },
      ],
    },
    include: {
      section: { include: { class: true } },
      branch: true,
      tenant: true,
      feePlans: {
        where: { status: "ACTIVE" },
        include: {
          installments: {
            orderBy: { installmentNumber: "asc" },
            include: { feeInvoice: true },
          },
        },
      },
      demoFeePlans: {
        where: { status: "ACTIVE" },
        include: {
          installments: {
            orderBy: { installmentNumber: "asc" },
            include: {
              transactions: {
                where: { status: "SUCCESS" },
                orderBy: { createdAt: "desc" },
              },
            },
          },
        },
      },
      feeInvoices: {
        orderBy: { dueDate: "desc" },
      },
      paymentReceipts: {
        orderBy: { receivedAt: "desc" },
      },
    },
  });

  if (linkedStudents.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Student & Parent Portal"
          title="Fees & Installment Settlement"
          description="View your agreed fee schedules, track installment due dates, and make secure demo payments."
        />
        <Callout tone="neutral" title="No Student Profile Found">
          No student profile is currently linked to your account. If you are a parent, please contact the school administration office.
        </Callout>
      </div>
    );
  }

  // Active student (default to first linked student)
  const student = linkedStudents[0];
  const studentName = `${student.firstName} ${student.lastName}`;
  const className = student.section?.class?.name ?? "Class";
  const sectionName = student.section?.name ? ` - ${student.section.name}` : "";
  const branchName = student.branch?.name ?? "Main Campus";

  // Gather installments from demoFeePlans (preferred for demo) or real feePlans
  const demoPlan = student.demoFeePlans[0] ?? null;
  const realPlan = student.feePlans[0] ?? null;

  let totalFeeAmount = 0;
  let totalPaidAmount = 0;
  let outstandingBalance = 0;
  let nextDueInstallment: {
    id: string;
    title: string;
    dueDate: Date;
    amount: number;
  } | null = null;

  interface UnifiedInstallment {
    id: string;
    installmentNumber: number;
    title: string;
    dueDate: Date;
    originalAmount: number;
    paidAmount: number;
    remaining: number;
    status: "PAID" | "DUE" | "OVERDUE" | "UPCOMING" | "PARTIALLY_PAID";
    isDemo: boolean;
    transactions?: Array<{ reference: string; amount: number; createdAt: Date }>;
  }

  const installmentsList: UnifiedInstallment[] = [];
  const receiptsList: ReceiptData[] = [];

  if (realPlan) {
    totalFeeAmount = realPlan.payableAmount;
    for (const inst of realPlan.installments) {
      const invPaid = inst.feeInvoice?.paidAmount ?? 0;
      const invTotal = inst.feeInvoice?.amount ?? inst.originalAmount;
      totalPaidAmount += invPaid;
      const rem = Math.max(0, invTotal - invPaid);

      let derivedStatus: UnifiedInstallment["status"] = "UPCOMING";
      if (invPaid >= invTotal && invTotal > 0) derivedStatus = "PAID";
      else if (invPaid > 0) derivedStatus = "PARTIALLY_PAID";
      else if (new Date() > inst.dueDate) derivedStatus = "OVERDUE";
      else derivedStatus = "DUE";

      installmentsList.push({
        id: inst.id,
        installmentNumber: inst.installmentNumber,
        title: inst.title,
        dueDate: inst.dueDate,
        originalAmount: invTotal,
        paidAmount: invPaid,
        remaining: rem,
        status: derivedStatus,
        isDemo: false,
      });

      if (rem > 0 && !nextDueInstallment) {
        nextDueInstallment = {
          id: inst.id,
          title: inst.title,
          dueDate: inst.dueDate,
          amount: rem,
        };
      }
    }
    outstandingBalance = Math.max(0, totalFeeAmount - totalPaidAmount);
  } else if (demoPlan) {
    totalFeeAmount = demoPlan.payableAmount;
    for (const inst of demoPlan.installments) {
      totalPaidAmount += inst.paidAmount;
      const rem = Math.max(0, inst.originalAmount - inst.paidAmount);
      let derivedStatus: UnifiedInstallment["status"] = "UPCOMING";
      const now = new Date();

      if (inst.paidAmount >= inst.originalAmount && inst.originalAmount > 0) {
        derivedStatus = "PAID";
      } else if (inst.paidAmount > 0) {
        derivedStatus = "PARTIALLY_PAID";
      } else if (now > inst.dueDate) {
        derivedStatus = "OVERDUE";
      } else {
        derivedStatus = "DUE";
      }

      installmentsList.push({
        id: inst.id,
        installmentNumber: inst.installmentNumber,
        title: inst.title,
        dueDate: inst.dueDate,
        originalAmount: inst.originalAmount,
        paidAmount: inst.paidAmount,
        remaining: rem,
        status: derivedStatus,
        isDemo: true,
        transactions: inst.transactions.map((t) => ({
          reference: t.reference || "JODO-DEMO-UTR",
          amount: t.amount,
          createdAt: t.createdAt,
        })),
      });

      if (rem > 0 && !nextDueInstallment) {
        nextDueInstallment = {
          id: inst.id,
          title: inst.title,
          dueDate: inst.dueDate,
          amount: rem,
        };
      }
    }
    outstandingBalance = Math.max(0, totalFeeAmount - totalPaidAmount);
  } else {
    // Standalone invoices
    totalFeeAmount = student.feeInvoices.reduce((s, i) => s + i.amount, 0);
    totalPaidAmount = student.feeInvoices.reduce((s, i) => s + i.paidAmount, 0);
    outstandingBalance = Math.max(0, totalFeeAmount - totalPaidAmount);

    for (const inv of student.feeInvoices) {
      const rem = Math.max(0, inv.amount - inv.paidAmount);
      let derivedStatus: UnifiedInstallment["status"] = "UPCOMING";
      if (inv.status === "PAID") derivedStatus = "PAID";
      else if (inv.status === "PARTIAL") derivedStatus = "PARTIALLY_PAID";
      else if (new Date() > inv.dueDate) derivedStatus = "OVERDUE";
      else derivedStatus = "DUE";

      installmentsList.push({
        id: inv.id,
        installmentNumber: 1,
        title: inv.title,
        dueDate: inv.dueDate,
        originalAmount: inv.amount,
        paidAmount: inv.paidAmount,
        remaining: rem,
        status: derivedStatus,
        isDemo: false,
      });

      if (rem > 0 && !nextDueInstallment) {
        nextDueInstallment = {
          id: inv.id,
          title: inv.title,
          dueDate: inv.dueDate,
          amount: rem,
        };
      }
    }
  }

  // Also append receipts from real receipts table if present
  for (const rcpt of student.paymentReceipts) {
    receiptsList.push({
      receiptNumber: rcpt.receiptNumber,
      date: rcpt.receivedAt,
      studentName,
      admissionNo: student.admissionNo,
      className: `${className}${sectionName}`,
      tenantName: ctx.tenant.name,
      branchName,
      payerName: rcpt.payerName || ctx.user.name,
      amount: rcpt.amount,
      method: rcpt.method,
      reference: rcpt.reference || "REF-OFFICIAL",
      description: "School Fee Payment",
      status: "SETTLED",
    });
  }

  // Also query demo payment transactions for this student
  const demoTransactions = await db.demoPaymentTransaction.findMany({
    where: {
      tenantId: ctx.tenant.id,
      session: { studentId: student.id },
      status: "SUCCESS",
    },
    include: { session: true, demoInstallment: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  for (const dt of demoTransactions) {
    receiptsList.push({
      receiptNumber: `RCPT-JODO-${(dt.reference || "000000").slice(-6)}`,
      date: dt.createdAt,
      studentName,
      admissionNo: student.admissionNo,
      className: `${className}${sectionName}`,
      tenantName: ctx.tenant.name,
      branchName,
      payerName: dt.session.payerName || `${ctx.user.name} (Guardian)`,
      amount: dt.amount,
      method: "Jodo Pay (Demo)",
      reference: dt.reference,
      description: `${dt.demoInstallment?.title || "Fee Installment"} (Jodo Demo)`,
      status: "SETTLED",
    });
  }

  // Deduplicate receipts by reference
  const seenRefs = new Set<string>();
  const uniqueReceipts = receiptsList.filter((r) => {
    if (seenRefs.has(r.reference)) return false;
    seenRefs.add(r.reference);
    return true;
  });
  uniqueReceipts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  receiptsList.length = 0;
  receiptsList.push(...uniqueReceipts);

  return (
    <div className="space-y-6">
      {/* Top Banner: Navigation & Jodo Demo Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Link
          href="/portal"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground transition"
        >
          <ArrowLeft className="size-3.5" /> Back to Student Portal Overview
        </Link>
        <div className="flex items-center gap-2">
          <Badge tone="warning">JODO DEMO GATEWAY ACTIVE</Badge>
          <span className="text-[11px] text-muted font-mono">Sandbox Mode</span>
        </div>
      </div>

      {/* Mandatory Demo Notice */}
      <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 flex items-start gap-3">
        <ShieldAlert className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 dark:text-amber-200">
          <p className="font-semibold">Simulated Payment Experience (Demo Mode)</p>
          <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5">
            This module demonstrates the complete Jodo-inspired fee installment settlement workflow. Transactions are simulated for management review without real bank debits.
          </p>
        </div>
      </div>

      {/* Student & Institution Profile Card */}
      <Card className="p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-[var(--border)]">
          <div className="flex items-start gap-3.5">
            <div className="size-12 rounded-xl bg-brand/10 text-brand flex items-center justify-center font-bold text-lg shrink-0">
              {student.firstName[0]}
              {student.lastName[0]}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-foreground">{studentName}</h1>
                <Badge tone="neutral">Student ID: {student.admissionNo}</Badge>
              </div>
              <p className="text-xs text-muted mt-0.5">
                Class: <span className="font-semibold text-foreground">{className}{sectionName}</span> &bull; Campus: <span className="font-semibold text-foreground">{branchName}</span>
              </p>
            </div>
          </div>
          <div className="text-left md:text-right">
            <p className="text-xs font-semibold text-foreground">{ctx.tenant.name}</p>
            <p className="text-[11px] text-muted">Academic Session 2026–2027</p>
          </div>
        </div>

        {/* Financial KPI Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-5">
          <div className="p-3.5 rounded-xl bg-[var(--surface-sunken)]">
            <span className="text-[10px] font-semibold text-muted uppercase tracking-wider block">
              Total Invoiced Fee
            </span>
            <span className="text-lg font-bold text-foreground mt-0.5 block">
              {money(totalFeeAmount)}
            </span>
            <span className="text-[10px] text-muted">Annual approved schedule</span>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-900/40">
            <span className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block">
              Total Paid to Date
            </span>
            <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400 mt-0.5 block">
              {money(totalPaidAmount)}
            </span>
            <span className="text-[10px] text-emerald-800/80 dark:text-emerald-400/70">Verified receipts</span>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/40">
            <span className="text-[10px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider block">
              Outstanding Balance
            </span>
            <span className="text-lg font-bold text-amber-700 dark:text-amber-400 mt-0.5 block">
              {money(outstandingBalance)}
            </span>
            <span className="text-[10px] text-amber-800/80 dark:text-amber-400/70">Across remaining terms</span>
          </div>

          <div className="p-3.5 rounded-xl bg-[var(--surface-sunken)]">
            <span className="text-[10px] font-semibold text-muted uppercase tracking-wider block">
              Next Due Date
            </span>
            <span className="text-sm font-bold text-foreground mt-1 block">
              {nextDueInstallment ? date(nextDueInstallment.dueDate) : "All dues cleared"}
            </span>
            <span className="text-[10px] text-muted">
              {nextDueInstallment ? `${money(nextDueInstallment.amount)} due` : "Nil balance"}
            </span>
          </div>
        </div>
      </Card>

      {/* Main Grid: Installments & Fee Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Installment Schedule */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
              <div>
                <h2 className="text-base font-bold text-foreground">
                  Installment Schedule & Jodo Checkout
                </h2>
                <p className="text-xs text-muted mt-0.5">
                  Select an upcoming installment to launch the simulated Jodo payment flow.
                </p>
              </div>
              {nextDueInstallment && (
                <div className="shrink-0">
                  <DemoCheckoutButton
                    studentId={student.id}
                    installmentId={nextDueInstallment.id}
                    amountRupees={nextDueInstallment.amount / 100}
                    label={`Pay Next Due (${money(nextDueInstallment.amount)}) →`}
                  />
                </div>
              )}
            </div>

            {/* Installment List */}
            {installmentsList.length === 0 ? (
              <div className="py-12 text-center">
                <Receipt className="size-10 mx-auto text-muted mb-3 opacity-40" />
                <h3 className="text-sm font-semibold text-foreground">No Active Fee Schedule</h3>
                <p className="text-xs text-muted max-w-sm mx-auto mt-1">
                  No fee installments or invoices are currently due for {studentName}. Fee schedules and payment links created by the institute will appear here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)] mt-2">
                {installmentsList.map((inst) => {
                const isPaid = inst.status === "PAID";
                const isDue = inst.status === "DUE" || inst.status === "OVERDUE";

                return (
                  <div key={inst.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={`size-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                          isPaid
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                            : isDue
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                            : "bg-[var(--surface-sunken)] text-muted"
                        }`}
                      >
                        Q{inst.installmentNumber}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{inst.title}</p>
                          <Badge
                            tone={
                              inst.status === "PAID"
                                ? "success"
                                : inst.status === "OVERDUE"
                                ? "danger"
                                : inst.status === "DUE"
                                ? "warning"
                                : "neutral"
                            }
                          >
                            {inst.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted mt-0.5 flex items-center gap-1.5">
                          <Calendar className="size-3 text-muted" /> Due Date: {date(inst.dueDate)}
                          {inst.paidAmount > 0 && isPaid && (
                            <span className="text-emerald-600 font-medium"> &bull; Settled in full</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                      <div className="text-left sm:text-right">
                        <span className="text-xs text-muted block">Installment Amount</span>
                        <span className="text-sm font-bold text-foreground">
                          {money(inst.originalAmount)}
                        </span>
                      </div>

                      {isPaid ? (
                        <div className="flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-900">
                          <CheckCircle2 className="size-3.5" /> Settled
                        </div>
                      ) : (
                        <DemoCheckoutButton
                          studentId={student.id}
                          installmentId={inst.id}
                          amountRupees={inst.remaining / 100}
                          label="Pay with Jodo →"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
            )}
          </Card>

          {/* Payment History & Official Receipts */}
          <Card className="p-6">
            <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
              <div>
                <h2 className="text-base font-bold text-foreground">Payment History & Receipts</h2>
                <p className="text-xs text-muted mt-0.5">
                  Official digital fee receipts generated by the school accounts office.
                </p>
              </div>
              <Receipt className="size-5 text-muted" />
            </div>

            {receiptsList.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted">
                No fee receipts generated yet. Complete a demo payment above to issue your first receipt.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)] mt-1">
                {receiptsList.map((rcpt, idx) => (
                  <div key={idx} className="py-3.5 flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{rcpt.receiptNumber}</span>
                        <Badge tone="success">{rcpt.status}</Badge>
                      </div>
                      <p className="text-muted mt-0.5">
                        {date(rcpt.date)} &bull; {rcpt.method} &bull; Ref: <span className="font-mono">{rcpt.reference}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-bold text-foreground text-sm">{money(rcpt.amount)}</span>
                      <StudentReceiptModal receipt={rcpt} triggerLabel="View / Print" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right Column (1 Col): Fee Breakdown & Financing Options */}
        <div className="space-y-4">
          {/* Fee Itemization Card */}
          <Card className="p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted mb-3 flex items-center gap-1.5">
              <FileText className="size-3.5 text-brand" /> Fee Component Breakdown
            </h3>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b border-[var(--border)]">
                <span className="text-muted">Tuition & Faculty Services (60%)</span>
                <span className="font-semibold text-foreground">{money(totalFeeAmount * 0.6)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--border)]">
                <span className="text-muted">Science & Computer Laboratory (20%)</span>
                <span className="font-semibold text-foreground">{money(totalFeeAmount * 0.2)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--border)]">
                <span className="text-muted">Library, Sports & Co-Curricular (15%)</span>
                <span className="font-semibold text-foreground">{money(totalFeeAmount * 0.15)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--border)]">
                <span className="text-muted">Examinations & Administrative (5%)</span>
                <span className="font-semibold text-foreground">{money(totalFeeAmount * 0.05)}</span>
              </div>
              <div className="flex justify-between pt-1 font-bold text-sm">
                <span>Total Annual Fee</span>
                <span>{money(totalFeeAmount)}</span>
              </div>
            </div>
          </Card>

          {/* Jodo Flex Financing Info Card */}
          <div className="rounded-2xl border-2 border-indigo-400/40 bg-gradient-to-br from-indigo-50/80 via-purple-50/40 to-white dark:from-indigo-950/40 dark:via-purple-950/20 dark:to-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400 font-bold text-xs uppercase tracking-wider">
              <Sparkles className="size-4" />
              <span>Jodo Flex &bull; Monthly Installments</span>
            </div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Zero-Cost Monthly EMIs for School Fees
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Parents can split remaining term fees into affordable monthly installments with zero interest and flexible tenures of 3, 6, or 9 months.
            </p>
            <div className="pt-2 text-[11px] text-indigo-950 dark:text-indigo-200 space-y-1">
              <div className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="size-3 text-indigo-600 shrink-0" />
                <span>Instant paperless approval in 2 minutes</span>
              </div>
              <div className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="size-3 text-indigo-600 shrink-0" />
                <span>No debit card or credit score blocks</span>
              </div>
            </div>
          </div>

          {/* School Accounts Help Card */}
          <Card className="p-5 space-y-2">
            <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <HelpCircle className="size-3.5 text-brand" /> Need Assistance?
            </h3>
            <p className="text-xs text-muted leading-relaxed">
              For fee concessions, sibling waivers, or bank transfer reconciliation, contact the Sunrise Public School cashier desk:
            </p>
            <div className="text-xs text-muted pt-1 space-y-0.5">
              <p>Email: <span className="font-mono text-foreground">accounts@sunrise.test</span></p>
              <p>Helpline: <span className="font-mono text-foreground">+91 11 2984 5000</span></p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
