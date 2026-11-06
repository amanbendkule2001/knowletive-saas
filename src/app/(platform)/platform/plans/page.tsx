import Link from "next/link";
import { Check, Layers, Minus, Plus, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import { money, num } from "@/lib/format";
import { FEATURES } from "@/lib/catalog";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Plans & features" };

export default async function PlansPage() {
  await requirePlatformPermission("platform.plans.read");
  const plans = await db.plan.findMany({
    where: { isArchived: false },
    include: { _count: { select: { subscriptions: true } } },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Platform"
        title="Plans & features"
        description="Prices, limits and entitlements are data. Changes apply to every institute on the plan immediately."
        actions={
          <Link href="/platform/plans/new" className="btn btn-primary">
            <Plus className="size-4" /> New plan
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => (
          <Link
            key={plan.id}
            href={`/platform/plans/${plan.id}`}
            className={`card card-hover relative flex flex-col p-4 ${
              plan.highlighted ? "border-[var(--brand)] ring-2 ring-[var(--brand-soft)]" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{plan.name}</p>
                <p className="font-mono text-[10px] text-muted">{plan.key}</p>
              </div>
              {plan.highlighted && <Badge tone="brand">Popular</Badge>}
              {!plan.isPublic && <Badge tone="neutral">Private</Badge>}
            </div>
            <p className="mt-3 text-xl font-semibold tracking-tight">
              {plan.priceMonthly === 0 ? "Custom" : money(plan.priceMonthly)}
              {plan.priceMonthly > 0 && <span className="text-[11px] font-normal text-muted"> /mo</span>}
            </p>
            <p className="text-[10px] text-muted">
              {plan.priceYearly > 0 ? `${money(plan.priceYearly)} billed yearly` : "Annual contract"}
            </p>
            <div className="mt-3 space-y-1 border-t border-[var(--border)] pt-3 text-[11px] text-muted">
              <p>{num(plan.maxStudents)} students · {num(plan.maxStaff)} staff</p>
              <p>{num(plan.aiCreditsMonthly)} AI credits · {(plan.maxStorageMb / 1024).toFixed(0)} GB</p>
              <p>{plan.features.length} of {FEATURES.length} modules enabled</p>
            </div>
            <div className="mt-auto flex items-center justify-between pt-3">
              <span className="flex items-center gap-1 text-[11px] text-muted">
                <Users className="size-3" /> {plan._count.subscriptions} institute{plan._count.subscriptions === 1 ? "" : "s"}
              </span>
              <span className="link text-[11px]">Edit →</span>
            </div>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Entitlement matrix"
          description="Exactly what each plan unlocks. This is enforced by the AI, billing and module guards."
          action={<Badge tone="brand"><Layers className="size-3" /> {FEATURES.length} features</Badge>}
        />
        <div className="table-wrap">
          <table className="data-table min-w-[720px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--surface-2)]">Feature</th>
                {plans.map((p) => (
                  <th key={p.id} className="text-center">
                    <span className={p.highlighted ? "text-[var(--brand)]" : ""}>{p.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f) => (
                <tr key={f.key}>
                  <td className="sticky left-0 z-10 bg-[var(--surface)]">
                    <p className="text-[12px] font-medium">{f.label}</p>
                    <p className="text-[10px] text-muted">{f.group}</p>
                  </td>
                  {plans.map((p) => (
                    <td key={p.id} className="text-center">
                      {p.features.includes(f.key) ? (
                        <span className="inline-grid size-5 place-items-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">
                          <Check className="size-3" />
                        </span>
                      ) : (
                        <span className="inline-grid size-5 place-items-center text-[var(--muted-2)]">
                          <Minus className="size-3" />
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
