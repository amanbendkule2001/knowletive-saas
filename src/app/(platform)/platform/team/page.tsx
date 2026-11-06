import type { Prisma } from "@prisma/client";
import { KeyRound, Mail, Plus, ShieldCheck, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import {
  invitePlatformUserAction,
  updatePlatformUserStatusAction,
} from "@/actions/platform";
import { ActionForm } from "@/components/ui/action-form";
import { Field, FormGrid } from "@/components/ui/form-field";
import { Avatar, Badge, Callout, Card, CardHeader, PageHeader, statusTone } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { date, timeAgo } from "@/lib/format";

export const metadata = { title: "Platform team" };

type TeamRow = Prisma.UserGetPayload<{ include: { platformRole: true } }>;

export default async function PlatformTeamPage() {
  const actor = await requirePlatformPermission("platform.users.read");

  const [team, roles] = await Promise.all([
    db.user.findMany({
      where: { OR: [{ isPlatformOwner: true }, { platformRoleId: { not: null } }] },
      include: { platformRole: true },
      orderBy: [{ isPlatformOwner: "desc" }, { createdAt: "asc" }],
    }),
    db.role.findMany({
      where: { scope: "PLATFORM", key: { not: "PLATFORM_OWNER" } },
      orderBy: { name: "asc" },
    }),
  ]);

  const canManage = actor.isPlatformOwner || actor.platformPermissions.includes("platform.users.manage");

  const columns: Column<TeamRow>[] = [
    {
      key: "user",
      header: "Teammate",
      mobile: "title",
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={u.name} color={u.avatarColor} size={30} />
          <div className="min-w-0">
            <p className="truncate font-medium">{u.name}</p>
            <p className="truncate text-[11px] text-muted">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      mobile: "subtitle",
      render: (u) => (
        <span className="text-muted">
          {u.isPlatformOwner ? "Platform Owner" : u.platformRole?.name ?? "No role"}
        </span>
      ),
    },
    {
      key: "login",
      header: "Last sign-in",
      mobile: "detail",
      render: (u) => (
        <div>
          <p>{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "Never"}</p>
          <p className="text-[10px] text-muted">Joined {date(u.createdAt)}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobile: "hidden",
      render: (u) => <Badge tone={statusTone(u.status)}>{u.status.toLowerCase()}</Badge>,
    },
    {
      key: "action",
      header: "",
      align: "right",
      mobile: "hidden",
      render: (u) => {
        if (u.isPlatformOwner || u.id === actor.id) {
          return <span className="text-[10px] text-muted">{u.id === actor.id ? "You" : "Owner"}</span>;
        }
        return (
          <form action={updatePlatformUserStatusAction}>
            <input type="hidden" name="userId" value={u.id} />
            <input type="hidden" name="status" value={u.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED"} />
            <button className="btn btn-secondary btn-sm" type="submit">
              {u.status === "SUSPENDED" ? "Reactivate" : "Suspend"}
            </button>
          </form>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Governance"
        title="Platform team"
        description="People who operate Knowletive itself — separate from institute staff. Platform roles are checked on every request."
        actions={<Badge tone="brand"><ShieldCheck className="size-3" /> {team.length} accounts</Badge>}
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Team directory" description="Owner and platform-role accounts" />
          <DataTable
            columns={columns}
            rows={team}
            emptyTitle="No platform team yet"
            emptyDescription="Invite a teammate using the form on this page."
          />
        </Card>

        <Card>
          <CardHeader
            title="Invite a teammate"
            description="Creates a platform account with the selected role."
            action={<UserRound className="size-4 text-[var(--brand)]" />}
          />
          <div className="p-4">
            {canManage ? (
              <ActionForm action={invitePlatformUserAction} submitLabel="Create account" pendingLabel="Creating…">
                <FormGrid cols={1}>
                  <Field label="Full name" htmlFor="name" required>
                    <input id="name" name="name" className="input" required placeholder="Priya Nair" />
                  </Field>
                  <Field label="Work email" htmlFor="email" required>
                    <input id="email" name="email" type="email" className="input" required placeholder="priya@knowletive.com" />
                  </Field>
                  <Field label="Temporary password" htmlFor="password" required hint="At least 8 characters with a letter and a number.">
                    <input
                      id="password"
                      name="password"
                      type="password"
                      className="input"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="••••••••"
                    />
                  </Field>
                  <Field label="Platform role" htmlFor="roleId" required>
                    <select id="roleId" name="roleId" className="select" required defaultValue="">
                      <option value="" disabled>
                        Choose a role
                      </option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Designation" htmlFor="designation">
                    <input id="designation" name="designation" className="input" placeholder="Support Engineer" />
                  </Field>
                  <Field label="Phone" htmlFor="phone">
                    <input id="phone" name="phone" className="input" placeholder="+91 98765 43210" />
                  </Field>
                </FormGrid>
              </ActionForm>
            ) : (
              <Callout tone="neutral" title="Read-only access">
                You can view the team but not invite or suspend accounts. Ask a platform owner if you
                need user management access.
              </Callout>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <div className="flex items-start gap-3 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
              <Mail className="size-4" />
            </span>
            <div>
              <p className="text-[13px] font-semibold">Invites are manual</p>
              <p className="mt-1 text-xs text-muted">
                Share the temporary password over a secure channel. The teammate can change it from
                workspace settings after signing in.
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--info-soft)] text-[var(--info)]">
              <KeyRound className="size-4" />
            </span>
            <div>
              <p className="text-[13px] font-semibold">Sessions are revocable</p>
              <p className="mt-1 text-xs text-muted">
                Suspending a teammate deletes every active session immediately. Their audit history
                remains intact.
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--success-soft)] text-[var(--success)]">
              <Plus className="size-4" />
            </span>
            <div>
              <p className="text-[13px] font-semibold">Need a custom role?</p>
              <p className="mt-1 text-xs text-muted">
                Create it in Platform roles first, then assign it here. Roles can be edited without
                touching the codebase.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
