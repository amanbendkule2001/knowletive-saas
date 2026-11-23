import Link from "next/link";
import {
  ShieldCheck,
  Bot,
  Sparkles,
  ArrowLeft,
  Lock,
  History,
  Info,
} from "lucide-react";
import { db } from "@/lib/db";
import { getTenantContext } from "@/lib/auth";
import {
  isVerifiedInstituteOwner,
  isVerifiedPlatformOwner,
} from "@/lib/ai-permissions";
import { listTenantAiUsersAction } from "@/actions/ai-access";
import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
  Callout,
} from "@/components/ui/primitives";
import { date, timeAgo } from "@/lib/format";
import { AiAccessManager } from "./ai-access-manager";

export const metadata = { title: "AI & Copilot Access Management" };

export default async function AiAccessSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return (
      <div className="p-6">
        <Callout tone="danger">Session expired. Please sign in again.</Callout>
      </div>
    );
  }

  const isOwner = isVerifiedInstituteOwner(ctx);
  const isPlatform = isVerifiedPlatformOwner(ctx.user);
  const canManage = isOwner || isPlatform;

  if (!canManage) {
    return (
      <div className="space-y-5 max-w-4xl mx-auto">
        <PageHeader
          eyebrow="Administration / Settings"
          title="AI & Copilot Access"
          description="Institutional AI permissions are restricted."
          actions={
            <Link
              href="/app/settings"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <ArrowLeft className="size-3.5" /> Back to Settings
            </Link>
          }
        />
        <Card>
          <div className="p-8 text-center space-y-4">
            <div className="inline-flex items-center justify-center size-12 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Lock className="size-6" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--foreground)]">
              Institute Owner Access Required
            </h3>
            <p className="text-sm text-[var(--muted)] max-w-md mx-auto">
              Under Knowletive SaaS security policy, granting and revoking AI Copilot and analytics capabilities is strictly restricted to verified <strong>Institute Owners</strong> and <strong>Platform Owners</strong>.
            </p>
            <div className="pt-2">
              <Link
                href="/app/settings"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm font-medium hover:bg-[var(--hover-surface)]"
              >
                Return to Settings Overview
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Fetch initial members
  const usersRes = await listTenantAiUsersAction();
  const members = usersRes.ok && usersRes.members ? usersRes.members : [];

  // Fetch recent AI audit logs
  const auditLogs = await db.auditLog.findMany({
    where: {
      tenantId: ctx.tenant.id,
      action: {
        in: ["ai.permission.update", "ai.copilot.chat", "ai.job.create"],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration / Settings"
        title="AI & Copilot Access Management"
        description="Centralized governance for conversational AI Copilot access and granular analytics capabilities across your institute."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/app/settings"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--hover-surface)] transition-colors"
            >
              <ArrowLeft className="size-3.5" /> Back to Settings
            </Link>
            <Badge tone="brand">
              <ShieldCheck className="size-3" />
              {isPlatform ? "Platform Owner" : "Institute Owner"}
            </Badge>
          </div>
        }
      />

      {/* Access Policy Summary Banner */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            <Bot className="size-4 text-[var(--brand)]" />
            Default Policy
          </div>
          <div className="text-xl font-bold mt-2 text-[var(--foreground)]">
            Owner Only
          </div>
          <p className="text-xs text-[var(--muted)] mt-1">
            Institute Owners have default access. All other roles (Teachers, Students, Parents) are disabled until explicitly granted.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            <Sparkles className="size-4 text-emerald-500" />
            Active Users
          </div>
          <div className="text-xl font-bold mt-2 text-[var(--foreground)]">
            {members.filter((m) => m.hasCopilotAccess).length} / {members.length}
          </div>
          <p className="text-xs text-[var(--muted)] mt-1">
            Total active members with AI Copilot conversational capabilities enabled.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            <Lock className="size-4 text-amber-500" />
            Security Isolation
          </div>
          <div className="text-xl font-bold mt-2 text-[var(--foreground)]">
            Domain Guardrails
          </div>
          <p className="text-xs text-[var(--muted)] mt-1">
            AI grants never override underlying student, attendance, or financial permission checks.
          </p>
        </div>
      </div>

      {/* Main Interactive Access Manager */}
      <Card>
        <CardHeader
          title="Institute Member Directory & AI Permissions"
          description="Search members, toggle conversational Copilot, and assign granular module capabilities."
          action={<Bot className="size-4 text-[var(--muted)]" />}
        />
        <div className="p-4">
          <AiAccessManager initialMembers={members} isOwnerOrPlatform={canManage} />
        </div>
      </Card>

      {/* Audit Log Feed */}
      <Card>
        <CardHeader
          title="AI Activity & Governance Audit Trail"
          description="Tamper-evident record of permission changes, Copilot sessions, and automated actions."
          action={<History className="size-4 text-[var(--muted)]" />}
        />
        <div className="table-wrap">
          <table className="data-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted-surface)] text-[var(--muted)] text-xs uppercase tracking-wider">
                <th className="py-2.5 px-4 font-semibold">Timestamp</th>
                <th className="py-2.5 px-4 font-semibold">Actor</th>
                <th className="py-2.5 px-4 font-semibold">Action</th>
                <th className="py-2.5 px-4 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] text-xs">
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-[var(--muted)]">
                    No recent AI governance events recorded.
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => {
                  const meta = log.meta as Record<string, unknown> | null;
                  return (
                    <tr key={log.id} className="hover:bg-[var(--hover-surface)] transition-colors">
                      <td className="py-2.5 px-4 text-[var(--muted)] whitespace-nowrap">
                        {timeAgo(log.createdAt)} ({date(log.createdAt)})
                      </td>
                      <td className="py-2.5 px-4 font-medium text-[var(--foreground)]">
                        {log.actorName}
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge
                          tone={
                            log.action === "ai.permission.update"
                              ? "brand"
                              : log.action === "ai.copilot.chat"
                              ? "success"
                              : "neutral"
                          }
                          className="text-[10px]"
                        >
                          {log.action}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-[var(--muted)] font-mono text-[11px]">
                        {log.action === "ai.permission.update" && meta?.targetUserEmail ? (
                          <span>
                            Target: {String(meta.targetUserEmail)} (
                            {Array.isArray(meta.grantedAiPermissions)
                              ? `${meta.grantedAiPermissions.length} modules`
                              : "updated"}
                            )
                          </span>
                        ) : log.action === "ai.copilot.chat" && meta?.engine ? (
                          <span>
                            Engine: {String(meta.engine)} | Tokens: {String(meta.tokens ?? 0)}
                          </span>
                        ) : (
                          <span>{log.entity}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
