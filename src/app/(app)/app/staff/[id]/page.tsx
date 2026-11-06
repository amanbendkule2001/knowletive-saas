import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import { removeStaffAction, updateStaffAction } from "@/actions/students";
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
  statusLabel,
  statusTone,
} from "@/components/ui/primitives";
import { date, timeAgo } from "@/lib/format";
import { PERMISSION_MAP } from "@/lib/catalog";

export const metadata = { title: "Staff member" };

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPermission("tenant.staff.read");
  const { id } = await params;

  const membership = await db.membership.findFirst({
    where: { id, tenantId: ctx.tenant.id },
    include: {
      user: true,
      role: { include: { permissions: true } },
    },
  });
  if (!membership) notFound();

  const roles = await db.role.findMany({
    where: { tenantId: ctx.tenant.id, scope: "TENANT" },
    orderBy: { name: "asc" },
  });

  const canWrite = hasTenantPermission(ctx, "tenant.staff.write");
  const permissionGroups = membership.role.permissions.reduce<Record<string, string[]>>(
    (acc, permission) => {
      const def = PERMISSION_MAP.get(permission.permissionKey);
      const group = def?.group ?? "Other";
      (acc[group] ??= []).push(def?.label ?? permission.permissionKey);
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-5">
      <Link
        href="/app/staff"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-3.5" /> All staff
      </Link>

      <PageHeader
        eyebrow={membership.isOwner ? "Institute owner" : membership.role.name}
        title={membership.user.name}
        description={`${membership.user.email}${membership.phone ? ` · ${membership.phone}` : ""}`}
        actions={
          <>
            <Badge tone={statusTone(membership.status)}>{statusLabel(membership.status)}</Badge>
            {canWrite && !membership.isOwner && (
              <form action={removeStaffAction}>
                <input type="hidden" name="membershipId" value={membership.id} />
                <ConfirmButton
                  className="btn btn-danger-soft"
                  message={`Remove ${membership.user.name} from this institute? They lose access immediately. Their login stays intact for other institutes.`}
                >
                  <Trash2 className="size-3.5" /> Remove access
                </ConfirmButton>
              </form>
            )}
          </>
        }
      />

      {membership.isOwner && (
        <Callout tone="info" title="Protected owner account" icon={<KeyRound className="size-4" />}>
          The institute owner keeps the Institute Admin role and must stay active. Transfer of ownership
          is handled by the platform team.
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Account" />
            <div className="flex items-center gap-3 px-4 py-4">
              <Avatar name={membership.user.name} color={membership.user.avatarColor} size={48} />
              <div className="min-w-0">
                <p className="truncate font-semibold">{membership.user.name}</p>
                <p className="truncate text-[11px] text-muted">{membership.user.email}</p>
              </div>
            </div>
            <div className="divide-y divide-[var(--border)] px-4 py-1">
              <InfoRow label="Role">{membership.role.name}</InfoRow>
              <InfoRow label="Designation">{membership.designation ?? "—"}</InfoRow>
              <InfoRow label="Employee no.">{membership.employeeNo ?? "—"}</InfoRow>
              <InfoRow label="Joined">{date(membership.createdAt)}</InfoRow>
              <InfoRow label="Last sign-in">
                {membership.user.lastLoginAt ? timeAgo(membership.user.lastLoginAt) : "Never"}
              </InfoRow>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Effective permissions"
              description={`${membership.role.permissions.length} granted by ${membership.role.name}`}
            />
            <div className="space-y-3 p-4">
              {Object.entries(permissionGroups).map(([group, permissions]) => (
                <div key={group}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-2)]">
                    {group}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {permissions.map((label) => (
                      <Badge key={label} tone="neutral">
                        {label}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
              {membership.role.permissions.length === 0 && (
                <p className="text-xs text-muted">No permissions granted. This member cannot access any module.</p>
              )}
            </div>
          </Card>
        </div>

        {canWrite && (
          <Card>
            <CardHeader
              title="Change access"
              description="Role changes take effect on the member's next request."
              action={<ShieldCheck className="size-4 text-[var(--muted)]" />}
            />
            <div className="p-4">
              <ActionForm
                action={updateStaffAction}
                submitLabel="Save access"
                pendingLabel="Saving…"
                cancelHref="/app/staff"
              >
                <input type="hidden" name="membershipId" value={membership.id} />
                <FormGrid>
                  <Field label="Role" htmlFor="roleId" required>
                    <select
                      id="roleId"
                      name="roleId"
                      className="select"
                      defaultValue={membership.roleId}
                      disabled={membership.isOwner}
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                    {membership.isOwner && <input type="hidden" name="roleId" value={membership.roleId} />}
                  </Field>
                  <Field label="Status" htmlFor="status">
                    <select
                      id="status"
                      name="status"
                      className="select"
                      defaultValue={membership.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE"}
                      disabled={membership.isOwner}
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="SUSPENDED">Suspended</option>
                    </select>
                    {membership.isOwner && <input type="hidden" name="status" value="ACTIVE" />}
                  </Field>
                  <Field label="Designation" htmlFor="designation">
                    <input
                      id="designation"
                      name="designation"
                      className="input"
                      defaultValue={membership.designation ?? ""}
                    />
                  </Field>
                  <Field label="Phone" htmlFor="phone">
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      className="input"
                      defaultValue={membership.phone ?? ""}
                    />
                  </Field>
                </FormGrid>
              </ActionForm>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
