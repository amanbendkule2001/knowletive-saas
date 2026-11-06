import Link from "next/link";
import type { Prisma, SubscriptionStatus } from "@prisma/client";
import {
  ArrowUpRight,
  CircleDollarSign,
  CreditCard,
  ReceiptText,
  Search,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import { markInvoicePaidAction } from "@/actions/platform";
import { subscriptionMrr } from "@/lib/billing";
import { date, money, num } from "@/lib/format";
import { safeInt } from "@/lib/utils";
import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
  Pagination,
  StatCard,
  statusTone,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";

export const metadata = { title: "Subscriptions" };

const PAGE_SIZE = 12;
const STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELED", "EXPIRED"] as const;

type SubscriptionRow = Prisma.TenantSubscriptionGetPayload<{
  include: { tenant: true; plan: true };
}>;

type InvoiceRow = Prisma.InvoiceGetPayload<{
  include: { tenant: true; plan: true };
}>;

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requirePlatformPermission("platform.subscriptions.read");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number])
    ? (sp.status as SubscriptionStatus)
    : undefined;
  const page = safeInt(sp.page, 1, 10_000);

  const where: Prisma.TenantSubscriptionWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          tenant: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { slug: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };

  const [total, subscriptions, openInvoices, recentInvoices, mrr, activeCount, trialCount] =
    await Promise.all([
      db.tenantSubscription.count({ where }),
      db.tenantSubscription.findMany({
        where,
        include: { tenant: true, plan: true },
        orderBy: { currentPeriodEnd: "asc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.invoice.findMany({
        where: { status: "OPEN" },
        include: { tenant: true, plan: true },
        orderBy: { dueAt: "asc" },
      }),
      db.invoice.findMany({
        include: { tenant: true, plan: true },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      subscriptionMrr(),
      db.tenantSubscription.count({ where: { status: "ACTIVE" } }),
      db.tenantSubscription.count({ where: { status: "TRIALING" } }),
    ]);

  const outstanding = openInvoices.reduce((sum, inv) => sum + inv.total, 0);
  const overdue = openInvoices.filter((inv) => inv.dueAt < new Date());

  const columns: Column<SubscriptionRow>[] = [
    {
      key: "tenant",
      header: "Institute",
      mobile: "title",
      render: (s) => (
        <Link href={`/platform/institutes/${s.tenantId}`} className="group block min-w-0">
          <span className="block truncate font-medium group-hover:underline">{s.tenant.name}</span>
          <span className="block truncate text-[11px] text-muted">
            {s.tenant.city ?? "—"} · {s.tenant.type.toLowerCase()}
          </span>
        </Link>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      mobile: "subtitle",
      render: (s) => (
        <span className="text-muted">
          {s.plan.name}
          <span className="ml-1 text-[10px] text-[var(--muted-2)]">
            · {s.billingCycle.toLowerCase()}
          </span>
        </span>
      ),
    },
    {
      key: "period",
      header: "Period ends",
      mobile: "detail",
      render: (s) => (
        <div>
          <p>{date(s.currentPeriodEnd)}</p>
          <p className="text-[10px] text-muted">
            {s.status === "TRIALING" && s.trialEndsAt
              ? `Trial · ${date(s.trialEndsAt)}`
              : `from ${date(s.currentPeriodStart)}`}
          </p>
        </div>
      ),
    },
    {
      key: "mrr",
      header: "MRR",
      align: "right",
      mobile: "detail",
      render: (s) => {
        if (s.status === "TRIALING") return <span className="text-muted">Trial</span>;
        const monthly =
          s.billingCycle === "YEARLY" ? Math.round(s.plan.priceYearly / 12) : s.plan.priceMonthly;
        return <span className="tabular-nums">{money(monthly)}</span>;
      },
    },
    {
      key: "status",
      header: "Status",
      mobile: "hidden",
      render: (s) => <Badge tone={statusTone(s.status)}>{s.status.replace(/_/g, " ").toLowerCase()}</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "hidden",
      render: (s) => (
        <Link href={`/platform/institutes/${s.tenantId}`} className="btn btn-secondary btn-sm">
          Manage <ArrowUpRight className="size-3" />
        </Link>
      ),
    },
  ];

  const invoiceColumns: Column<InvoiceRow>[] = [
    {
      key: "number",
      header: "Invoice",
      mobile: "title",
      render: (inv) => (
        <Link href={`/platform/institutes/${inv.tenantId}`} className="group block">
          <span className="block font-mono text-[12px] font-medium group-hover:underline">
            {inv.number}
          </span>
          <span className="block text-[10px] text-muted">{inv.tenant.name}</span>
        </Link>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      mobile: "subtitle",
      render: (inv) => <span className="text-muted">{inv.plan?.name ?? "—"}</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      mobile: "detail",
      render: (inv) => <span className="tabular-nums">{money(inv.total)}</span>,
    },
    {
      key: "due",
      header: "Due",
      mobile: "detail",
      render: (inv) => (
        <span className={inv.status === "OPEN" && inv.dueAt < new Date() ? "text-[var(--danger)]" : "text-muted"}>
          {date(inv.dueAt)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobile: "hidden",
      render: (inv) => <Badge tone={statusTone(inv.status)}>{inv.status.toLowerCase()}</Badge>,
    },
    {
      key: "action",
      header: "",
      align: "right",
      mobile: "hidden",
      render: (inv) =>
        inv.status === "OPEN" ? (
          <details className="relative inline-block text-left">
            <summary className="btn btn-secondary btn-sm cursor-pointer list-none select-none">
              Record payment
            </summary>
            <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
              <form action={markInvoicePaidAction} className="space-y-2 text-left">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <p className="text-xs font-semibold">Verify manual receipt</p>
                <div>
                  <label className="text-[10px] text-muted">UTR / Bank Reference</label>
                  <input
                    name="reference"
                    placeholder="e.g. UTR12984920"
                    required
                    className="input text-xs py-1 h-8"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted">Bank / Channel</label>
                  <input
                    name="bankName"
                    placeholder="e.g. HDFC NEFT / Cash"
                    className="input text-xs py-1 h-8"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted">Notes (optional)</label>
                  <input
                    name="notes"
                    placeholder="e.g. Verified by Accounts"
                    className="input text-xs py-1 h-8"
                  />
                </div>
                <button className="btn btn-primary btn-sm w-full mt-1" type="submit">
                  Confirm & activate
                </button>
              </form>
            </div>
          </details>
        ) : (
          <div className="text-right">
            <span className="block text-[11px] text-muted">{inv.paidAt ? date(inv.paidAt) : "—"}</span>
            {inv.providerRef && (
              <span className="block font-mono text-[9px] text-[var(--muted-2)] truncate max-w-[140px]" title={inv.providerRef}>
                {inv.providerRef}
              </span>
            )}
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Revenue"
        title="Subscriptions"
        description="Every institute's plan, renewal date and platform invoice. Manual billing is active until payment keys are configured."
        actions={
          <Link href="/platform/plans" className="btn btn-secondary">
            <CreditCard className="size-4" /> Plans & pricing
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Monthly recurring revenue"
          value={money(mrr)}
          sub={`${money(mrr * 12)} annualised`}
          icon={<TrendingUp className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Active subscriptions"
          value={num(activeCount)}
          sub={`${trialCount} on trial · ${num(total)} shown`}
          icon={<CreditCard className="size-4" />}
        />
        <StatCard
          label="Outstanding"
          value={money(outstanding)}
          sub={`${openInvoices.length} open invoice${openInvoices.length === 1 ? "" : "s"}`}
          icon={<CircleDollarSign className="size-4" />}
          tone={overdue.length ? "danger" : "neutral"}
        />
        <StatCard
          label="Overdue"
          value={num(overdue.length)}
          sub={overdue.length ? money(overdue.reduce((s, i) => s + i.total, 0)) : "Nothing overdue"}
          icon={<TriangleAlert className="size-4" />}
          tone={overdue.length ? "danger" : "success"}
        />
      </div>

      <form method="GET" className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-2)]" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search institute name, slug or email…"
            className="input pl-8"
            aria-label="Search subscriptions"
          />
        </div>
        <div className="flex gap-2">
          <select name="status" defaultValue={status ?? ""} className="select sm:w-40" aria-label="Filter status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" type="submit">
            Filter
          </button>
        </div>
      </form>

      <DataTable
        columns={columns}
        rows={subscriptions}
        emptyTitle={q || status ? "No subscriptions match those filters" : "No subscriptions yet"}
        emptyDescription={
          q || status
            ? "Try a different search or clear the filters."
            : "Create an institute to start a subscription."
        }
        footer={
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            basePath="/platform/subscriptions"
            query={{ q, status }}
          />
        }
      />

      <Card>
        <CardHeader
          title="Invoices awaiting payment"
          description="Mark an invoice paid to record the payment and roll the subscription period forward."
          action={
            <Badge tone={overdue.length ? "danger" : "neutral"}>
              <ReceiptText className="size-3" /> {openInvoices.length} open
            </Badge>
          }
        />
        <DataTable
          columns={invoiceColumns}
          rows={openInvoices}
          emptyTitle="No open invoices"
          emptyDescription="Every platform invoice has been settled."
        />
      </Card>

      <Card>
        <CardHeader title="Recently raised invoices" description="Latest 8 platform invoices" />
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Institute</th>
                <th>Plan</th>
                <th className="text-right">Subtotal</th>
                <th className="text-right">GST</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th>Reconciliation</th>
              </tr>
            </thead>
            <tbody>
              {recentInvoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="font-mono text-[12px]">{inv.number}</td>
                  <td>{inv.tenant.name}</td>
                  <td className="text-muted">{inv.plan?.name ?? "—"}</td>
                  <td className="text-right tabular-nums text-muted">{money(inv.subtotal)}</td>
                  <td className="text-right tabular-nums text-muted">{money(inv.tax)}</td>
                  <td className="text-right tabular-nums font-medium">{money(inv.total)}</td>
                  <td>
                    <Badge tone={statusTone(inv.status)}>{inv.status.toLowerCase()}</Badge>
                  </td>
                  <td className="text-[11px] text-muted font-mono max-w-[200px] truncate" title={inv.providerRef ?? ""}>
                    {inv.providerRef || "—"}
                  </td>
                </tr>
              ))}
              {recentInvoices.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-xs text-muted">
                    No invoices yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
