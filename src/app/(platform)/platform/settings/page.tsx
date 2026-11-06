import { Database, KeyRound, Server, ShieldCheck, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import { savePlatformSettingsAction } from "@/actions/platform";
import { changePasswordAction } from "@/actions/auth";
import { getBillingGateway } from "@/lib/billing";
import { ActionForm } from "@/components/ui/action-form";
import { Field, FormGrid } from "@/components/ui/form-field";
import { Badge, Callout, Card, CardHeader, PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Platform settings" };

type PlatformSettings = {
  name?: string;
  supportEmail?: string;
  defaultTrialDays?: number;
  billingProvider?: string;
  aiMode?: string;
};

function databaseHost() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return `${url.hostname}:${url.port || "5432"}/${url.pathname.replace(/^\//, "")}`;
  } catch {
    return "configured via DATABASE_URL";
  }
}

export default async function PlatformSettingsPage() {
  const user = await requirePlatformPermission("platform.settings.manage");
  const [setting, tenants, plans] = await Promise.all([
    db.setting.findUnique({ where: { key: "platform" } }),
    db.tenant.count({ where: { status: { not: "CHURNED" } } }),
    db.plan.count({ where: { isArchived: false } }),
  ]);

  const value = (setting?.value ?? {}) as PlatformSettings;
  const gateway = getBillingGateway();
  const aiProvider = process.env.AI_PROVIDER && process.env.OPENAI_API_KEY ? "openai" : "mock";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Governance"
        title="Platform settings"
        description="Identity, default trial length and runtime configuration for the platform console."
        actions={<Badge tone="brand"><ShieldCheck className="size-3" /> Owner controls</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Platform identity" description="Used in emails and the console header" />
            <div className="p-4">
              <ActionForm action={savePlatformSettingsAction} submitLabel="Save platform settings" pendingLabel="Saving…">
                <FormGrid>
                  <Field label="Platform name" htmlFor="name" required>
                    <input
                      id="name"
                      name="name"
                      className="input"
                      required
                      defaultValue={value.name ?? "Knowletive"}
                    />
                  </Field>
                  <Field label="Support email" htmlFor="supportEmail" required>
                    <input
                      id="supportEmail"
                      name="supportEmail"
                      type="email"
                      className="input"
                      required
                      defaultValue={value.supportEmail ?? "support@knowletive.com"}
                    />
                  </Field>
                  <Field
                    label="Default trial days"
                    htmlFor="defaultTrialDays"
                    hint="Applied to institutes created without an explicit trial length."
                  >
                    <input
                      id="defaultTrialDays"
                      name="defaultTrialDays"
                      type="number"
                      min={0}
                      max={90}
                      className="input"
                      defaultValue={value.defaultTrialDays ?? 14}
                    />
                  </Field>
                  <Field label="Signed in as" htmlFor="account">
                    <input id="account" className="input" value={user.email} readOnly disabled />
                  </Field>
                </FormGrid>
              </ActionForm>
            </div>
          </Card>

          <Card>
            <CardHeader title="Your account" description="Change the password for your platform login" />
            <div className="p-4">
              <ActionForm action={changePasswordAction} submitLabel="Update password" pendingLabel="Updating…">
                <FormGrid cols={1}>
                  <Field label="Current password" htmlFor="currentPassword" required>
                    <input
                      id="currentPassword"
                      name="currentPassword"
                      type="password"
                      className="input"
                      required
                      autoComplete="current-password"
                    />
                  </Field>
                  <Field label="New password" htmlFor="newPassword" required hint="At least 8 characters with a letter and a number.">
                    <input
                      id="newPassword"
                      name="newPassword"
                      type="password"
                      className="input"
                      required
                      minLength={8}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="Confirm new password" htmlFor="confirmPassword" required>
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      className="input"
                      required
                      autoComplete="new-password"
                    />
                  </Field>
                </FormGrid>
              </ActionForm>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Runtime" description="Environment-derived, read-only" />
            <div className="divide-y divide-[var(--border)]">
              {[
                {
                  icon: <Database className="size-4" />,
                  label: "Database",
                  value: databaseHost(),
                  hint: "PostgreSQL via Prisma",
                },
                {
                  icon: <Server className="size-4" />,
                  label: "Environment",
                  value: process.env.NODE_ENV ?? "development",
                  hint: "Use production builds behind HTTPS",
                },
                {
                  icon: <KeyRound className="size-4" />,
                  label: "Billing provider",
                  value: gateway.id,
                  hint: gateway.id === "manual" ? "Invoices + bank transfer" : "Keys configured",
                },
                {
                  icon: <Sparkles className="size-4" />,
                  label: "AI provider",
                  value: aiProvider === "openai" ? "OpenAI-compatible" : "Deterministic demo",
                  hint: aiProvider === "openai" ? "Metered per call" : "No key required",
                },
              ].map((row) => (
                <div key={row.label} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 text-[var(--muted)]">{row.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium">{row.label}</p>
                    <p className="truncate font-mono text-[10px] text-muted">{row.value}</p>
                    <p className="text-[10px] text-[var(--muted-2)]">{row.hint}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Platform footprint" />
            <div className="grid grid-cols-2 gap-3 p-4">
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted">Institutes</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{tenants}</p>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted">Active plans</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{plans}</p>
              </div>
            </div>
          </Card>

          <Callout tone="warning" title="Before going live">
            Set <code className="font-mono text-[11px]">BILLING_PROVIDER</code> and provider keys,
            configure an AI key or keep demo mode intentionally, terminate TLS at the proxy, and back
            up the database nightly. All three are environment changes — no redeploy code needed.
          </Callout>
        </div>
      </div>
    </div>
  );
}
