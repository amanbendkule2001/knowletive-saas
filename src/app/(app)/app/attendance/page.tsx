import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck2, Check, Clock, UserX, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission, isStaffMember } from "@/lib/auth";
import { hasFeature } from "@/lib/entitlements";
import { saveAttendanceRegisterAction } from "@/actions/operations";
import { SubmitButton } from "@/components/ui/action-form";
import { FeatureLocked } from "@/components/ui/feature-gate";
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
  statusLabel,
  statusTone,
} from "@/components/ui/primitives";
import { date, isoDate, num, pct } from "@/lib/format";

export const metadata = { title: "Attendance" };

const STATUSES = [
  { value: "PRESENT", label: "Present", icon: Check, tone: "success" as const },
  { value: "LATE", label: "Late", icon: Clock, tone: "warning" as const },
  { value: "ABSENT", label: "Absent", icon: UserX, tone: "danger" as const },
  { value: "EXCUSED", label: "Excused", icon: Users, tone: "info" as const },
];

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; sectionId?: string; saved?: string; error?: string }>;
}) {
  const ctx = await requireTenantPermission("tenant.attendance.read");
  if (!isStaffMember(ctx)) redirect("/portal");
  const plan = ctx.tenant.subscription?.plan;
  if (!hasFeature(plan, "attendance")) {
    return <FeatureLocked feature="attendance" title="Attendance" />;
  }

  const sp = await searchParams;
  const today = isoDate(new Date());
  const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;
  const selectedDate = new Date(`${dateValue}T00:00:00.000Z`);
  const sectionId = sp.sectionId ?? "";
  const canWrite = hasTenantPermission(ctx, "tenant.attendance.write");

  const [classes, sections, stats] = await Promise.all([
    db.classLevel.findMany({
      where: { tenantId: ctx.tenant.id },
      include: { sections: true },
      orderBy: { order: "asc" },
    }),
    db.section.findMany({
      where: { tenantId: ctx.tenant.id },
      include: {
        class: true,
        _count: { select: { students: { where: { status: "ACTIVE" } } } },
      },
      orderBy: [{ class: { order: "asc" } }, { name: "asc" }],
    }),
    db.attendance.groupBy({
      by: ["status"],
      where: { tenantId: ctx.tenant.id, date: selectedDate },
      _count: { _all: true },
    }),
  ]);

  const selectedSection = sections.find((section) => section.id === sectionId) ?? null;
  const students = selectedSection
    ? await db.student.findMany({
        where: { tenantId: ctx.tenant.id, sectionId: selectedSection.id, status: "ACTIVE" },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      })
    : [];
  const existing = selectedSection
    ? await db.attendance.findMany({
        where: {
          tenantId: ctx.tenant.id,
          date: selectedDate,
          studentId: { in: students.map((student) => student.id) },
        },
        select: { studentId: true, status: true },
      })
    : [];
  const marked = new Map(existing.map((row) => [row.studentId, row.status]));

  const total = stats.reduce((sum, row) => sum + row._count._all, 0);
  const present = stats.find((r) => r.status === "PRESENT")?._count._all ?? 0;
  const late = stats.find((r) => r.status === "LATE")?._count._all ?? 0;
  const absent = stats.find((r) => r.status === "ABSENT")?._count._all ?? 0;
  const excused = stats.find((r) => r.status === "EXCUSED")?._count._all ?? 0;
  const rate = total ? ((present + late) / total) * 100 : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Academics"
        title="Attendance"
        description="Mark a daily register and keep an auditable record. Re-marking a day updates the existing entries instead of duplicating them."
        actions={<Badge tone="brand"><CalendarCheck2 className="size-3" /> {date(selectedDate)}</Badge>}
      />

      {sp.error && (
        <Callout tone="danger" title="Attendance not saved">
          {sp.error}
        </Callout>
      )}
      {sp.saved && !sp.error && (
        <Callout tone="success" title="Register saved">
          The attendance register for {date(selectedDate)} is up to date.
        </Callout>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Marked on this day"
          value={num(total)}
          sub="student entries recorded"
          icon={<Users className="size-4" />}
        />
        <StatCard
          label="Present"
          value={num(present + late)}
          sub={total ? pct(rate) : "No register"}
          icon={<Check className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Absent"
          value={num(absent)}
          sub={total ? pct((absent / total) * 100) : "—"}
          icon={<UserX className="size-4" />}
          tone="danger"
        />
        <StatCard
          label="Late / excused"
          value={`${num(late)} / ${num(excused)}`}
          sub="follow up with guardians"
          icon={<Clock className="size-4" />}
          tone="warning"
        />
      </div>

      <Card>
        <CardHeader
          title="Load a register"
          description="Choose a date and section. Weekends are allowed for special sessions."
        />
        <form className="flex flex-col gap-2 p-3 sm:flex-row sm:items-end">
          <div className="sm:w-44">
            <label className="label" htmlFor="date">
              Date
            </label>
            <input
              id="date"
              name="date"
              type="date"
              className="input"
              defaultValue={dateValue}
              max={today}
            />
          </div>
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="sectionId">
              Class section
            </label>
            <select id="sectionId" name="sectionId" className="select" defaultValue={sectionId}>
              <option value="">Choose a section</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.class.name} — Section {section.name} ({section._count.students} students)
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-secondary" type="submit">
            Load register
          </button>
        </form>
      </Card>

      {selectedSection ? (
        <Card>
          <CardHeader
            title={`${selectedSection.class.name} — Section ${selectedSection.name}`}
            description={`${students.length} active students · ${date(selectedDate)}`}
            action={
              marked.size > 0 ? (
                <Badge tone="success">{marked.size} already marked</Badge>
              ) : (
                <Badge tone="neutral">Not marked</Badge>
              )
            }
          />
          <form action={saveAttendanceRegisterAction}>
            <input type="hidden" name="date" value={dateValue} />
            <input type="hidden" name="sectionId" value={selectedSection.id} />
            <div className="divide-y divide-[var(--border)]">
              {students.map((student) => {
                const current = marked.get(student.id) ?? "PRESENT";
                return (
                  <div
                    key={student.id}
                    className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar
                        name={`${student.firstName} ${student.lastName}`}
                        color={ctx.tenant.accentColor}
                        size={32}
                      />
                      <div className="min-w-0">
                        <Link
                          href={`/app/students/${student.id}`}
                          className="block truncate text-[13px] font-medium hover:underline"
                        >
                          {student.firstName} {student.lastName}
                        </Link>
                        <p className="font-mono text-[10px] text-muted">{student.admissionNo}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {STATUSES.map((status) => {
                        const Icon = status.icon;
                        return (
                          <label
                            key={status.value}
                            className="cursor-pointer"
                            title={status.label}
                          >
                            <input
                              type="radio"
                              name={`status_${student.id}`}
                              value={status.value}
                              defaultChecked={current === status.value}
                              className="peer sr-only"
                              disabled={!canWrite}
                            />
                            <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-[11px] font-medium text-muted transition peer-checked:border-transparent peer-checked:bg-[var(--surface-3)] peer-checked:text-[var(--text)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--brand)]">
                              <Icon className="size-3" />
                              {status.label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {students.length === 0 && (
                <EmptyState
                  title="No active students in this section"
                  description="Move students into this section from their profile, or choose another section."
                  action={
                    <Link href="/app/students" className="btn btn-secondary btn-sm">
                      Manage students
                    </Link>
                  }
                />
              )}
            </div>
            {students.length > 0 && canWrite && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-3">
                <p className="text-[11px] text-muted">
                  Defaults to present. Change anyone who was absent, late or excused.
                </p>
                <SubmitButton pendingLabel="Saving register…">
                  <Check className="size-3.5" /> Save register
                </SubmitButton>
              </div>
            )}
            {!canWrite && students.length > 0 && (
              <div className="border-t border-[var(--border)] px-4 py-3 text-[11px] text-muted">
                You have read-only access to attendance. Ask an admin for the Mark attendance permission.
              </div>
            )}
          </form>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Sections" description="Choose a section to mark attendance." />
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((section) => (
              <Link
                key={section.id}
                href={`/app/attendance?date=${dateValue}&sectionId=${section.id}`}
                className="card card-hover flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">
                    {section.class.name} — {section.name}
                  </p>
                  <p className="text-[11px] text-muted">{section._count.students} active students</p>
                </div>
                <Progress
                  className="w-16"
                  value={section._count.students}
                  max={section.capacity}
                  tone="brand"
                />
              </Link>
            ))}
            {sections.length === 0 && (
              <div className="col-span-full">
                <EmptyState
                  title="No sections configured"
                  description="Create classes and sections before marking attendance."
                  action={
                    <Link href="/app/academics" className="btn btn-primary btn-sm">
                      Open academics
                    </Link>
                  }
                />
              </div>
            )}
          </div>
          {classes.length > 0 && sections.length > 0 && total === 0 && (
            <div className="border-t border-[var(--border)] p-4">
              <Callout tone="info" title="No register marked for this day">
                Pick a section above to start. Attendance feeds the overview dashboard and absence
                follow-ups.
              </Callout>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader
          title="Day summary"
          description={`Across all sections on ${date(selectedDate)}`}
          action={<Badge tone={statusTone(total ? "PRESENT" : "PENDING")}>{total ? pct(rate) : "No data"}</Badge>}
        />
        <div className="grid gap-3 p-4 sm:grid-cols-4">
          {[
            { label: "Present", value: present, tone: "success" as const },
            { label: "Late", value: late, tone: "warning" as const },
            { label: "Absent", value: absent, tone: "danger" as const },
            { label: "Excused", value: excused, tone: "info" as const },
          ].map((row) => (
            <div key={row.label} className="rounded-xl bg-[var(--surface-2)] p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">{row.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{num(row.value)}</p>
              <Badge tone={row.tone}>{total ? pct((row.value / total) * 100, 0) : "0%"}</Badge>
            </div>
          ))}
        </div>
        {total > 0 && (
          <div className="px-4 pb-4">
            <Progress
              value={present + late}
              max={total}
              tone={rate >= 90 ? "success" : rate >= 75 ? "warning" : "danger"}
            />
            <p className="mt-1.5 text-[11px] text-muted">
              {num(present + late)} of {num(total)} students present or late ·{" "}
              {statusLabel("ATTENDANCE")} recorded for this date
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
