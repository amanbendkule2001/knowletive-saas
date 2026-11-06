import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowUpRight,
  CalendarCheck,
  CircleDollarSign,
  GraduationCap,
  Megaphone,
  Plus,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { requireTenant } from "@/lib/rbac";
import { db } from "@/lib/db";
import { hasTenantPermission, isStaffMember } from "@/lib/auth";
import { getAiUsage } from "@/lib/billing";
import { date, isoDate, money, monthLabel, num, pct, startOfDay, startOfMonth, timeAgo } from "@/lib/format";
import {
  Avatar,
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Progress,
  StatCard,
} from "@/components/ui/primitives";
import { AreaChart, BarList, Donut } from "@/components/ui/charts";

export const metadata = { title: "Overview" };

export default async function AppOverview() {
  const ctx = await requireTenant();
  if (!isStaffMember(ctx)) redirect("/portal");
  const tenantId = ctx.tenant.id;
  const plan = ctx.tenant.subscription?.plan ?? null;
  const now = new Date();
  const today = startOfDay(now);
  const monthStart = startOfMonth(now);
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const sevenDaysAgo = new Date(today.getTime() - 7 * 86_400_000);

  const [
    students,
    staff,
    todayAttendance,
    latestAttendance,
    monthCollected,
    outstandingInvoices,
    recentStudents,
    announcements,
    audit,
    payments,
    attendanceTrend,
    classGroups,
    classes,
    aiUsage,
  ] = await Promise.all([
    db.student.count({ where: { tenantId, status: "ACTIVE" } }),
    db.membership.count({ where: { tenantId, status: "ACTIVE" } }),
    db.attendance.groupBy({
      by: ["status"],
      where: { tenantId, date: today },
      _count: { _all: true },
    }),
    db.attendance.findFirst({
      where: { tenantId },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    db.feePayment.aggregate({
      where: { tenantId, paidAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    db.feeInvoice.findMany({
      where: { tenantId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
      select: { amount: true, paidAmount: true, dueDate: true },
    }),
    db.student.findMany({
      where: { tenantId, status: "ACTIVE" },
      include: { section: { include: { class: true } }, guardians: { include: { guardian: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.announcement.findMany({
      where: { tenantId },
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      take: 4,
    }),
    db.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 6 }),
    db.feePayment.findMany({
      where: { tenantId, paidAt: { gte: sixMonthsAgo } },
      select: { amount: true, paidAt: true },
    }),
    db.attendance.groupBy({
      by: ["date", "status"],
      where: { tenantId, date: { gte: sevenDaysAgo } },
      _count: { _all: true },
    }),
    db.student.groupBy({
      by: ["classId"],
      where: { tenantId, status: "ACTIVE" },
      _count: { _all: true },
    }),
    db.classLevel.findMany({ where: { tenantId }, orderBy: { order: "asc" } }),
    plan ? getAiUsage(tenantId, plan.aiCreditsMonthly) : Promise.resolve(null),
  ]);

  let dayAttendance: { status: string; _count: { _all: number } }[] = todayAttendance;
  let attendanceDay = today;
  if (dayAttendance.length === 0 && latestAttendance?.date) {
    attendanceDay = latestAttendance.date;
    const fallback = await db.attendance.groupBy({
      by: ["status"],
      where: { tenantId, date: latestAttendance.date },
      _count: { _all: true },
    });
    dayAttendance = fallback;
  }
  const attendanceTotal = dayAttendance.reduce((sum, row) => sum + row._count._all, 0);
  const present = dayAttendance.find((r) => r.status === "PRESENT")?._count._all ?? 0;
  const late = dayAttendance.find((r) => r.status === "LATE")?._count._all ?? 0;
  const absent = dayAttendance.find((r) => r.status === "ABSENT")?._count._all ?? 0;
  const excused = dayAttendance.find((r) => r.status === "EXCUSED")?._count._all ?? 0;
  const attendanceRate = attendanceTotal ? ((present + late) / attendanceTotal) * 100 : 0;

  const collected = monthCollected._sum.amount ?? 0;
  const outstanding = outstandingInvoices.reduce((sum, inv) => sum + (inv.amount - inv.paidAmount), 0);
  const overdueCount = outstandingInvoices.filter((i) => i.dueDate < now).length;

  const months: { key: string; label: string; value: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, label: monthLabel(d), value: 0 });
  }
  for (const payment of payments) {
    if (!payment.paidAt) continue;
    const bucket = months.find(
      (m) => m.key === `${payment.paidAt!.getUTCFullYear()}-${payment.paidAt!.getUTCMonth()}`,
    );
    if (bucket) bucket.value += payment.amount;
  }

  const trendMap = new Map<string, { present: number; total: number }>();
  for (const row of attendanceTrend) {
    const key = isoDate(row.date);
    const bucket = trendMap.get(key) ?? { present: 0, total: 0 };
    bucket.total += row._count._all;
    if (row.status === "PRESENT" || row.status === "LATE") bucket.present += row._count._all;
    trendMap.set(key, bucket);
  }
  const attendancePoints = [...trendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      label: new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(new Date(key)),
      value: value.total ? Math.round((value.present / value.total) * 100) : 0,
    }));

  const classNames = new Map(classes.map((c) => [c.id, c.name]));
  const classStrength = classGroups
    .map((g) => ({
      label: g.classId ? classNames.get(g.classId) ?? "Unassigned" : "Unassigned",
      value: g._count._all,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const canWriteStudents = hasTenantPermission(ctx, "tenant.students.write");
  const canWriteFees = hasTenantPermission(ctx, "tenant.fees.write");
  const canWriteAttendance = hasTenantPermission(ctx, "tenant.attendance.write");
  const canUseAi = hasTenantPermission(ctx, "tenant.ai.use") && plan?.features.includes("ai");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={ctx.membership?.roleName ?? "Workspace"}
        title={`${ctx.tenant.name}`}
        description="A live view of enrolment, attendance and fee collection for the current month."
        actions={
          <>
            {canWriteStudents && (
              <Link href="/app/students/new" className="btn btn-secondary">
                <Plus className="size-4" /> Add student
              </Link>
            )}
            {canUseAi && (
              <Link href="/app/ai" className="btn btn-primary">
                <Sparkles className="size-4" /> AI Studio
              </Link>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active students"
          value={num(students)}
          sub={plan ? `of ${num(plan.maxStudents)} on ${plan.name}` : "No active plan"}
          icon={<GraduationCap className="size-4" />}
          href="/app/students"
        />
        <StatCard
          label="Attendance"
          value={attendanceTotal ? pct(attendanceRate, 0) : "—"}
          sub={
            attendanceTotal
              ? `${num(present + late)} of ${num(attendanceTotal)} in · ${date(attendanceDay)}`
              : "Not marked yet"
          }
          icon={<CalendarCheck className="size-4" />}
          tone={attendanceRate >= 90 ? "success" : attendanceRate >= 75 ? "warning" : "danger"}
          href="/app/attendance"
        />
        <StatCard
          label="Collected this month"
          value={money(collected)}
          sub={`Since ${date(monthStart)}`}
          icon={<Wallet className="size-4" />}
          tone="success"
          href="/app/fees"
        />
        <StatCard
          label="Outstanding fees"
          value={money(outstanding)}
          sub={`${outstandingInvoices.length} invoices · ${overdueCount} overdue`}
          icon={<CircleDollarSign className="size-4" />}
          tone={outstanding > 0 ? "warning" : "success"}
          href="/app/fees?status=OVERDUE"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Card>
          <CardHeader
            title="Fee collections"
            description="Recorded payments over the last six months"
            action={<Badge tone="brand">GST ready</Badge>}
          />
          <div className="p-4">
            <AreaChart data={months} format="money" height={220} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Attendance mix"
            description={attendanceTotal ? `Latest register — ${date(attendanceDay)}` : "No attendance marked"}
          />
          <div className="p-4">
            {attendanceTotal ? (
              <>
                <Donut
                  segments={[
                    { label: "Present", value: present, color: "#10b981" },
                    { label: "Late", value: late, color: "#f59e0b" },
                    { label: "Absent", value: absent, color: "#ef4444" },
                    { label: "Excused", value: excused, color: "#38bdf8" },
                  ]}
                  centerValue={pct(attendanceRate, 0)}
                  centerLabel="present"
                />
                <div className="mt-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Last 7 days
                  </p>
                  <BarList
                    data={attendancePoints.length ? attendancePoints : [{ label: "No data", value: 0 }]}
                    format="percent"
                  />
                </div>
              </>
            ) : (
              <EmptyState
                title="Attendance not started"
                description="Mark today's register to unlock attendance insights."
                action={
                  canWriteAttendance ? (
                    <Link href="/app/attendance" className="btn btn-primary btn-sm">
                      Mark attendance
                    </Link>
                  ) : undefined
                }
              />
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Newest students"
            description="Latest admissions in this institute"
            action={
              <Link href="/app/students" className="link text-xs">
                View all
              </Link>
            }
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Guardian</th>
                  <th>Admitted</th>
                </tr>
              </thead>
              <tbody>
                {recentStudents.map((student) => {
                  const guardian = student.guardians.find((g) => g.isPrimary)?.guardian ?? student.guardians[0]?.guardian;
                  return (
                    <tr key={student.id}>
                      <td>
                        <Link href={`/app/students/${student.id}`} className="group flex items-center gap-2.5">
                          <Avatar name={`${student.firstName} ${student.lastName}`} size={28} color="#4f46e5" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium group-hover:underline">
                              {student.firstName} {student.lastName}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-muted">
                              {student.admissionNo}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="text-muted">
                        {student.section ? `${student.section.class.name} — ${student.section.name}` : "—"}
                      </td>
                      <td className="text-muted">{guardian?.name ?? "—"}</td>
                      <td className="text-muted">{date(student.admissionDate)}</td>
                    </tr>
                  );
                })}
                {recentStudents.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-xs text-muted">
                      No students yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Plan usage"
            description={plan ? `${plan.name} · ${ctx.tenant.subscription?.status.toLowerCase()}` : "No plan"}
            action={
              <Link href="/app/billing" className="link text-xs">
                Billing
              </Link>
            }
          />
          <div className="space-y-4 p-4">
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Students</span>
                <span className="font-medium tabular-nums">
                  {num(students)} / {num(plan?.maxStudents ?? 0)}
                </span>
              </div>
              <Progress className="mt-1.5" value={students} max={plan?.maxStudents ?? 1} />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Staff</span>
                <span className="font-medium tabular-nums">
                  {num(staff)} / {num(plan?.maxStaff ?? 0)}
                </span>
              </div>
              <Progress className="mt-1.5" value={staff} max={plan?.maxStaff ?? 1} tone="brand" />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">AI credits</span>
                <span className="font-medium tabular-nums">
                  {num(aiUsage?.used ?? 0)} / {num(plan?.aiCreditsMonthly ?? 0)}
                </span>
              </div>
              <Progress
                className="mt-1.5"
                value={aiUsage?.used ?? 0}
                max={plan?.aiCreditsMonthly || 1}
                tone={
                  (aiUsage?.used ?? 0) > (plan?.aiCreditsMonthly ?? 0) * 0.85 ? "warning" : "brand"
                }
              />
            </div>
            <div className="rounded-xl bg-[var(--surface-2)] p-3 text-[11px] text-muted">
              <p className="flex items-center justify-between">
                <span>Renews</span>
                <span className="font-medium text-[var(--text)]">
                  {date(ctx.tenant.subscription?.currentPeriodEnd)}
                </span>
              </p>
              <p className="mt-1 flex items-center justify-between">
                <span>Cycle</span>
                <span className="font-medium text-[var(--text)]">
                  {ctx.tenant.subscription?.billingCycle.toLowerCase() ?? "—"}
                </span>
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Class strength"
            description="Active students by class"
            action={<Users className="size-4 text-[var(--muted)]" />}
          />
          <div className="p-4">
            <BarList data={classStrength} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Announcements"
            description="Latest notices"
            action={
              <Link href="/app/announcements" className="link text-xs">
                All
              </Link>
            }
          />
          <div className="divide-y divide-[var(--border)]">
            {announcements.map((announcement) => (
              <Link
                key={announcement.id}
                href="/app/announcements"
                className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-2)]"
              >
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                  <Megaphone className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-medium">{announcement.title}</span>
                    {announcement.pinned && <Badge tone="warning">Pinned</Badge>}
                  </span>
                  <span className="line-clamp-2 text-[11px] text-muted">{announcement.body}</span>
                  <span className="mt-0.5 block text-[10px] text-[var(--muted-2)]">
                    {announcement.audience.toLowerCase()} · {timeAgo(announcement.publishedAt)}
                  </span>
                </span>
              </Link>
            ))}
            {announcements.length === 0 && (
              <p className="px-4 py-8 text-center text-xs text-muted">No announcements yet.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Recent activity"
            description="Audit trail"
            action={
              <Link href="/app/settings" className="link text-xs">
                Settings
              </Link>
            }
          />
          <div className="divide-y divide-[var(--border)]">
            {audit.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2.5 px-4 py-2.5">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                <div className="min-w-0">
                  <p className="truncate text-[12px]">
                    <span className="font-medium">{entry.actorName}</span>{" "}
                    <span className="text-muted">{entry.action.replace(/\./g, " ")}</span>
                  </p>
                  <p className="text-[10px] text-[var(--muted-2)]">
                    {timeAgo(entry.createdAt)}
                    {entry.entity ? ` · ${entry.entity}` : ""}
                  </p>
                </div>
              </div>
            ))}
            {audit.length === 0 && (
              <p className="px-4 py-8 text-center text-xs text-muted">No activity recorded yet.</p>
            )}
          </div>
        </Card>
      </div>

      {plan && (students / plan.maxStudents > 0.9 || staff / plan.maxStaff > 0.9) && (
        <Callout tone="warning" title="You are close to a plan limit">
          {students / plan.maxStudents > 0.9
            ? `Student capacity is at ${Math.round((students / plan.maxStudents) * 100)}%. `
            : ""}
          {staff / plan.maxStaff > 0.9
            ? `Staff capacity is at ${Math.round((staff / plan.maxStaff) * 100)}%. `
            : ""}
          <Link href="/app/billing" className="underline">
            Review plans
          </Link>{" "}
          before adding more records.
        </Callout>
      )}

      {canWriteFees && outstanding > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <CircleDollarSign className="size-3.5 text-[var(--brand)]" />
          Collect outstanding fees from the fees workspace —{" "}
          <Link href="/app/fees?status=OVERDUE" className="link">
            {overdueCount} overdue invoice{overdueCount === 1 ? "" : "s"}
          </Link>
          <ArrowUpRight className="size-3" />
        </div>
      )}
    </div>
  );
}
