import Link from "next/link";
import {
  CheckCircle2,
  Filter,
  GraduationCap,
  Layers,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Pagination,
  Progress,
  StatCard,
  Tone,
} from "@/components/ui/primitives";
import { num } from "@/lib/format";
import type { BatchStatus, Prisma } from "@prisma/client";

export const metadata = { title: "Batch Management" };

const PAGE_SIZE = 15;

function batchStatusTone(status: BatchStatus): Tone {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "DRAFT":
      return "warning";
    case "COMPLETED":
      return "info";
    case "ARCHIVED":
      return "neutral";
    default:
      return "neutral";
  }
}

export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    academicYearId?: string;
    subjectId?: string;
    teacherId?: string;
    page?: string;
  }>;
}) {
  const ctx = await requireTenantPermission("tenant.batches.read");
  const canWrite = hasTenantPermission(ctx, "tenant.batches.write");

  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const statusFilter = sp.status as BatchStatus | undefined;
  const academicYearId = sp.academicYearId || undefined;
  const subjectId = sp.subjectId || undefined;
  const teacherId = sp.teacherId || undefined;
  const page = Math.max(1, parseInt(sp.page || "1", 10));

  const roleKey = ctx.membership?.roleKey;
  const isTeacher = roleKey === "TEACHER";
  const isInstAdminOrPrincipal = roleKey === "INSTITUTE_ADMIN" || roleKey === "PRINCIPAL";
  const teacherFilter = isTeacher && !isInstAdminOrPrincipal ? { teachers: { some: { teacher: { userId: ctx.user.id } } } } : {};

  // Build where clause
  const where: Prisma.BatchWhereInput = {
    tenantId: ctx.tenant.id,
    ...teacherFilter,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(academicYearId ? { academicYearId } : {}),
    ...(subjectId ? { subjectId } : {}),
    ...(teacherId ? { teachers: { some: { teacherId } } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
            { schedule: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const statsWhere: Prisma.BatchWhereInput = {
    tenantId: ctx.tenant.id,
    ...teacherFilter,
  };

  // Run stats and listing in parallel
  const [
    totalCount,
    batches,
    totalBatches,
    activeBatches,
    totalActiveEnrollments,
    totalCapacity,
    academicYears,
    subjects,
  ] = await Promise.all([
    db.batch.count({ where }),
    db.batch.findMany({
      where,
      include: {
        academicYear: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true, code: true } },
        teachers: {
          include: {
            teacher: { select: { id: true, user: { select: { name: true } } } },
          },
        },
        _count: {
          select: {
            students: { where: { status: "ACTIVE" } },
          },
        },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.batch.count({ where: statsWhere }),
    db.batch.count({ where: { ...statsWhere, status: "ACTIVE" } }),
    db.batchStudent.count({
      where: {
        batch: statsWhere,
        status: "ACTIVE",
      },
    }),
    db.batch.aggregate({
      where: { ...statsWhere, status: "ACTIVE" },
      _sum: { capacity: true },
    }),
    db.academicYear.findMany({
      where: { tenantId: ctx.tenant.id },
      select: { id: true, name: true },
      orderBy: { startDate: "desc" },
    }),
    db.subject.findMany({
      where: { tenantId: ctx.tenant.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const activeCapSum = totalCapacity._sum.capacity || 0;
  const availableCapacity = Math.max(0, activeCapSum - totalActiveEnrollments);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Batches"
        description="Manage subject groups, coaching batches, teacher assignments and student rosters."
        actions={
          canWrite ? (
            <Link href="/app/batches/new" className="btn btn-primary btn-sm flex items-center gap-1.5">
              <Plus className="size-4" />
              <span>Create batch</span>
            </Link>
          ) : undefined
        }
      />

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Total Batches"
          value={num(totalBatches)}
          icon={<Layers className="size-4" />}
          sub={`${activeBatches} currently active`}
        />
        <StatCard
          label="Active Batches"
          value={num(activeBatches)}
          icon={<CheckCircle2 className="size-4 text-[var(--success)]" />}
        />
        <StatCard
          label="Active Enrollments"
          value={num(totalActiveEnrollments)}
          icon={<GraduationCap className="size-4 text-[var(--brand)]" />}
          sub="Across all batches"
        />
        <StatCard
          label="Available Capacity"
          value={num(availableCapacity)}
          icon={<Users className="size-4 text-[var(--info)]" />}
          sub={`Of ${num(activeCapSum)} active seats`}
        />
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4">
        <form method="GET" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search by name, code, schedule..."
              className="input pl-9 text-xs w-full"
            />
          </div>

          <div>
            <select name="status" defaultValue={statusFilter || ""} className="input text-xs w-full">
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="DRAFT">Draft</option>
              <option value="COMPLETED">Completed</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>

          <div>
            <select name="academicYearId" defaultValue={academicYearId || ""} className="input text-xs w-full">
              <option value="">All Academic Years</option>
              {academicYears.map((ay) => (
                <option key={ay.id} value={ay.id}>
                  {ay.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select name="subjectId" defaultValue={subjectId || ""} className="input text-xs w-full">
              <option value="">All Subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-secondary btn-sm text-xs flex-1">
              <Filter className="size-3.5" /> Filter
            </button>
            {(q || statusFilter || academicYearId || subjectId || teacherId) && (
              <Link href="/app/batches" className="btn btn-ghost btn-sm text-xs text-muted">
                Reset
              </Link>
            )}
          </div>
        </form>
      </Card>

      {/* Batches Table */}
      {batches.length === 0 ? (
        <Card className="p-12">
          <EmptyState
            icon={<Layers className="size-8 text-muted" />}
            title="No batches found"
            description={
              q || statusFilter || academicYearId || subjectId
                ? "No batches match the applied search or filter criteria."
                : "Create your first batch to organize subject groups and student enrollments."
            }
            action={
              canWrite ? (
                <Link href="/app/batches/new" className="btn btn-primary btn-sm mt-3">
                  <Plus className="size-4" /> Create batch
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-sunken)] text-muted font-medium">
                  <th className="py-3 px-4">Batch Name & Code</th>
                  <th className="py-3 px-4">Academic Year</th>
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Assigned Teachers</th>
                  <th className="py-3 px-4 min-w-[160px]">Enrolled / Capacity</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {batches.map((b) => {
                  const activeCount = b._count.students;
                  const ratio = Math.round((activeCount / b.capacity) * 100);
                  const isFull = activeCount >= b.capacity;

                  return (
                    <tr key={b.id} className="hover:bg-[var(--surface-hover)] transition">
                      <td className="py-3 px-4">
                        <Link href={`/app/batches/${b.id}`} className="font-semibold text-foreground hover:underline">
                          {b.name}
                        </Link>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-[11px] text-muted">{b.code}</span>
                          {b.schedule && (
                            <span className="text-[11px] text-muted truncate max-w-[200px]" title={b.schedule}>
                              &bull; {b.schedule}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-muted">{b.academicYear.name}</td>
                      <td className="py-3 px-4">
                        {b.subject ? (
                          <span className="font-medium text-foreground">{b.subject.name}</span>
                        ) : (
                          <span className="text-muted italic">General / All-Subject</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {b.teachers.length === 0 ? (
                          <span className="text-muted text-[11px]">Unassigned</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {b.teachers.map((t) => (
                              <Badge key={t.id} tone="neutral" className="text-[10px]">
                                {t.teacher.user.name} {t.isPrimary ? "(Lead)" : ""}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-medium text-foreground">
                              {activeCount} / {b.capacity}
                            </span>
                            <span className={`text-[10px] ${isFull ? "text-[var(--danger)] font-semibold" : "text-muted"}`}>
                              {isFull ? "Full" : `${ratio}%`}
                            </span>
                          </div>
                          <Progress
                            value={activeCount}
                            max={b.capacity}
                            className={`h-1.5 ${isFull ? "[&>div]:bg-[var(--danger)]" : ""}`}
                          />
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge tone={batchStatusTone(b.status)}>{b.status}</Badge>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link href={`/app/batches/${b.id}`} className="btn btn-secondary btn-sm text-xs">
                          View details
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="border-t border-[var(--border)]">
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={totalCount}
                basePath="/app/batches"
                query={{ q, status: statusFilter, academicYearId, subjectId }}
              />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
