import Link from "next/link";
import { ArrowLeft, BookOpen, CheckCircle2, Clock, TrendingUp } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { Card, PageHeader, Progress, StatCard } from "@/components/ui/primitives";
import { num } from "@/lib/format";
import { getSyllabusDashboardMetrics } from "@/actions/syllabus";

export const metadata = { title: "Syllabus Progress Reports — Knowletive" };

export default async function SyllabusReportsPage() {
  const ctx = await requireTenantPermission("tenant.syllabus.view_reports");

  const isTeacher = ctx.membership?.roleKey === "TEACHER";

  const [metrics, subjects, teachers] = await Promise.all([
    getSyllabusDashboardMetrics(ctx.tenant.id, isTeacher ? ctx.user.id : undefined),
    db.subject.findMany({
      where: {
        tenantId: ctx.tenant.id,
        ...(isTeacher
          ? {
              syllabusTracks: {
                some: {
                  teachers: {
                    some: { teacher: { userId: ctx.user.id } },
                  },
                },
              },
            }
          : {}),
      },
      include: {
        syllabusTracks: {
          where: isTeacher
            ? {
                teachers: {
                  some: { teacher: { userId: ctx.user.id } },
                },
              }
            : undefined,
          include: {
            topics: { select: { id: true, status: true } },
          },
        },
      },
    }),
    db.membership.findMany({
      where: {
        tenantId: ctx.tenant.id,
        role: { key: "TEACHER" },
        ...(isTeacher ? { userId: ctx.user.id } : {}),
      },
      include: {
        user: true,
        assignedSyllabuses: {
          include: {
            syllabus: {
              include: {
                topics: { select: { id: true, status: true } },
              },
            },
          },
        },
        taughtProgresses: {
          select: { id: true, completedHours: true },
        },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Link href="/app/syllabus" className="hover:text-foreground flex items-center gap-1 transition">
          <ArrowLeft className="size-3.5" />
          <span>Back to SyllabusTrack</span>
        </Link>
      </div>

      <PageHeader
        title="Syllabus Progress & Completion Reports"
        description="Comprehensive analytics on subject coverage, faculty milestones, and delayed topics."
      />

      {/* KPI Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Overall Progress"
          value={`${metrics.completionRate}%`}
          sub={`${metrics.completedTopics} of ${metrics.totalTopics} topics`}
          tone="success"
          icon={<CheckCircle2 className="size-4" />}
        />
        <StatCard
          label="Active Syllabuses"
          value={num(metrics.activeSyllabuses)}
          sub={`${metrics.completedSyllabuses} fully delivered`}
          tone="brand"
          icon={<BookOpen className="size-4" />}
        />
        <StatCard
          label="In-Progress Topics"
          value={num(metrics.inProgressTopics)}
          sub="Currently being taught"
          tone="warning"
          icon={<Clock className="size-4" />}
        />
        <StatCard
          label="Delayed Topics"
          value={num(metrics.delayedTopics)}
          sub={metrics.delayedTopics > 0 ? "Requires attention" : "Zero delays"}
          tone={metrics.delayedTopics > 0 ? "danger" : "success"}
          icon={<TrendingUp className="size-4" />}
        />
      </div>

      {/* Subject-Wise Completion Matrix */}
      <Card className="p-5 border border-[var(--border)] space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Subject-Wise Curriculum Delivery</h3>
          <p className="text-xs text-muted">Aggregated across all classrooms and batches in this institute.</p>
        </div>

        <div className="divide-y divide-[var(--border)]">
          {subjects.length === 0 ? (
            <p className="text-xs text-muted py-4">No subjects configured yet.</p>
          ) : (
            subjects.map((sub) => {
              const allTopics = sub.syllabusTracks.flatMap((s) => s.topics);
              const total = allTopics.length;
              const completed = allTopics.filter((t) => t.status === "COMPLETED").length;
              const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

              return (
                <div key={sub.id} className="py-3.5 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                  <div className="md:col-span-4">
                    <p className="text-xs font-semibold text-foreground">{sub.name}</p>
                    <p className="text-[11px] text-muted">{sub.syllabusTracks.length} Active Syllabus Structures</p>
                  </div>

                  <div className="md:col-span-6 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">{completed}/{total} Topics Completed</span>
                      <span className="font-semibold text-foreground">{pct}%</span>
                    </div>
                    <Progress value={pct} tone={pct === 100 ? "success" : "brand"} />
                  </div>

                  <div className="md:col-span-2 text-right">
                    <span className="badge badge-neutral text-xs">
                      {sub.code || "Standard"}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Faculty Workload & Delivery */}
      <Card className="p-5 border border-[var(--border)] space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Faculty Progress & Workload</h3>
          <p className="text-xs text-muted">Curriculum delivery verified per assigned teacher.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {teachers.map((t) => {
            const assignedSyllabuses = t.assignedSyllabuses.map((a) => a.syllabus);
            const allTopics = assignedSyllabuses.flatMap((s) => s.topics);
            const total = allTopics.length;
            const completed = allTopics.filter((top) => top.status === "COMPLETED").length;
            const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
            const hoursTaught = t.taughtProgresses.reduce((acc, p) => acc + p.completedHours, 0);

            return (
              <div key={t.id} className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">{t.user.name}</h4>
                    <p className="text-[11px] text-muted">{t.user.email}</p>
                  </div>
                  <span className="text-[11px] font-mono text-muted bg-[var(--accent)] px-2 py-0.5 rounded">
                    {assignedSyllabuses.length} Assigned
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted">Progress</span>
                    <span className="font-semibold text-foreground">{completed}/{total} ({pct}%)</span>
                  </div>
                  <Progress value={pct} tone={pct === 100 ? "success" : "brand"} />
                </div>

                <p className="text-[11px] text-muted pt-1 border-t border-[var(--border)]">
                  Total Teaching Hours Logged: <span className="font-semibold text-foreground">{hoursTaught} hrs</span>
                </p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
