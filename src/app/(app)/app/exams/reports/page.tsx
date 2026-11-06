import Link from "next/link";
import {
  ArrowLeft,
  Award,
  BarChart3,
  Filter,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { Card, PageHeader, StatCard } from "@/components/ui/primitives";

export const metadata = { title: "Exam Performance Analytics" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ examId?: string }>;
}) {
  const { examId } = await searchParams;
  const ctx = await requireTenantPermission("tenant.exams.view_reports");

  const [publishedExams, selectedExam] = await Promise.all([
    db.examination.findMany({
      where: { tenantId: ctx.tenant.id, isPublished: true },
      select: { id: true, title: true, code: true, academicYear: { select: { name: true } } },
      orderBy: { publishedAt: "desc" },
    }),
    examId
      ? db.examination.findFirst({
          where: { id: examId, tenantId: ctx.tenant.id },
          include: {
            academicYear: true,
            gradeScale: { include: { bands: { orderBy: { minPercentage: "desc" } } } },
            subjects: { include: { subject: true } },
            results: {
              include: { student: true },
              orderBy: [{ rank: "asc" }, { percentage: "desc" }],
            },
          },
        })
      : null,
  ]);

  // If no exam is explicitly chosen, use first published exam if available
  const activeExam =
    selectedExam ||
    (publishedExams[0]
      ? await db.examination.findFirst({
          where: { id: publishedExams[0].id, tenantId: ctx.tenant.id },
          include: {
            academicYear: true,
            gradeScale: { include: { bands: { orderBy: { minPercentage: "desc" } } } },
            subjects: { include: { subject: true } },
            results: {
              include: { student: true },
              orderBy: [{ rank: "asc" }, { percentage: "desc" }],
            },
          },
        })
      : null);

  const results = activeExam?.results || [];
  const totalStudents = results.length;
  const passedStudents = results.filter((r) => r.resultStatus === "PASS").length;
  const passRate = totalStudents > 0 ? Math.round((passedStudents / totalStudents) * 100) : 0;

  const totalPercentage = results.reduce((sum, r) => sum + r.percentage, 0);
  const avgPercentage = totalStudents > 0 ? Math.round((totalPercentage / totalStudents) * 10) / 10 : 0;

  const highestScore = results.length > 0 ? Math.max(...results.map((r) => r.percentage)) : 0;
  const lowestScore = results.length > 0 ? Math.min(...results.map((r) => r.percentage)) : 0;

  // Grade distribution
  const gradeCounts: Record<string, number> = {};
  for (const r of results) {
    const g = r.grade || "N/A";
    gradeCounts[g] = (gradeCounts[g] || 0) + 1;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/app/exams" className="btn btn-ghost btn-sm text-zinc-500 hover:text-zinc-800">
          <ArrowLeft className="h-4 w-4" /> Back to Examinations
        </Link>
      </div>

      <PageHeader
        title="Institutional Assessment Analytics"
        description="Comprehensive comparative performance reports, grade distribution curves, and merit lists."
      />

      {/* Exam Selector Toolbar */}
      <Card className="p-4">
        <form className="flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Selected Examination:
            </span>
            <select
              name="examId"
              defaultValue={activeExam?.id || ""}
              className="select select-bordered select-sm text-xs font-medium"
            >
              {publishedExams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title} ({ex.code}) • {ex.academicYear.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-secondary btn-sm flex items-center gap-1">
              <Filter className="h-3.5 w-3.5" /> Load Analytics
            </button>
          </div>

          {activeExam && (
            <div className="text-xs text-zinc-500">
              Published on:{" "}
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                {activeExam.publishedAt ? new Date(activeExam.publishedAt).toLocaleDateString() : "-"}
              </span>
            </div>
          )}
        </form>
      </Card>

      {!activeExam ? (
        <Card className="p-12 text-center text-zinc-500">
          No published examinations found. Publish an assessment to generate performance analytics.
        </Card>
      ) : (
        <>
          {/* Key Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="Total Candidates" value={totalStudents} sub="Assessed students" />
            <StatCard label="Pass Rate" value={`${passRate}%`} sub={`${passedStudents} of ${totalStudents} cleared`} />
            <StatCard label="Batch Average" value={`${avgPercentage}%`} sub="Weighted score" />
            <StatCard label="Top Score" value={`${highestScore}%`} sub="Institutional highest" />
            <StatCard label="Minimum Score" value={`${lowestScore}%`} sub="Lower threshold" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Grade Distribution Breakdown */}
            <Card className="p-5 space-y-4">
              <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-indigo-500" /> Grade Distribution
              </h3>
              <div className="space-y-2">
                {activeExam.gradeScale.bands.map((b) => {
                  const count = gradeCounts[b.letterGrade] || 0;
                  const pct = totalStudents > 0 ? Math.round((count / totalStudents) * 100) : 0;
                  return (
                    <div key={b.id} className="space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-zinc-900 dark:text-zinc-100">
                          Grade {b.letterGrade} ({b.minPercentage}-{b.maxPercentage}%)
                        </span>
                        <span className="font-mono text-zinc-500">
                          {count} students ({pct}%)
                        </span>
                      </div>
                      <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            b.isPassing ? "bg-indigo-600 dark:bg-indigo-500" : "bg-red-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Top Rankers / Merit List */}
            <Card className="md:col-span-2 p-5 space-y-4">
              <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Award className="h-4 w-4 text-emerald-500" /> Top Academic Performers
              </h3>

              <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                <table className="table w-full text-xs">
                  <thead>
                    <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      <th className="w-12 text-center">Rank</th>
                      <th>Student</th>
                      <th>Adm No</th>
                      <th className="text-right">Total Marks</th>
                      <th className="text-right">Percentage</th>
                      <th className="text-center">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {results.slice(0, 10).map((r) => (
                      <tr key={r.id}>
                        <td className="text-center font-bold text-indigo-600 dark:text-indigo-400">
                          #{r.rank}
                        </td>
                        <td className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {r.student.firstName} {r.student.lastName}
                        </td>
                        <td className="text-zinc-500 font-mono">{r.student.admissionNo}</td>
                        <td className="text-right font-mono font-medium">
                          {r.totalMarksObtained} / {r.totalMaxMarks}
                        </td>
                        <td className="text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                          {r.percentage}%
                        </td>
                        <td className="text-center font-bold">{r.grade || "N/A"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
