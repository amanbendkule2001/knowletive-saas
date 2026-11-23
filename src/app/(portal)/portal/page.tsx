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
import { DemoCheckoutButton } from "@/components/portal/demo-checkout-button";

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
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  const studentIds = linkedStudents.map((s) => s.id);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // eslint-disable-line react-hooks/purity
  const now = new Date();

  // Fetch fee invoices, attendance, payment links, exam results, fee plans, and student files
  const [feeInvoices, attendanceRecords, paymentLinks, examResults, feePlans, demoFeePlans, studentFiles] = await (studentIds.length > 0
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
        db.feePaymentLink
          .findMany({
            where: {
              tenantId: ctx.tenant.id,
              expiresAt: { gte: now },
              feeInvoice: { studentId: { in: studentIds } },
            },
            select: { id: true, token: true, feeInvoiceId: true, status: true },
          })
          .catch(() => []),
        db.examResult
          .findMany({
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
          })
          .catch(() => []),
        db.studentFeePlan
          .findMany({
            where: { tenantId: ctx.tenant.id, studentId: { in: studentIds }, status: "ACTIVE" },
            include: {
              installments: {
                orderBy: { installmentNumber: "asc" },
                include: { feeInvoice: true },
              },
            },
          })
          .catch(() => []),
        db.demoFeePlan
          .findMany({
            where: { tenantId: ctx.tenant.id, studentId: { in: studentIds }, status: "ACTIVE" },
            include: {
              installments: {
                orderBy: { installmentNumber: "asc" },
              },
            },
          })
          .catch(() => []),
        db.fileAsset
          .findMany({
            where: { tenantId: ctx.tenant.id, studentId: { in: studentIds } },
            select: { id: true, studentId: true, name: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          })
          .catch(() => []),
      ])
    : Promise.resolve([[], [], [], [], [], [], []] as [
        Awaited<ReturnType<typeof db.feeInvoice.findMany>>,
        Awaited<ReturnType<typeof db.attendance.findMany>>,
        Awaited<ReturnType<typeof db.feePaymentLink.findMany<{ select: { id: true; token: true; feeInvoiceId: true; status: true } }>>>,
        Awaited<ReturnType<typeof db.examResult.findMany<{ include: { exam: { include: { academicYear: true } }; snapshots: true } }>>>,
        Awaited<ReturnType<typeof db.studentFeePlan.findMany<{ include: { installments: { include: { feeInvoice: true } } } }>>>,
        Awaited<ReturnType<typeof db.demoFeePlan.findMany<{ include: { installments: true } }>>>,
        Array<{ id: string; studentId: string | null; name: string; createdAt: Date }>,
      ]));

  // Index files by student id
  const filesByStudent = new Map<string, Array<{ id: string; name: string }>>();
  for (const f of studentFiles) {
    if (!f.studentId) continue;
    const arr = filesByStudent.get(f.studentId) ?? [];
    arr.push({ id: f.id, name: f.name });
    filesByStudent.set(f.studentId, arr);
  }

  // Index payment links by invoice id
  const payLinkByInvoice = new Map(paymentLinks.map((pl) => [pl.feeInvoiceId, pl]));

  // Group by student
  const invoicesByStudent = new Map<string, typeof feeInvoices>();
  for (const inv of feeInvoices) {
    const arr = invoicesByStudent.get(inv.studentId) ?? [];
    arr.push(inv);
    invoicesByStudent.set(inv.studentId, arr);
  }

  const plansByStudent = new Map<string, typeof feePlans>();
  for (const plan of feePlans) {
    const arr = plansByStudent.get(plan.studentId) ?? [];
    arr.push(plan);
    plansByStudent.set(plan.studentId, arr);
  }

  const demoPlansByStudent = new Map<string, typeof demoFeePlans>();
  for (const dp of demoFeePlans) {
    const arr = demoPlansByStudent.get(dp.studentId) ?? [];
    arr.push(dp);
    demoPlansByStudent.set(dp.studentId, arr);
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
              const studentPlans = plansByStudent.get(student.id) ?? [];
              const studentDemoPlans = demoPlansByStudent.get(student.id) ?? [];
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
                    {/* ── Fee Invoices & Installments ── */}
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                          <CreditCard className="size-3.5" /> Fees & Installment Schedules
                        </p>
                        <Link
                          href="/portal/fees"
                          className="text-[11px] font-semibold text-brand hover:underline"
                        >
                          Full Jodo Portal →
                        </Link>
                      </div>

                      {/* 1. Official Installment Plans */}
                      {studentPlans.map((plan) => (
                        <div key={plan.id} className="mb-4 rounded-xl border border-[var(--border)] p-3 bg-[var(--surface-2)] space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-foreground">{plan.title}</span>
                            <Badge tone="info">{plan.scheduleType}</Badge>
                          </div>
                          <div className="text-[11px] text-muted flex justify-between">
                            <span>Total: {money(plan.payableAmount)}</span>
                            <span>{plan.installments.length} installments</span>
                          </div>
                          <div className="space-y-1.5 pt-1">
                            {plan.installments.map((inst) => {
                              const payLink = inst.feeInvoice ? payLinkByInvoice.get(inst.feeInvoice.id) : null;
                              const remainingPaise = inst.feeInvoice
                                ? Math.max(0, inst.feeInvoice.amount - inst.feeInvoice.paidAmount)
                                : Math.max(0, inst.originalAmount - inst.discountAmount + inst.lateFeeAmount);
                              return (
                                <div key={inst.id} className="flex items-center justify-between text-xs py-1 border-t border-[var(--border)]">
                                  <div className="min-w-0">
                                    <p className="font-medium truncate">{inst.title}</p>
                                    <p className="text-[10px] text-muted">Due {date(inst.dueDate)} · {money(remainingPaise)} remaining</p>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <Badge tone={inst.status === "PAID" ? "success" : inst.status === "PARTIALLY_PAID" ? "warning" : inst.status === "OVERDUE" ? "danger" : "neutral"}>
                                      {inst.status}
                                    </Badge>
                                    {payLink && inst.status !== "PAID" && (
                                      <Link href={`/pay/${payLink.token}`} className="text-[10px] text-brand underline ml-1">Pay</Link>
                                    )}
                                    {inst.status !== "PAID" && remainingPaise > 0 && (
                                      <DemoCheckoutButton
                                        studentId={student.id}
                                        installmentId={inst.id}
                                        amountRupees={remainingPaise / 100}
                                        label="Demo Pay →"
                                      />
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {/* 2. Isolated DEMO Installment Plans */}
                      {studentDemoPlans.map((dp) => (
                        <div key={dp.id} className="mb-4 rounded-xl border-2 border-amber-400/50 bg-amber-50/40 dark:bg-amber-950/20 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-foreground">{dp.title}</span>
                            <Badge tone="warning">DEMO PLAN</Badge>
                          </div>
                          <div className="space-y-1.5 pt-1">
                            {dp.installments.map((inst) => {
                              const remaining = Math.max(0, inst.originalAmount - inst.paidAmount);
                              return (
                                <div key={inst.id} className="flex items-center justify-between text-xs py-1 border-t border-amber-200 dark:border-amber-900/40">
                                  <div className="min-w-0">
                                    <p className="font-medium truncate">{inst.title}</p>
                                    <p className="text-[10px] text-muted">
                                      Due {date(inst.dueDate)} · {money(remaining)} remaining
                                    </p>
                                  </div>
                                  <div className="flex flex-col items-end gap-1">
                                    <Badge tone={inst.status === "PAID" ? "success" : inst.status === "PARTIALLY_PAID" ? "warning" : "neutral"}>
                                      {inst.status}
                                    </Badge>
                                    {remaining > 0 && (
                                      <DemoCheckoutButton
                                        studentId={student.id}
                                        installmentId={inst.id}
                                        amountRupees={remaining / 100}
                                      />
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {/* 3. Standard Invoices (when no plans or standalone bills) */}
                      {invoices.length === 0 && studentPlans.length === 0 && studentDemoPlans.length === 0 ? (
                        <p className="text-xs text-muted">No invoices or fee plans issued yet.</p>
                      ) : (
                        studentPlans.length === 0 && studentDemoPlans.length === 0 && (
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
                        )
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
                      {(() => {
                        const docs = filesByStudent.get(student.id) ?? [];
                        return docs.length === 0 ? (
                          <p className="text-xs text-muted">No documents attached.</p>
                        ) : (
                          <div className="space-y-1">
                            {docs.map((doc) => (
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
                        );
                      })()}
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
