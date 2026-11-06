import Link from "next/link";
import {
  Building2,
  KeyRound,
  Palette,
  ScrollText,
  ShieldCheck,
  UserRound,
  Landmark,
  Image as ImageIcon,
  Upload,
  Trash2,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import { saveInstitutionSettingsAction, updateProfileAction } from "@/actions/admin";
import { changePasswordAction } from "@/actions/auth";
import { uploadSchoolLogoAction, deleteSchoolLogoAction } from "@/actions/storage";
import { ActionForm } from "@/components/ui/action-form";
import { Field, FormGrid } from "@/components/ui/form-field";
import {
  Avatar,
  Badge,
  Callout,
  Card,
  CardHeader,
  InfoRow,
  PageHeader,
  statusLabel,
  statusTone,
} from "@/components/ui/primitives";
import { date, num, timeAgo } from "@/lib/format";

export const metadata = { title: "Settings" };

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
  "UTC",
];

const CURRENCIES = ["INR", "USD", "AED", "GBP"];

export default async function TenantSettingsPage() {
  const ctx = await requireTenantPermission("tenant.settings.read");
  const canManage = hasTenantPermission(ctx, "tenant.settings.manage");
  const canViewAudit = hasTenantPermission(ctx, "tenant.audit.read");
  const tenant = ctx.tenant;
  const plan = tenant.subscription?.plan;
  const settings =
    tenant.settings && typeof tenant.settings === "object" && !Array.isArray(tenant.settings)
      ? (tenant.settings as Record<string, unknown>)
      : {};
  const academicYear =
    typeof settings.academicYear === "string" ? settings.academicYear : "";
  const upiVpa = typeof settings.upiVpa === "string" ? settings.upiVpa : "";
  const bankName = typeof settings.bankName === "string" ? settings.bankName : "";
  const accountNumber = typeof settings.accountNumber === "string" ? settings.accountNumber : "";
  const ifscCode = typeof settings.ifscCode === "string" ? settings.ifscCode : "";
  const accountHolder = typeof settings.accountHolder === "string" ? settings.accountHolder : "";
  const logoFileId = typeof settings.logoFileId === "string" ? settings.logoFileId : null;

  const audit = canViewAudit
    ? await db.auditLog.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Institute identity, branded workspace preferences, your profile and the security controls behind them."
        actions={
          <Badge tone="brand">
            <ShieldCheck className="size-3" /> {ctx.membership?.roleName ?? "Member"}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Institute profile"
              description="Shown on the workspace, notices and invoices."
              action={<Building2 className="size-4 text-[var(--muted)]" />}
            />
            {canManage ? (
              <div className="p-4">
                <ActionForm
                  action={saveInstitutionSettingsAction}
                  submitLabel="Save institute settings"
                  pendingLabel="Saving…"
                >
                  <FormGrid>
                    <Field label="Institute name" htmlFor="name" required>
                      <input
                        id="name"
                        name="name"
                        className="input"
                        defaultValue={tenant.name}
                        maxLength={120}
                        required
                      />
                    </Field>
                    <Field label="Contact email" htmlFor="email" required>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        className="input"
                        defaultValue={tenant.email}
                        required
                      />
                    </Field>
                    <Field label="Phone" htmlFor="phone">
                      <input
                        id="phone"
                        name="phone"
                        type="tel"
                        className="input"
                        defaultValue={tenant.phone ?? ""}
                        maxLength={20}
                      />
                    </Field>
                    <Field label="Website" htmlFor="website">
                      <input
                        id="website"
                        name="website"
                        className="input"
                        defaultValue={tenant.website ?? ""}
                        placeholder="https://"
                        maxLength={160}
                      />
                    </Field>
                    <Field label="Address" htmlFor="address">
                      <input
                        id="address"
                        name="address"
                        className="input"
                        defaultValue={tenant.address ?? ""}
                        maxLength={200}
                      />
                    </Field>
                    <Field label="City" htmlFor="city">
                      <input
                        id="city"
                        name="city"
                        className="input"
                        defaultValue={tenant.city ?? ""}
                        maxLength={80}
                      />
                    </Field>
                    <Field label="State" htmlFor="state">
                      <input
                        id="state"
                        name="state"
                        className="input"
                        defaultValue={tenant.state ?? ""}
                        maxLength={80}
                      />
                    </Field>
                    <Field label="Academic year" htmlFor="academicYear" hint="e.g. 2026-27">
                      <input
                        id="academicYear"
                        name="academicYear"
                        className="input"
                        defaultValue={academicYear}
                        maxLength={20}
                        placeholder="2026-27"
                      />
                    </Field>
                    <Field label="Timezone" htmlFor="timezone" required>
                      <select
                        id="timezone"
                        name="timezone"
                        className="select"
                        defaultValue={tenant.timezone}
                      >
                        {TIMEZONES.map((timezone) => (
                          <option key={timezone} value={timezone}>
                            {timezone}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Currency" htmlFor="currency" required>
                      <select
                        id="currency"
                        name="currency"
                        className="select"
                        defaultValue={tenant.currency}
                      >
                        {CURRENCIES.map((currency) => (
                          <option key={currency} value={currency}>
                            {currency}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label="Accent colour"
                      htmlFor="accentColor"
                      hint="Used for avatars and highlights in this workspace."
                    >
                      <input
                        id="accentColor"
                        name="accentColor"
                        type="color"
                        className="input h-10 p-1"
                        defaultValue={tenant.accentColor}
                      />
                    </Field>
                    <Field label="Logo initials" htmlFor="logoInitials" hint="Generated from the name. Contact support to change manually.">
                      <input
                        id="logoInitials"
                        className="input"
                        defaultValue={tenant.logoInitials}
                        readOnly
                        disabled
                      />
                    </Field>
                  </FormGrid>
                  <p className="text-[11px] text-muted">
                    Saving recalculates the logo initials from the institute name and updates the
                    workspace branding immediately.
                  </p>
                </ActionForm>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)] px-4 py-1">
                <InfoRow label="Name">{tenant.name}</InfoRow>
                <InfoRow label="Email">{tenant.email}</InfoRow>
                <InfoRow label="Phone">{tenant.phone ?? "—"}</InfoRow>
                <InfoRow label="Website">
                  {tenant.website ? (
                    <a href={tenant.website} target="_blank" rel="noreferrer" className="link">
                      {tenant.website}
                    </a>
                  ) : (
                    "—"
                  )}
                </InfoRow>
                <InfoRow label="Address">
                  {[tenant.address, tenant.city, tenant.state].filter(Boolean).join(", ") || "—"}
                </InfoRow>
                <InfoRow label="Academic year">{academicYear || "—"}</InfoRow>
                <InfoRow label="Timezone">{tenant.timezone}</InfoRow>
                <InfoRow label="Currency">{tenant.currency}</InfoRow>
              </div>
            )}
          </Card>

          {/* ── Payment Settings ───────────────────────────────────── */}
          <Card>
            <CardHeader
              title="Payment collection"
              description="UPI and bank details shown on the public fee payment page."
              action={<Landmark className="size-4 text-[var(--muted)]" />}
            />
            {canManage ? (
              <div className="p-4">
                <ActionForm
                  action={saveInstitutionSettingsAction}
                  submitLabel="Save payment details"
                  pendingLabel="Saving…"
                >
                  <FormGrid>
                    <Field label="UPI VPA / ID" htmlFor="upiVpa" hint="e.g. schoolname@okicici">
                      <input
                        id="upiVpa"
                        name="upiVpa"
                        className="input"
                        defaultValue={upiVpa}
                        placeholder="school@upi"
                        maxLength={80}
                      />
                    </Field>
                    <Field label="Account holder name" htmlFor="accountHolder">
                      <input
                        id="accountHolder"
                        name="accountHolder"
                        className="input"
                        defaultValue={accountHolder}
                        placeholder={tenant.name}
                        maxLength={120}
                      />
                    </Field>
                    <Field label="Bank name" htmlFor="bankName">
                      <input
                        id="bankName"
                        name="bankName"
                        className="input"
                        defaultValue={bankName}
                        placeholder="State Bank of India"
                        maxLength={80}
                      />
                    </Field>
                    <Field label="Account number" htmlFor="accountNumber">
                      <input
                        id="accountNumber"
                        name="accountNumber"
                        className="input"
                        defaultValue={accountNumber}
                        placeholder="XXXXXX"
                        maxLength={30}
                      />
                    </Field>
                    <Field label="IFSC code" htmlFor="ifscCode" hint="11-character bank branch code">
                      <input
                        id="ifscCode"
                        name="ifscCode"
                        className="input"
                        defaultValue={ifscCode}
                        placeholder="SBIN0001234"
                        maxLength={11}
                      />
                    </Field>
                  </FormGrid>
                </ActionForm>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)] px-4 py-1">
                <InfoRow label="UPI VPA">{upiVpa || "—"}</InfoRow>
                <InfoRow label="Bank">{bankName || "—"}</InfoRow>
                <InfoRow label="Account">{accountNumber || "—"}</InfoRow>
                <InfoRow label="IFSC">{ifscCode || "—"}</InfoRow>
              </div>
            )}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader
                title="Your profile"
                description="Visible to teammates in this institute."
                action={<UserRound className="size-4 text-[var(--muted)]" />}
              />
              <div className="p-4">
                <div className="mb-4 flex items-center gap-3">
                  <Avatar name={ctx.user.name} color={ctx.user.avatarColor} size={44} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{ctx.user.name}</p>
                    <p className="truncate text-[11px] text-muted">{ctx.user.email}</p>
                  </div>
                </div>
                <ActionForm
                  action={updateProfileAction}
                  submitLabel="Save profile"
                  pendingLabel="Saving…"
                >
                  <FormGrid cols={1}>
                    <Field label="Full name" htmlFor="profileName" required>
                      <input
                        id="profileName"
                        name="name"
                        className="input"
                        defaultValue={ctx.user.name}
                        maxLength={80}
                        required
                      />
                    </Field>
                    <Field label="Email" htmlFor="profileEmail" hint="Contact the platform team to change your login email.">
                      <input
                        id="profileEmail"
                        className="input"
                        defaultValue={ctx.user.email}
                        disabled
                      />
                    </Field>
                    <Field
                      label="Avatar colour"
                      htmlFor="avatarColor"
                      hint="Personal preference, separate from the institute accent."
                    >
                      <input
                        id="avatarColor"
                        name="avatarColor"
                        type="color"
                        className="input h-10 p-1"
                        defaultValue={ctx.user.avatarColor}
                      />
                    </Field>
                  </FormGrid>
                </ActionForm>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Password"
                description="Use at least 8 characters with a letter and a number."
                action={<KeyRound className="size-4 text-[var(--muted)]" />}
              />
              <div className="p-4">
                <ActionForm
                  action={changePasswordAction}
                  submitLabel="Update password"
                  pendingLabel="Updating…"
                >
                  <FormGrid cols={1}>
                    <Field label="Current password" htmlFor="currentPassword" required>
                      <input
                        id="currentPassword"
                        name="currentPassword"
                        type="password"
                        className="input"
                        autoComplete="current-password"
                        required
                      />
                    </Field>
                    <Field label="New password" htmlFor="newPassword" required>
                      <input
                        id="newPassword"
                        name="newPassword"
                        type="password"
                        className="input"
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                    </Field>
                    <Field label="Confirm new password" htmlFor="confirmPassword" required>
                      <input
                        id="confirmPassword"
                        name="confirmPassword"
                        type="password"
                        className="input"
                        autoComplete="new-password"
                        required
                      />
                    </Field>
                  </FormGrid>
                </ActionForm>
              </div>
            </Card>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Institute logo"
              description="Custom logo displayed on the workspace and parent portal."
              action={<ImageIcon className="size-4 text-[var(--muted)]" />}
            />
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-4">
                {logoFileId ? (
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
                    <img
                      src={`/api/files/${logoFileId}`}
                      alt={tenant.name}
                      className="size-full object-contain p-1"
                    />
                  </div>
                ) : (
                  <Avatar name={tenant.name} size={52} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{tenant.name}</p>
                  <p className="text-xs text-muted">
                    {logoFileId ? "Custom logo active" : "Using initials avatar"}
                  </p>
                </div>
              </div>

              {canManage && (
                <div className="pt-2 border-t border-[var(--border)] space-y-2">
                  <form action={uploadSchoolLogoAction} className="flex flex-col gap-2">
                    <label className="text-[11px] font-medium text-muted">
                      Upload new logo (PNG, JPG, WebP, max 2 MB)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        name="logo"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="text-xs text-muted file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--surface-2)] file:text-xs file:font-medium hover:file:bg-[var(--surface-3)]"
                        required
                      />
                      <button type="submit" className="btn btn-secondary btn-sm shrink-0">
                        <Upload className="size-3.5" /> Upload
                      </button>
                    </div>
                  </form>

                  {logoFileId && (
                    <form action={deleteSchoolLogoAction} className="pt-1">
                      <button
                        type="submit"
                        className="btn btn-secondary btn-sm text-[var(--danger)] hover:bg-[var(--danger-soft)] w-full"
                      >
                        <Trash2 className="size-3.5" /> Remove custom logo
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Workspace"
              description="Plan, role and identity at a glance."
              action={<Palette className="size-4 text-[var(--muted)]" />}
            />
            <div className="divide-y divide-[var(--border)] px-4 py-1">
              <InfoRow label="Status">
                <Badge tone={statusTone(tenant.status)}>{statusLabel(tenant.status)}</Badge>
              </InfoRow>
              <InfoRow label="Type">{statusLabel(tenant.type)}</InfoRow>
              <InfoRow label="Slug">
                <span className="font-mono text-[12px]">{tenant.slug}</span>
              </InfoRow>
              <InfoRow label="Plan">{plan?.name ?? "No plan"}</InfoRow>
              <InfoRow label="Subscription">
                {tenant.subscription ? statusLabel(tenant.subscription.status) : "—"}
              </InfoRow>
              <InfoRow label="Renews">{date(tenant.subscription?.currentPeriodEnd)}</InfoRow>
              <InfoRow label="Your role">{ctx.membership?.roleName ?? "Member"}</InfoRow>
              <InfoRow label="Permissions">{num(ctx.permissions.size)}</InfoRow>
              <InfoRow label="Created">{date(tenant.createdAt)}</InfoRow>
            </div>
            <div className="border-t border-[var(--border)] p-3">
              <Link href="/app/billing" className="btn btn-secondary w-full">
                Manage subscription
              </Link>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Recent activity"
              description="Latest audited actions in this institute."
              action={<ScrollText className="size-4 text-[var(--muted)]" />}
            />
            {canViewAudit ? (
              <div className="divide-y divide-[var(--border)]">
                {audit.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2.5 px-4 py-2.5">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                    <div className="min-w-0">
                      <p className="truncate text-[12px]">
                        <span className="font-medium">{entry.actorName}</span>{" "}
                        <span className="text-muted">{entry.action.replace(/\./g, " ")}</span>
                      </p>
                      <p className="text-[10px] text-[var(--muted-2)]">
                        {timeAgo(entry.createdAt)}
                        {entry.entity ? ` · ${entry.entity}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
                {audit.length === 0 && (
                  <p className="px-4 py-8 text-center text-xs text-muted">
                    No activity recorded yet.
                  </p>
                )}
              </div>
            ) : (
              <p className="p-4 text-[12px] text-muted">
                You do not have permission to view the audit trail. Ask an institute admin for the
                View audit log permission.
              </p>
            )}
          </Card>

          <Callout tone="info" title="Security reminders" icon={<ShieldCheck className="size-4" />}>
            Use a unique password, keep your role at the minimum access you need, and review staff
            access when someone changes responsibilities. Sensitive actions are recorded in the audit
            trail with your name.
          </Callout>
        </div>
      </div>
    </div>
  );
}
