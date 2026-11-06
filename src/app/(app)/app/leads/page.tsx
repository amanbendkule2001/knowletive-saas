import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Flame,
  MessageSquare,
  Plus,
  Search,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission, isStaffMember } from "@/lib/auth";
import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
  Pagination,
  StatCard,
  Tone,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { date, num } from "@/lib/format";
import type { Prisma, LeadStatus } from "@prisma/client";

export const metadata = { title: "Leads & Enquiries" };

type LeadRow = Prisma.LeadGetPayload<{
  include: {
    assignedTo: { include: { user: true } };
    academicYear: true;
    convertedStudent: true;
  };
}>;

const PAGE_SIZE = 20;

function leadStatusTone(status: LeadStatus): Tone {
  switch (status) {
    case "CONVERTED":
      return "success";
    case "INTERESTED":
      return "brand";
    case "FOLLOW_UP":
      return "warning";
    case "CONTACTED":
      return "info";
    case "NEW":
      return "neutral";
    case "LOST":
      return "danger";
    default:
      return "neutral";
  }
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
    deleted?: string;
  }>;
}) {
  const ctx = await requireTenantPermission("tenant.leads.read");
  if (!isStaffMember(ctx)) redirect("/portal");

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const validStatuses: LeadStatus[] = ["NEW", "CONTACTED", "FOLLOW_UP", "INTERESTED", "CONVERTED", "LOST"];
  const statusFilter = validStatuses.includes(sp.status as LeadStatus) ? (sp.status as LeadStatus) : undefined;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const tenantId = ctx.tenant.id;

  const where: Prisma.LeadWhereInput = {
    tenantId,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(q
      ? {
          OR: [
            { studentName: { contains: q, mode: "insensitive" } },
            { guardianName: { contains: q, mode: "insensitive" } },
            { guardianPhone: { contains: q } },
            { guardianEmail: { contains: q, mode: "insensitive" } },
            { classInterested: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [leads, total, statusCounts, upcomingFollowUps] = await Promise.all([
    db.lead.findMany({
      where,
      include: {
        assignedTo: { include: { user: true } },
        academicYear: true,
        convertedStudent: true,
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.lead.count({ where }),
    db.lead.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true },
    }),
    db.lead.findMany({
      where: {
        tenantId,
        status: { in: ["NEW", "CONTACTED", "FOLLOW_UP", "INTERESTED"] },
        nextFollowUp: { not: null },
      },
      orderBy: { nextFollowUp: "asc" },
      take: 5,
      include: { assignedTo: { include: { user: true } } },
    }),
  ]);

  const counts: Record<string, number> = statusCounts.reduce(
    (acc, c) => ({ ...acc, [c.status]: c._count._all }),
    {}
  );
  const totalAll = statusCounts.reduce((sum, c) => sum + c._count._all, 0);

  const canWrite = hasTenantPermission(ctx, "tenant.leads.write");

  const columns: Column<LeadRow>[] = [
    {
      key: "student",
      header: "Prospective Student",
      mobile: "title",
      render: (lead) => (
        <div>
          <Link
            href={`/app/leads/${lead.id}`}
            className="font-medium text-[var(--text)] hover:text-[var(--brand)] hover:underline"
          >
            {lead.studentName}
          </Link>
          <p className="text-xs text-muted">
            {lead.classInterested ? `Interested in ${lead.classInterested}` : "Class not specified"}
            {lead.academicYear ? ` · ${lead.academicYear.name}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "guardian",
      header: "Guardian Contact",
      render: (lead) => (
        <div>
          <p className="text-sm font-medium">{lead.guardianName}</p>
          <p className="text-xs text-muted">
            {lead.guardianPhone}
            {lead.guardianEmail ? ` · ${lead.guardianEmail}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (lead) => <Badge tone={leadStatusTone(lead.status)}>{lead.status.replace("_", " ")}</Badge>,
    },
    {
      key: "source",
      header: "Source",
      render: (lead) => (
        <span className="text-xs capitalize text-muted">{lead.source.toLowerCase().replace("_", " ")}</span>
      ),
    },
    {
      key: "followUp",
      header: "Next Follow-Up",
      render: (lead) => {
        if (!lead.nextFollowUp) return <span className="text-xs text-muted">—</span>;
        const isOverdue = new Date(lead.nextFollowUp) < new Date() && lead.status !== "CONVERTED" && lead.status !== "LOST";
        return (
          <span className={isOverdue ? "text-xs font-semibold text-[var(--danger)]" : "text-xs text-muted"}>
            {date(lead.nextFollowUp)}
            {isOverdue ? " (Overdue)" : ""}
          </span>
        );
      },
    },
    {
      key: "assigned",
      header: "Assigned Staff",
      render: (lead) => (
        <span className="text-xs text-muted">{lead.assignedTo?.user.name ?? "Unassigned"}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (lead) => (
        <Link href={`/app/leads/${lead.id}`} className="btn btn-secondary btn-sm">
          View
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admissions CRM"
        title="Leads & Enquiries"
        description="Track prospective student enquiries, schedule follow-ups, and convert qualified leads into enrolled students."
        actions={
          canWrite ? (
            <Link href="/app/leads/new" className="btn btn-primary">
              <Plus className="size-4" /> New enquiry
            </Link>
          ) : null
        }
      />

      {/* KPI Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard
          label="Total Enquiries"
          value={num(totalAll)}
          sub="All registered leads"
          icon={<Users className="size-4 text-muted" />}
        />
        <StatCard
          label="New"
          value={num(counts.NEW ?? 0)}
          sub="Awaiting first contact"
          icon={<MessageSquare className="size-4 text-muted" />}
        />
        <StatCard
          label="Contacted"
          value={num(counts.CONTACTED ?? 0)}
          sub="Initial call made"
          icon={<Clock className="size-4 text-[var(--info)]" />}
        />
        <StatCard
          label="Follow-Up"
          value={num(counts.FOLLOW_UP ?? 0)}
          sub="Action scheduled"
          icon={<Calendar className="size-4 text-[var(--warning)]" />}
        />
        <StatCard
          label="Interested"
          value={num(counts.INTERESTED ?? 0)}
          sub="High purchase intent"
          icon={<Flame className="size-4 text-[var(--brand)]" />}
        />
        <StatCard
          label="Converted"
          value={num(counts.CONVERTED ?? 0)}
          sub="Enrolled as students"
          icon={<UserCheck className="size-4 text-[var(--success)]" />}
        />
        <StatCard
          label="Lost"
          value={num(counts.LOST ?? 0)}
          sub="Not proceeding"
          icon={<CheckCircle2 className="size-4 text-muted" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Main Leads Table Area */}
        <div className="space-y-4 lg:col-span-3">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link
                href="/app/leads"
                className={`btn btn-sm ${!statusFilter ? "btn-primary" : "btn-secondary"}`}
              >
                All ({totalAll})
              </Link>
              {validStatuses.map((st) => (
                <Link
                  key={st}
                  href={`/app/leads?status=${st}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                  className={`btn btn-sm ${statusFilter === st ? "btn-primary" : "btn-secondary"}`}
                >
                  {st.replace("_", " ")} ({counts[st] ?? 0})
                </Link>
              ))}
            </div>

            <form method="GET" action="/app/leads" className="flex items-center gap-2">
              {statusFilter ? <input type="hidden" name="status" value={statusFilter} /> : null}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Search name, phone, email…"
                  className="input input-sm pl-8 text-xs"
                />
              </div>
              <button type="submit" className="btn btn-secondary btn-sm">
                Filter
              </button>
            </form>
          </div>

          {/* Data Table */}
          <DataTable
            columns={columns}
            rows={leads}
            emptyTitle="No leads found"
            emptyDescription={
              q || statusFilter
                ? "Try clearing filters to see more enquiries."
                : "Record your first enquiry from prospective parents or students."
            }
            emptyAction={
              canWrite ? (
                <Link href="/app/leads/new" className="btn btn-primary btn-sm mt-3">
                  <UserPlus className="size-3.5" /> Add enquiry
                </Link>
              ) : null
            }
            footer={
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                basePath="/app/leads"
                query={{ status: statusFilter, q: q }}
              />
            }
          />
        </div>

        {/* Sidebar: Upcoming Follow-ups */}
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Upcoming Follow-Ups"
              description="Scheduled calls & visits"
              action={<Calendar className="size-4 text-[var(--brand)]" />}
            />
            <div className="divide-y divide-[var(--border)]">
              {upcomingFollowUps.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted">
                  No pending follow-ups scheduled.
                </div>
              ) : (
                upcomingFollowUps.map((lead) => {
                  const isOverdue = lead.nextFollowUp && new Date(lead.nextFollowUp) < new Date();
                  return (
                    <div key={lead.id} className="p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <Link
                          href={`/app/leads/${lead.id}`}
                          className="font-semibold text-[var(--text)] hover:underline truncate"
                        >
                          {lead.studentName}
                        </Link>
                        <Badge tone={leadStatusTone(lead.status)} className="text-[10px]">
                          {lead.status.replace("_", " ")}
                        </Badge>
                      </div>
                      <p className="text-muted truncate">
                        {lead.guardianName} · {lead.guardianPhone}
                      </p>
                      <div className="flex items-center justify-between pt-1">
                        <span className={isOverdue ? "font-semibold text-[var(--danger)]" : "text-muted"}>
                          {date(lead.nextFollowUp)}
                        </span>
                        <Link href={`/app/leads/${lead.id}`} className="text-[var(--brand)] hover:underline">
                          Open →
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
