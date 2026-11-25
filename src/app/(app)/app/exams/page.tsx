import Link from "next/link";
import {
  Award,
  Filter,
  Plus,
  Search,
  Sliders,
  Calendar,
  BookOpen,
  Layers,
  Users,
  FileText,
  CheckCircle2,
  ArrowRight,
  X,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  Tone,
  statusLabel,
} from "@/components/ui/primitives";
import { getOrProvisionAcademicYears } from "@/lib/academic-years";
import { cn } from "@/lib/utils";
import type { ExamStatus, ExamTargetType, Prisma } from "@prisma/client";

export const metadata = { title: "Examinations & Assessments" };

function examStatusTone(status: ExamStatus): Tone {
  switch (status) {
    case "PUBLISHED":
      return "success";
    case "EVALUATED":
      return "info";
    case "IN_PROGRESS":
      return "brand";
    case "SCHEDULED":
      return "warning";
    case "DRAFT":
      return "neutral";
    case "ARCHIVED":
      return "neutral";
    default:
      return "neutral";
  }
}

function formatExamDate(dateStr: Date | string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function ExamsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    targetType?: string;
    academicYearId?: string;
  }>;
}) {
  const ctx = await requireTenantPermission("tenant.exams.read");
  const canWrite = hasTenantPermission(ctx, "tenant.exams.write");
  const canGrading = hasTenantPermission(ctx, "tenant.exams.manage_grading");
  const canReports = hasTenantPermission(ctx, "tenant.exams.view_reports");

  const sp = await searchParams;
  const q = sp.q?.trim();
  const statusFilter = sp.status as ExamStatus | undefined;
  const targetTypeFilter = sp.targetType as ExamTargetType | undefined;
  const academicYearId = sp.academicYearId;

  // Build where filter
  const where: Prisma.ExaminationWhereInput = {
    tenantId: ctx.tenant.id,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(targetTypeFilter ? { targetType: targetTypeFilter } : {}),
    ...(academicYearId ? { academicYearId } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [exams, academicYears, totalCount, scheduledCount, evaluatedCount, publishedCount, enrollmentCount] =
    await Promise.all([
      db.examination.findMany({
        where,
        include: {
          academicYear: true,
          gradeScale: true,
          class: true,
          section: true,
          batch: true,
          syllabusTrack: { select: { id: true, name: true, code: true } },
          _count: {
            select: {
              subjects: true,
              enrollments: true,
              results: true,
            },
          },
        },
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      }),
      getOrProvisionAcademicYears(ctx.tenant.id),
      db.examination.count({ where: { tenantId: ctx.tenant.id } }),
      db.examination.count({ where: { tenantId: ctx.tenant.id, status: "SCHEDULED" } }),
      db.examination.count({ where: { tenantId: ctx.tenant.id, status: "EVALUATED" } }),
      db.examination.count({ where: { tenantId: ctx.tenant.id, status: "PUBLISHED" } }),
      db.examEnrollment.count({ where: { tenantId: ctx.tenant.id } }),
    ]);

  const hasActiveFilters = Boolean(q || statusFilter || targetTypeFilter || academicYearId);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Assessments"
        title="Examinations & Assessments"
        description="Schedule conventional school and batch-targeted examinations, manage subject evaluation grids, and publish verified report cards."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canGrading && (
              <Link href="/app/exams/grading" className="btn btn-secondary btn-sm flex items-center gap-1.5 text-xs">
                <Sliders className="size-3.5" />
                <span>Grading Scales</span>
              </Link>
            )}
            {canReports && (
              <Link href="/app/exams/reports" className="btn btn-secondary btn-sm flex items-center gap-1.5 text-xs">
                <Award className="size-3.5" />
                <span>Analytics & Reports</span>
              </Link>
            )}
            {canWrite && (
              <Link href="/app/exams/new" className="btn btn-primary btn-sm flex items-center gap-1.5 text-xs">
                <Plus className="size-3.5" />
                <span>New Examination</span>
              </Link>
            )}
          </div>
        }
      />

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <StatCard
          label="Total Examinations"
          value={totalCount}
          sub="All academic levels"
          icon={<FileText className="size-4" />}
          tone="brand"
          href="/app/exams"
          active={!statusFilter}
        />
        <StatCard
          label="Scheduled"
          value={scheduledCount}
          sub="Upcoming assessments"
          icon={<Calendar className="size-4" />}
          tone="warning"
          href="/app/exams?status=SCHEDULED"
          active={statusFilter === "SCHEDULED"}
        />
        <StatCard
          label="Evaluated"
          value={evaluatedCount}
          sub="Awaiting publication"
          icon={<CheckCircle2 className="size-4" />}
          tone="info"
          href="/app/exams?status=EVALUATED"
          active={statusFilter === "EVALUATED"}
        />
        <StatCard
          label="Published"
          value={publishedCount}
          sub="Report cards issued"
          icon={<Award className="size-4" />}
          tone="success"
          href="/app/exams?status=PUBLISHED"
          active={statusFilter === "PUBLISHED"}
        />
        <StatCard
          label="Active Enrollments"
          value={enrollmentCount}
          sub="Student candidates"
          icon={<Users className="size-4" />}
          tone="neutral"
          href="/app/exams/reports"
        />
      </div>

      {/* Filters Toolbar */}
      <Card className="p-3.5 sm:p-4">
        <form className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search by examination title or code…"
              className="input pl-9 text-xs w-full"
            />
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap lg:flex-nowrap items-center gap-2">
            <select
              name="status"
              defaultValue={statusFilter || ""}
              className="input text-xs w-full sm:w-auto"
            >
              <option value="">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="EVALUATED">Evaluated</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
            </select>

            <select
              name="targetType"
              defaultValue={targetTypeFilter || ""}
              className="input text-xs w-full sm:w-auto"
            >
              <option value="">All Academic Targets</option>
              <option value="CLASS_SECTION">Class / Section</option>
              <option value="BATCH">Coaching & Cohort Batch</option>
            </select>

            <select
              name="academicYearId"
              defaultValue={academicYearId || ""}
              className="input text-xs w-full sm:w-auto"
            >
              <option value="">All Academic Years</option>
              {academicYears.map((ay) => (
                <option key={ay.id} value={ay.id}>
                  {ay.name}
                </option>
              ))}
            </select>

            <div className="col-span-2 sm:col-span-1 flex items-center gap-2">
              <button
                type="submit"
                className="btn btn-secondary btn-sm text-xs flex-1 sm:flex-initial flex items-center justify-center gap-1.5"
              >
                <Filter className="size-3.5" /> Filter
              </button>
              {hasActiveFilters && (
                <Link
                  href="/app/exams"
                  className="btn btn-ghost btn-sm text-xs text-muted hover:text-foreground flex items-center gap-1"
                  title="Clear all filters"
                >
                  <X className="size-3.5" />
                  <span className="hidden sm:inline">Reset</span>
                </Link>
              )}
            </div>
          </div>
        </form>
      </Card>

      {/* Examination Listing Table */}
      {exams.length === 0 ? (
        <Card>
          <EmptyState
            title="No examinations found"
            description={
              hasActiveFilters
                ? "No examinations match your selected filter criteria. Try adjusting your query or resetting filters."
                : "Create your first assessment to schedule exams, assign subjects, and evaluate student marks."
            }
            action={
              hasActiveFilters ? (
                <Link href="/app/exams" className="btn btn-secondary btn-sm mt-3">
                  Reset filters
                </Link>
              ) : canWrite ? (
                <Link href="/app/exams/new" className="btn btn-primary btn-sm flex items-center gap-1.5 mt-3">
                  <Plus className="size-4" /> Create Examination
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          {/* Desktop & Tablet Table View */}
          <Card className="overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-sunken)] text-muted font-medium">
                    <th className="py-3 px-4">Examination</th>
                    <th className="py-3 px-4">Target Academic Unit</th>
                    <th className="py-3 px-4">Term & Academic Year</th>
                    <th className="py-3 px-4">Assessment Window</th>
                    <th className="py-3 px-4 text-center">Subjects</th>
                    <th className="py-3 px-4 text-center">Enrolled</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {exams.map((exam) => {
                    const isBatch = exam.targetType === "BATCH";
                    const targetName = isBatch
                      ? exam.batch?.name || "Batch (Unassigned)"
                      : exam.class?.name || "Class (Unassigned)";
                    const targetSub = isBatch
                      ? exam.batch?.code ? `Code: ${exam.batch.code}` : null
                      : exam.section ? `Section ${exam.section.name}` : "All Sections";

                    return (
                      <tr key={exam.id} className="hover:bg-[var(--surface-hover)] transition-colors">
                        {/* Examination Name & Details */}
                        <td className="py-3 px-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <Link
                                href={`/app/exams/${exam.id}`}
                                className="font-semibold text-foreground hover:text-[var(--brand)] transition-colors line-clamp-1"
                              >
                                {exam.title}
                              </Link>
                              {Date.now() - new Date(exam.createdAt).getTime() < 48 * 3600 * 1000 && (
                                <span className="inline-flex items-center gap-1 rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--brand)]">
                                  <span className="size-1 rounded-full bg-[var(--brand)] animate-pulse" />
                                  New
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-muted font-medium">
                                {exam.code}
                              </span>
                              <span className="text-[11px] text-muted capitalize">
                                {exam.examType.replace(/_/g, " ").toLowerCase()}
                              </span>
                              {exam.syllabusTrack && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 font-medium truncate max-w-[160px]" title={exam.syllabusTrack.name}>
                                  {exam.syllabusTrack.name}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Target Unit */}
                        <td className="py-3 px-4">
                          <div className="flex items-start gap-2">
                            <span
                              className={cn(
                                "mt-0.5 grid size-6 place-items-center rounded-md shrink-0 text-xs",
                                isBatch
                                  ? "bg-indigo-500/10 text-indigo-400"
                                  : "bg-emerald-500/10 text-emerald-400",
                              )}
                            >
                              {isBatch ? (
                                <Layers className="size-3.5" />
                              ) : (
                                <BookOpen className="size-3.5" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <div className="font-medium text-foreground text-xs truncate max-w-[200px]">
                                {targetName}
                              </div>
                              {targetSub && (
                                <div className="text-[11px] text-muted truncate max-w-[200px]">
                                  {targetSub}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Term & Academic Year */}
                        <td className="py-3 px-4">
                          <div className="font-medium text-foreground">
                            {exam.term || "Regular Term"}
                          </div>
                          <div className="text-[11px] text-muted font-mono">
                            {exam.academicYear.name}
                          </div>
                        </td>

                        {/* Assessment Window */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 font-medium text-foreground">
                            <Calendar className="size-3 text-muted shrink-0" />
                            <span>{formatExamDate(exam.startDate)}</span>
                          </div>
                          <div className="text-[11px] text-muted pl-4.5">
                            to {formatExamDate(exam.endDate)}
                          </div>
                        </td>

                        {/* Subjects count */}
                        <td className="py-3 px-4 text-center">
                          <div className="inline-flex flex-col items-center">
                            <span className="font-mono font-semibold text-xs text-foreground">
                              {exam._count.subjects}
                            </span>
                            <span className="text-[10px] text-muted">
                              {exam._count.subjects === 1 ? "subject" : "subjects"}
                            </span>
                          </div>
                        </td>

                        {/* Enrollments count */}
                        <td className="py-3 px-4 text-center">
                          <div className="inline-flex flex-col items-center">
                            <span className="font-mono font-semibold text-xs text-foreground">
                              {exam._count.enrollments}
                            </span>
                            <span className="text-[10px] text-muted">
                              {exam._count.enrollments === 1 ? "student" : "students"}
                            </span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3 px-4 text-center">
                          <Badge tone={examStatusTone(exam.status)} className="text-[11px] font-medium tracking-wide">
                            {statusLabel(exam.status)}
                          </Badge>
                        </td>

                        {/* Action */}
                        <td className="py-3 px-4 text-right">
                          <Link
                            href={`/app/exams/${exam.id}`}
                            className="btn btn-secondary btn-sm text-xs font-medium inline-flex items-center gap-1 hover:border-[var(--brand)] transition-all"
                          >
                            <span>Manage Studio</span>
                            <ArrowRight className="size-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile Card List (Optimized for small screens) */}
          <div className="space-y-3 md:hidden">
            {exams.map((exam) => {
              const isBatch = exam.targetType === "BATCH";
              const targetName = isBatch
                ? exam.batch?.name || "Batch (Unassigned)"
                : exam.class?.name || "Class (Unassigned)";
              const targetSub = isBatch
                ? exam.batch?.code ? `Code: ${exam.batch.code}` : null
                : exam.section ? `Section ${exam.section.name}` : "All Sections";

              return (
                <Card key={exam.id} className="p-4 space-y-3 hover:border-[var(--brand)] transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <Link
                        href={`/app/exams/${exam.id}`}
                        className="font-semibold text-sm text-foreground hover:text-[var(--brand)] transition-colors line-clamp-2"
                      >
                        {exam.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-3)] font-medium">
                          {exam.code}
                        </span>
                        <span>•</span>
                        <span className="capitalize">{exam.examType.replace(/_/g, " ").toLowerCase()}</span>
                      </div>
                    </div>
                    <Badge tone={examStatusTone(exam.status)} className="shrink-0 text-[11px]">
                      {statusLabel(exam.status)}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 py-2 border-y border-[var(--border)] text-xs">
                    <div>
                      <span className="text-[10px] text-muted block uppercase tracking-wider font-semibold">Target</span>
                      <span className="font-medium text-foreground truncate block">
                        {targetName}
                      </span>
                      {targetSub && <span className="text-[10px] text-muted block truncate">{targetSub}</span>}
                    </div>
                    <div>
                      <span className="text-[10px] text-muted block uppercase tracking-wider font-semibold">Timeline</span>
                      <span className="font-medium text-foreground block">
                        {formatExamDate(exam.startDate)}
                      </span>
                      <span className="text-[10px] text-muted block">to {formatExamDate(exam.endDate)}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <div className="flex items-center gap-2 text-muted">
                      <span><strong className="text-foreground">{exam._count.subjects}</strong> subjects</span>
                      <span>•</span>
                      <span><strong className="text-foreground">{exam._count.enrollments}</strong> students</span>
                    </div>
                    <Link
                      href={`/app/exams/${exam.id}`}
                      className="btn btn-secondary btn-sm text-xs flex items-center gap-1"
                    >
                      <span>Manage</span>
                      <ArrowRight className="size-3" />
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
