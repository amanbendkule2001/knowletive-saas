import { ShieldCheck, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import { savePlatformRoleAction } from "@/actions/platform";
import { PLATFORM_PERMISSIONS } from "@/lib/catalog";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, Callout, Card, CardHeader, PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Platform roles" };

const groups = PLATFORM_PERMISSIONS.reduce<Record<string, typeof PLATFORM_PERMISSIONS>>(
  (acc, permission) => {
    (acc[permission.group] ??= []).push(permission);
    return acc;
  },
  {},
);

export default async function PlatformRolesPage() {
  await requirePlatformPermission("platform.roles.read");
  const roles = await db.role.findMany({
    where: { scope: "PLATFORM" },
    include: {
      permissions: true,
      _count: { select: { platformUsers: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Governance"
        title="Platform roles"
        description="Control what the platform team can see and change. Permissions are checked on every page and every server action."
        actions={<Badge tone="brand"><ShieldCheck className="size-3" /> {PLATFORM_PERMISSIONS.length} permissions</Badge>}
      />

      <Callout tone="info" title="Least privilege by default">
        Platform Support is intentionally read-only. Add write permissions only when a teammate needs
        them, and review access when someone changes teams. The owner role always has every permission.
      </Callout>

      <div className="grid gap-4 xl:grid-cols-2">
        {roles.map((role) => {
          const selected = new Set(role.permissions.map((p) => p.permissionKey));
          const locked = role.key === "PLATFORM_OWNER";

          return (
            <Card key={role.id}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {role.name}
                    {locked && <Badge tone="brand">Locked</Badge>}
                    {role.isSystem && !locked && <Badge tone="neutral">System</Badge>}
                  </span>
                }
                description={role.description ?? "Custom platform role"}
                action={
                  <span className="flex items-center gap-1 text-[11px] text-muted">
                    <Users className="size-3" /> {role._count.platformUsers}
                  </span>
                }
              />

              {locked ? (
                <div className="p-4">
                  <p className="text-xs text-muted">
                    The platform owner bypasses permission checks and always has full access. This role
                    cannot be restricted to avoid locking the platform out of its own console.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {PLATFORM_PERMISSIONS.map((p) => (
                      <Badge key={p.key} tone="neutral">
                        {p.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-4">
                  <ActionForm
                    action={savePlatformRoleAction}
                    submitLabel="Save permissions"
                    pendingLabel="Saving…"
                  >
                    <input type="hidden" name="roleId" value={role.id} />
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
                  </ActionForm>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
