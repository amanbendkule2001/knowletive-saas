import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CalendarCheck,
  CircleDollarSign,
  Download,
  FileText,
  Mail,
  MapPin,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission, isStaffMember } from "@/lib/auth";
import { setStudentStatusAction } from "@/actions/students";
import { uploadStudentDocumentAction, deleteStudentDocumentAction } from "@/actions/storage";
import { ConfirmButton } from "@/components/ui/client-bits";
import {
  Avatar,
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  InfoRow,
  PageHeader,
  Progress,
  StatCard,
  statusLabel,
  statusTone,
} from "@/components/ui/primitives";
import { date, money, num, pct } from "@/lib/format";

export const metadata = { title: "Student profile" };

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; saved?: string }>;
}) {
  const ctx = await requireTenantPermission("tenant.students.read");
  if (!isStaffMember(ctx)) redirect("/portal");
  const { id } = await params;
  const sp = await searchParams;

  const student = await db.student.findFirst({
    where: { id, tenantId: ctx.tenant.id },
    include: {
      section: { include: { class: true } },
      guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } },
      feeInvoices: { orderBy: { dueDate: "desc" } },
      attendance: { orderBy: { date: "desc" }, take: 30 },
    },
  });
  if (!student) notFound();

  const attendanceCounts = await db.attendance.groupBy({
    by: ["status"],
    where: { tenantId: ctx.tenant.id, studentId: student.id },
    _count: { _all: true },
  });

  const totalDays = attendanceCounts.reduce((sum, row) => sum + row._count._all, 0);
  const present = attendanceCounts.find((r) => r.status === "PRESENT")?._count._all ?? 0;
  const late = attendanceCounts.find((r) => r.status === "LATE")?._count._all ?? 0;
  const attendanceRate = totalDays ? ((present + late) / totalDays) * 100 : 0;

  const billed = student.feeInvoices.filter((inv) => inv.status !== "WAIVED");
  const totalBilled = billed.reduce((sum, inv) => sum + inv.amount, 0);
  const totalPaid = billed.reduce((sum, inv) => sum + inv.paidAmount, 0);
  const outstanding = totalBilled - totalPaid;
  const canWrite = hasTenantPermission(ctx, "tenant.students.write");
  const canDelete = hasTenantPermission(ctx, "tenant.students.delete");
  const canWriteFees = hasTenantPermission(ctx, "tenant.fees.write");
  const primaryGuardian = student.guardians[0]?.guardian;

  const documents = await db.fileAsset.findMany({
    where: { tenantId: ctx.tenant.id, studentId: student.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-5">
      <Link
        href="/app/students"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-3.5" /> All students
      </Link>

      {(sp.created || sp.saved) && (
        <Callout tone="success" title={sp.created ? "Student added" : "Profile saved"}>
          {sp.created
            ? "Guardian details can be extended from the Parents page and fees from the Fees workspace."
            : "Your changes are live across attendance and fee records."}
        </Callout>
      )}

      <PageHeader
        eyebrow={student.section ? `${student.section.class.name} — Section ${student.section.name}` : "Unassigned"}
        title={`${student.firstName} ${student.lastName}`}
        description={`Admission ${student.admissionNo} · joined ${date(student.admissionDate)}`}
        actions={
          <>
            <Badge tone={statusTone(student.status)}>{statusLabel(student.status)}</Badge>
            {canWrite && (
              <Link href={`/app/students/${student.id}/edit`} className="btn btn-secondary">
                <Pencil className="size-3.5" /> Edit profile
              </Link>
            )}
            {canDelete && student.status !== "ALUMNI" && (
              <form action={setStudentStatusAction}>
                <input type="hidden" name="studentId" value={student.id} />
                <input type="hidden" name="status" value="ALUMNI" />
                <ConfirmButton
                  className="btn btn-danger-soft"
                  message={`Archive ${student.firstName} ${student.lastName}? They will be removed from the active roll but all records are kept.`}
                >
                  Archive
                </ConfirmButton>
              </form>
            )}
            {canDelete && student.status === "ALUMNI" && (
              <form action={setStudentStatusAction}>
                <input type="hidden" name="studentId" value={student.id} />
                <input type="hidden" name="status" value="ACTIVE" />
                <button className="btn btn-primary" type="submit">
                  Restore to active roll
                </button>
              </form>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Attendance"
          value={totalDays ? pct(attendanceRate, 0) : "—"}
          sub={`${num(present + late)} of ${num(totalDays)} days present`}
          icon={<CalendarCheck className="size-4" />}
          tone={attendanceRate >= 90 ? "success" : attendanceRate >= 75 ? "warning" : "danger"}
          href="/app/attendance"
        />
        <StatCard
          label="Total billed"
          value={money(totalBilled)}
          sub={`${student.feeInvoices.length} invoice${student.feeInvoices.length === 1 ? "" : "s"}`}
          icon={<CircleDollarSign className="size-4" />}
        />
        <StatCard
          label="Paid"
          value={money(totalPaid)}
          sub={`${pct(totalBilled ? (totalPaid / totalBilled) * 100 : 0, 0)} of billed`}
          icon={<CircleDollarSign className="size-4" />}
          tone="success"
        />
        <StatCard
          label="Outstanding"
          value={money(outstanding)}
          sub={outstanding > 0 ? "Follow up with the guardian" : "All settled"}
          icon={<CircleDollarSign className="size-4" />}
          tone={outstanding > 0 ? "warning" : "success"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Profile" description="Identity and contact details" />
            <div className="flex items-center gap-3 px-4 py-4">
              <Avatar
                name={`${student.firstName} ${student.lastName}`}
                color={ctx.tenant.accentColor}
                size={52}
              />
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {student.firstName} {student.lastName}
                </p>
                <p className="font-mono text-[11px] text-muted">{student.admissionNo}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone={statusTone(student.status)}>{statusLabel(student.status)}</Badge>
                  {student.gender && <Badge tone="neutral">{statusLabel(student.gender)}</Badge>}
                  {student.bloodGroup && <Badge tone="danger">{student.bloodGroup}</Badge>}
                </div>
              </div>
            </div>
            <div className="divide-y divide-[var(--border)] px-4 py-1">
              <InfoRow label="Class">
                {student.section
                  ? `${student.section.class.name} — ${student.section.name}`
                  : "Unassigned"}
              </InfoRow>
              <InfoRow label="Date of birth">{date(student.dob)}</InfoRow>
              <InfoRow label="Email">
                {student.email ? (
                  <a href={`mailto:${student.email}`} className="link">
                    {student.email}
                  </a>
                ) : (
                  "—"
                )}
              </InfoRow>
              <InfoRow label="Phone">{student.phone ?? "—"}</InfoRow>
              <InfoRow label="Address">{student.address ?? "—"}</InfoRow>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Guardians"
              description={`${student.guardians.length} linked`}
              action={
                hasTenantPermission(ctx, "tenant.parents.write") ? (
                  <Link href="/app/parents/new" className="link text-xs">
                    Add
                  </Link>
                ) : undefined
              }
            />
            <div className="divide-y divide-[var(--border)]">
              {student.guardians.map((link) => (
                <Link
                  key={link.guardianId}
                  href={`/app/parents/${link.guardianId}`}
                  className="flex items-start gap-2.5 px-4 py-3 hover:bg-[var(--surface-2)]"
                >
                  <Avatar name={link.guardian.name} size={30} color="#0d9488" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium">
                      <span className="truncate">{link.guardian.name}</span>
                      {link.isPrimary && <Badge tone="brand">Primary</Badge>}
                    </p>
                    <p className="text-[11px] text-muted">
                      {link.guardian.relation ?? "Guardian"} · {link.guardian.phone}
                    </p>
                    {link.guardian.email && (
                      <p className="truncate text-[10px] text-[var(--muted-2)]">
                        {link.guardian.email}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
              {student.guardians.length === 0 && (
                <EmptyState
                  title="No guardian linked"
                  description="Add a parent or guardian so fee reminders and absence alerts reach the right person."
                  action={
                    hasTenantPermission(ctx, "tenant.parents.write") ? (
                      <Link href="/app/parents/new" className="btn btn-primary btn-sm">
                        <Plus className="size-3.5" /> Add parent
                      </Link>
                    ) : undefined
                  }
                />
              )}
            </div>
          </Card>

          {primaryGuardian && (
            <Card>
              <CardHeader title="Emergency contact" />
              <div className="space-y-2 p-4 text-[13px]">
                <p className="flex items-center gap-2">
                  <UserRound className="size-3.5 text-muted" /> {primaryGuardian.name}
                </p>
                <p className="flex items-center gap-2">
                  <Phone className="size-3.5 text-muted" />
                  <a href={`tel:${primaryGuardian.phone}`} className="link">
                    {primaryGuardian.phone}
                  </a>
                </p>
                {primaryGuardian.email && (
                  <p className="flex items-center gap-2">
                    <Mail className="size-3.5 text-muted" />
                    <a href={`mailto:${primaryGuardian.email}`} className="link truncate">
                      {primaryGuardian.email}
                    </a>
                  </p>
                )}
                {student.address && (
                  <p className="flex items-start gap-2 text-muted">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" /> {student.address}
                  </p>
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Documents & Attachments"
              description={`${documents.length} file${documents.length === 1 ? "" : "s"} stored`}
              action={<Paperclip className="size-4 text-muted" />}
            />
            <div className="divide-y divide-[var(--border)]">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                    <FileText className="size-4 text-muted shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{doc.name}</p>
                      <p className="text-[10px] text-muted">
                        {doc.kind.replace(/_/g, " ")} &bull; {Math.round(doc.size / 1024)} KB &bull; {date(doc.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={`/api/files/${doc.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost btn-sm text-xs"
                      title="Download file"
                    >
                      <Download className="size-3.5" />
                    </a>
                    {canWrite && (
                      <form action={deleteStudentDocumentAction}>
                        <input type="hidden" name="fileId" value={doc.id} />
                        <input type="hidden" name="studentId" value={student.id} />
                        <button
                          type="submit"
                          className="btn btn-ghost btn-sm text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                          title="Delete file"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
              {documents.length === 0 && (
                <div className="p-4 text-center text-xs text-muted">
                  No documents attached yet.
                </div>
              )}
            </div>

            {canWrite && (
              <form action={uploadStudentDocumentAction} className="border-t border-[var(--border)] bg-[var(--surface-sunken)] p-3 space-y-2">
                <input type="hidden" name="studentId" value={student.id} />
                <p className="text-xs font-semibold">Attach document</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    name="name"
                    placeholder="Document title (e.g. Birth Certificate)"
                    className="input text-xs py-1 h-8"
                  />
                  <select name="kind" className="select text-xs py-1 h-8">
                    <option value="DOCUMENT">Academic Document / PDF</option>
                    <option value="STUDENT_PHOTO">Student Photograph</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    name="file"
                    required
                    accept="image/*,application/pdf,.doc,.docx"
                    className="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-[var(--surface-2)] file:text-foreground cursor-pointer flex-1"
                  />
                  <button type="submit" className="btn btn-primary btn-sm text-xs">
                    <Upload className="size-3" /> Upload
                  </button>
                </div>
              </form>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Fee invoices"
              description="Term fees, partial payments and dues"
              action={
                canWriteFees ? (
                  <Link href={`/app/fees/new?student=${student.id}`} className="btn btn-secondary btn-sm">
                    <Plus className="size-3.5" /> New invoice
                  </Link>
                ) : undefined
              }
            />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Due</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {student.feeInvoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <Link href={`/app/fees/${invoice.id}`} className="font-medium hover:underline">
                          {invoice.title}
                        </Link>
                        <p className="font-mono text-[10px] text-muted">{invoice.number}</p>
                      </td>
                      <td className="text-muted">{date(invoice.dueDate)}</td>
                      <td className="text-right tabular-nums">{money(invoice.amount)}</td>
                      <td className="text-right tabular-nums">
                        {money(invoice.amount - invoice.paidAmount)}
                      </td>
                      <td>
                        <Badge tone={statusTone(invoice.status)}>{statusLabel(invoice.status)}</Badge>
                      </td>
                    </tr>
                  ))}
                  {student.feeInvoices.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-xs text-muted">
                        No fee invoices yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Attendance record"
              description={`Last ${student.attendance.length} marked days`}
              action={<Badge tone={attendanceRate >= 75 ? "success" : "warning"}>{pct(attendanceRate, 0)}</Badge>}
            />
            <div className="p-4">
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(["PRESENT", "LATE", "ABSENT", "EXCUSED"] as const).map((value) => {
                  const count = attendanceCounts.find((r) => r.status === value)?._count._all ?? 0;
                  return (
                    <div key={value} className="rounded-xl bg-[var(--surface-2)] p-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-muted">
                        {statusLabel(value)}
                      </p>
                      <p className="text-lg font-semibold tabular-nums">{num(count)}</p>
                    </div>
                  );
                })}
              </div>
              <Progress
                value={attendanceRate}
                tone={attendanceRate >= 90 ? "success" : attendanceRate >= 75 ? "warning" : "danger"}
              />
              <p className="mt-1.5 text-[11px] text-muted">
                {num(present + late)} present of {num(totalDays)} recorded days
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {student.attendance.map((row) => (
                  <span
                    key={row.id}
                    title={`${date(row.date)} — ${statusLabel(row.status)}`}
                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium ${
                      row.status === "PRESENT"
                        ? "bg-[var(--success-soft)] text-[var(--success)]"
                        : row.status === "LATE"
                          ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                          : row.status === "ABSENT"
                            ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                            : "bg-[var(--info-soft)] text-[var(--info)]"
                    }`}
                  >
                    {date(row.date).slice(0, 6)}
                  </span>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
