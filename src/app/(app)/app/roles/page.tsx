import { Lock, ShieldCheck, Trash2, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import { TENANT_PERMISSIONS } from "@/lib/catalog";
import {
  createTenantRoleAction,
  deleteTenantRoleAction,
  saveTenantRoleAction,
} from "@/actions/admin";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmButton } from "@/components/ui/client-bits";
import { Field, FormGrid } from "@/components/ui/form-field";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  PageHeader,
} from "@/components/ui/primitives";

export const metadata = { title: "Roles & permissions" };

const groups = TENANT_PERMISSIONS.reduce<Record<string, typeof TENANT_PERMISSIONS>>(
  (acc, permission) => {
    (acc[permission.group] ??= []).push(permission);
    return acc;
  },
  {},
);

function PermissionPicker({ selected }: { selected: Set<string> }) {
  return (
    <div className="space-y-3">
      {Object.entries(groups).map(([group, permissions]) => (
        <div key={group}>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-2)]">
            {group}
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {permissions.map((permission) => (
              <label
                key={permission.key}
                className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] px-2.5 py-2 text-[12px] transition hover:bg-[var(--surface-2)]"
              >
                <input
                  type="checkbox"
                  name="permissions"
                  value={permission.key}
                  defaultChecked={selected.has(permission.key)}
                  className="mt-0.5 size-3.5 shrink-0 accent-[var(--brand)]"
                />
                <span className="min-w-0">
                  <span className="block">{permission.label}</span>
                  <span className="block truncate font-mono text-[9px] text-[var(--muted-2)]">
                    {permission.key}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function TenantRolesPage() {
  const ctx = await requireTenantPermission("tenant.roles.read");
  const canManage = hasTenantPermission(ctx, "tenant.roles.manage");
  const roles = await db.role.findMany({
    where: { tenantId: ctx.tenant.id, scope: "TENANT" },
    include: {
      permissions: true,
      _count: { select: { memberships: true } },
    },
    orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Roles & permissions"
        description="Decide what each role can see and change. Permissions are enforced on every page and every server action, not just in the interface."
        actions={
          <Badge tone="brand">
            <ShieldCheck className="size-3" /> {roles.length} roles · {TENANT_PERMISSIONS.length} permissions
          </Badge>
        }
      />

      <Callout tone="info" title="Least privilege by default">
        Start with the closest template, then add only what the role needs. The Institute Admin role
        always has full access and cannot be edited, so the institute can never lock itself out.
        Changes apply on each member&apos;s next request.
      </Callout>

      <div className="grid gap-4 xl:grid-cols-2">
        {roles.map((role) => {
          const locked = role.key === "INSTITUTE_ADMIN";
          const selected = new Set(role.permissions.map((permission) => permission.permissionKey));
          const custom = !role.isSystem;

          return (
            <Card key={role.id}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {role.name}
                    {locked && <Badge tone="brand">Locked</Badge>}
                    {role.isSystem && !locked && <Badge tone="neutral">Template</Badge>}
                    {custom && <Badge tone="info">Custom</Badge>}
                  </span>
                }
                description={role.description ?? "Custom institute role"}
                action={
                  <span className="flex items-center gap-2 text-[11px] text-muted">
                    <span className="flex items-center gap-1">
                      <Users className="size-3" /> {role._count.memberships}
                    </span>
                    {canManage && custom && role._count.memberships === 0 && (
                      <form action={deleteTenantRoleAction}>
                        <input type="hidden" name="roleId" value={role.id} />
                        <ConfirmButton
                          className="btn btn-ghost btn-sm text-[var(--danger)]"
                          message={`Delete the ${role.name} role? This cannot be undone.`}
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only">Delete role</span>
                        </ConfirmButton>
                      </form>
                    )}
                  </span>
                }
              />

              {locked || !canManage ? (
                <div className="p-4">
                  {locked ? (
                    <p className="text-[12px] leading-relaxed text-muted">
                      Institute Admin bypasses permission checks and always has full access. This
                      protects the institute from accidentally losing access to its own workspace.
                    </p>
                  ) : (
                    <p className="text-[12px] leading-relaxed text-muted">
                      You can view role permissions but not edit them. Ask an institute admin for
                      the Manage roles permission.
                    </p>
                  )}

                  <details className="mt-3">
                    <summary className="cursor-pointer text-[11px] font-medium text-[var(--brand)]">
                      {locked ? "All permissions" : `${selected.size} permissions granted`}
                    </summary>
                    <div className="mt-2 max-h-64 space-y-2 overflow-auto rounded-lg bg-[var(--surface-2)] p-3">
                      {Object.entries(groups).map(([group, permissions]) => {
                        const granted = permissions.filter((permission) =>
                          selected.has(permission.key),
                        );
                        if (!granted.length) return null;
                        return (
                          <div key={group}>
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-2)]">
                              {group}
                            </p>
                            <p className="text-[11px] text-muted">
                              {granted.map((permission) => permission.label).join(", ")}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                </div>
              ) : (
                <div className="p-4">
                  <ActionForm
                    action={saveTenantRoleAction}
                    submitLabel="Save role"
                    pendingLabel="Saving…"
                  >
                    <input type="hidden" name="roleId" value={role.id} />
                    <FormGrid>
                      <Field label="Role name" htmlFor={`name-${role.id}`} required>
                        <input
                          id={`name-${role.id}`}
                          name="name"
                          className="input"
                          defaultValue={role.name}
                          maxLength={50}
                          required
                        />
                      </Field>
                      <Field label="Description" htmlFor={`description-${role.id}`}>
                        <input
                          id={`description-${role.id}`}
                          name="description"
                          className="input"
                          defaultValue={role.description ?? ""}
                          maxLength={200}
                          placeholder="What this role is responsible for"
                        />
                      </Field>
                    </FormGrid>

                    <details className="rounded-xl border border-[var(--border)]" open>
                      <summary className="cursor-pointer px-3 py-2.5 text-[12px] font-medium">
                        Permissions{" "}
                        <span className="text-muted">({selected.size} selected)</span>
                      </summary>
                      <div className="border-t border-[var(--border)] p-3">
                        <PermissionPicker selected={selected} />
                      </div>
                    </details>

                    {role._count.memberships > 0 && (
                      <p className="text-[11px] text-muted">
                        This role is assigned to {role._count.memberships} member
                        {role._count.memberships === 1 ? "" : "s"}. Changes take effect on their next
                        request.
                      </p>
                    )}
                  </ActionForm>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {canManage ? (
        <Card>
          <CardHeader
            title="Create a custom role"
            description="Useful for coordinators, counsellors, librarians or transport managers."
            action={<Lock className="size-4 text-[var(--muted)]" />}
          />
          <div className="p-4">
            <ActionForm
              action={createTenantRoleAction}
              submitLabel="Create role"
              pendingLabel="Creating…"
            >
              <FormGrid>
                <Field label="Role name" htmlFor="new-role-name" required>
                  <input
                    id="new-role-name"
                    name="name"
                    className="input"
                    placeholder="Exam coordinator"
                    maxLength={50}
                    required
                  />
                </Field>
                <Field label="Description" htmlFor="new-role-description">
                  <input
                    id="new-role-description"
                    name="description"
                    className="input"
                    placeholder="Owns exam schedules and result publication"
                    maxLength={200}
                  />
                </Field>
              </FormGrid>

              <details className="rounded-xl border border-[var(--border)]">
                <summary className="cursor-pointer px-3 py-2.5 text-[12px] font-medium">
                  Choose permissions
                </summary>
                <div className="border-t border-[var(--border)] p-3">
                  <PermissionPicker selected={new Set()} />
                </div>
              </details>

              <p className="text-[11px] text-muted">
                Choose at least one permission. You can fine-tune the role later, and assign it to
                staff from the Staff page.
              </p>
            </ActionForm>
          </div>
        </Card>
      ) : (
        <Callout tone="warning" title="Read-only roles">
          Your role can view the permission model but not create or edit roles. Ask an institute
          admin to make changes.
        </Callout>
      )}
    </div>
  );
}
