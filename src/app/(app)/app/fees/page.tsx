import Link from "next/link";
import { redirect } from "next/navigation";
import type { FeeStatus, Prisma } from "@prisma/client";
import {
  Building2,
  Calendar,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Download,
  FileText,
  Layers,
  Plus,
  Receipt,
  ReceiptText,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission, isStaffMember } from "@/lib/auth";
import { resolveUserBranchScope, buildBranchFilter } from "@/lib/branch";
import { getEffectiveFeeCollectedSum } from "@/lib/branch-reconciliation";
import { hasFeature } from "@/lib/entitlements";
import { FeatureLocked } from "@/components/ui/feature-gate";
import {
  Avatar,
  Badge,
  Callout,
  Card,
  CardHeader,
  PageHeader,
  Pagination,
  StatCard,
  statusLabel,
  statusTone,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { date, money, num, startOfMonth } from "@/lib/format";
import { safeInt } from "@/lib/utils";
import { DemoCheckoutButton } from "@/components/portal/demo-checkout-button";
import { StudentReceiptModal, type ReceiptData } from "@/components/portal/student-receipt-modal";

export const metadata = { title: "Fees & Payment Gateway" };

const PAGE_SIZE = 20;
const STATUSES: FeeStatus[] = ["PENDING", "PARTIAL", "OVERDUE", "PAID", "WAIVED"];
const OPEN_STATUSES: FeeStatus[] = ["PENDING", "PARTIAL", "OVERDUE"];

type FeeRow = Prisma.FeeInvoiceGetPayload<{
  include: { student: { include: { section: { include: { class: true } } } } };
}>;

export default async function FeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; tab?: string; branchId?: string }>;
}) {
  const ctx = await requireTenantPermission("tenant.fees.read");
  if (!isStaffMember(ctx)) redirect("/portal");
  const plan = ctx.tenant.subscription?.plan;
  if (!hasFeature(plan, "fees")) {
    return <FeatureLocked feature="fees" title="Fees & payments" />;
  }

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = STATUSES.includes(sp.status as FeeStatus) ? (sp.status as FeeStatus) : undefined;
  const page = safeInt(sp.page, 1, 10_000);
  const currentTab = sp.tab ?? "invoices";
  const selectedBranchId = sp.branchId || undefined;
  const tenantId = ctx.tenant.id;
  const now = new Date();

  const branchScope = await resolveUserBranchScope(ctx);
  const branchFilter = selectedBranchId
    ? { branchId: selectedBranchId }
    : branchScope.isBranchScoped
    ? buildBranchFilter(branchScope.allowedBranchIds)
    : {};

  // 1. Core KPIs
  const [billed, collectedThisMonth, overdue, statusCounts] = await Promise.all([
    db.feeInvoice.aggregate({
      where: { tenantId, status: { not: "WAIVED" }, ...branchFilter },
      _sum: { amount: true, paidAmount: true },
    }),
    branchScope.isBranchScoped
      ? getEffectiveFeeCollectedSum(tenantId, startOfMonth(now), branchScope.allowedBranchIds, db).then((total) => ({
          _sum: { amount: total },
        }))
      : db.feePayment.aggregate({
          where: { tenantId, paidAt: { gte: startOfMonth(now) }, ...branchFilter },
          _sum: { amount: true },
        }),
    db.feeInvoice.aggregate({
      where: { tenantId, status: { in: OPEN_STATUSES }, dueDate: { lt: now }, ...branchFilter },
      _sum: { amount: true, paidAmount: true },
      _count: { _all: true },
    }),
    db.feeInvoice.groupBy({
      by: ["status"],
      where: { tenantId, ...branchFilter },
      _count: { _all: true },
    }),
  ]);

  const billedTotal = billed._sum.amount ?? 0;
  const collectedTotal = billed._sum.paidAmount ?? 0;
  const outstanding = Math.max(0, billedTotal - collectedTotal);
  const overdueAmount = Math.max(0, (overdue._sum.amount ?? 0) - (overdue._sum.paidAmount ?? 0));
  const canWrite = hasTenantPermission(ctx, "tenant.fees.write");
  const countFor = (value: FeeStatus) => statusCounts.find((row) => row.status === value)?._count._all ?? 0;
  const allCount = statusCounts.reduce((sum, row) => sum + row._count._all, 0);

  // 2. Tab Data Queries
  let invoiceRows: FeeRow[] = [];
  let invoiceTotal = 0;

  // Branch tab data
  let branchSummaries: Array<{
    id: string;
    name: string;
    code: string;
    branchType: string;
    collectorCode: string | null;
    bankAccount: string | null;
    bankIfsc: string | null;
    billedAmount: number;
    collectedAmount: number;
    onlineSettledBalance: number;
    studentCount: number;
  }> = [];

  // Installments tab data
  let installmentsList: Array<{
    id: string;
    installmentNumber: number;
    title: string;
    studentName: string;
    admissionNo: string;
    studentId: string;
    dueDate: Date;
    originalAmount: number;
    paidAmount: number;
    remaining: number;
    status: string;
    isDemo: boolean;
  }> = [];

  // Transactions tab data
  let transactionList: Array<{
    id: string;
    reference: string;
    receiptNumber: string;
    studentName: string;
    admissionNo: string;
    amount: number;
    method: string;
    date: Date;
    status: string;
    branchName: string;
  }> = [];

  if (currentTab === "invoices") {
    const where: Prisma.FeeInvoiceWhereInput = {
      tenantId,
      ...branchFilter,
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { title: { contains: q, mode: "insensitive" } },
              { student: { firstName: { contains: q, mode: "insensitive" } } },
              { student: { lastName: { contains: q, mode: "insensitive" } } },
              { student: { admissionNo: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      db.feeInvoice.findMany({
        where,
        include: { student: { include: { section: { include: { class: true } } } } },
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.feeInvoice.count({ where }),
    ]);
    invoiceRows = rows;
    invoiceTotal = total;
  } else if (currentTab === "branches") {
    const branches = await db.branch.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(branchScope.isBranchScoped ? { id: { in: branchScope.allowedBranchIds } } : {}),
      },
      include: {
        _count: { select: { students: true } },
      },
      orderBy: [{ branchType: "asc" }, { name: "asc" }],
    });

    for (const b of branches) {
      const [branchInvoices, lastLedger] = await Promise.all([
        db.feeInvoice.aggregate({
          where: { tenantId, branchId: b.id, status: { not: "WAIVED" } },
          _sum: { amount: true, paidAmount: true },
        }),
        db.branchLedgerEntry.findFirst({
          where: { tenantId, branchId: b.id },
          orderBy: { postedAt: "desc" },
          select: { balanceAfter: true },
        }),
      ]);

      branchSummaries.push({
        id: b.id,
        name: b.name,
        code: b.code,
        branchType: b.branchType,
        collectorCode: b.collectorCode,
        bankAccount: b.bankAccountNumber,
        bankIfsc: b.bankIfsc,
        billedAmount: branchInvoices._sum.amount ?? 0,
        collectedAmount: branchInvoices._sum.paidAmount ?? 0,
        onlineSettledBalance: lastLedger?.balanceAfter ?? 0,
        studentCount: b._count.students,
      });
    }
  } else if (currentTab === "installments") {
    // Fetch demo fee plans and installments
    const [demoPlans, realPlans] = await Promise.all([
      db.demoFeePlan.findMany({
        where: { tenantId, status: "ACTIVE", ...branchFilter },
        include: {
          student: true,
          installments: { orderBy: { installmentNumber: "asc" } },
        },
        take: 50,
      }),
      db.studentFeePlan.findMany({
        where: { tenantId, status: "ACTIVE", ...branchFilter },
        include: {
          student: true,
          installments: {
            orderBy: { installmentNumber: "asc" },
            include: { feeInvoice: true },
          },
        },
        take: 50,
      }),
    ]);

    for (const dp of demoPlans) {
      for (const inst of dp.installments) {
        installmentsList.push({
          id: inst.id,
          installmentNumber: inst.installmentNumber,
          title: inst.title,
          studentName: `${dp.student.firstName} ${dp.student.lastName}`,
          admissionNo: dp.student.admissionNo,
          studentId: dp.student.id,
          dueDate: inst.dueDate,
          originalAmount: inst.originalAmount,
          paidAmount: inst.paidAmount,
          remaining: Math.max(0, inst.originalAmount - inst.paidAmount),
          status: inst.status,
          isDemo: true,
        });
      }
    }

    for (const rp of realPlans) {
      for (const inst of rp.installments) {
        const paid = inst.feeInvoice?.paidAmount ?? 0;
        const total = inst.feeInvoice?.amount ?? inst.originalAmount;
        installmentsList.push({
          id: inst.id,
          installmentNumber: inst.installmentNumber,
          title: inst.title,
          studentName: `${rp.student.firstName} ${rp.student.lastName}`,
          admissionNo: rp.student.admissionNo,
          studentId: rp.student.id,
          dueDate: inst.dueDate,
          originalAmount: total,
          paidAmount: paid,
          remaining: Math.max(0, total - paid),
          status: inst.status,
          isDemo: false,
        });
      }
    }
  } else if (currentTab === "transactions") {
    const [receipts, demoTransactions] = await Promise.all([
      db.paymentReceipt.findMany({
        where: { tenantId, ...branchFilter },
        include: { student: true, branch: true },
        orderBy: { receivedAt: "desc" },
        take: 30,
      }),
      db.demoPaymentTransaction.findMany({
        where: { tenantId, status: "SUCCESS" },
        include: {
          session: {
            include: { student: { include: { branch: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

    for (const r of receipts) {
      transactionList.push({
        id: r.id,
        reference: r.reference || r.providerRef || "REF-OFFICIAL",
        receiptNumber: r.receiptNumber,
        studentName: `${r.student.firstName} ${r.student.lastName}`,
        admissionNo: r.student.admissionNo,
        amount: r.amount,
        method: r.method,
        date: r.receivedAt,
        status: "SETTLED",
        branchName: r.branch?.name ?? "Main Campus",
      });
    }

    for (const dt of demoTransactions) {
      transactionList.push({
        id: dt.id,
        reference: dt.reference || "JODO-DEMO-UTR",
        receiptNumber: `RCPT-JODO-${(dt.reference || "000000").slice(-6)}`,
        studentName: `${dt.session.student.firstName} ${dt.session.student.lastName}`,
        admissionNo: dt.session.student.admissionNo,
        amount: dt.amount,
        method: "ONLINE_JODO (Demo)",
        date: dt.createdAt,
        status: "SETTLED",
        branchName: dt.session.student.branch?.name ?? "Main Campus",
      });
    }

    // Sort by date desc
    transactionList.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  const invoiceColumns: Column<FeeRow>[] = [
    {
      key: "invoice",
      header: "Invoice",
      mobile: "title",
      render: (row) => (
        <Link href={`/app/fees/${row.id}`} className="group block min-w-0">
          <span className="block truncate font-mono text-[12px] font-medium group-hover:underline">
            {row.number}
          </span>
          <span className="block truncate text-[11px] text-muted">{row.title}</span>
        </Link>
      ),
    },
    {
      key: "student",
      header: "Student",
      mobile: "subtitle",
      render: (row) => (
        <Link href={`/app/students/${row.studentId}`} className="group flex items-center gap-2.5">
          <Avatar
            name={`${row.student.firstName} ${row.student.lastName}`}
            size={28}
            color={ctx.tenant.accentColor}
          />
          <span className="min-w-0">
            <span className="block truncate font-medium group-hover:underline">
              {row.student.firstName} {row.student.lastName}
            </span>
            <span className="block truncate font-mono text-[10px] text-muted">
              {row.student.admissionNo}
            </span>
          </span>
        </Link>
      ),
    },
    {
      key: "class",
      header: "Class",
      mobile: "detail",
      render: (row) => (
        <span className="text-muted">
          {row.student.section ? `${row.student.section.class.name} — ${row.student.section.name}` : "—"}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => (
        <div className="text-right">
          <span className="block font-medium">{money(row.amount)}</span>
          {row.paidAmount > 0 && row.status !== "PAID" && (
            <span className="block text-[10px] text-[var(--success)]">Paid {money(row.paidAmount)}</span>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>,
    },
    {
      key: "dueDate",
      header: "Due date",
      render: (row) => (
        <span
          className={
            row.dueDate < now && row.status !== "PAID" && row.status !== "WAIVED"
              ? "text-[var(--danger)] font-medium"
              : "text-muted"
          }
        >
          {date(row.dueDate)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "hidden",
      render: (row) => (
        <Link href={`/app/fees/${row.id}`} className="link text-xs">
          Open
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations & Finance"
        title="Fees & Payment Gateway"
        description="Monitor fee collections, oversee multi-branch settlements, and manage Jodo demo installments."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/portal/fees" className="btn btn-secondary btn-sm" target="_blank">
              <Sparkles className="size-3.5 text-brand" /> Launch Student Portal Checkout
            </Link>
            {canWrite && (
              <Link href="/app/fees/new" className="btn btn-primary btn-sm">
                <Plus className="size-4" /> New Invoice
              </Link>
            )}
          </div>
        }
      />

      {/* Top Financial KPI Summary */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Billed (All Time)"
          value={money(billedTotal)}
          sub={`${num(allCount)} invoices · active`}
          icon={<ReceiptText className="size-4" />}
        />
        <StatCard
          label="Collected This Month"
          value={money(collectedThisMonth._sum.amount ?? 0)}
          sub={`Since ${date(startOfMonth(now))}`}
          icon={<Wallet className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Outstanding Dues"
          value={money(outstanding)}
          sub={`${num(countFor("PENDING") + countFor("PARTIAL") + countFor("OVERDUE"))} open bills`}
          icon={<CircleDollarSign className="size-4" />}
          tone={outstanding > 0 ? "warning" : "success"}
        />
        <StatCard
          label="Past Due / Overdue"
          value={money(overdueAmount)}
          sub={`${num(overdue._count._all)} overdue accounts`}
          icon={<TriangleAlert className="size-4" />}
          tone={overdueAmount > 0 ? "danger" : "success"}
        />
      </div>

      {/* Primary Navigation Tabs */}
      <div className="border-b border-[var(--border)] flex gap-4 text-xs font-semibold">
        <Link
          href="/app/fees?tab=invoices"
          className={`pb-3 border-b-2 flex items-center gap-1.5 transition ${
            currentTab === "invoices"
              ? "border-brand text-brand"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          <ReceiptText className="size-4" /> Fee Invoices
        </Link>
        <Link
          href="/app/fees?tab=installments"
          className={`pb-3 border-b-2 flex items-center gap-1.5 transition ${
            currentTab === "installments"
              ? "border-brand text-brand"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          <Sparkles className="size-4 text-indigo-600" /> Jodo Installment Plans
          <Badge tone="warning">DEMO</Badge>
        </Link>
        <Link
          href="/app/fees?tab=branches"
          className={`pb-3 border-b-2 flex items-center gap-1.5 transition ${
            currentTab === "branches"
              ? "border-brand text-brand"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          <Building2 className="size-4" /> Branch Collections & Settlements
        </Link>
        <Link
          href="/app/fees?tab=transactions"
          className={`pb-3 border-b-2 flex items-center gap-1.5 transition ${
            currentTab === "transactions"
              ? "border-brand text-brand"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          <CreditCard className="size-4" /> Receipts & Transactions
        </Link>
      </div>

      {/* ── TAB 1: INVOICES ────────────────────────────────────────── */}
      {currentTab === "invoices" && (
        <Card>
          <CardHeader
            title="All Fee Invoices"
            description="Search by invoice number, title, student name or admission number."
          />

          <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-3 py-2.5">
            {[{ key: "", label: "All", count: allCount }, ...STATUSES.map((value) => ({
              key: value,
              label: statusLabel(value),
              count: countFor(value),
            }))].map((chip) => {
              const active = chip.key === (status ?? "");
              const params = new URLSearchParams();
              params.set("tab", "invoices");
              if (q) params.set("q", q);
              if (chip.key) params.set("status", chip.key);
              return (
                <Link
                  key={chip.key || "all"}
                  href={`/app/fees?${params.toString()}`}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
                    active
                      ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                      : "text-muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                  }`}
                >
                  {chip.label}
                  <span className="tabular-nums opacity-70">{num(chip.count)}</span>
                </Link>
              );
            })}
          </div>

          <form className="flex flex-col gap-2 border-b border-[var(--border)] p-3 sm:flex-row sm:items-center">
            <input type="hidden" name="tab" value="invoices" />
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-2)]" />
              <input
                name="q"
                defaultValue={q}
                placeholder="Search invoice, title or student…"
                className="input pl-8"
                aria-label="Search fee invoices"
              />
            </div>
            {status && <input type="hidden" name="status" value={status} />}
            <button className="btn btn-secondary" type="submit">
              Search
            </button>
            {(q || status) && (
              <Link href="/app/fees?tab=invoices" className="btn btn-ghost">
                Clear
              </Link>
            )}
          </form>

          <DataTable
            columns={invoiceColumns}
            rows={invoiceRows}
            emptyTitle={q || status ? "No invoices match those filters" : "No fee invoices yet"}
            emptyDescription={
              q || status
                ? "Try a different search term or clear the status filter."
                : "Raise the first invoice to start collecting fees online."
            }
            emptyAction={
              canWrite && !q && !status ? (
                <Link href="/app/fees/new" className="btn btn-primary btn-sm">
                  <Plus className="size-3.5" /> New invoice
                </Link>
              ) : undefined
            }
            footer={
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={invoiceTotal}
                basePath="/app/fees"
                query={{ q: q || undefined, status, tab: "invoices" }}
              />
            }
          />
        </Card>
      )}

      {/* ── TAB 2: JODO INSTALLMENT PLANS ──────────────────────────── */}
      {currentTab === "installments" && (
        <div className="space-y-4">
          <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Active Installment Schedules (Jodo Sandbox)
                </h3>
                <p className="text-xs text-muted mt-0.5">
                  Scheduled term fees, quarter installments, and live settlement statuses.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="info">{installmentsList.length} Scheduled Installments</Badge>
                {canWrite && (
                  <Link href="/app/fees/new?mode=plan" className="btn btn-primary btn-sm inline-flex items-center gap-1.5">
                    <Plus className="size-3.5" /> New Installment Plan
                  </Link>
                )}
              </div>
            </div>

            <div className="divide-y divide-[var(--border)] mt-2">
              {installmentsList.length === 0 ? (
                <div className="py-12 text-center">
                  <Layers className="size-10 mx-auto text-muted mb-3 opacity-40" />
                  <h4 className="text-sm font-semibold text-foreground">No Installment Schedules Yet</h4>
                  <p className="text-xs text-muted max-w-sm mx-auto mt-1 mb-4">
                    Set up an installment fee schedule for students to enable quarterly Jodo checkout.
                  </p>
                  <Link href="/app/fees/new?mode=plan" className="btn btn-primary btn-sm inline-flex items-center gap-1.5">
                    <Plus className="size-3.5" /> Create Installment Plan
                  </Link>
                </div>
              ) : (
                installmentsList.map((inst) => {
                  const isPaid = inst.status === "PAID";
                  const isDue = inst.status === "DUE" || inst.status === "OVERDUE";

                  return (
                    <div
                      key={inst.id}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
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
                            <span className="font-semibold text-foreground text-sm">
                              {inst.studentName}
                            </span>
                            <span className="text-muted font-mono text-[11px]">
                              ({inst.admissionNo})
                            </span>
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
                          <p className="text-muted mt-0.5">
                            {inst.title} &bull; Due: {date(inst.dueDate)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                        <div className="text-left sm:text-right">
                          <span className="text-muted block text-[11px]">Amount</span>
                          <span className="font-bold text-foreground text-sm">
                            {money(inst.originalAmount)}
                          </span>
                        </div>

                        {isPaid ? (
                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-900">
                            Settled
                          </span>
                        ) : (
                          <DemoCheckoutButton
                            studentId={inst.studentId}
                            installmentId={inst.id}
                            amountRupees={inst.remaining / 100}
                            label="Pay Demo →"
                          />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ── TAB 3: BRANCH COLLECTIONS & SETTLEMENTS ────────────────── */}
      {currentTab === "branches" && (
        <div className="space-y-4">
          <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Branch Collection Breakdown & Online Payable Balances
                </h3>
                <p className="text-xs text-muted mt-0.5">
                  Multi-branch ledger attribution, Jodo collector codes, and institution payable balances.
                </p>
              </div>
              <Badge tone="neutral">
                {branchSummaries.length} Registered Campus{branchSummaries.length === 1 ? "" : "es"}
              </Badge>
            </div>

            <div className="divide-y divide-[var(--border)] mt-2">
              {branchSummaries.length === 0 ? (
                <div className="py-12 text-center">
                  <Building2 className="size-10 mx-auto text-muted mb-3 opacity-40" />
                  <h4 className="text-sm font-semibold text-foreground">No Active Branches Configured</h4>
                  <p className="text-xs text-muted max-w-sm mx-auto mt-1">
                    Multi-branch campus entities and Jodo collector code routings configured for this institute will appear here with live ledger balances.
                  </p>
                </div>
              ) : (
                branchSummaries.map((b) => (
                  <div
                    key={b.id}
                    className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground text-sm">{b.name}</span>
                        <Badge tone={b.branchType === "MAIN" ? "brand" : "neutral"}>
                          {b.branchType}
                        </Badge>
                        <span className="text-muted font-mono text-[11px]">[{b.code}]</span>
                      </div>
                      <p className="text-muted">
                        Collector Code:{" "}
                        <span className="font-mono font-medium text-foreground">
                          {b.collectorCode || "Not Configured"}
                        </span>{" "}
                        &bull; Students: <span className="font-medium text-foreground">{b.studentCount}</span>
                      </p>
                      {b.bankAccount && (
                        <p className="text-[11px] text-muted">
                          Bank A/C: <span className="font-mono">{b.bankAccount}</span> ({b.bankIfsc})
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-4 text-right shrink-0">
                      <div>
                        <span className="text-muted text-[10px] uppercase font-semibold block">
                          Billed Total
                        </span>
                        <span className="font-bold text-foreground text-sm block mt-0.5">
                          {money(b.billedAmount)}
                        </span>
                      </div>
                      <div>
                        <span className="text-emerald-700 dark:text-emerald-400 text-[10px] uppercase font-semibold block">
                          Collected
                        </span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 text-sm block mt-0.5">
                          {money(b.collectedAmount)}
                        </span>
                      </div>
                      <div className="bg-indigo-50/60 dark:bg-indigo-950/30 p-2 rounded-xl border border-indigo-200/50 dark:border-indigo-900/40">
                        <span className="text-indigo-700 dark:text-indigo-300 text-[10px] uppercase font-bold block">
                          Settled Payable
                        </span>
                        <span className="font-bold text-indigo-700 dark:text-indigo-400 text-sm block mt-0.5">
                          {money(b.onlineSettledBalance)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ── TAB 4: RECEIPTS & TRANSACTIONS ──────────────────────────── */}
      {currentTab === "transactions" && (
        <Card className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
            <div>
              <h3 className="text-base font-bold text-foreground">
                Payment Transactions & Receipts Audit Log
              </h3>
              <p className="text-xs text-muted mt-0.5">
                Every online Jodo settlement, offline cash receipt, and gateway UTR reference.
              </p>
            </div>
            <Receipt className="size-5 text-muted" />
          </div>

          <div className="divide-y divide-[var(--border)] mt-2">
            {transactionList.length === 0 ? (
              <div className="py-12 text-center">
                <ReceiptText className="size-10 mx-auto text-muted mb-3 opacity-40" />
                <h4 className="text-sm font-semibold text-foreground">No Transactions Recorded Yet</h4>
                <p className="text-xs text-muted max-w-sm mx-auto mt-1">
                  Payments completed via the Jodo checkout simulator or manual cash receipts will appear here in real time.
                </p>
              </div>
            ) : (
              transactionList.map((tx) => {
                const modalData: ReceiptData = {
                  receiptNumber: tx.receiptNumber,
                  date: tx.date,
                  studentName: tx.studentName,
                  admissionNo: tx.admissionNo,
                  className: "Standard Enrolled",
                  tenantName: ctx.tenant.name,
                  branchName: tx.branchName,
                  payerName: `${tx.studentName} (Payer)`,
                  amount: tx.amount,
                  method: tx.method,
                  reference: tx.reference,
                  description: "School Fee Settlement",
                  status: tx.status,
                };

                return (
                  <div
                    key={tx.id}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground">{tx.receiptNumber}</span>
                        <Badge tone="success">{tx.status}</Badge>
                        <span className="text-muted font-medium">&bull; {tx.branchName}</span>
                      </div>
                      <p className="text-muted mt-0.5">
                        {tx.studentName} ({tx.admissionNo}) &bull; {tx.method} &bull; Ref:{" "}
                        <span className="font-mono font-medium">{tx.reference}</span>
                      </p>
                      <p className="text-[10px] text-muted">{date(tx.date)}</p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-bold text-foreground text-sm">{money(tx.amount)}</span>
                      <StudentReceiptModal receipt={modalData} triggerLabel="View Receipt" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
