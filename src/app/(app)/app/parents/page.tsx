import Link from "next/link";
import { Plus, Search, Users } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission, hashPassword } from "@/lib/auth";
import {
  Avatar,
  Badge,
  Callout,
  Card,
  PageHeader,
  Pagination,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { num } from "@/lib/format";

export const metadata = { title: "Parents" };

type GuardianRow = Prisma.GuardianGetPayload<{
  include: { students: { include: { student: { include: { section: { include: { class: true } } } } } } };
}>;

const PAGE_SIZE = 20;

export default async function ParentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; created?: string; deleted?: string }>;
}) {
  const ctx = await requireTenantPermission("tenant.parents.read");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const tenantId = ctx.tenant.id;

  // Auto-sync any tenant members who have the PARENT role into the Guardian table
  try {
    const parentMembers = await db.membership.findMany({
      where: {
        tenantId,
        role: { key: "PARENT" },
      },
      include: { user: true },
    });

    for (const m of parentMembers) {
      const existing = await db.guardian.findFirst({
        where: {
          tenantId,
          OR: [
            { userId: m.userId },
            ...(m.user.email ? [{ email: m.user.email }] : []),
            ...(m.phone ? [{ phone: m.phone }] : []),
          ],
        },
      });

      if (!existing) {
        await db.guardian.create({
          data: {
            tenantId,
            userId: m.userId,
            name: m.user.name,
            email: m.user.email || null,
            phone: m.phone || "—",
            relation: "Guardian",
          },
        });
      } else if (!existing.userId) {
        await db.guardian.update({
          where: { id: existing.id },
          data: { userId: m.userId },
        });
      }
    }

    // Auto-provision user accounts for existing guardians lacking a login
    const unlinkedGuardians = await db.guardian.findMany({
      where: { tenantId, userId: null },
    });
    if (unlinkedGuardians.length > 0) {
      let parentRole = await db.role.findFirst({
        where: { tenantId, key: "PARENT" },
      });
      if (!parentRole) {
        parentRole = await db.role.create({
          data: {
            tenantId,
            key: "PARENT",
            name: "Parent",
            description: "Parent portal: own child's attendance, fees and notices.",
            scope: "TENANT",
            isSystem: true,
          },
        });
      }
      const defaultPasswordHash = await hashPassword("Admin@123");
      for (const g of unlinkedGuardians) {
        const cleanPhone = g.phone.trim();
        const parentEmail =
          g.email?.trim().toLowerCase() ||
          `parent.${cleanPhone.replace(/[^0-9]/g, "")}@parent.${ctx.tenant.slug || "institute"}.com`;
        let user = await db.user.findUnique({ where: { email: parentEmail } });
        if (!user) {
          user = await db.user.create({
            data: {
              email: parentEmail,
              name: g.name,
              passwordHash: defaultPasswordHash,
              status: "ACTIVE",
            },
          });
        }
        const member = await db.membership.findUnique({
          where: { tenantId_userId: { tenantId, userId: user.id } },
        });
        if (!member) {
          await db.membership.create({
            data: {
              tenantId,
              userId: user.id,
              roleId: parentRole.id,
              phone: cleanPhone,
              status: "ACTIVE",
            },
          });
        }
        await db.guardian.update({
          where: { id: g.id },
          data: { userId: user.id },
        });
      }
    }
  } catch {
    // Non-blocking sync fallback
  }

  const where: Prisma.GuardianWhereInput = {
    tenantId,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [guardians, total, linkCount, activeStudents, coveredStudents] = await Promise.all([
    db.guardian.findMany({
      where,
      include: {
        students: {
          include: { student: { include: { section: { include: { class: true } } } } },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.guardian.count({ where }),
    db.studentGuardian.count({ where: { guardian: { tenantId } } }),
    db.student.count({ where: { tenantId, status: "ACTIVE" } }),
    db.student.count({
      where: { tenantId, status: "ACTIVE", guardians: { some: {} } },
    }),
  ]);

  const canWrite = hasTenantPermission(ctx, "tenant.parents.write");

  const columns: Column<GuardianRow>[] = [
    {
      key: "name",
      header: "Parent / guardian",
      mobile: "title",
      render: (guardian) => (
        <Link href={`/app/parents/${guardian.id}`} className="group flex items-center gap-2.5">
          <Avatar name={guardian.name} size={32} color="#0d9488" />
          <span className="min-w-0">
            <span className="block truncate font-medium group-hover:underline">{guardian.name}</span>
            <span className="block truncate text-[10px] text-muted">
              {guardian.relation ?? "Guardian"}
              {guardian.occupation ? ` · ${guardian.occupation}` : ""}
            </span>
          </span>
        </Link>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      mobile: "subtitle",
      render: (guardian) => (
        <span className="text-muted">
          {guardian.phone}
          {guardian.email ? ` · ${guardian.email}` : ""}
        </span>
      ),
    },
    {
      key: "children",
      header: "Children",
      mobile: "detail",
      render: (guardian) => (
        <span className="flex flex-wrap gap-1">
          {guardian.students.map((link) => (
            <Badge key={link.studentId} tone="neutral">
              {link.student.firstName} {link.student.lastName}
              {link.isPrimary ? " ★" : ""}
            </Badge>
          ))}
          {guardian.students.length === 0 && <span className="text-[var(--muted-2)]">Not linked</span>}
        </span>
      ),
    },
    {
      key: "count",
      header: "Links",
      align: "right",
      mobile: "hidden",
      render: (guardian) => <span className="tabular-nums">{guardian.students.length}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "hidden",
      render: (guardian) => (
        <Link href={`/app/parents/${guardian.id}`} className="link text-xs">
          View
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People"
        title="Parents & guardians"
        description="One guardian can be linked to several students. Fee reminders and alerts use these contacts."
        actions={
          canWrite ? (
            <Link href="/app/parents/new" className="btn btn-primary">
              <Plus className="size-4" /> Add parent
            </Link>
          ) : undefined
        }
      />

      {(sp.created || sp.deleted) && (
        <Callout tone="success" title={sp.deleted ? "Parent removed" : "Parent added"}>
          {sp.deleted
            ? "The guardian record and its student links were removed. Student profiles are untouched."
            : "The guardian is ready. Link more children from the parent profile."}
        </Callout>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs text-muted">Guardians</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums">{num(total)}</p>
          <p className="text-[11px] text-muted">{q ? "matching your search" : "in this institute"}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-muted">Student links</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums">{num(linkCount)}</p>
          <p className="text-[11px] text-muted">guardian ↔ student relationships</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-muted">Coverage</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums">
            {num(coveredStudents)}
            <span className="text-sm font-normal text-muted"> / {num(activeStudents)}</span>
          </p>
          <p className="text-[11px] text-muted">active students with a guardian link</p>
        </div>
      </div>

      <Card>
        <form className="flex flex-col gap-2 border-b border-[var(--border)] p-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-2)]" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name, phone or email"
              className="input pl-8"
              aria-label="Search parents"
            />
          </div>
          <button className="btn btn-secondary" type="submit">
            Search
          </button>
          {q && (
            <Link href="/app/parents" className="btn btn-ghost">
              Clear
            </Link>
          )}
        </form>

        <DataTable
          columns={columns}
          rows={guardians}
          emptyTitle={q ? "No parents match that search" : "No parents yet"}
          emptyDescription={
            q
              ? "Try a different name, phone number or email."
              : "Add a guardian, or add one while creating a student."
          }
          emptyAction={
            canWrite ? (
              <Link href="/app/parents/new" className="btn btn-primary btn-sm">
                <Plus className="size-3.5" /> Add parent
              </Link>
            ) : undefined
          }
          footer={
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              basePath="/app/parents"
              query={{ q: q || undefined }}
            />
          }
        />
      </Card>

      {!q && (
        <Callout tone="info" title="Parent portal" icon={<Users className="size-4" />}>
          Parents currently receive notices through staff. A parent login portal is available on plans with
          the <strong>Parent app</strong> entitlement —{" "}
          <Link href="/app/billing" className="underline">
            review your plan
          </Link>
          .
        </Callout>
      )}
    </div>
  );
}
