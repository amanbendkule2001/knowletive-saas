import Link from "next/link";
import { redirect } from "next/navigation";
import type { FeeStatus, Prisma } from "@prisma/client";
import {
  CircleDollarSign,
  Download,
  Plus,
  ReceiptText,
  Search,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission, isStaffMember } from "@/lib/auth";
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

export const metadata = { title: "Fees" };

const PAGE_SIZE = 20;
const STATUSES: FeeStatus[] = ["PENDING", "PARTIAL", "OVERDUE", "PAID", "WAIVED"];
const OPEN_STATUSES: FeeStatus[] = ["PENDING", "PARTIAL", "OVERDUE"];

type FeeRow = Prisma.FeeInvoiceGetPayload<{
  include: { student: { include: { section: { include: { class: true } } } } };
}>;

export default async function FeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
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
  const tenantId = ctx.tenant.id;
  const now = new Date();

  const where: Prisma.FeeInvoiceWhereInput = {
    tenantId,
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

  const [rows, total, billed, collectedThisMonth, overdue, statusCounts] = await Promise.all([
    db.feeInvoice.findMany({
      where,
      include: { student: { include: { section: { include: { class: true } } } } },
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.feeInvoice.count({ where }),
    db.feeInvoice.aggregate({
      where: { tenantId, status: { not: "WAIVED" } },
      _sum: { amount: true, paidAmount: true },
    }),
    db.feePayment.aggregate({
      where: { tenantId, paidAt: { gte: startOfMonth(now) } },
      _sum: { amount: true },
    }),
    db.feeInvoice.aggregate({
      where: { tenantId, status: { in: OPEN_STATUSES }, dueDate: { lt: now } },
      _sum: { amount: true, paidAmount: true },
      _count: { _all: true },
    }),
    db.feeInvoice.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true },
    }),
  ]);

  const billedTotal = billed._sum.amount ?? 0;
  const collectedTotal = billed._sum.paidAmount ?? 0;
  const outstanding = Math.max(0, billedTotal - collectedTotal);
  const overdueAmount = Math.max(
    0,
    (overdue._sum.amount ?? 0) - (overdue._sum.paidAmount ?? 0),
  );
  const canWrite = hasTenantPermission(ctx, "tenant.fees.write");
  const countFor = (value: FeeStatus) =>
    statusCounts.find((row) => row.status === value)?._count._all ?? 0;
  const allCount = statusCounts.reduce((sum, row) => sum + row._count._all, 0);

  const columns: Column<FeeRow>[] = [
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
        <Link
          href={`/app/students/${row.studentId}`}
          className="group flex items-center gap-2.5"
        >
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
          {row.student.section
            ? `${row.student.section.class.name} — ${row.student.section.name}`
            : "—"}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      mobile: "detail",
      render: (row) => <span className="tabular-nums">{money(row.amount)}</span>,
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      mobile: "detail",
      render: (row) => {
        const balance = row.amount - row.paidAmount;
        if (row.status === "WAIVED") return <span className="text-muted">Waived</span>;
        return (
          <span className={balance > 0 ? "font-medium tabular-nums" : "tabular-nums text-muted"}>
            {money(balance)}
          </span>
        );
      },
    },
    {
      key: "due",
      header: "Due",
      mobile: "detail",
      render: (row) => (
        <span
          className={
            OPEN_STATUSES.includes(row.status) && row.dueDate < now
              ? "text-[var(--danger)]"
              : "text-muted"
          }
        >
          {date(row.dueDate)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobile: "hidden",
      render: (row) => (
        <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Fees & payments"
        description="Raise invoices, record full or partial payments and keep every receipt auditable."
        actions={
          <>
            <Link href="/app/students/export" className="btn btn-secondary">
              <Download className="size-3.5" /> Export students
            </Link>
            {canWrite && (
              <Link href="/app/fees/new" className="btn btn-primary">
                <Plus className="size-4" /> New invoice
              </Link>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Billed (all time)"
          value={money(billedTotal)}
          sub={`${num(allCount)} invoices · waived excluded`}
          icon={<ReceiptText className="size-4" />}
        />
        <StatCard
          label="Collected this month"
          value={money(collectedThisMonth._sum.amount ?? 0)}
          sub={`Since ${date(startOfMonth(now))}`}
          icon={<Wallet className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Outstanding"
          value={money(outstanding)}
          sub={`${num(countFor("PENDING") + countFor("PARTIAL") + countFor("OVERDUE"))} open invoices`}
          icon={<CircleDollarSign className="size-4" />}
          tone={outstanding > 0 ? "warning" : "success"}
        />
        <StatCard
          label="Overdue"
          value={money(overdueAmount)}
          sub={`${num(overdue._count._all)} invoice${overdue._count._all === 1 ? "" : "s"} past due`}
          icon={<TriangleAlert className="size-4" />}
          tone={overdueAmount > 0 ? "danger" : "success"}
        />
      </div>

      <Card>
        <CardHeader
          title="All fee invoices"
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
            if (q) params.set("q", q);
            if (chip.key) params.set("status", chip.key);
            return (
              <Link
                key={chip.key || "all"}
                href={`/app/fees${params.toString() ? `?${params.toString()}` : ""}`}
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
            <Link href="/app/fees" className="btn btn-ghost">
              Clear
            </Link>
          )}
        </form>

        <DataTable
          columns={columns}
          rows={rows}
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
              total={total}
              basePath="/app/fees"
              query={{ q: q || undefined, status }}
            />
          }
        />
      </Card>

      {outstanding > 0 && (
        <Callout tone="info" title="Collecting dues">
          Outstanding balances update automatically as payments are recorded. Partial payments keep
          the invoice open until the full amount is settled, and every payment keeps a receipt
          reference for reconciliation.
        </Callout>
      )}
    </div>
  );
}
