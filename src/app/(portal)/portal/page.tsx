import Link from "next/link";
import { db } from "@/lib/db";
import { getTenantContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  Badge,
  Avatar,
  EmptyState,
  PageHeader,
  statusTone,
  statusLabel,
} from "@/components/ui/primitives";
import {
  GraduationCap,
  CalendarCheck,
  CreditCard,
  Download,
  FileText,
  Paperclip,
  ShieldCheck,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Award,
} from "lucide-react";
import { date, money, timeAgo } from "@/lib/format";
import { StudentReportCardModal } from "@/components/exams/exam-client-bits";

export const metadata = { title: "Parent Portal" };

const ATTENDANCE_ICON: Record<string, React.ReactNode> = {
  PRESENT: <CheckCircle2 className="size-3.5 text-[var(--success)]" />,
  ABSENT: <XCircle className="size-3.5 text-[var(--danger)]" />,
  LATE: <Clock className="size-3.5 text-[var(--warning)]" />,
  EXCUSED: <CheckCircle2 className="size-3.5 text-[var(--info)]" />,
};

const ATTENDANCE_LABEL: Record<string, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  EXCUSED: "Excused",
};

export default async function PortalPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  // Enforce strict guardian-to-student or student self relationship filtering
  const linkedStudents = await db.student.findMany({
    where: {
      tenantId: ctx.tenant.id,
      OR: [
        {
          guardians: {
            some: {
              guardian: {
                userId: ctx.user.id,
              },
            },
          },
        },
        {
          userId: ctx.user.id,
        },
      ],
    },
    include: {
      section: { include: { class: true } },
      files: { orderBy: { createdAt: "desc" } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  const studentIds = linkedStudents.map((s) => s.id);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // eslint-disable-line react-hooks/purity
  const now = new Date();

  // Fetch fee invoices, attendance, payment links, and published exam results for all linked students
  const [feeInvoices, attendanceRecords, paymentLinks, examResults] = await (studentIds.length > 0
    ? Promise.all([
        db.feeInvoice.findMany({
          where: { tenantId: ctx.tenant.id, studentId: { in: studentIds } },
          orderBy: { dueDate: "desc" },
          take: 60,
        }),
        db.attendance.findMany({
          where: {
            tenantId: ctx.tenant.id,
            studentId: { in: studentIds },
            date: { gte: thirtyDaysAgo },
          },
          orderBy: { date: "desc" },
          take: 300,
        }),
        db.feePaymentLink.findMany({
          where: {
            tenantId: ctx.tenant.id,
            expiresAt: { gte: now },
            feeInvoice: { studentId: { in: studentIds } },
          },
          select: { id: true, token: true, feeInvoiceId: true, status: true },
        }),
        db.examResult.findMany({
          where: {
            tenantId: ctx.tenant.id,
            studentId: { in: studentIds },
            exam: { isPublished: true },
          },
          include: {
            exam: {
              include: {
                academicYear: true,
              },
            },
            snapshots: {
              orderBy: { version: "desc" },
              take: 1,
            },
          },
          orderBy: { publishedAt: "desc" },
        }),
      ])
    : Promise.resolve([[], [], [], []] as [
        Awaited<ReturnType<typeof db.feeInvoice.findMany>>,
        Awaited<ReturnType<typeof db.attendance.findMany>>,
        Awaited<ReturnType<typeof db.feePaymentLink.findMany<{ select: { id: true; token: true; feeInvoiceId: true; status: true } }>>>,
        Awaited<ReturnType<typeof db.examResult.findMany<{ include: { exam: { include: { academicYear: true } }; snapshots: true } }>>>,
      ]));

  // Index payment links by invoice id
  const payLinkByInvoice = new Map(paymentLinks.map((pl) => [pl.feeInvoiceId, pl]));

  // Group by student
  const invoicesByStudent = new Map<string, typeof feeInvoices>();
  for (const inv of feeInvoices) {
    const arr = invoicesByStudent.get(inv.studentId) ?? [];
    arr.push(inv);
    invoicesByStudent.set(inv.studentId, arr);
  }

  const attendanceByStudent = new Map<string, typeof attendanceRecords>();
  for (const rec of attendanceRecords) {
    const arr = attendanceByStudent.get(rec.studentId) ?? [];
    arr.push(rec);
    attendanceByStudent.set(rec.studentId, arr);
  }

  const resultsByStudent = new Map<string, typeof examResults>();
  for (const res of examResults) {
    const arr = resultsByStudent.get(res.studentId) ?? [];
    arr.push(res);
    resultsByStudent.set(res.studentId, arr);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Parent & Student Portal"
        title={`Welcome, ${ctx.user.name}`}
        description={`Secure access portal for ${ctx.tenant.name}.`}
      />

      {/* ── Enrolled Children ───────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold">Your Enrolled Children</h2>
            <p className="text-xs text-muted">Students registered under your guardian profile.</p>
          </div>
          <Badge tone="neutral">
            <Users className="size-3.5" /> {linkedStudents.length}{" "}
            {linkedStudents.length === 1 ? "Child" : "Children"}
          </Badge>
        </div>

        {linkedStudents.length === 0 ? (
          <EmptyState
            icon={<GraduationCap className="size-8" />}
            title="No linked student profiles found"
            description="Your login is active, but no student records have been linked to your email address yet. Please contact the school administration office to verify your guardian details."
          />
        ) : (
          <div className="space-y-6">
            {linkedStudents.map((student) => {
              const fullName = `${student.firstName} ${student.lastName}`;
              const className = student.section?.class?.name ?? "Class";
              const sectionName = student.section?.name ? ` – ${student.section.name}` : "";
              const invoices = invoicesByStudent.get(student.id) ?? [];
              const attendance = attendanceByStudent.get(student.id) ?? [];
              const studentResults = resultsByStudent.get(student.id) ?? [];
              const openInvoices = invoices.filter(
                (i) => i.status === "PENDING" || i.status === "OVERDUE" || i.status === "PARTIAL",
              );
              const totalDue = openInvoices.reduce((s, i) => s + (i.amount - i.paidAmount), 0);
              const attendanceTotal = attendance.length;
              const presentCount = attendance.filter(
                (a) => a.status === "PRESENT" || a.status === "LATE",
              ).length;
              const attendancePct =
                attendanceTotal > 0 ? Math.round((presentCount / attendanceTotal) * 100) : null;

              return (
                <div
                  key={student.id}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
                >
                  {/* Student header */}
                  <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
                    <Avatar name={fullName} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm leading-tight">{fullName}</p>
                      <p className="text-xs text-muted">
                        {className}
                        {sectionName} · Adm: {student.admissionNo}
                      </p>
                    </div>
                    <Badge tone={student.status === "ACTIVE" ? "success" : "neutral"}>
                      {student.status.toLowerCase()}
                    </Badge>
                  </div>

                  <div className="grid gap-0 divide-y divide-[var(--border)] lg:grid-cols-3 lg:divide-y-0 lg:divide-x">
                    {/* ── Fee Invoices ── */}
                    <div className="p-4">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted mb-3">
                        <CreditCard className="size-3.5" /> Fee Invoices
                      </p>
                      {invoices.length === 0 ? (
                        <p className="text-xs text-muted">No invoices issued yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {totalDue > 0 && (
                            <div className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 flex items-center gap-2 text-xs">
                              <AlertTriangle className="size-3.5 text-[var(--danger)] shrink-0" />
                              <span className="font-medium text-[var(--danger)]">
                                {money(totalDue)} outstanding
                              </span>
                            </div>
                          )}
                          {invoices.slice(0, 8).map((inv) => {
                            const payLink = payLinkByInvoice.get(inv.id);
                            const canPay =
                              payLink &&
                              (inv.status === "PENDING" ||
                                inv.status === "OVERDUE" ||
                                inv.status === "PARTIAL");
                            return (
                              <div
                                key={inv.id}
                                className="flex items-start justify-between gap-2 text-xs"
                              >
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{inv.title}</p>
                                  <p className="text-muted">
                                    Due {date(inv.dueDate)}
                                    {inv.paidAmount > 0 && inv.status !== "PAID" && (
                                      <> · Paid {money(inv.paidAmount)}</>
                                    )}
                                  </p>
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                  <Badge tone={statusTone(inv.status)}>
                                    {statusLabel(inv.status)}
                                  </Badge>
                                  {canPay && (
                                    <Link
                                      href={`/pay/${payLink.token}`}
                                      className="text-[10px] text-[var(--brand)] underline"
                                    >
                                      Pay now →
                                    </Link>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* ── Attendance (last 30 days) ── */}
                    <div className="p-4">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted mb-3">
                        <CalendarCheck className="size-3.5" /> Attendance · Last 30 days
                      </p>
                      {attendance.length === 0 ? (
                        <p className="text-xs text-muted">No records for the last 30 days.</p>
                      ) : (
                        <>
                          {attendancePct !== null && (
                            <div className="mb-2 flex items-center gap-2 text-xs">
                              <span
                                className={
                                  attendancePct >= 90
                                    ? "text-[var(--success)] font-semibold"
                                    : attendancePct >= 75
                                      ? "text-[var(--warning)] font-semibold"
                                      : "text-[var(--danger)] font-semibold"
                                }
                              >
                                {attendancePct}% present
                              </span>
                              <span className="text-muted">
                                ({presentCount}/{attendanceTotal} days)
                              </span>
                            </div>
                          )}
                          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                            {attendance.slice(0, 25).map((rec) => (
                              <div
                                key={rec.id}
                                className="flex items-center justify-between gap-2 text-xs"
                              >
                                <span className="text-muted tabular-nums">{date(rec.date)}</span>
                                <span className="flex items-center gap-1 font-medium">
                                  {ATTENDANCE_ICON[rec.status] ?? null}
                                  {ATTENDANCE_LABEL[rec.status] ?? rec.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* ── Documents ── */}
                    <div className="p-4">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted mb-3">
                        <Paperclip className="size-3.5" /> Documents
                      </p>
                      {student.files.length === 0 ? (
                        <p className="text-xs text-muted">No documents attached.</p>
                      ) : (
                        <div className="space-y-1">
                          {student.files.map((doc) => (
                            <a
                              key={doc.id}
                              href={`/api/files/${doc.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between text-xs p-1.5 rounded-md hover:bg-[var(--surface-2)] transition"
                            >
                              <span className="truncate flex items-center gap-1.5 text-foreground">
                                <FileText className="size-3.5 text-muted shrink-0" />
                                {doc.name}
                              </span>
                              <Download className="size-3 text-muted shrink-0 ml-1" />
                            </a>
                          ))}
                        </div>
                      )}
                      <div className="mt-4 pt-3 border-t border-[var(--border)] flex items-center justify-between text-[11px] text-muted">
                        <span className="flex items-center gap-1.5 text-[var(--success)]">
                          <ShieldCheck className="size-3.5" /> Verified Profile
                        </span>
                        <span>{timeAgo(student.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── Official Assessment Results & Report Cards ── */}
                  <div className="border-t border-[var(--border)] p-4 bg-[var(--surface)]">
                    <div className="flex items-center justify-between mb-3">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                        <Award className="size-3.5 text-indigo-500" /> Academic Assessments & Report Cards
                      </p>
                      {studentResults.length > 0 && (
                        <span className="text-[11px] text-muted font-medium">
                          {studentResults.length} {studentResults.length === 1 ? "evaluation" : "evaluations"} published
                        </span>
                      )}
                    </div>

                    {studentResults.length === 0 ? (
                      <p className="text-xs text-muted">No official examination results published yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {studentResults.map((res) => {
                          const snapshot = res.snapshots[0];
                          return (
                            <div
                              key={res.id}
                              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-xs"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <Link
                                    href={`/portal/results/${res.id}`}
                                    className="font-semibold text-foreground truncate hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline"
                                  >
                                    {res.exam.title}
                                  </Link>
                                  <span className="text-[10px] text-muted">
                                    ({res.exam.academicYear.name})
                                  </span>
                                </div>
                                <p className="text-muted mt-0.5">
                                  Score:{" "}
                                  <span className="font-mono font-medium text-foreground">
                                    {res.totalMarksObtained} / {res.totalMaxMarks}
                                  </span>
                                  {" · "}
                                  Percentage:{" "}
                                  <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                                    {res.percentage}%
                                  </span>
                                  {res.rank ? (
                                    <>
                                      {" · "}
                                      Rank:{" "}
                                      <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                                        #{res.rank}
                                      </span>
                                    </>
                                  ) : null}
                                </p>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <Badge tone={res.resultStatus === "PASS" ? "success" : "danger"}>
                                  {res.resultStatus} ({res.grade || "N/A"})
                                </Badge>
                                {snapshot ? (
                                  <StudentReportCardModal
                                    snapshot={
                                      snapshot.snapshotData as unknown as Parameters<
                                        typeof StudentReportCardModal
                                      >[0]["snapshot"]
                                    }
                                    checksum={snapshot.checksum}
                                  />
                                ) : (
                                  <span className="text-[11px] text-muted italic">
                                    Snapshot pending
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
