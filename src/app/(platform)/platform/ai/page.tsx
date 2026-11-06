import Link from "next/link";
import { Bot, CircleGauge, Sparkles, Wand2 } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import { AI_FEATURE_MAP } from "@/lib/catalog";
import { num, timeAgo } from "@/lib/format";
import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
  Progress,
  StatCard,
} from "@/components/ui/primitives";
import { BarList } from "@/components/ui/charts";

export const metadata = { title: "AI usage" };

export default async function PlatformAiPage() {
  await requirePlatformPermission("platform.ai.read");

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [usage, jobs, totalJobs, featureGroups, tenants] = await Promise.all([
    db.tenantUsage.findMany({
      where: { periodStart: monthStart },
      include: {
        tenant: { include: { subscription: { include: { plan: true } } } },
      },
      orderBy: { aiCreditsUsed: "desc" },
    }),
    db.aiJob.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      include: { tenant: true, user: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    db.aiJob.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    db.aiJob.groupBy({
      by: ["feature"],
      where: { createdAt: { gte: thirtyDaysAgo } },
      _count: { _all: true },
      _sum: { credits: true },
    }),
    db.tenant.count({ where: { status: { not: "CHURNED" } } }),
  ]);

  const creditsUsed = usage.reduce((sum, u) => sum + u.aiCreditsUsed, 0);
  const creditsLimit = usage.reduce((sum, u) => sum + u.aiCreditsLimit, 0);
  const failed = jobs.filter((j) => j.status === "FAILED").length;
  const provider = process.env.AI_PROVIDER && process.env.OPENAI_API_KEY ? "openai" : "mock";

  const featureData = featureGroups
    .map((g) => ({
      label: AI_FEATURE_MAP.get(g.feature)?.label ?? g.feature,
      value: g._count._all,
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Intelligence"
        title="AI usage across the platform"
        description="Metered credits, module mix and recent generation activity. Every call is recorded against an institute and a user."
        actions={
          <Badge tone={provider === "openai" ? "success" : "brand"}>
            <Bot className="size-3" /> {provider === "openai" ? "Live model" : "Demo provider"}
          </Badge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Credits used this month"
          value={num(creditsUsed)}
          sub={`of ${num(creditsLimit)} allocated`}
          icon={<Sparkles className="size-4" />}
        />
        <StatCard
          label="Generations (30 days)"
          value={num(totalJobs)}
          sub={`${failed} failed in the latest ${jobs.length}`}
          icon={<Wand2 className="size-4" />}
          tone="info"
        />
        <StatCard
          label="Institutes using AI"
          value={`${usage.filter((u) => u.aiCreditsUsed > 0).length}/${num(tenants)}`}
          sub="active this month"
          icon={<CircleGauge className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Provider"
          value={provider === "openai" ? "OpenAI-compatible" : "Deterministic demo"}
          sub={provider === "openai" ? process.env.OPENAI_MODEL ?? "gpt-4o-mini" : "No API key required"}
          icon={<Bot className="size-4" />}
          tone={provider === "openai" ? "success" : "neutral"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader
            title="Credit consumption"
            description="Current billing month, by institute"
            action={<Badge tone="neutral">{usage.length} rows</Badge>}
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Institute</th>
                  <th>Plan</th>
                  <th className="w-48">Usage</th>
                  <th className="text-right">Used</th>
                  <th className="text-right">Limit</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => {
                  const plan = u.tenant.subscription?.plan;
                  const pctUsed = u.aiCreditsLimit ? Math.round((u.aiCreditsUsed / u.aiCreditsLimit) * 100) : 0;
                  return (
                    <tr key={u.id}>
                      <td>
                        <Link
                          href={`/platform/institutes/${u.tenantId}`}
                          className="font-medium hover:underline"
                        >
                          {u.tenant.name}
                        </Link>
                      </td>
                      <td className="text-muted">{plan?.name ?? "—"}</td>
                      <td>
                        <Progress
                          value={u.aiCreditsUsed}
                          max={u.aiCreditsLimit || 1}
                          tone={pctUsed > 90 ? "danger" : pctUsed > 70 ? "warning" : "brand"}
                        />
                        <p className="mt-1 text-[10px] text-muted">{pctUsed}% consumed</p>
                      </td>
                      <td className="text-right tabular-nums">{num(u.aiCreditsUsed)}</td>
                      <td className="text-right tabular-nums text-muted">{num(u.aiCreditsLimit)}</td>
                    </tr>
                  );
                })}
                {usage.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-muted">
                      No AI usage recorded this month.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Module mix" description="Generations by AI module, last 30 days" />
            <div className="p-4">
              <BarList data={featureData} />
            </div>
          </Card>
          <Card>
            <CardHeader title="What gets metered" description="Credit cost per module" />
            <div className="divide-y divide-[var(--border)]">
              {[...AI_FEATURE_MAP.values()].map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium">{f.label}</span>
                    <span className="block truncate text-[10px] text-muted">{f.description}</span>
                  </span>
                  <Badge tone="brand">{f.credits} cr</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Recent generations"
          description="Prompts and outputs are visible to platform owners for support and abuse review."
        />
        <div className="divide-y divide-[var(--border)]">
          {jobs.map((job) => {
            const feature = AI_FEATURE_MAP.get(job.feature);
            return (
              <details key={job.id} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-start gap-3">
                  <span
                    className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${
                      job.status === "FAILED"
                        ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                        : "bg-[var(--brand-soft)] text-[var(--brand)]"
                    }`}
                  >
                    <Sparkles className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold">{feature?.label ?? job.feature}</span>
                      <Badge tone={job.status === "FAILED" ? "danger" : "success"}>
                        {job.status.toLowerCase()}
                      </Badge>
                      <span className="text-[10px] text-muted">{job.credits} credits</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {job.tenant.name} · {job.user?.name ?? "Deleted user"} · {timeAgo(job.createdAt)}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-[10px] text-[var(--muted-2)] sm:block">
                    {job.durationMs ? `${job.durationMs} ms` : ""}
                  </span>
                </summary>
                <div className="mt-3 grid gap-3 pl-10 md:grid-cols-2">
                  <div className="rounded-xl bg-[var(--surface-2)] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Brief</p>
                    <p className="prose-block mt-1 text-[12px]">{job.prompt}</p>
                  </div>
                  <div className="rounded-xl bg-[var(--surface-2)] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Output</p>
                    <p className="prose-block mt-1 max-h-60 overflow-auto text-[12px]">
                      {job.output ?? job.error ?? "No output"}
                    </p>
                  </div>
                </div>
              </details>
            );
          })}
          {jobs.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-muted">No generations in the last 30 days.</p>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap gap-2 text-[11px] text-muted">
        <Badge tone="neutral">Cost visibility</Badge>
        <span>
          Credits are reserved atomically before a call and refunded automatically when the provider
          fails. Monthly limits come from the institute&apos;s plan.
        </span>
        <span className="hidden sm:inline">
          {num(creditsLimit - creditsUsed)} credits remaining across active plans this month.
        </span>
      </div>
    </div>
  );
}
