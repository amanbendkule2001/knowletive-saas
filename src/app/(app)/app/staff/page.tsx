import Link from "next/link";
import { Plus, Search, ShieldCheck, Users } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import {
  Avatar,
  Badge,
  Card,
  PageHeader,
  Pagination,
  statusLabel,
  statusTone,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { date, num } from "@/lib/format";

export const metadata = { title: "Staff" };

type MembershipRow = Prisma.MembershipGetPayload<{
  include: { user: true; role: true };
}>;

const PAGE_SIZE = 20;

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; removed?: string }>;
}) {
  const ctx = await requireTenantPermission("tenant.staff.read");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = ["ACTIVE", "SUSPENDED", "INVITED"].includes(sp.status ?? "")
    ? (sp.status as "ACTIVE" | "SUSPENDED" | "INVITED")
    : "";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const tenantId = ctx.tenant.id;

  const where: Prisma.MembershipWhereInput = {
    tenantId,
    ...(status ? { status } : {}),
    ...(q
      ? {
          user: {
            is: {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { email: { contains: q, mode: "insensitive" as const } },
              ],
            },
          },
        }
      : {}),
  };

  const [members, total, roles] = await Promise.all([
    db.membership.findMany({
      where,
      include: { user: true, role: true },
      orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.membership.count({ where }),
    db.role.findMany({
      where: { tenantId, scope: "TENANT" },
      include: { _count: { select: { memberships: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const canWrite = hasTenantPermission(ctx, "tenant.staff.write");
  const activeCount = await db.membership.count({ where: { tenantId, status: "ACTIVE" } });

  const columns: Column<MembershipRow>[] = [
    {
      key: "name",
      header: "Team member",
      mobile: "title",
      render: (member) => (
        <Link href={`/app/staff/${member.id}`} className="group flex items-center gap-2.5">
          <Avatar name={member.user.name} color={member.user.avatarColor} size={32} />
          <span className="min-w-0">
            <span className="block truncate font-medium group-hover:underline">
              {member.user.name}
              {member.isOwner ? " ★" : ""}
            </span>
            <span className="block truncate text-[10px] text-muted">{member.user.email}</span>
          </span>
        </Link>
      ),
    },
    {
      key: "role",
      header: "Role",
      mobile: "subtitle",
      render: (member) => <Badge tone="brand">{member.role.name}</Badge>,
    },
    {
      key: "designation",
      header: "Designation",
      mobile: "detail",
      render: (member) => <span className="text-muted">{member.designation ?? "—"}</span>,
    },
    {
      key: "phone",
      header: "Phone",
      mobile: "detail",
      render: (member) => <span className="text-muted">{member.phone ?? "—"}</span>,
    },
    {
      key: "joined",
      header: "Joined",
      mobile: "detail",
      render: (member) => <span className="text-muted">{date(member.createdAt)}</span>,
    },
    {
      key: "status",
      header: "Status",
      mobile: "hidden",
      render: (member) => (
        <Badge tone={statusTone(member.status)}>{statusLabel(member.status)}</Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "hidden",
      render: (member) => (
        <Link href={`/app/staff/${member.id}`} className="link text-xs">
          Manage
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People"
        title="Staff & access"
        description="Every staff member signs in with a role. Permissions are enforced on the server for every page and action."
        actions={
          canWrite ? (
            <Link href="/app/staff/new" className="btn btn-primary">
              <Plus className="size-4" /> Invite staff
            </Link>
          ) : undefined
        }
      />

      {sp.removed && (
        <div className="rounded-xl bg-[var(--success-soft)] px-3.5 py-3 text-[13px] text-[var(--success)]">
          The staff member was removed from this institute. Their personal login remains for other
          institutes, if any.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="flex items-center justify-between text-xs text-muted">
            Active staff <Users className="size-4" />
          </p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums">{num(activeCount)}</p>
          <p className="text-[11px] text-muted">of {num(ctx.tenant.subscription?.plan?.maxStaff ?? 0)} on your plan</p>
        </div>
        <div className="card p-4">
          <p className="flex items-center justify-between text-xs text-muted">
            Roles <ShieldCheck className="size-4" />
          </p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums">{num(roles.length)}</p>
          <p className="text-[11px] text-muted">system and custom roles</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-muted">Directory</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums">{num(total)}</p>
          <p className="text-[11px] text-muted">{q || status ? "matching filters" : "memberships in total"}</p>
        </div>
      </div>

      <Card>
        <form className="flex flex-col gap-2 border-b border-[var(--border)] p-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-2)]" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name or email"
              className="input pl-8"
              aria-label="Search staff"
            />
          </div>
          <select name="status" defaultValue={status} className="select sm:w-40" aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="INVITED">Invited</option>
          </select>
          <button className="btn btn-secondary" type="submit">
            Filter
          </button>
          {(q || status) && (
            <Link href="/app/staff" className="btn btn-ghost">
              Clear
            </Link>
          )}
        </form>

        <DataTable
          columns={columns}
          rows={members}
          emptyTitle={q || status ? "No staff match those filters" : "No staff yet"}
          emptyDescription={
            q || status
              ? "Try a different name, email or status."
              : "Invite your principal, teachers and accountants to collaborate."
          }
          emptyAction={
            canWrite ? (
              <Link href="/app/staff/new" className="btn btn-primary btn-sm">
                <Plus className="size-3.5" /> Invite staff
              </Link>
            ) : undefined
          }
          footer={
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              basePath="/app/staff"
              query={{ q: q || undefined, status: status || undefined }}
            />
          }
        />
      </Card>

      <Card>
        <div className="divide-y divide-[var(--border)]">
          {roles.map((role) => (
            <div key={role.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[13px] font-medium">
                  {role.name}
                  {role.isSystem && <Badge tone="neutral">System</Badge>}
                </p>
                <p className="truncate text-[11px] text-muted">{role.description ?? "Custom role"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-[11px] text-muted">{role._count.memberships} members</span>
                <Link href="/app/roles" className="link text-xs">
                  Permissions
                </Link>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
