import Link from "next/link";
import type { Invoice, Plan } from "@prisma/client";
import {
  ArrowUpRight,
  Check,
  CircleDollarSign,
  CreditCard,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import { changeTenantPlanAction } from "@/actions/admin";
import { getAiUsage, getBillingGateway } from "@/lib/billing";
import { usageSnapshot } from "@/lib/entitlements";
import { FEATURE_MAP } from "@/lib/catalog";
import { ActionForm } from "@/components/ui/action-form";
import { Field, FormGrid } from "@/components/ui/form-field";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  PageHeader,
  Progress,
  StatCard,
  statusLabel,
  statusTone,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { date, daysBetween, money, num } from "@/lib/format";

export const metadata = { title: "Subscription" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ blocked?: string; changed?: string }>;
}) {
  const ctx = await requireTenantPermission("tenant.billing.read");
  const sp = await searchParams;
  const tenantId = ctx.tenant.id;
  const subscription = ctx.tenant.subscription;
  const plan = subscription?.plan ?? null;
  const canManage = hasTenantPermission(ctx, "tenant.billing.manage");
  const gateway = getBillingGateway();

  const [plans, invoices, usage, aiUsage] = await Promise.all([
    db.plan.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" } }),
    db.invoice.findMany({
      where: { tenantId },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    usageSnapshot(tenantId),
    plan ? getAiUsage(tenantId, plan.aiCreditsMonthly) : Promise.resolve(null),
  ]);

  const trialLeft =
    subscription?.status === "TRIALING" && subscription.trialEndsAt
      ? daysBetween(new Date(), subscription.trialEndsAt)
      : null;
  const openInvoices = invoices.filter((invoice) => invoice.status === "OPEN");
  const outstanding = openInvoices.reduce((sum, invoice) => sum + invoice.total, 0);

  const invoiceColumns: Column<Invoice & { plan: Plan | null }>[] = [
    {
      key: "number",
      header: "Invoice",
      mobile: "title",
      render: (invoice) => (
        <div>
          <p className="font-mono text-[12px] font-medium">{invoice.number}</p>
          <p className="text-[10px] text-muted">
            {date(invoice.periodStart)} – {date(invoice.periodEnd)}
          </p>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      mobile: "subtitle",
      render: (invoice) => <span className="text-muted">{invoice.plan?.name ?? "—"}</span>,
    },
    {
      key: "subtotal",
      header: "Subtotal",
      align: "right",
      mobile: "detail",
      render: (invoice) => <span className="tabular-nums text-muted">{money(invoice.subtotal)}</span>,
    },
    {
      key: "tax",
      header: "GST",
      align: "right",
      mobile: "detail",
      render: (invoice) => <span className="tabular-nums text-muted">{money(invoice.tax)}</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      mobile: "detail",
      render: (invoice) => <span className="font-medium tabular-nums">{money(invoice.total)}</span>,
    },
    {
      key: "due",
      header: "Due",
      mobile: "detail",
      render: (invoice) => (
        <span
          className={
            invoice.status === "OPEN" && invoice.dueAt < new Date()
              ? "text-[var(--danger)]"
              : "text-muted"
          }
        >
          {date(invoice.dueAt)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobile: "hidden",
      render: (invoice) => (
        <Badge tone={statusTone(invoice.status)}>{statusLabel(invoice.status)}</Badge>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Subscription & billing"
        description="Your plan, entitlement usage and platform invoices. Billing is provider-agnostic and works manually until payment keys are added."
        actions={
          plan ? (
            <Badge tone={statusTone(subscription?.status ?? "ACTIVE")}>
              {statusLabel(subscription?.status ?? "ACTIVE")} · {plan.name}
            </Badge>
          ) : undefined
        }
      />

      {(sp.blocked || ctx.subscriptionBlocked) && (
        <Callout
          tone="danger"
          title="Writes are paused until billing is restored"
          icon={<TriangleAlert className="size-4" />}
        >
          Your subscription is{" "}
          <strong>{statusLabel(subscription?.status ?? "INACTIVE")}</strong>. Reading is still
          available. Choose a plan below to restore access — the platform team will confirm the
          payment and settle the invoice.
        </Callout>
      )}

      {sp.changed && (
        <Callout tone="success" title="Plan updated">
          Your new plan is active and the invoice has been raised. Check the invoice list below for
          the amount and due date.
        </Callout>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Current plan"
          value={plan?.name ?? "None"}
          sub={
            plan
              ? `${subscription?.billingCycle.toLowerCase()} · ${
                  subscription?.status === "TRIALING" && trialLeft !== null
                    ? `${Math.max(0, trialLeft)} trial days left`
                    : `renews ${date(subscription?.currentPeriodEnd)}`
                }`
              : "Choose a plan to activate the workspace"
          }
          icon={<CreditCard className="size-4" />}
        />
        <StatCard
          label="Students"
          value={num(usage.students)}
          sub={plan ? `of ${num(plan.maxStudents)} allowed` : "No plan limit"}
          icon={<CircleDollarSign className="size-4" />}
          tone={plan && usage.students / plan.maxStudents > 0.9 ? "warning" : "neutral"}
        />
        <StatCard
          label="AI credits"
          value={num(aiUsage?.remaining ?? 0)}
          sub={plan ? `${num(aiUsage?.used ?? 0)} of ${num(plan.aiCreditsMonthly)} used` : "—"}
          icon={<Sparkles className="size-4" />}
          tone={(aiUsage?.remaining ?? 0) > 0 ? "brand" : "danger"}
        />
        <StatCard
          label="Open invoices"
          value={num(openInvoices.length)}
          sub={openInvoices.length ? `${money(outstanding)} outstanding` : "Nothing due"}
          icon={<ReceiptText className="size-4" />}
          tone={openInvoices.length ? "warning" : "success"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Plan usage"
              description="Entitlements are enforced on every write, so limits can never be silently exceeded."
              action={
                <Link href="#plans" className="link text-xs">
                  Compare plans
                </Link>
              }
            />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">Students</span>
                    <span className="font-medium tabular-nums">
                      {num(usage.students)} / {num(plan?.maxStudents ?? 0)}
                    </span>
                  </div>
                  <Progress
                    className="mt-1.5"
                    value={usage.students}
                    max={plan?.maxStudents ?? 1}
                    tone={
                      plan && usage.students / plan.maxStudents > 0.9 ? "warning" : "brand"
                    }
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">Staff</span>
                    <span className="font-medium tabular-nums">
                      {num(usage.staff)} / {num(plan?.maxStaff ?? 0)}
                    </span>
                  </div>
                  <Progress
                    className="mt-1.5"
                    value={usage.staff}
                    max={plan?.maxStaff ?? 1}
                    tone={plan && usage.staff / plan.maxStaff > 0.9 ? "warning" : "brand"}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">AI credits this month</span>
                    <span className="font-medium tabular-nums">
                      {num(aiUsage?.used ?? 0)} / {num(plan?.aiCreditsMonthly ?? 0)}
                    </span>
                  </div>
                  <Progress
                    className="mt-1.5"
                    value={aiUsage?.used ?? 0}
                    max={plan?.aiCreditsMonthly || 1}
                    tone={
                      (aiUsage?.used ?? 0) > (plan?.aiCreditsMonthly ?? 0) * 0.85
                        ? "warning"
                        : "brand"
                    }
                  />
                </div>
              </div>

              <div className="rounded-xl bg-[var(--surface-2)] p-3 text-[11px] text-muted">
                <p className="flex items-center justify-between gap-2">
                  <span>Billing cycle</span>
                  <span className="font-medium text-[var(--text)]">
                    {statusLabel(subscription?.billingCycle ?? "MONTHLY")}
                  </span>
                </p>
                <p className="mt-2 flex items-center justify-between gap-2">
                  <span>Period start</span>
                  <span className="font-medium text-[var(--text)]">
                    {date(subscription?.currentPeriodStart)}
                  </span>
                </p>
                <p className="mt-2 flex items-center justify-between gap-2">
                  <span>Renews</span>
                  <span className="font-medium text-[var(--text)]">
                    {date(subscription?.currentPeriodEnd)}
                  </span>
                </p>
                <p className="mt-2 flex items-center justify-between gap-2">
                  <span>Payment provider</span>
                  <span className="font-medium text-[var(--text)]">{gateway.id}</span>
                </p>
                <p className="mt-2 flex items-center justify-between gap-2">
                  <span>Seats</span>
                  <span className="font-medium text-[var(--text)]">
                    {num(subscription?.seats ?? plan?.maxStaff ?? 0)}
                  </span>
                </p>
                {subscription?.trialEndsAt && (
                  <p className="mt-2 flex items-center justify-between gap-2">
                    <span>Trial ends</span>
                    <span className="font-medium text-[var(--text)]">
                      {date(subscription.trialEndsAt)}
                    </span>
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-[var(--border)] p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-2)]">
                Included in {plan?.name ?? "your plan"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(plan?.features ?? []).map((feature) => (
                  <Badge key={feature} tone="success">
                    <Check className="size-3" /> {FEATURE_MAP.get(feature)?.label ?? feature}
                  </Badge>
                ))}
                {(plan?.features.length ?? 0) === 0 && (
                  <span className="text-[11px] text-muted">No features configured.</span>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Platform invoices"
              description="GST invoices for your Knowletive subscription"
              action={
                <Badge tone={openInvoices.length ? "warning" : "success"}>
                  {openInvoices.length} open
                </Badge>
              }
            />
            <DataTable
              columns={invoiceColumns}
              rows={invoices}
              emptyTitle="No invoices yet"
              emptyDescription="Your first platform invoice appears here after a plan is activated."
            />
            <div className="border-t border-[var(--border)] px-4 py-3 text-[11px] text-muted">
              Invoices are raised with 18% GST. Bank-transfer payments are confirmed by the platform
              team, who then mark the invoice paid and roll the billing period forward.
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {canManage ? (
            <Card>
              <CardHeader
                title="Change plan"
                description="Upgrades apply immediately and raise a new invoice."
                action={<ShieldCheck className="size-4 text-[var(--muted)]" />}
              />
              <div className="p-4">
                <ActionForm
                  action={changeTenantPlanAction}
                  submitLabel="Change plan & invoice"
                  pendingLabel="Updating…"
                >
                  <FormGrid cols={1}>
                    <Field label="New plan" htmlFor="planId" required>
                      <select id="planId" name="planId" className="select" defaultValue={plan?.id ?? ""}>
                        <option value="">Choose a plan</option>
                        {plans.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} — {item.maxStudents} students ·{" "}
                            {item.priceMonthly ? `${money(item.priceMonthly)}/mo` : "custom"}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Billing cycle" htmlFor="cycle" required>
                      <select
                        id="cycle"
                        name="cycle"
                        className="select"
                        defaultValue={subscription?.billingCycle ?? "MONTHLY"}
                      >
                        <option value="MONTHLY">Monthly</option>
                        <option value="YEARLY">Yearly (2 months free)</option>
                      </select>
                    </Field>
                  </FormGrid>
                  <p className="text-[11px] text-muted">
                    Changing a plan resets the current period and raises an invoice for the new
                    amount. Entitlement changes apply immediately.
                  </p>
                </ActionForm>
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Billing access" />
              <p className="p-4 text-[12px] leading-relaxed text-muted">
                You can review the subscription but not change plans. Ask an institute admin for the
                Manage billing permission.
              </p>
            </Card>
          )}

          <Card>
            <CardHeader title="Payment method" description={`Provider: ${gateway.id}`} />
            <div className="space-y-3 p-4 text-[12px] text-muted">
              {gateway.id === "manual" ? (
                <>
                  <p>
                    Manual billing is active. Knowletive raises a GST invoice for each period and
                    your team pays by bank transfer.
                  </p>
                  <Link href="mailto:support@knowletive.com" className="btn btn-secondary w-full">
                    Contact accounts <ArrowUpRight className="size-3.5" />
                  </Link>
                  <p className="text-[10px] text-[var(--muted-2)]">
                    Add a payment gateway key and set BILLING_PROVIDER to switch checkout on without
                    any code changes.
                  </p>
                </>
              ) : (
                <p>
                  Checkout is handled by <strong>{gateway.id}</strong>. Contact support if a payment
                  does not reflect within 15 minutes.
                </p>
              )}
            </div>
          </Card>

          <Callout tone="info" title="Data safety">
            Downgrades never delete records. Modules outside the new plan become read-only until you
            upgrade again, and your invoices and audit history stay available.
          </Callout>
        </div>
      </div>

      <div id="plans" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Compare plans</h2>
            <p className="text-xs text-muted">
              Prices exclude 18% GST. Yearly billing includes two months free.
            </p>
          </div>
          {plan && <Badge tone="brand">You are on {plan.name}</Badge>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {plans.map((item) => {
            const current = item.id === plan?.id;
            return (
              <Card
                key={item.id}
                className={`flex flex-col ${current ? "ring-1 ring-[var(--brand)]" : ""}`}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{item.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {item.maxStudents ? `${num(item.maxStudents)} students` : "Custom"}
                      </p>
                    </div>
                    {current ? (
                      <Badge tone="brand">Current</Badge>
                    ) : item.highlighted ? (
                      <Badge tone="warning">Popular</Badge>
                    ) : null}
                  </div>
                  <p className="mt-3 text-2xl font-semibold tracking-tight">
                    {item.priceMonthly ? money(item.priceMonthly) : "Custom"}
                    {item.priceMonthly ? (
                      <span className="text-[11px] font-normal text-muted">/mo</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted">
                    {item.priceYearly
                      ? `${money(Math.round(item.priceYearly / 12))}/mo billed yearly`
                      : "Annual contract · talk to sales"}
                  </p>
                  <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted">
                    {item.description}
                  </p>
                </div>
                <div className="mt-auto space-y-2 border-t border-[var(--border)] p-4">
                  <div className="grid grid-cols-2 gap-2 text-[10px] text-muted">
                    <span>{num(item.maxStudents)} students</span>
                    <span>{num(item.maxStaff)} staff</span>
                    <span>{num(item.aiCreditsMonthly)} AI credits</span>
                    <span>{num(Math.round(item.maxStorageMb / 1024))} GB storage</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {item.features.slice(0, 5).map((feature) => (
                      <Badge key={feature} tone="neutral">
                        {FEATURE_MAP.get(feature)?.label ?? feature}
                      </Badge>
                    ))}
                    {item.features.length > 5 && (
                      <Badge tone="neutral">+{item.features.length - 5}</Badge>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
