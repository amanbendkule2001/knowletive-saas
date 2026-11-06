import Link from "next/link";
import {
  Award,
  Filter,
  Plus,
  Search,
  Sliders,
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
} from "@/components/ui/primitives";
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
      db.academicYear.findMany({
        where: { tenantId: ctx.tenant.id },
        orderBy: { startDate: "desc" },
      }),
      db.examination.count({ where: { tenantId: ctx.tenant.id } }),
      db.examination.count({ where: { tenantId: ctx.tenant.id, status: "SCHEDULED" } }),
      db.examination.count({ where: { tenantId: ctx.tenant.id, status: "EVALUATED" } }),
      db.examination.count({ where: { tenantId: ctx.tenant.id, status: "PUBLISHED" } }),
      db.examEnrollment.count({ where: { tenantId: ctx.tenant.id } }),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Examinations & Assessments"
        description="Schedule conventional school and batch-targeted examinations, manage subject evaluation grids, and publish verified report cards."
        actions={
          <div className="flex items-center gap-2">
            {canGrading && (
              <Link href="/app/exams/grading" className="btn btn-secondary text-sm flex items-center gap-1.5">
                <Sliders className="h-4 w-4" />
                Grading Scales
              </Link>
            )}
            {canReports && (
              <Link href="/app/exams/reports" className="btn btn-secondary text-sm flex items-center gap-1.5">
                <Award className="h-4 w-4" />
                Analytics & Reports
              </Link>
            )}
            {canWrite && (
              <Link href="/app/exams/new" className="btn btn-primary text-sm flex items-center gap-1.5">
                <Plus className="h-4 w-4" />
                New Examination
              </Link>
            )}
          </div>
        }
      />

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total Examinations" value={totalCount} sub="All academic levels" />
        <StatCard label="Scheduled" value={scheduledCount} sub="Upcoming assessments" />
        <StatCard label="Evaluated" value={evaluatedCount} sub="Awaiting publication" />
        <StatCard label="Published" value={publishedCount} sub="Report cards issued" />
        <StatCard label="Active Enrollments" value={enrollmentCount} sub="Student candidates" />
      </div>

      {/* Filters Toolbar */}
      <Card className="p-4 space-y-3">
        <form className="flex flex-col md:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search by examination title or code..."
              className="input input-bordered input-sm pl-9 w-full"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <select
              name="status"
              defaultValue={statusFilter || ""}
              className="select select-bordered select-sm text-xs"
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
              className="select select-bordered select-sm text-xs"
            >
              <option value="">All Academic Targets</option>
              <option value="CLASS_SECTION">Class / Section</option>
              <option value="BATCH">Enterprise Batch</option>
            </select>

            <select
              name="academicYearId"
              defaultValue={academicYearId || ""}
              className="select select-bordered select-sm text-xs"
            >
              <option value="">All Academic Years</option>
              {academicYears.map((ay) => (
                <option key={ay.id} value={ay.id}>
                  {ay.name}
                </option>
              ))}
            </select>

            <button type="submit" className="btn btn-secondary btn-sm flex items-center gap-1">
              <Filter className="h-3.5 w-3.5" /> Filter
            </button>
          </div>
        </form>
      </Card>

      {/* Examination Listing Table */}
      {exams.length === 0 ? (
        <EmptyState
          title="No examinations found"
          description="Create your first assessment to schedule exams, assign subjects, and evaluate student marks."
          action={
            canWrite ? (
              <Link href="/app/exams/new" className="btn btn-primary btn-sm flex items-center gap-1.5 mt-2">
                <Plus className="h-4 w-4" /> Create Examination
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-base-100 shadow-sm">
          <table className="table w-full text-sm">
            <thead>
              <tr className="bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 text-xs">
                <th>Examination</th>
                <th>Target Academic Unit</th>
                <th>Term & Academic Year</th>
                <th>Assessment Window</th>
                <th className="text-center">Subjects</th>
                <th className="text-center">Enrolled</th>
                <th className="text-center">Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {exams.map((exam) => {
                const targetLabel =
                  exam.targetType === "BATCH"
                    ? `Batch: ${exam.batch?.name || "N/A"}`
                    : `Class: ${exam.class?.name || "N/A"}${exam.section ? ` - Sec ${exam.section.name}` : " (All Sections)"}`;

                return (
                  <tr key={exam.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                    <td>
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                        <Link href={`/app/exams/${exam.id}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">
                          {exam.title}
                        </Link>
                      </div>
                      <div className="text-xs text-zinc-400 font-mono">
                        {exam.code} • {exam.examType.replace("_", " ")}
                      </div>
                    </td>

                    <td>
                      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {targetLabel}
                      </span>
                    </td>

                    <td className="text-xs text-zinc-500">
                      <div>{exam.term || "Regular Term"}</div>
                      <div className="text-zinc-400">{exam.academicYear.name}</div>
                    </td>

                    <td className="text-xs text-zinc-500">
                      <div>{new Date(exam.startDate).toLocaleDateString()}</div>
                      <div className="text-zinc-400">to {new Date(exam.endDate).toLocaleDateString()}</div>
                    </td>

                    <td className="text-center font-mono font-medium text-zinc-700 dark:text-zinc-300">
                      {exam._count.subjects}
                    </td>

                    <td className="text-center font-mono font-medium text-zinc-700 dark:text-zinc-300">
                      {exam._count.enrollments}
                    </td>

                    <td className="text-center">
                      <Badge tone={examStatusTone(exam.status)}>
                        {exam.status}
                      </Badge>
                    </td>

                    <td className="text-right">
                      <Link
                        href={`/app/exams/${exam.id}`}
                        className="btn btn-ghost btn-xs text-indigo-600 dark:text-indigo-400 font-medium"
                      >
                        Manage Studio →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
