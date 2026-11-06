import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  Filter,
  Layers,
  Plus,
  Search,
  Sparkles,
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
import { getSyllabusDashboardMetrics } from "@/actions/syllabus";
import type { SyllabusStatus, SyllabusTargetType, Prisma } from "@prisma/client";

export const metadata = { title: "SyllabusTrack & Curriculum" };

const PAGE_SIZE = 15;

function syllabusStatusTone(status: SyllabusStatus): Tone {
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

export default async function SyllabusPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    targetType?: string;
    academicYearId?: string;
    subjectId?: string;
    page?: string;
  }>;
}) {
  const ctx = await requireTenantPermission("tenant.syllabus.read");
  const canWrite = hasTenantPermission(ctx, "tenant.syllabus.write");

  const params = await searchParams;
  const q = (params.q || "").trim();
  const statusFilter = (params.status || "") as SyllabusStatus | "";
  const targetTypeFilter = (params.targetType || "") as SyllabusTargetType | "";
  const academicYearId = params.academicYearId || "";
  const subjectId = params.subjectId || "";
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);

  const isTeacher = ctx.membership?.roleKey === "TEACHER";

  // Fetch filter dropdown options
  const [academicYears, subjects, metrics] = await Promise.all([
    db.academicYear.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true, isActive: true },
    }),
    db.subject.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    getSyllabusDashboardMetrics(ctx.tenant.id, isTeacher ? ctx.user.id : undefined),
  ]);

  // Construct query filter
  const where: Prisma.SyllabusTrackWhereInput = {
    tenantId: ctx.tenant.id,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(targetTypeFilter ? { targetType: targetTypeFilter } : {}),
    ...(academicYearId ? { academicYearId } : {}),
    ...(subjectId ? { subjectId } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  // Teacher Scoping: If user is teacher, filter to assigned syllabuses
  if (ctx.membership?.roleKey === "TEACHER") {
    where.teachers = { some: { teacher: { userId: ctx.user.id } } };
  }

  const [totalCount, syllabuses] = await Promise.all([
    db.syllabusTrack.count({ where }),
    db.syllabusTrack.findMany({
      where,
      include: {
        academicYear: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true, code: true } },
        class: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
        batch: { select: { id: true, name: true, code: true } },
        teachers: {
          include: {
            teacher: {
              include: { user: { select: { id: true, name: true, avatarColor: true } } },
            },
          },
        },
        _count: {
          select: {
            chapters: true,
            topics: true,
            lessonPlans: true,
          },
        },
        topics: {
          select: { id: true, status: true },
        },
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="SyllabusTrack"
        description="Curriculum hierarchy, chapter lesson planning, and verified topic progress."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/app/syllabus/reports" className="btn btn-secondary btn-sm text-xs flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-muted" />
              <span>Completion Reports</span>
            </Link>
            {canWrite && (
              <Link href="/app/syllabus/new" className="btn btn-primary btn-sm flex items-center gap-1.5">
                <Plus className="size-4" />
                <span>New Syllabus</span>
              </Link>
            )}
          </div>
        }
      />

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Total Syllabuses"
          value={num(metrics.totalSyllabuses)}
          sub={`${metrics.activeSyllabuses} active`}
          tone="brand"
          icon={<BookOpen className="size-4" />}
        />
        <StatCard
          label="Chapters Defined"
          value={num(metrics.totalChapters)}
          sub={`${metrics.totalTopics} total topics`}
          tone="neutral"
          icon={<Layers className="size-4" />}
        />
        <StatCard
          label="Completed Topics"
          value={num(metrics.completedTopics)}
          sub={`${metrics.completionRate}% syllabus progress`}
          tone="success"
          icon={<CheckCircle2 className="size-4" />}
        />
        <StatCard
          label="In-Progress"
          value={num(metrics.inProgressTopics)}
          sub={`${metrics.pendingTopics} pending`}
          tone="warning"
          icon={<Clock className="size-4" />}
        />
        <StatCard
          label="Delayed Topics"
          value={num(metrics.delayedTopics)}
          sub={metrics.delayedTopics > 0 ? "Past scheduled date" : "On schedule"}
          tone={metrics.delayedTopics > 0 ? "danger" : "success"}
          icon={<AlertTriangle className="size-4" />}
        />
      </div>

      {/* Search & Filters */}
      <Card className="p-4 space-y-3">
        <form method="GET" action="/app/syllabus" className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="relative md:col-span-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search syllabus name, code..."
              className="input pl-9 text-xs w-full"
            />
          </div>

          <div className="md:col-span-2">
            <select name="status" defaultValue={statusFilter} className="input text-xs w-full">
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="DRAFT">Draft</option>
              <option value="COMPLETED">Completed</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select name="targetType" defaultValue={targetTypeFilter} className="input text-xs w-full">
              <option value="">All Target Types</option>
              <option value="CLASS_SECTION">Conventional (Class)</option>
              <option value="BATCH">Coaching (Batch)</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select name="academicYearId" defaultValue={academicYearId} className="input text-xs w-full">
              <option value="">All Academic Years</option>
              {academicYears.map((ay) => (
                <option key={ay.id} value={ay.id}>
                  {ay.name} {ay.isActive ? "(Current)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select name="subjectId" defaultValue={subjectId} className="input text-xs w-full">
              <option value="">All Subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-12 flex items-center justify-end gap-2">
            <button type="submit" className="btn btn-secondary btn-sm text-xs flex items-center justify-center gap-1.5">
              <Filter className="size-3.5" />
              <span>Filter</span>
            </button>
            {(q || statusFilter || targetTypeFilter || academicYearId || subjectId) && (
              <Link href="/app/syllabus" className="btn btn-ghost btn-sm text-xs text-muted">
                Reset
              </Link>
            )}
          </div>
        </form>
      </Card>

      {/* Syllabus Card Grid */}
      {syllabuses.length === 0 ? (
        <EmptyState
          icon="book"
          title="No syllabus structures found"
          description={
            q || statusFilter || targetTypeFilter || academicYearId || subjectId
              ? "No syllabus matching your filter criteria. Try adjusting your filters."
              : "Define your institute's academic curriculum, chapters, and topic milestones to track classroom teaching."
          }
          action={
            canWrite ? (
              <Link href="/app/syllabus/new" className="btn btn-primary btn-sm">
                <Plus className="size-4 mr-1.5" />
                <span>Create First Syllabus</span>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {syllabuses.map((s) => {
            const completedCount = s.topics.filter((t) => t.status === "COMPLETED").length;
            const totalTopics = s.topics.length;
            const progressPct = totalTopics > 0 ? Math.round((completedCount / totalTopics) * 100) : 0;

            return (
              <Link
                key={s.id}
                href={`/app/syllabus/${s.id}`}
                className="card p-5 border border-[var(--border)] hover:border-[var(--brand)] transition group flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] font-mono text-muted bg-[var(--accent)] px-2 py-0.5 rounded">
                      {s.code}
                    </span>
                    <Badge tone={syllabusStatusTone(s.status)}>{s.status}</Badge>
                  </div>

                  <h3 className="text-sm font-semibold text-foreground mt-2.5 group-hover:text-[var(--brand)] transition line-clamp-1">
                    {s.name}
                  </h3>
                  <p className="text-xs text-muted mt-1 line-clamp-2">
                    {s.description || "No description provided."}
                  </p>

                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <span className="badge badge-neutral text-[11px]">
                      {s.subject.name}
                    </span>
                    {s.targetType === "CLASS_SECTION" ? (
                      <span className="badge badge-brand text-[11px]">
                        {s.class?.name} {s.section ? `• ${s.section.name}` : ""}
                      </span>
                    ) : (
                      <span className="badge badge-info text-[11px]">
                        Batch: {s.batch?.name || s.batch?.code}
                      </span>
                    )}
                    <span className="text-[11px] text-muted">
                      {s.academicYear.name}
                    </span>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-[var(--border)] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">Progress ({completedCount}/{totalTopics} topics)</span>
                    <span className="font-semibold text-foreground">{progressPct}%</span>
                  </div>
                  <Progress value={progressPct} tone={progressPct === 100 ? "success" : "brand"} />

                  <div className="flex items-center justify-between pt-2 text-[11px] text-muted">
                    <span>{s._count.chapters} Chapters &bull; {s._count.lessonPlans} Lessons</span>
                    {s.teachers.length > 0 && (
                      <span className="truncate max-w-[140px]">
                        Faculty: {s.teachers.map((t) => t.teacher.user.name).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <Pagination page={page} total={totalCount} pageSize={PAGE_SIZE} basePath="/app/syllabus" />
      )}
    </div>
  );
}
