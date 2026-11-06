import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  GraduationCap,
  History,
  Settings,
  UserCheck,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Progress,
  StatCard,
  Tone,
} from "@/components/ui/primitives";
import {
  EnrollStudentsModal,
  DropStudentButton,
  TransferStudentButton,
  CompleteBatchButton,
} from "@/components/batches/batch-client-bits";
import { date, num } from "@/lib/format";
import type { BatchStatus, BatchStudentStatus, BatchEventType } from "@prisma/client";

export const metadata = { title: "Batch Details" };

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

function studentEnrollmentTone(status: BatchStudentStatus): Tone {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "DROPPED":
      return "danger";
    case "COMPLETED":
      return "info";
    case "TRANSFERRED":
      return "warning";
    default:
      return "neutral";
  }
}

function eventTypeTone(type: BatchEventType): Tone {
  switch (type) {
    case "ENROLLED":
      return "success";
    case "RE_ENROLLED":
      return "brand";
    case "DROPPED":
      return "danger";
    case "TRANSFERRED":
      return "warning";
    case "COMPLETED":
      return "info";
    default:
      return "neutral";
  }
}

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenantPermission("tenant.batches.read");

  const canWrite = hasTenantPermission(ctx, "tenant.batches.write");
  const canEnroll = hasTenantPermission(ctx, "tenant.batches.enroll");
  const canTransfer = hasTenantPermission(ctx, "tenant.batches.transfer");

  // Fetch batch with all associations
  const batch = await db.batch.findFirst({
    where: { id, tenantId: ctx.tenant.id },
    include: {
      academicYear: true,
      subject: true,
      teachers: {
        include: {
          teacher: {
            include: {
              user: { select: { id: true, name: true, email: true } },
              role: { select: { name: true } },
            },
          },
        },
      },
      students: {
        include: {
          student: {
            include: {
              section: { include: { class: true } },
            },
          },
        },
        orderBy: [{ status: "asc" }, { student: { firstName: "asc" } }],
      },
      events: {
        include: {
          student: {
            select: { firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!batch) {
    notFound();
  }

  // Teacher record-level access control: Teachers can only view batches assigned to them
  const roleKey = ctx.membership?.roleKey;
  const isTeacher = roleKey === "TEACHER";
  const isInstAdminOrPrincipal = roleKey === "INSTITUTE_ADMIN" || roleKey === "PRINCIPAL";
  if (isTeacher && !isInstAdminOrPrincipal) {
    const isAssigned = batch.teachers.some((bt) => bt.teacher.user.id === ctx.user.id);
    if (!isAssigned) {
      redirect("/app/forbidden?p=tenant.batches.read&denied=record");
    }
  }

  // Active students and capacity
  const activeStudents = batch.students.filter((s) => s.status === "ACTIVE");
  const inactiveStudents = batch.students.filter((s) => s.status !== "ACTIVE");
  const activeCount = activeStudents.length;
  const remainingSlots = Math.max(0, batch.capacity - activeCount);
  const ratio = Math.round((activeCount / batch.capacity) * 100);
  const isFull = activeCount >= batch.capacity;

  // Active student IDs in this batch
  const activeStudentIds = new Set(activeStudents.map((s) => s.studentId));

  // Eligible students for enrollment in this tenant
  const [tenantStudents, otherBatches] = await Promise.all([
    canEnroll
      ? db.student.findMany({
          where: { tenantId: ctx.tenant.id, status: "ACTIVE" },
          select: {
            id: true,
            admissionNo: true,
            firstName: true,
            lastName: true,
            section: { select: { name: true, class: { select: { name: true } } } },
          },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        })
      : Promise.resolve([]),
    canTransfer
      ? db.batch.findMany({
          where: { tenantId: ctx.tenant.id, id: { not: batch.id }, status: "ACTIVE" },
          select: {
            id: true,
            name: true,
            code: true,
            capacity: true,
            _count: { select: { students: { where: { status: "ACTIVE" } } } },
          },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const availableForEnrollment = tenantStudents
    .filter((s) => !activeStudentIds.has(s.id))
    .map((s) => ({
      id: s.id,
      admissionNo: s.admissionNo,
      name: `${s.firstName} ${s.lastName}`.trim(),
      classSection: s.section ? `${s.section.class.name} - ${s.section.name}` : null,
    }));

  const targetBatches = otherBatches.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    capacity: b.capacity,
    activeCount: b._count.students,
  }));

  return (
    <div className="space-y-6">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/app/batches" className="btn btn-ghost btn-sm text-xs flex items-center gap-1.5 text-muted hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          <span>Back to batches</span>
        </Link>
        <div className="flex items-center gap-2">
          {canWrite && batch.status === "ACTIVE" && (
            <CompleteBatchButton
              batchId={batch.id}
              batchName={batch.name}
              activeCount={activeCount}
            />
          )}
          {canWrite && (
            <Link href={`/app/batches/${batch.id}/settings`} className="btn btn-secondary btn-sm text-xs flex items-center gap-1.5">
              <Settings className="size-3.5" />
              <span>Settings</span>
            </Link>
          )}
          {canEnroll && batch.status === "ACTIVE" && (
            <EnrollStudentsModal
              batchId={batch.id}
              batchName={batch.name}
              capacity={batch.capacity}
              currentActive={activeCount}
              availableStudents={availableForEnrollment}
            />
          )}
        </div>
      </div>

      {/* Header Info */}
      <Card className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold text-foreground tracking-tight">{batch.name}</h1>
              <Badge tone={batchStatusTone(batch.status)}>{batch.status}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted">
              <span className="font-mono bg-[var(--surface-sunken)] px-2 py-0.5 rounded border border-[var(--border)]">
                {batch.code}
              </span>
              <span>&bull;</span>
              <span>{batch.academicYear.name}</span>
              {batch.subject && (
                <>
                  <span>&bull;</span>
                  <span className="font-medium text-foreground">{batch.subject.name}</span>
                </>
              )}
              {batch.schedule && (
                <>
                  <span>&bull;</span>
                  <span>{batch.schedule}</span>
                </>
              )}
            </div>
          </div>

          <div className="sm:text-right min-w-[200px]">
            <div className="flex items-center justify-between sm:justify-end gap-2 text-xs">
              <span className="text-muted">Capacity:</span>
              <span className="font-semibold text-foreground">
                {activeCount} / {batch.capacity} seats ({ratio}%)
              </span>
            </div>
            <div className="mt-1.5">
              <Progress
                value={activeCount}
                max={batch.capacity}
                className={`h-2 ${isFull ? "[&>div]:bg-[var(--danger)]" : ""}`}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {remainingSlots > 0 ? `${remainingSlots} slot(s) remaining` : "Full capacity reached"}
            </p>
          </div>
        </div>

        {batch.description && (
          <p className="mt-4 pt-4 border-t border-[var(--border)] text-xs text-muted leading-relaxed">
            {batch.description}
          </p>
        )}
      </Card>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Active Students"
          value={num(activeCount)}
          icon={<GraduationCap className="size-4 text-[var(--brand)]" />}
        />
        <StatCard
          label="Available Slots"
          value={num(remainingSlots)}
          icon={<Users className="size-4 text-[var(--info)]" />}
        />
        <StatCard
          label="Assigned Teachers"
          value={num(batch.teachers.length)}
          icon={<UserCheck className="size-4 text-[var(--success)]" />}
        />
        <StatCard
          label="Lifecycle Events"
          value={num(batch.events.length)}
          icon={<History className="size-4 text-muted" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main: Student Roster (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden">
            <CardHeader
              title="Active Student Roster"
              description={`${activeCount} student(s) actively participating in this batch.`}
            />

            {activeStudents.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={<Users className="size-7 text-muted" />}
                  title="No active students"
                  description="No students are currently enrolled in this batch."
                  action={
                    canEnroll && batch.status === "ACTIVE" ? (
                      <div className="mt-2">
                        <EnrollStudentsModal
                          batchId={batch.id}
                          batchName={batch.name}
                          capacity={batch.capacity}
                          currentActive={activeCount}
                          availableStudents={availableForEnrollment}
                        />
                      </div>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-sunken)] text-muted font-medium">
                      <th className="py-2.5 px-4">Student</th>
                      <th className="py-2.5 px-4">Class & Section</th>
                      <th className="py-2.5 px-4">Enrolled Date</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {activeStudents.map((bs) => (
                      <tr key={bs.id} className="hover:bg-[var(--surface-hover)] transition">
                        <td className="py-2.5 px-4">
                          <Link href={`/app/students/${bs.student.id}`} className="font-semibold text-foreground hover:underline">
                            {bs.student.firstName} {bs.student.lastName}
                          </Link>
                          <p className="font-mono text-[10px] text-muted">Adm: {bs.student.admissionNo}</p>
                        </td>
                        <td className="py-2.5 px-4 text-muted">
                          {bs.student.section
                            ? `${bs.student.section.class.name} - ${bs.student.section.name}`
                            : "—"}
                        </td>
                        <td className="py-2.5 px-4 text-muted">{date(bs.enrolledAt)}</td>
                        <td className="py-2.5 px-4">
                          <Badge tone={studentEnrollmentTone(bs.status)}>{bs.status}</Badge>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canTransfer && targetBatches.length > 0 && (
                              <TransferStudentButton
                                fromBatchId={batch.id}
                                studentId={bs.student.id}
                                studentName={`${bs.student.firstName} ${bs.student.lastName}`}
                                targetBatches={targetBatches}
                              />
                            )}
                            {canEnroll && (
                              <DropStudentButton
                                batchId={batch.id}
                                studentId={bs.student.id}
                                studentName={`${bs.student.firstName} ${bs.student.lastName}`}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Historical / Inactive Roster */}
          {inactiveStudents.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader
                title="Historical Roster (Dropped / Completed / Transferred)"
                description="Preserved records of previous batch participants."
              />
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-sunken)] text-muted font-medium">
                      <th className="py-2 px-4">Student</th>
                      <th className="py-2 px-4">Status</th>
                      <th className="py-2 px-4">Reason / Notes</th>
                      <th className="py-2 px-4">Effective Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {inactiveStudents.map((bs) => (
                      <tr key={bs.id} className="text-muted hover:bg-[var(--surface-hover)]">
                        <td className="py-2 px-4 font-medium text-foreground">
                          {bs.student.firstName} {bs.student.lastName}
                        </td>
                        <td className="py-2 px-4">
                          <Badge tone={studentEnrollmentTone(bs.status)}>{bs.status}</Badge>
                        </td>
                        <td className="py-2 px-4 text-xs italic">{bs.dropReason || "—"}</td>
                        <td className="py-2 px-4 text-xs">
                          {bs.droppedAt ? date(bs.droppedAt) : bs.completedAt ? date(bs.completedAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Immutable Audit Events Log */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Batch Lifecycle Events"
              description="Tamper-proof chronological log of student enrollment, drops, completions and transfers."
            />
            {batch.events.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted">No events recorded yet.</div>
            ) : (
              <div className="divide-y divide-[var(--border)] max-h-72 overflow-y-auto">
                {batch.events.map((ev) => (
                  <div key={ev.id} className="p-3 text-xs flex items-start justify-between gap-3 hover:bg-[var(--surface-hover)]">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge tone={eventTypeTone(ev.eventType)} className="text-[10px]">
                          {ev.eventType}
                        </Badge>
                        <span className="font-semibold text-foreground">
                          {ev.student.firstName} {ev.student.lastName}
                        </span>
                      </div>
                      {ev.reason && <p className="text-[11px] text-muted">{ev.reason}</p>}
                    </div>
                    <div className="text-right text-[11px] text-muted whitespace-nowrap">
                      <p>{date(ev.effectiveDate)}</p>
                      <p className="text-[10px]">by {ev.actorName}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar: Details & Teachers (1 col) */}
        <div className="space-y-6">
          {/* Assigned Teachers */}
          <Card className="p-5">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <UserCheck className="size-4 text-[var(--brand)]" />
                <span>Assigned Teachers</span>
              </h3>
              {canWrite && (
                <Link href={`/app/batches/${batch.id}/settings`} className="text-xs text-[var(--brand)] hover:underline">
                  Manage
                </Link>
              )}
            </div>

            {batch.teachers.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted">
                No teachers assigned to this batch.
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {batch.teachers.map((bt) => (
                  <div
                    key={bt.id}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] text-xs"
                  >
                    <div>
                      <p className="font-semibold text-foreground">{bt.teacher.user.name}</p>
                      <p className="text-[10px] text-muted">{bt.teacher.user.email}</p>
                    </div>
                    {bt.isPrimary && (
                      <Badge tone="brand" className="text-[10px]">
                        Lead Faculty
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Schedule & Metadata */}
          <Card className="p-5 space-y-3 text-xs">
            <h3 className="text-sm font-semibold text-foreground pb-2 border-b border-[var(--border)]">
              Batch Information
            </h3>

            <div>
              <span className="text-muted block text-[11px]">Academic Year</span>
              <span className="font-medium text-foreground">{batch.academicYear.name}</span>
            </div>

            <div>
              <span className="text-muted block text-[11px]">Subject</span>
              <span className="font-medium text-foreground">
                {batch.subject ? `${batch.subject.name} (${batch.subject.code || "N/A"})` : "General / All-Subject"}
              </span>
            </div>

            <div>
              <span className="text-muted block text-[11px]">Timings / Schedule</span>
              <span className="font-medium text-foreground">{batch.schedule || "Not specified"}</span>
            </div>

            <div>
              <span className="text-muted block text-[11px]">Duration</span>
              <span className="font-medium text-foreground">
                {batch.startDate ? date(batch.startDate) : "Flexible"} &rarr;{" "}
                {batch.endDate ? date(batch.endDate) : "Ongoing"}
              </span>
            </div>

            <div className="pt-2 border-t border-[var(--border)] text-[11px] text-muted">
              Created: {date(batch.createdAt)}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
