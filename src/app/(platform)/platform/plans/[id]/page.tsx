import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import { savePlanAction } from "@/actions/platform";
import { PlanForm } from "@/components/platform/plan-form";
import { Badge, Callout, Card, CardHeader, PageHeader, statusTone } from "@/components/ui/primitives";
import { date, money } from "@/lib/format";

export const metadata = { title: "Edit plan" };

export default async function EditPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  await requirePlatformPermission("platform.plans.read");
  const { id } = await params;
  const sp = await searchParams;

  const plan = await db.plan.findUnique({
    where: { id },
    include: {
      subscriptions: {
        include: { tenant: true },
        orderBy: { createdAt: "desc" },
        take: 8,
      },
      _count: { select: { subscriptions: true } },
    },
  });
  if (!plan) notFound();

  const canManage = true;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/platform/plans" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]">
        <ArrowLeft className="size-3.5" /> Plans
      </Link>

      {sp.created && (
        <Callout tone="success" title="Plan created">
          Assign it to an institute from the institute page, or leave it public for new signups.
        </Callout>
      )}

      <PageHeader
        eyebrow={`Created ${date(plan.createdAt)}`}
        title={plan.name}
        description={`${plan._count.subscriptions} institute${plan._count.subscriptions === 1 ? "" : "s"} · ${money(plan.priceMonthly)}/month · ${plan.features.length} modules`}
        actions={
          <>
            {plan.isPublic ? <Badge tone="success">Public</Badge> : <Badge tone="neutral">Private</Badge>}
            {plan.highlighted && <Badge tone="brand">Highlighted</Badge>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Card className="p-4 sm:p-5">
          <PlanForm plan={plan} action={savePlanAction} />
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Subscribers" description="Institutes currently on this plan" />
            <div className="divide-y divide-[var(--border)]">
              {plan.subscriptions.map((s) => (
                <Link
                  key={s.id}
                  href={`/platform/institutes/${s.tenantId}`}
                  className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-[var(--surface-2)]"
                >
                  <span
                    className="grid size-7 shrink-0 place-items-center rounded-md text-[9px] font-bold text-white"
                    style={{ background: s.tenant.accentColor }}
                  >
                    {s.tenant.logoInitials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">{s.tenant.name}</span>
                    <span className="block text-[10px] text-muted">{s.tenant.city ?? "—"}</span>
                  </span>
                  <Badge tone={statusTone(s.status)}>{s.status.toLowerCase()}</Badge>
                </Link>
              ))}
              {plan.subscriptions.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-muted">No institutes on this plan yet.</p>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <p className="text-[13px] font-semibold">Plan checklist</p>
            <ul className="mt-2 space-y-1.5 text-[11px] text-muted">
              <li>• Limits are enforced on create actions.</li>
              <li>• Feature toggles hide navigation and block APIs.</li>
              <li>• Prices are stored in minor units (paise).</li>
              <li>• GST (18%) is added to India invoices.</li>
              <li>• Billing provider reads the plan key.</li>
            </ul>
            {!canManage && (
              <p className="mt-2 text-[11px] text-[var(--danger)]">Read-only access.</p>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-[var(--brand)]" />
              <p className="text-[13px] font-semibold">Assign to an institute</p>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Open an institute and use “Change plan &amp; invoice” to move it onto this plan.
            </p>
            <Link href="/platform/institutes" className="btn btn-secondary btn-sm mt-3 w-full">
              Browse institutes
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
