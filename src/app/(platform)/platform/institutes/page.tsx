import Link from "next/link";
import { Plus, Search } from "lucide-react";
import type { Prisma, TenantStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import { money, num } from "@/lib/format";
import { safeInt } from "@/lib/utils";
import { Badge, PageHeader, Pagination, statusTone } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";

export const metadata = { title: "Institutes" };

const PAGE_SIZE = 12;
const STATUSES = ["TRIAL", "ACTIVE", "SUSPENDED", "CHURNED"] as const;

type InstituteRow = Prisma.TenantGetPayload<{
  include: {
    subscription: { include: { plan: true } };
    _count: { select: { students: true; memberships: true } };
  };
}>;

export default async function InstitutesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; plan?: string; page?: string }>;
}) {
  await requirePlatformPermission("platform.institutes.read");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? (sp.status as TenantStatus) : undefined;
  const plan = sp.plan && sp.plan !== "all" ? sp.plan : undefined;
  const page = safeInt(sp.page, 1, 10_000);

  const where: Prisma.TenantWhereInput = {
    ...(status ? { status } : {}),
    ...(plan ? { subscription: { plan: { key: plan } } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { city: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, tenants, plans] = await Promise.all([
    db.tenant.count({ where }),
    db.tenant.findMany({
      where,
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { students: true, memberships: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.plan.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" } }),
  ]);

  const columns: Column<InstituteRow>[] = [
    {
      key: "name",
      header: "Institute",
      mobile: "title",
      render: (t) => (
        <Link href={`/platform/institutes/${t.id}`} className="group flex items-center gap-2.5">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg text-[10px] font-bold text-white"
            style={{ background: t.accentColor }}
          >
            {t.logoInitials}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium group-hover:underline">{t.name}</span>
            <span className="block truncate text-[11px] text-muted">
              {t.city ?? "—"} · {t.type.toLowerCase()}
            </span>
          </span>
        </Link>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      mobile: "hidden",
      render: (t) => (
        <span className="text-muted">
          {t.subscription?.plan.name ?? "—"}
          <span className="ml-1 text-[10px] text-[var(--muted-2)]">
            {t.subscription ? `· ${t.subscription.billingCycle.toLowerCase()}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "students",
      header: "Students",
      align: "right",
      mobile: "detail",
      render: (t) => (
        <span className="tabular-nums">
          {num(t._count.students)}
          <span className="text-[10px] text-[var(--muted-2)]">
            {" "}/ {num(t.subscription?.plan.maxStudents ?? 0)}
          </span>
        </span>
      ),
    },
    {
      key: "staff",
      header: "Staff",
      align: "right",
      mobile: "detail",
      render: (t) => <span className="tabular-nums">{num(t._count.memberships)}</span>,
    },
    {
      key: "mrr",
      header: "MRR",
      align: "right",
      mobile: "detail",
      render: (t) => {
        const s = t.subscription;
        if (!s || s.status === "TRIALING") return <span className="text-muted">Trial</span>;
        const monthly = s.billingCycle === "YEARLY" ? Math.round(s.plan.priceYearly / 12) : s.plan.priceMonthly;
        return <span className="tabular-nums">{money(monthly)}</span>;
      },
    },
    {
      key: "status",
      header: "Status",
      mobile: "hidden",
      render: (t) => <Badge tone={statusTone(t.status)}>{t.status.toLowerCase()}</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "hidden",
      render: (t) => (
        <Link href={`/platform/institutes/${t.id}`} className="btn btn-secondary btn-sm">
          Manage
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Platform"
        title="Institutes"
        description={`${num(total)} workspace${total === 1 ? "" : "s"} on the platform`}
        actions={
          <Link href="/platform/institutes/new" className="btn btn-primary">
            <Plus className="size-4" /> New institute
          </Link>
        }
      />

      <form method="GET" className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-2)]" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by name, city, slug or email…"
            className="input pl-8"
            aria-label="Search institutes"
          />
        </div>
        <div className="flex gap-2">
          <select name="status" defaultValue={status ?? ""} className="select sm:w-36" aria-label="Filter status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
          <select name="plan" defaultValue={plan ?? "all"} className="select sm:w-36" aria-label="Filter plan">
            <option value="all">All plans</option>
            {plans.map((p) => (
              <option key={p.id} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" type="submit">
            Filter
          </button>
        </div>
      </form>

      <DataTable
        columns={columns}
        rows={tenants}
        emptyTitle={q || status || plan ? "No institutes match those filters" : "No institutes yet"}
        emptyDescription={
          q || status || plan
            ? "Try a different search or clear the filters."
            : "Create the first institute and its admin in one step."
        }
        emptyAction={
          <Link href="/platform/institutes/new" className="btn btn-primary btn-sm">
            <Plus className="size-3.5" /> New institute
          </Link>
        }
        footer={
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            basePath="/platform/institutes"
            query={{ q, status, plan }}
          />
        }
      />
    </div>
  );
}
