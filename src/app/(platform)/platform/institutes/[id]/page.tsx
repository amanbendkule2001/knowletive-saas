import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Ban,
  Building2,
  ExternalLink,
  FileText,
  GraduationCap,
  KeyRound,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import {
  activateTenantAction,
  changeTenantPlanAction,
  createTenantInvoiceAction,
  extendTrialAction,
  markInvoicePaidAction,
  openWorkspaceAction,
  suspendTenantAction,
} from "@/actions/platform";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmButton } from "@/components/ui/client-bits";
import { Field, FormGrid } from "@/components/ui/form-field";
import {
  Avatar,
  Badge,
  Callout,
  Card,
  CardHeader,
  InfoRow,
  PageHeader,
  Progress,
  statusTone,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { date, daysBetween, money, num, timeAgo } from "@/lib/format";
import type { Invoice } from "@prisma/client";

export const metadata = { title: "Institute" };

export default async function InstituteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  await requirePlatformPermission("platform.institutes.read");
  const { id } = await params;
  const sp = await searchParams;

  const tenant = await db.tenant.findUnique({
    where: { id },
    include: {
      subscription: { include: { plan: true } },
      memberships: { include: { user: true, role: true }, orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }] },
      invoices: { orderBy: { createdAt: "desc" }, take: 10 },
      auditLogs: { orderBy: { createdAt: "desc" }, take: 8 },
      _count: { select: { students: true, memberships: true, guardians: true } },
    },
  });
  if (!tenant) notFound();

  const [plans, usage] = await Promise.all([
    db.plan.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" } }),
    db.tenantUsage.findFirst({ where: { tenantId: id }, orderBy: { periodStart: "desc" } }),
  ]);

  const sub = tenant.subscription;
  const plan = sub?.plan;
  const aiUsed = usage?.aiCreditsUsed ?? 0;
  const aiLimit = plan?.aiCreditsMonthly ?? 0;
  const trialLeft = sub?.trialEndsAt ? daysBetween(new Date(), sub.trialEndsAt) : null;

  const invoiceColumns: Column<Invoice>[] = [
    {
      key: "number",
      header: "Invoice",
      mobile: "title",
      render: (inv) => (
        <div>
          <p className="font-mono text-[12px] font-medium">{inv.number}</p>
          <p className="text-[10px] text-muted">
            {date(inv.periodStart)} – {date(inv.periodEnd)}
          </p>
        </div>
      ),
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
      render: (inv) => <span className="text-muted">{date(inv.dueAt)}</span>,
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
          <form action={markInvoicePaidAction}>
            <input type="hidden" name="invoiceId" value={inv.id} />
            <button className="btn btn-secondary btn-sm" type="submit">
              Mark paid
            </button>
          </form>
        ) : (
          <span className="text-[11px] text-muted">{inv.paidAt ? `Paid ${date(inv.paidAt)}` : "—"}</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <Link href="/platform/institutes" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]">
        <ArrowLeft className="size-3.5" /> All institutes
      </Link>

      {sp.created && (
        <Callout tone="success" title="Institute created">
          The workspace, subscription and admin account are ready. Share the admin&apos;s email and
          temporary password securely.
        </Callout>
      )}

      <PageHeader
        eyebrow={`${tenant.type.toLowerCase()} · ${tenant.city ?? "—"}`}
        title={tenant.name}
        description={`${tenant.email}${tenant.phone ? ` · ${tenant.phone}` : ""} · created ${date(tenant.createdAt)}`}
        actions={
          <>
            <Badge tone={statusTone(tenant.status)}>{tenant.status.toLowerCase()}</Badge>
            <form action={openWorkspaceAction}>
              <input type="hidden" name="tenantId" value={tenant.id} />
              <button className="btn btn-secondary" type="submit">
                <ExternalLink className="size-3.5" /> Open workspace
              </button>
            </form>
            {tenant.status === "SUSPENDED" ? (
              <form action={activateTenantAction}>
                <input type="hidden" name="tenantId" value={tenant.id} />
                <button className="btn btn-primary" type="submit">
                  Reactivate
                </button>
              </form>
            ) : (
              <form action={suspendTenantAction}>
                <input type="hidden" name="tenantId" value={tenant.id} />
                <ConfirmButton
                  className="btn btn-danger-soft"
                  message={`Suspend ${tenant.name}? Institute users will lose access immediately (platform owners keep support access).`}
                >
                  <Ban className="size-3.5" /> Suspend
                </ConfirmButton>
              </form>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Students</span>
            <GraduationCap className="size-4 text-[var(--brand)]" />
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{num(tenant._count.students)}</p>
          <p className="text-[11px] text-muted">of {num(plan?.maxStudents ?? 0)} allowed</p>
          <Progress className="mt-2" value={tenant._count.students} max={plan?.maxStudents ?? 1} />
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Staff & parents</span>
            <Users className="size-4 text-[var(--info)]" />
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{num(tenant._count.memberships)}</p>
          <p className="text-[11px] text-muted">{num(tenant._count.guardians)} guardians · {num(plan?.maxStaff ?? 0)} staff limit</p>
          <Progress className="mt-2" value={tenant._count.memberships} max={plan?.maxStaff ?? 1} tone="brand" />
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>AI credits</span>
            <Sparkles className="size-4 text-[var(--brand)]" />
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{num(aiUsed)}</p>
          <p className="text-[11px] text-muted">of {num(aiLimit)} this month</p>
          <Progress className="mt-2" value={aiUsed} max={aiLimit || 1} tone={aiUsed > aiLimit * 0.85 ? "warning" : "brand"} />
        </div>
        <div className="card p-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Storage</span>
            <Building2 className="size-4 text-[var(--success)]" />
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {((plan?.maxStorageMb ?? 0) / 1024).toFixed(0)} GB
          </p>
          <p className="text-[11px] text-muted">Document metering landing soon</p>
          <Progress className="mt-2" value={0} max={1} tone="success" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Subscription"
              description="Plan, entitlement limits and billing cycle"
              action={<Badge tone={statusTone(sub?.status ?? "ACTIVE")}>{sub?.status.toLowerCase() ?? "none"}</Badge>}
            />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted">Current plan</p>
                <p className="mt-1 text-lg font-semibold">{plan?.name ?? "No plan"}</p>
                <p className="text-xs text-muted">
                  {plan ? money(plan.priceMonthly) + " / month" : "—"} · {sub?.billingCycle.toLowerCase() ?? "—"}
                </p>
                <div className="mt-3 space-y-1 text-[11px] text-muted">
                  <p>Period: {date(sub?.currentPeriodStart)} → {date(sub?.currentPeriodEnd)}</p>
                  <p>
                    {sub?.status === "TRIALING"
                      ? `Trial ends in ${Math.max(0, trialLeft ?? 0)} days`
                      : `Renews ${date(sub?.currentPeriodEnd)}`}
                  </p>
                  <p>Provider: {sub?.provider ?? "manual"}</p>
                </div>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted">Extend trial</p>
                <form action={extendTrialAction} className="mt-2 flex items-center gap-2">
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <select name="days" defaultValue="7" className="select h-9 flex-1 py-1 text-xs" aria-label="Trial days">
                    <option value="7">+7 days</option>
                    <option value="14">+14 days</option>
                    <option value="30">+30 days</option>
                  </select>
                  <button className="btn btn-secondary btn-sm" type="submit">
                    Extend
                  </button>
                </form>
                <p className="mt-2 text-[10px] text-muted">
                  Moves the subscription back to trialing and updates the institute status.
                </p>
              </div>
            </div>

            <div className="border-t border-[var(--border)] p-4">
              <ActionForm
                action={changeTenantPlanAction}
                submitLabel="Change plan & invoice"
                pendingLabel="Updating…"
              >
                <input type="hidden" name="tenantId" value={tenant.id} />
                <FormGrid>
                  <Field label="New plan" htmlFor="planId">
                    <select id="planId" name="planId" className="select" defaultValue={plan?.id}>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {p.maxStudents} students · {money(p.priceMonthly)}/mo
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Billing cycle" htmlFor="cycle">
                    <select id="cycle" name="cycle" className="select" defaultValue={sub?.billingCycle ?? "MONTHLY"}>
                      <option value="MONTHLY">Monthly</option>
                      <option value="YEARLY">Yearly (2 months free)</option>
                    </select>
                  </Field>
                </FormGrid>
              </ActionForm>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Invoices"
              description="Platform subscription invoices raised for this institute"
              action={
                <form action={createTenantInvoiceAction}>
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <button className="btn btn-secondary btn-sm" type="submit">
                    <Plus className="size-3.5" /> Raise invoice
                  </button>
                </form>
              }
            />
            <DataTable
              columns={invoiceColumns}
              rows={tenant.invoices}
              emptyTitle="No invoices yet"
              emptyDescription="Raise an invoice for the current billing period."
            />
          </Card>

          <Card>
            <CardHeader title="Institute audit trail" description="Latest events recorded for this tenant" />
            <div className="divide-y divide-[var(--border)]">
              {tenant.auditLogs.map((a) => (
                <div key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-[var(--surface-2)] text-[9px] font-semibold text-muted">
                    {a.actorName.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px]">
                      <span className="font-medium">{a.actorName}</span>{" "}
                      <span className="text-muted">{a.action.replace(/\./g, " ")}</span>
                      {a.entity && <span className="text-[var(--muted-2)]"> · {a.entity}</span>}
                    </p>
                    <p className="text-[10px] text-[var(--muted-2)]">
                      {timeAgo(a.createdAt)} · {a.actorType.toLowerCase()}
                    </p>
                  </div>
                </div>
              ))}
              {tenant.auditLogs.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-muted">No activity yet.</p>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Workspace details" />
            <div className="divide-y divide-[var(--border)] px-4 py-1">
              <InfoRow label="Slug">
                <span className="font-mono text-[12px]">{tenant.slug}</span>
              </InfoRow>
              <InfoRow label="Type">{tenant.type.toLowerCase()}</InfoRow>
              <InfoRow label="Country">{tenant.country}</InfoRow>
              <InfoRow label="Timezone">{tenant.timezone}</InfoRow>
              <InfoRow label="Currency">{tenant.currency}</InfoRow>
              <InfoRow label="Address">
                {[tenant.address, tenant.city, tenant.state].filter(Boolean).join(", ") || "—"}
              </InfoRow>
              <InfoRow label="Website">
                {tenant.website ? (
                  <a href={tenant.website} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1">
                    Visit <ArrowUpRight className="size-3" />
                  </a>
                ) : (
                  "—"
                )}
              </InfoRow>
              <InfoRow label="Trial ends">{tenant.trialEndsAt ? date(tenant.trialEndsAt) : "—"}</InfoRow>
            </div>
          </Card>

          <Card>
            <CardHeader title="Team" description={`${tenant.memberships.length} accounts`} />
            <div className="divide-y divide-[var(--border)]">
              {tenant.memberships.map((m) => (
                <div key={m.id} className="flex items-center gap-2.5 px-4 py-2.5">
                  <Avatar name={m.user.name} color={m.user.avatarColor} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{m.user.name}</p>
                    <p className="truncate text-[10px] text-muted">{m.user.email}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-medium">{m.role.name}</p>
                    {m.isOwner && <p className="text-[9px] text-[var(--brand)]">Owner</p>}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Support quick actions" />
            <div className="space-y-2 p-3.5">
              <form action={openWorkspaceAction}>
                <input type="hidden" name="tenantId" value={tenant.id} />
                <button className="btn btn-secondary w-full justify-start" type="submit">
                  <KeyRound className="size-3.5" /> Support access to workspace
                </button>
              </form>
              <Link href={`/platform/subscriptions?tenant=${tenant.id}`} className="btn btn-secondary w-full justify-start">
                <FileText className="size-3.5" /> Billing history
              </Link>
              <p className="px-1 pt-1 text-[10px] leading-relaxed text-muted">
                Support access is read/write and recorded in the institute audit trail under your
                platform identity.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
