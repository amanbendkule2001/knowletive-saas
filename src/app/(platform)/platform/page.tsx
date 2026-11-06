import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  GraduationCap,
  Plus,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import { getBillingGateway, subscriptionMrr } from "@/lib/billing";
import { addDays, money, monthLabel, num, timeAgo } from "@/lib/format";
import { Card, CardHeader, PageHeader, StatCard, statusTone, Badge } from "@/components/ui/primitives";
import { AreaChart, Donut } from "@/components/ui/charts";

export const metadata = { title: "Platform overview" };

export default async function PlatformOverview() {
  await requirePlatformPermission("platform.overview.read");

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

  const [tenants, paidInvoices, openInvoices, usage, audit, plans, mrr] = await Promise.all([
    db.tenant.findMany({
      where: { status: { not: "CHURNED" } },
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { students: true, memberships: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.invoice.findMany({
      where: { status: "PAID", paidAt: { gte: sixMonthsAgo } },
      select: { total: true, paidAt: true },
    }),
    db.invoice.findMany({
      where: { status: "OPEN" },
      select: { total: true, dueAt: true, tenantId: true },
    }),
    db.tenantUsage.findMany({ where: { periodStart: monthStart } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
    db.plan.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" } }),
    subscriptionMrr(),
  ]);

  const active = tenants.filter((t) => t.status === "ACTIVE");
  const trials = tenants.filter((t) => t.status === "TRIAL");
  const suspended = tenants.filter((t) => t.status === "SUSPENDED");
  const totalStudents = tenants.reduce((s, t) => s + t._count.students, 0);
  const aiUsed = usage.reduce((s, u) => s + u.aiCreditsUsed, 0);
  const outstanding = openInvoices.reduce((s, i) => s + i.total, 0);

  const months: { label: string; key: string; value: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ label: monthLabel(d), key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, value: 0 });
  }
  for (const inv of paidInvoices) {
    if (!inv.paidAt) continue;
    const key = `${inv.paidAt.getUTCFullYear()}-${inv.paidAt.getUTCMonth()}`;
    const bucket = months.find((m) => m.key === key);
    if (bucket) bucket.value += inv.total;
  }

  const planMix = plans
    .map((p) => ({
      label: p.name,
      value: tenants.filter((t) => t.subscription?.planId === p.id).length,
    }))
    .filter((p) => p.value > 0);

  const needsAttention = [
    ...trials
      .filter((t) => t.trialEndsAt && t.trialEndsAt <= addDays(now, 7))
      .map((t) => ({
        id: `trial-${t.id}`,
        tenantId: t.id,
        label: t.name,
        detail: `Trial ends ${t.trialEndsAt ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(t.trialEndsAt) : "soon"}`,
        tone: "warning" as const,
      })),
    ...suspended.map((t) => ({
      id: `susp-${t.id}`,
      tenantId: t.id,
      label: t.name,
      detail: "Access suspended",
      tone: "danger" as const,
    })),
    ...openInvoices
      .filter((i) => i.dueAt < now)
      .slice(0, 4)
      .map((i) => {
        const t = tenants.find((x) => x.id === i.tenantId);
        return {
          id: `inv-${i.tenantId}-${i.total}`,
          tenantId: i.tenantId,
          label: t?.name ?? "Institute",
          detail: `${money(i.total)} overdue`,
          tone: "danger" as const,
        };
      }),
  ].slice(0, 6);

  const gateway = getBillingGateway();
  const aiMode = process.env.AI_PROVIDER && process.env.OPENAI_API_KEY ? "Live model" : "Demo mode";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Platform"
        title="Good to see you again"
        description="Every institute, subscription and AI credit in one view."
        actions={
          <Link href="/platform/institutes/new" className="btn btn-primary">
            <Plus className="size-4" /> New institute
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active institutes"
          value={num(active.length)}
          sub={`${trials.length} on trial · ${suspended.length} suspended`}
          icon={<Building2 className="size-4" />}
        />
        <StatCard
          label="Monthly recurring revenue"
          value={money(mrr)}
          sub={`${money(mrr * 12)} annualised`}
          icon={<TrendingUp className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Students under management"
          value={num(totalStudents)}
          sub={`${num(tenants.reduce((s, t) => s + t._count.memberships, 0))} staff accounts`}
          icon={<GraduationCap className="size-4" />}
          tone="info"
        />
        <StatCard
          label="Outstanding invoices"
          value={money(outstanding)}
          sub={`${openInvoices.length} open · ${openInvoices.filter((i) => i.dueAt < now).length} overdue`}
          icon={<CircleDollarSign className="size-4" />}
          tone={openInvoices.some((i) => i.dueAt < now) ? "danger" : "neutral"}
          href="/platform/subscriptions"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader
            title="Collected revenue"
            description="Paid platform invoices, last 6 months"
            action={<Badge tone="brand">GST inclusive</Badge>}
          />
          <div className="p-4">
            <AreaChart data={months.map((m) => ({ label: m.label, value: m.value }))} format="money" height={210} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Plan mix" description="Institutes by subscription plan" />
          <div className="p-4">
            <Donut
              segments={planMix.length ? planMix : [{ label: "No institutes", value: 1 }]}
              centerValue={num(tenants.length)}
              centerLabel="institutes"
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2">
                <p className="text-[10px] text-muted">AI credits used</p>
                <p className="text-sm font-semibold tabular-nums">{num(aiUsed)}</p>
              </div>
              <div className="rounded-lg bg-[var(--surface-2)] px-3 py-2">
                <p className="text-[10px] text-muted">Conversion rate</p>
                <p className="text-sm font-semibold tabular-nums">
                  {tenants.length ? Math.round((active.length / tenants.length) * 100) : 0}%
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Institutes"
            description="Newest workspaces across the platform"
            action={
              <Link href="/platform/institutes" className="link text-xs">
                View all
              </Link>
            }
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Institute</th>
                  <th>Plan</th>
                  <th>Students</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tenants.slice(0, 6).map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/platform/institutes/${t.id}`} className="group flex items-center gap-2.5">
                        <span
                          className="grid size-8 shrink-0 place-items-center rounded-lg text-[10px] font-bold text-white"
                          style={{ background: t.accentColor }}
                        >
                          {t.logoInitials}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium group-hover:underline">{t.name}</span>
                          <span className="block truncate text-[11px] text-muted">
                            {t.city ?? "—"} · {t.type.toLowerCase()}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="text-muted">{t.subscription?.plan.name ?? "—"}</td>
                    <td className="tabular-nums">{num(t._count.students)}</td>
                    <td>
                      <Badge tone={statusTone(t.status)}>{t.status.toLowerCase()}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Needs attention"
              description="Trials, suspensions and overdue invoices"
            />
            <div className="divide-y divide-[var(--border)]">
              {needsAttention.length === 0 && (
                <p className="px-4 py-8 text-center text-xs text-muted">Everything is healthy.</p>
              )}
              {needsAttention.map((item) => (
                <Link
                  key={item.id}
                  href={`/platform/institutes/${item.tenantId}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[var(--surface-2)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{item.label}</span>
                    <span className="block truncate text-[11px] text-muted">{item.detail}</span>
                  </span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-[var(--muted-2)]" />
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="System" description="Runtime configuration" />
            <div className="space-y-2 p-3.5">
              {[
                ["Database", "PostgreSQL · connected", "success"],
                ["Billing provider", `${gateway.id} (provider-agnostic)`, "brand"],
                ["AI provider", aiMode, "brand"],
                ["Audit trail", "Enabled", "success"],
              ].map(([label, value, tone]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted">{label}</span>
                  <Badge tone={tone as "success" | "brand"}>{value}</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent activity" action={<Link href="/platform/audit" className="link text-xs">Audit log</Link>} />
            <div className="divide-y divide-[var(--border)]">
              {audit.map((a) => (
                <div key={a.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <div className="min-w-0">
                    <p className="truncate text-[12px]">
                      <span className="font-medium">{a.actorName}</span>{" "}
                      <span className="text-muted">{a.action.replace(/\./g, " ")}</span>
                    </p>
                    <p className="text-[10px] text-[var(--muted-2)]">{timeAgo(a.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {trials.length > 0 && (
        <Card className="border-[color-mix(in_srgb,var(--warning)_25%,transparent)]">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid size-9 place-items-center rounded-lg bg-[var(--warning-soft)] text-[var(--warning)]">
                <AlertTriangle className="size-4" />
              </span>
              <div>
                <p className="text-[13px] font-semibold">{trials.length} institutes are on trial</p>
                <p className="text-xs text-muted">
                  Follow up before the trial ends to convert them to a paid plan.
                </p>
              </div>
            </div>
            <Link href="/platform/institutes?status=TRIAL" className="btn btn-secondary btn-sm">
              Review trials
            </Link>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <Sparkles className="size-3.5 text-[var(--brand)]" />
        Tip: use the institute switcher to open any workspace as platform owner — actions are still
        audited under your account.
      </div>
    </div>
  );
}
