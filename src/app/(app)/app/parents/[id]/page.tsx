import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone, Trash2, Unlink } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import {
  deleteGuardianAction,
  unlinkGuardianAction,
  updateGuardianAction,
} from "@/actions/students";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmButton } from "@/components/ui/client-bits";
import { Field, FormGrid } from "@/components/ui/form-field";
import {
  Avatar,
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  InfoRow,
  PageHeader,
  statusTone,
  statusLabel,
} from "@/components/ui/primitives";
import { date } from "@/lib/format";

export const metadata = { title: "Parent profile" };

export default async function ParentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const ctx = await requireTenantPermission("tenant.parents.read");
  const { id } = await params;
  const sp = await searchParams;

  const guardian = await db.guardian.findFirst({
    where: { id, tenantId: ctx.tenant.id },
    include: {
      students: {
        include: { student: { include: { section: { include: { class: true } } } } },
        orderBy: { isPrimary: "desc" },
      },
    },
  });
  if (!guardian) notFound();

  const canWrite = hasTenantPermission(ctx, "tenant.parents.write");
  const linkedIds = new Set(guardian.students.map((link) => link.studentId));
  const availableStudents = canWrite
    ? await db.student.findMany({
        where: { tenantId: ctx.tenant.id, status: "ACTIVE", id: { notIn: [...linkedIds] } },
        include: { section: { include: { class: true } } },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        take: 500,
      })
    : [];

  return (
    <div className="space-y-5">
      <Link
        href="/app/parents"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-3.5" /> All parents
      </Link>

      {sp.created && (
        <Callout tone="success" title="Parent added">
          Link more children below if this guardian is responsible for other students.
        </Callout>
      )}

      <PageHeader
        eyebrow={guardian.relation ?? "Guardian"}
        title={guardian.name}
        description={`${guardian.phone}${guardian.email ? ` · ${guardian.email}` : ""}`}
        actions={
          <>
            <Badge tone="brand">
              {guardian.students.length} child{guardian.students.length === 1 ? "" : "ren"}
            </Badge>
            {canWrite && (
              <form action={deleteGuardianAction}>
                <input type="hidden" name="guardianId" value={guardian.id} />
                <ConfirmButton
                  className="btn btn-danger-soft"
                  message={`Delete ${guardian.name}? Student links are removed, but student records are kept. This cannot be undone.`}
                >
                  <Trash2 className="size-3.5" /> Delete
                </ConfirmButton>
              </form>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Contact" description="Primary details on record" />
            <div className="flex items-center gap-3 px-4 py-4">
              <Avatar name={guardian.name} size={48} color="#0d9488" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{guardian.name}</p>
                <p className="text-[11px] text-muted">{guardian.relation ?? "Guardian"}</p>
              </div>
            </div>
            <div className="divide-y divide-[var(--border)] px-4 py-1">
              <InfoRow label="Phone">
                <a href={`tel:${guardian.phone}`} className="link inline-flex items-center gap-1">
                  <Phone className="size-3" /> {guardian.phone}
                </a>
              </InfoRow>
              <InfoRow label="Email">
                {guardian.email ? (
                  <a href={`mailto:${guardian.email}`} className="link inline-flex items-center gap-1">
                    <Mail className="size-3" /> {guardian.email}
                  </a>
                ) : (
                  "—"
                )}
              </InfoRow>
              <InfoRow label="Occupation">{guardian.occupation ?? "—"}</InfoRow>
              <InfoRow label="Added">{date(guardian.createdAt)}</InfoRow>
            </div>
          </Card>

          <Card>
            <CardHeader title="Children" description="Students linked to this guardian" />
            <div className="divide-y divide-[var(--border)]">
              {guardian.students.map((link) => (
                <div key={link.studentId} className="flex items-start gap-2.5 px-4 py-3">
                  <Avatar
                    name={`${link.student.firstName} ${link.student.lastName}`}
                    size={30}
                    color={ctx.tenant.accentColor}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/app/students/${link.studentId}`}
                      className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium hover:underline"
                    >
                      <span className="truncate">
                        {link.student.firstName} {link.student.lastName}
                      </span>
                      {link.isPrimary && <Badge tone="brand">Primary</Badge>}
                      <Badge tone={statusTone(link.student.status)}>
                        {statusLabel(link.student.status)}
                      </Badge>
                    </Link>
                    <p className="text-[11px] text-muted">
                      {link.student.admissionNo}
                      {link.student.section
                        ? ` · ${link.student.section.class.name} — ${link.student.section.name}`
                        : ""}
                    </p>
                  </div>
                  {canWrite && (
                    <form action={unlinkGuardianAction}>
                      <input type="hidden" name="guardianId" value={guardian.id} />
                      <input type="hidden" name="studentId" value={link.studentId} />
                      <button
                        className="btn btn-ghost btn-sm text-[var(--danger)]"
                        type="submit"
                        title="Unlink this student"
                      >
                        <Unlink className="size-3.5" />
                      </button>
                    </form>
                  )}
                </div>
              ))}
              {guardian.students.length === 0 && (
                <EmptyState
                  title="No children linked"
                  description="Use the form to link this guardian to a student."
                />
              )}
            </div>
          </Card>
        </div>

        {canWrite && (
          <Card>
            <CardHeader
              title="Edit guardian"
              description="Changes apply to future notices and fee reminders."
            />
            <div className="p-4">
              <ActionForm
                action={updateGuardianAction}
                submitLabel="Save changes"
                pendingLabel="Saving…"
                cancelHref="/app/parents"
              >
                <input type="hidden" name="guardianId" value={guardian.id} />
                <FormGrid>
                  <Field label="Full name" htmlFor="name" required>
                    <input id="name" name="name" className="input" defaultValue={guardian.name} required />
                  </Field>
                  <Field label="Phone number" htmlFor="phone" required>
                    <input
                      id="phone"
                      name="phone"
                      type="tel"
                      className="input"
                      defaultValue={guardian.phone}
                      required
                    />
                  </Field>
                  <Field label="Email" htmlFor="email">
                    <input
                      id="email"
                      name="email"
                      type="email"
                      className="input"
                      defaultValue={guardian.email ?? ""}
                    />
                  </Field>
                  <Field label="Relationship" htmlFor="relation">
                    <select
                      id="relation"
                      name="relation"
                      className="select"
                      defaultValue={guardian.relation ?? ""}
                    >
                      <option value="">Not specified</option>
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Guardian">Guardian</option>
                      <option value="Grandparent">Grandparent</option>
                      <option value="Other">Other</option>
                    </select>
                  </Field>
                  <Field label="Occupation" htmlFor="occupation">
                    <input
                      id="occupation"
                      name="occupation"
                      className="input"
                      defaultValue={guardian.occupation ?? ""}
                    />
                  </Field>
                  <Field
                    label="Link another student"
                    htmlFor="studentId"
                    hint="Optional. Leaves existing links unchanged."
                  >
                    <select id="studentId" name="studentId" className="select" defaultValue="">
                      <option value="">No new link</option>
                      {availableStudents.map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.firstName} {student.lastName} · {student.admissionNo}
                          {student.section ? ` · ${student.section.class.name}-${student.section.name}` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                </FormGrid>
              </ActionForm>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
