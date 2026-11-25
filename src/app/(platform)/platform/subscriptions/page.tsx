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
  RotateCcw,
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
import { RaiseInvoiceModal } from "./raise-invoice-modal";

export const metadata = { title: "Subscriptions" };

const PAGE_SIZE = 12;

type SubscriptionRow = Prisma.TenantSubscriptionGetPayload<{
  include: { tenant: true; plan: true };
}>;

type InvoiceRow = Prisma.InvoiceGetPayload<{
  include: { tenant: true; plan: true };
}>;

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    filter?: string;
    gst?: string;
    page?: string;
  }>;
}) {
  await requirePlatformPermission("platform.subscriptions.read");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const currentFilter = (sp.filter || sp.status || "all").trim();
  const gstFilter = (sp.gst || "").trim();
  const page = safeInt(sp.page, 1, 10_000);
  const now = new Date();

  // ── Query counts for dynamic KPI badges and filter dropdowns ────
  const [
    totalAll,
    activeCount,
    trialCount,
    pastDueCount,
    mrrCount,
    allOpenInvoices,
    institutes,
    mrr,
  ] = await Promise.all([
    db.tenantSubscription.count(),
    db.tenantSubscription.count({ where: { status: "ACTIVE" } }),
    db.tenantSubscription.count({ where: { status: "TRIALING" } }),
    db.tenantSubscription.count({ where: { status: "PAST_DUE" } }),
    db.tenantSubscription.count({ where: { status: "ACTIVE", plan: { priceMonthly: { gt: 0 } } } }),
    db.invoice.findMany({
      where: { status: "OPEN" },
      include: { tenant: true, plan: true },
      orderBy: { dueAt: "asc" },
    }),
    db.tenant.findMany({
      where: { status: { not: "CHURNED" } },
      select: {
        id: true,
        name: true,
        city: true,
        subscription: { select: { plan: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    subscriptionMrr(),
  ]);

  const outstanding = allOpenInvoices.reduce((sum, inv) => sum + inv.total, 0);
  const overdueInvoices = allOpenInvoices.filter((inv) => inv.dueAt < now);

  // ── Build filtered query for subscriptions table based on selected KPI / Status ──
  let statusCondition: Prisma.TenantSubscriptionWhereInput = {};

  if (currentFilter === "active" || currentFilter === "ACTIVE") {
    statusCondition = { status: "ACTIVE" };
  } else if (currentFilter === "mrr") {
    statusCondition = { status: "ACTIVE", plan: { priceMonthly: { gt: 0 } } };
  } else if (currentFilter === "trialing" || currentFilter === "TRIALING") {
    statusCondition = { status: "TRIALING" };
  } else if (currentFilter === "past_due" || currentFilter === "PAST_DUE") {
    statusCondition = { status: "PAST_DUE" };
  } else if (currentFilter === "overdue") {
    statusCondition = {
      OR: [
        { status: "PAST_DUE" },
        { tenant: { invoices: { some: { status: "OPEN", dueAt: { lt: now } } } } },
      ],
    };
  } else if (currentFilter === "outstanding") {
    statusCondition = {
      tenant: { invoices: { some: { status: "OPEN" } } },
    };
  } else if (["PAUSED", "CANCELED", "EXPIRED"].includes(currentFilter.toUpperCase())) {
    statusCondition = { status: currentFilter.toUpperCase() as SubscriptionStatus };
  }

  // GST filter condition on subscriptions
  let gstCondition: Prisma.TenantSubscriptionWhereInput = {};
  if (gstFilter === "18") {
    gstCondition = {
      tenant: {
        invoices: {
          some: {
            tax: { gt: 0 },
            subtotal: { gt: 0 },
          },
        },
      },
    };
  } else if (gstFilter === "0") {
    gstCondition = {
      tenant: {
        invoices: {
          some: {
            tax: 0,
          },
        },
      },
    };
  } else if (gstFilter === "has_gst") {
    gstCondition = {
      tenant: {
        invoices: {
          some: {
            tax: { gt: 0 },
          },
        },
      },
    };
  }

  const where: Prisma.TenantSubscriptionWhereInput = {
    ...statusCondition,
    ...gstCondition,
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

  // ── Fetch paginated subscriptions and matching invoices ──────────
  const [totalFiltered, subscriptions, recentInvoices] = await Promise.all([
    db.tenantSubscription.count({ where }),
    db.tenantSubscription.findMany({
      where,
      include: { tenant: true, plan: true },
      orderBy: { currentPeriodEnd: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.invoice.findMany({
      where: {
        ...(gstFilter === "18"
          ? { tax: { gt: 0 } }
          : gstFilter === "0"
          ? { tax: 0 }
          : gstFilter === "has_gst"
          ? { tax: { gt: 0 } }
          : {}),
      },
      include: { tenant: true, plan: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  // Filter open invoices based on current view / GST filter
  const displayedOpenInvoices = allOpenInvoices.filter((inv) => {
    if (currentFilter === "overdue" && inv.dueAt >= now) return false;
    if (gstFilter === "18" && inv.tax <= 0) return false;
    if (gstFilter === "0" && inv.tax > 0) return false;
    if (gstFilter === "has_gst" && inv.tax <= 0) return false;
    if (q) {
      const qLower = q.toLowerCase();
      const match =
        inv.tenant.name.toLowerCase().includes(qLower) ||
        inv.number.toLowerCase().includes(qLower);
      if (!match) return false;
    }
    return true;
  });

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
        return <span className="tabular-nums font-medium">{money(monthly)}</span>;
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
      key: "charges",
      header: "Charges & GST",
      align: "right",
      mobile: "detail",
      render: (inv) => (
        <div className="text-right">
          <span className="tabular-nums font-semibold">{money(inv.total)}</span>
          <span className="block text-[10px] text-muted">
            Base {money(inv.subtotal)} {inv.tax > 0 ? `+ GST ${money(inv.tax)}` : "(0% GST)"}
          </span>
        </div>
      ),
    },
    {
      key: "due",
      header: "Due",
      mobile: "detail",
      render: (inv) => (
        <span className={inv.status === "OPEN" && inv.dueAt < now ? "text-[var(--danger)] font-medium" : "text-muted"}>
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
                    placeholder="e.g. Verified with accounts"
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

  // Helper function to build clean navigation URLs while preserving search queries
  const buildKpiUrl = (targetFilter: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (targetFilter !== "all") params.set("filter", targetFilter);
    if (gstFilter) params.set("gst", gstFilter);
    const qs = params.toString();
    return `/platform/subscriptions${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Revenue"
        title="Subscriptions"
        description="Every institute's plan, renewal date and platform invoice. Click any KPI to inspect corresponding data dynamically."
        actions={
          <div className="flex items-center gap-2">
            <RaiseInvoiceModal
              institutes={institutes.map((i) => ({
                id: i.id,
                name: i.name,
                city: i.city,
                planName: i.subscription?.plan?.name,
              }))}
            />
            <Link href="/platform/plans" className="btn btn-secondary">
              <CreditCard className="size-4" /> Plans & pricing
            </Link>
          </div>
        }
      />

      {/* ── Interactive Clickable KPI Cards ─────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Monthly recurring revenue"
          value={money(mrr)}
          sub={`${money(mrr * 12)} annualised`}
          icon={<TrendingUp className="size-4" />}
          tone="success"
          href={buildKpiUrl("mrr")}
          active={currentFilter === "mrr"}
        />
        <StatCard
          label="Active subscriptions"
          value={num(activeCount)}
          sub={`${trialCount} on trial · ${num(totalAll)} total`}
          icon={<CreditCard className="size-4" />}
          href={buildKpiUrl("active")}
          active={currentFilter === "active" || currentFilter === "ACTIVE"}
        />
        <StatCard
          label="Outstanding"
          value={money(outstanding)}
          sub={`${allOpenInvoices.length} open invoice${allOpenInvoices.length === 1 ? "" : "s"}`}
          icon={<CircleDollarSign className="size-4" />}
          tone={overdueInvoices.length ? "danger" : "neutral"}
          href={buildKpiUrl("outstanding")}
          active={currentFilter === "outstanding"}
        />
        <StatCard
          label="Overdue"
          value={num(overdueInvoices.length)}
          sub={overdueInvoices.length ? money(overdueInvoices.reduce((s, i) => s + i.total, 0)) : "Nothing overdue"}
          icon={<TriangleAlert className="size-4" />}
          tone={overdueInvoices.length ? "danger" : "success"}
          href={buildKpiUrl("overdue")}
          active={currentFilter === "overdue" || currentFilter === "past_due" || currentFilter === "PAST_DUE"}
        />
      </div>

      {/* ── Filter Form with KPI Categories & GST Select Options ── */}
      <form method="GET" className="card flex flex-col gap-2.5 p-3.5 sm:flex-row sm:items-center shadow-xs">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-2)]" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search institute name, slug or email…"
            className="input pl-8 text-xs"
            aria-label="Search subscriptions"
          />
        </div>

        <div className="flex flex-wrap sm:flex-nowrap gap-2 items-center">
          {/* KPI / Status Filter Select with Dynamic Counts */}
          <select
            name="filter"
            defaultValue={currentFilter}
            className="select sm:w-52 text-xs"
            aria-label="Filter by KPI or status"
          >
            <option value="all">All subscriptions ({totalAll})</option>
            <option value="active">Active subscriptions ({activeCount})</option>
            <option value="mrr">Paying MRR ({mrrCount})</option>
            <option value="trialing">On trial ({trialCount})</option>
            <option value="outstanding">Outstanding invoices ({allOpenInvoices.length})</option>
            <option value="overdue">Overdue ({overdueInvoices.length})</option>
            <option value="PAST_DUE">Past due ({pastDueCount})</option>
            <option value="PAUSED">Paused</option>
            <option value="CANCELED">Canceled</option>
            <option value="EXPIRED">Expired</option>
          </select>

          {/* GST Select Option Filter */}
          <select
            name="gst"
            defaultValue={gstFilter}
            className="select sm:w-44 text-xs"
            aria-label="Filter by GST option"
          >
            <option value="">All GST options</option>
            <option value="18">18% GST (Standard)</option>
            <option value="12">12% GST (Concessional)</option>
            <option value="5">5% GST (Reduced)</option>
            <option value="0">0% GST (Exempt)</option>
            <option value="has_gst">Any GST applied</option>
          </select>

          <button className="btn btn-secondary text-xs shrink-0" type="submit">
            Filter
          </button>

          {(q || currentFilter !== "all" || gstFilter) && (
            <Link
              href="/platform/subscriptions"
              className="btn btn-ghost text-xs text-muted hover:text-[var(--text)] shrink-0 inline-flex items-center gap-1"
              title="Reset all filters"
            >
              <RotateCcw className="size-3" /> Reset
            </Link>
          )}
        </div>
      </form>

      {/* ── Active KPI Filter Indicator Banner ───────────────────── */}
      {currentFilter !== "all" && (
        <div className="flex items-center justify-between rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-soft)]/20 px-4 py-2 text-xs">
          <span className="flex items-center gap-2 font-medium text-[var(--foreground)]">
            <Badge tone="brand">Active Filter</Badge>
            <span>
              Showing data for:{" "}
              <strong>
                {currentFilter === "mrr"
                  ? `Monthly Recurring Revenue (${num(mrrCount)} paying institutes)`
                  : currentFilter === "active"
                  ? `Active Subscriptions (${num(activeCount)} institutes)`
                  : currentFilter === "outstanding"
                  ? `Outstanding Invoices & Dues (${money(outstanding)})`
                  : currentFilter === "overdue"
                  ? `Overdue Subscriptions & Invoices (${num(overdueInvoices.length)} open)`
                  : currentFilter}
              </strong>
            </span>
          </span>
          <Link
            href="/platform/subscriptions"
            className="link text-xs font-semibold text-[var(--brand)] hover:underline"
          >
            Show all
          </Link>
        </div>
      )}

      {/* ── Main Subscriptions Table ─────────────────────────────── */}
      <DataTable
        columns={columns}
        rows={subscriptions}
        emptyTitle={q || currentFilter !== "all" || gstFilter ? "No subscriptions match those filters" : "No subscriptions yet"}
        emptyDescription={
          q || currentFilter !== "all" || gstFilter
            ? "Try resetting the filters to view all subscriptions."
            : "Create an institute to start a subscription."
        }
        footer={
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={totalFiltered}
            basePath="/platform/subscriptions"
            query={{ q, filter: currentFilter, gst: gstFilter }}
          />
        }
      />

      {/* ── Invoices Awaiting Payment Section ────────────────────── */}
      <Card>
        <CardHeader
          title="Invoices awaiting payment"
          description="Mark an invoice paid to record the payment and roll the subscription period forward."
          action={
            <Badge tone={displayedOpenInvoices.some((i) => i.dueAt < now) ? "danger" : "neutral"}>
              <ReceiptText className="size-3" /> {displayedOpenInvoices.length} open
            </Badge>
          }
        />
        <DataTable
          columns={invoiceColumns}
          rows={displayedOpenInvoices}
          emptyTitle="No open invoices"
          emptyDescription={
            currentFilter === "overdue"
              ? "No invoices are currently overdue."
              : "Every platform invoice in this view has been settled."
          }
        />
      </Card>

      {/* ── Recently Raised Invoices Section ─────────────────────── */}
      <Card>
        <CardHeader
          title="Recently raised invoices"
          description="Latest platform invoices with full GST and charges breakdown"
        />
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Institute</th>
                <th>Plan</th>
                <th className="text-right">Base Charges</th>
                <th className="text-right">GST</th>
                <th className="text-right">Total Payable</th>
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
                  <td className="text-right tabular-nums text-muted">
                    {inv.tax > 0 ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        {money(inv.tax)}
                      </span>
                    ) : (
                      <span className="text-muted">Exempt</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums font-semibold">{money(inv.total)}</td>
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
