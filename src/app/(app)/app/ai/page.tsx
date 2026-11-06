import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bot,
  CircleGauge,
  History,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import { hasFeature } from "@/lib/entitlements";
import { getAiUsage } from "@/lib/billing";
import { AI_FEATURE_MAP, AI_FEATURES } from "@/lib/catalog";
import { deleteAiJobAction } from "@/actions/operations";
import { AiComposer } from "@/components/app/ai-composer";
import { ConfirmButton, CopyButton } from "@/components/ui/client-bits";
import { FeatureLocked } from "@/components/ui/feature-gate";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  PageHeader,
  Progress,
  StatCard,
  statusLabel,
} from "@/components/ui/primitives";
import { date, num, timeAgo } from "@/lib/format";

export const metadata = { title: "AI Studio" };

export default async function AiStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const ctx = await requireTenant();
  const canUse = hasTenantPermission(ctx, "tenant.ai.use");
  const canRead = canUse || hasTenantPermission(ctx, "tenant.ai.read");
  if (!canRead) redirect("/app/forbidden?p=tenant.ai.use");

  const plan = ctx.tenant.subscription?.plan;
  if (!plan || !hasFeature(plan, "ai")) {
    return <FeatureLocked feature="ai" title="AI Studio" />;
  }

  const sp = await searchParams;
  const [usage, jobs] = await Promise.all([
    getAiUsage(ctx.tenant.id, plan.aiCreditsMonthly),
    db.aiJob.findMany({
      where: { tenantId: ctx.tenant.id },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const selectedJob = sp.job
    ? (jobs.find((job) => job.id === sp.job) ??
      (await db.aiJob.findFirst({
        where: { id: sp.job, tenantId: ctx.tenant.id },
        include: { user: { select: { name: true } } },
      })))
    : null;

  const now = new Date();
  const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const provider = process.env.AI_PROVIDER === "openai" && process.env.OPENAI_API_KEY ? "openai" : "mock";
  const succeeded = jobs.filter((job) => job.status === "SUCCEEDED").length;
  const failed = jobs.filter((job) => job.status === "FAILED").length;
  const selectedFeature = selectedJob ? AI_FEATURE_MAP.get(selectedJob.feature) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Intelligence"
        title="AI Studio"
        description="Turn routine admin and teaching work into a first draft. Every run is metered, logged and reviewable."
        actions={
          <>
            <Badge tone={provider === "openai" ? "success" : "brand"}>
              <Bot className="size-3" /> {provider === "openai" ? "Live model" : "Demo provider"}
            </Badge>
            <Badge tone={usage.remaining > 0 ? "neutral" : "danger"}>
              {num(usage.remaining)} credits left
            </Badge>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Credits remaining"
          value={num(usage.remaining)}
          sub={`of ${num(usage.limit)} on ${plan.name}`}
          icon={<Sparkles className="size-4" />}
          tone={usage.remaining > 0 ? "brand" : "danger"}
        />
        <StatCard
          label="Used this month"
          value={num(usage.used)}
          sub={`Resets ${date(nextReset)}`}
          icon={<CircleGauge className="size-4" />}
          tone={usage.used > usage.limit * 0.85 ? "warning" : "neutral"}
        />
        <StatCard
          label="Generations"
          value={num(jobs.length)}
          sub={`${succeeded} succeeded · ${failed} failed`}
          icon={<Wand2 className="size-4" />}
          tone="info"
        />
        <StatCard
          label="Modules available"
          value={num(AI_FEATURES.length)}
          sub="report cards, lessons, fees and more"
          icon={<Bot className="size-4" />}
        />
      </div>

      {!canUse && (
        <Callout tone="info" title="Read-only AI access">
          You can review past generations but not run new ones. Ask an institute admin for the Use AI
          modules permission.
        </Callout>
      )}

      {canUse && usage.remaining <= 0 && (
        <Callout
          tone="danger"
          title="No AI credits left this month"
          icon={<TriangleAlert className="size-4" />}
        >
          Your plan includes {num(usage.limit)} credits per month. Credits reset on{" "}
          {date(nextReset)}. You can also{" "}
          <Link href="/app/billing" className="underline">
            upgrade the plan
          </Link>{" "}
          for a higher allowance.
        </Callout>
      )}

      <Card>
        <CardHeader
          title="Generate a draft"
          description="Pick a module, add the context only you know, and review the output before it leaves the school."
          action={<Sparkles className="size-4 text-[var(--brand)]" />}
        />
        <div className="p-4">
          {canUse ? (
            <AiComposer
              features={AI_FEATURES}
              creditsRemaining={usage.remaining}
              canUse={canUse}
            />
          ) : (
            <p className="text-[12px] text-muted">
              Your role can view AI history. To generate drafts, an institute admin needs to grant
              the Use AI modules permission.
            </p>
          )}
        </div>
      </Card>

      {selectedJob && (
        <Card>
          <CardHeader
            title={selectedFeature?.label ?? selectedJob.feature}
            description={`${selectedJob.user?.name ?? "Deleted user"} · ${date(selectedJob.createdAt)} · ${selectedJob.provider}${
              selectedJob.model ? `/${selectedJob.model}` : ""
            }`}
            action={
              <div className="flex items-center gap-1.5">
                {selectedJob.output && (
                  <CopyButton text={selectedJob.output} label="Copy output" />
                )}
                <form action={deleteAiJobAction}>
                  <input type="hidden" name="jobId" value={selectedJob.id} />
                  <ConfirmButton
                    className="btn btn-ghost btn-sm text-[var(--danger)]"
                    message="Delete this generation from the history? The action cannot be undone."
                  >
                    <Trash2 className="size-3.5" />
                    <span className="sr-only">Delete generation</span>
                  </ConfirmButton>
                </form>
              </div>
            }
          />
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
            <Badge tone={selectedJob.status === "FAILED" ? "danger" : "success"}>
              {statusLabel(selectedJob.status)}
            </Badge>
            <Badge tone="neutral">{selectedJob.credits} credits</Badge>
            {selectedJob.durationMs ? (
              <Badge tone="neutral">{num(selectedJob.durationMs)} ms</Badge>
            ) : null}
            {selectedJob.tokensOut ? (
              <Badge tone="neutral">{num(selectedJob.tokensOut)} tokens out</Badge>
            ) : null}
          </div>
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            <div className="rounded-xl bg-[var(--surface-2)] p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Brief</p>
              <p className="mt-1.5 whitespace-pre-line text-[12px] leading-relaxed">
                {selectedJob.prompt}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--surface-2)] p-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                {selectedJob.status === "FAILED" ? "Error" : "Draft output"}
              </p>
              <p className="mt-1.5 max-h-96 overflow-auto whitespace-pre-line text-[12px] leading-relaxed">
                {selectedJob.output ?? selectedJob.error ?? "No output was recorded."}
              </p>
            </div>
          </div>
          <div className="border-t border-[var(--border)] px-4 py-3 text-[11px] text-muted">
            AI output is a draft. Check names, marks, amounts and dates against school records before
            sharing with parents or students.
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader
            title="Recent generations"
            description="Every run is recorded against your name and the institute"
            action={
              <span className="flex items-center gap-1 text-[11px] text-muted">
                <History className="size-3" /> {jobs.length}
              </span>
            }
          />
          <div className="divide-y divide-[var(--border)]">
            {jobs.map((job) => {
              const feature = AI_FEATURE_MAP.get(job.feature);
              return (
                <Link
                  key={job.id}
                  href={`/app/ai?job=${job.id}`}
                  className={`flex items-start gap-3 px-4 py-3 transition hover:bg-[var(--surface-2)] ${
                    selectedJob?.id === job.id ? "bg-[var(--surface-2)]" : ""
                  }`}
                >
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
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-medium">
                        {feature?.label ?? job.feature}
                      </span>
                      {job.status === "FAILED" && <Badge tone="danger">Failed</Badge>}
                      <span className="text-[10px] text-muted">{job.credits} cr</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {job.prompt}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-[var(--muted-2)]">
                      {job.user?.name ?? "Deleted user"} · {timeAgo(job.createdAt)}
                    </span>
                  </span>
                </Link>
              );
            })}
            {jobs.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-semibold">No generations yet</p>
                <p className="mt-1 text-xs text-muted">
                  Your first draft will appear here with its prompt, output and credit cost.
                </p>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Credit meter"
              description="Monthly allowance from your plan"
              action={<Badge tone={usage.remaining > 0 ? "brand" : "danger"}>{num(usage.remaining)} left</Badge>}
            />
            <div className="p-4">
              <Progress
                value={usage.used}
                max={usage.limit || 1}
                tone={usage.used > usage.limit * 0.85 ? "warning" : "brand"}
              />
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                <span>{num(usage.used)} used</span>
                <span>{num(usage.limit)} total</span>
              </div>
              <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-3">
                {AI_FEATURES.map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="truncate text-muted">{item.label}</span>
                    <span className="shrink-0 tabular-nums">{item.credits} cr</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {provider === "mock" ? (
            <Callout tone="brand" title="Demo provider active">
              No AI key is configured, so Knowletive returns deterministic sample drafts. Add{" "}
              <code className="font-mono text-[10px]">AI_PROVIDER</code> and{" "}
              <code className="font-mono text-[10px]">OPENAI_API_KEY</code> to switch to a live model
              without changing this page.
            </Callout>
          ) : (
            <Callout tone="success" title="Live provider connected">
              Requests are billed to your provider account. Credits are reserved before the call and
              refunded automatically if the provider fails.
            </Callout>
          )}

          <Card>
            <CardHeader title="Use AI responsibly" />
            <ul className="space-y-2 p-4 text-[11px] text-muted">
              <li>• Never paste sensitive financial or medical data into prompts.</li>
              <li>• Review every draft before it is shared with a family.</li>
              <li>• Prompts and outputs are kept for support and abuse review.</li>
              <li>• Failed generations do not consume credits.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
