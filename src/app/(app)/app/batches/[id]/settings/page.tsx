import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { updateBatchAction, assignTeachersAction } from "@/actions/batches";
import { ActionForm } from "@/components/ui/action-form";
import { Field, FormGrid } from "@/components/ui/form-field";
import { Card, PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Batch Settings" };

export default async function BatchSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenantPermission("tenant.batches.write");

  const [batch, academicYears, subjects, allTeachers] = await Promise.all([
    db.batch.findFirst({
      where: { id, tenantId: ctx.tenant.id },
      include: {
        teachers: true,
        _count: { select: { students: { where: { status: "ACTIVE" } } } },
      },
    }),
    db.academicYear.findMany({
      where: { tenantId: ctx.tenant.id },
      select: { id: true, name: true, isActive: true },
      orderBy: { startDate: "desc" },
    }),
    db.subject.findMany({
      where: { tenantId: ctx.tenant.id },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    db.membership.findMany({
      where: {
        tenantId: ctx.tenant.id,
        status: "ACTIVE",
        role: { key: { in: ["TEACHER", "PRINCIPAL", "INSTITUTE_ADMIN"] } },
      },
      select: {
        id: true,
        user: { select: { name: true, email: true } },
        role: { select: { name: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  if (!batch) {
    notFound();
  }

  const activeCount = batch._count.students;
  const assignedTeacherIds = new Set(batch.teachers.map((t) => t.teacherId));
  const primaryTeacherId = batch.teachers.find((t) => t.isPrimary)?.teacherId || "";

  const bindUpdateAction = updateBatchAction.bind(null, batch.id);

  async function handleAssignTeachers(formData: FormData) {
    "use server";
    const teacherIds = formData.getAll("teacherIds").map(String).filter(Boolean);
    const primaryId = String(formData.get("primaryTeacherId") || "");
    await assignTeachersAction(id, teacherIds, primaryId);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={`Settings: ${batch.name}`}
        description={`Update batch configuration, schedule, capacity and faculty allocation.`}
        actions={
          <Link href={`/app/batches/${batch.id}`} className="btn btn-secondary btn-sm flex items-center gap-1.5">
            <ArrowLeft className="size-3.5" />
            <span>Back to batch</span>
          </Link>
        }
      />

      {/* Main Settings Form */}
      <Card className="p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4 pb-2 border-b border-[var(--border)]">
          Batch Configuration
        </h3>

        <ActionForm
          action={bindUpdateAction}
          submitLabel="Save changes"
          pendingLabel="Saving changes…"
        >
          <FormGrid>
            <Field label="Batch name" htmlFor="name" required>
              <input
                id="name"
                name="name"
                type="text"
                required
                defaultValue={batch.name}
                className="input text-xs w-full"
              />
            </Field>

            <Field label="Batch code" htmlFor="code" required>
              <input
                id="code"
                name="code"
                type="text"
                required
                defaultValue={batch.code}
                className="input font-mono uppercase text-xs w-full"
              />
            </Field>

            <Field label="Academic year" htmlFor="academicYearId" required>
              <select
                id="academicYearId"
                name="academicYearId"
                required
                defaultValue={batch.academicYearId}
                className="input text-xs w-full"
              >
                {academicYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name} {y.isActive ? "(Current)" : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Subject" htmlFor="subjectId">
              <select
                id="subjectId"
                name="subjectId"
                defaultValue={batch.subjectId || ""}
                className="input text-xs w-full"
              >
                <option value="">General / Multi-Subject</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.code ? `(${s.code})` : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Maximum capacity"
              htmlFor="capacity"
              required
              hint={`Currently enrolled: ${activeCount}. Cannot be set below ${activeCount}.`}
            >
              <input
                id="capacity"
                name="capacity"
                type="number"
                min={activeCount}
                max="1000"
                required
                defaultValue={batch.capacity}
                className="input text-xs w-full"
              />
            </Field>

            <Field label="Batch status" htmlFor="status" required>
              <select id="status" name="status" defaultValue={batch.status} className="input text-xs w-full">
                <option value="ACTIVE">Active (Accepts enrollments)</option>
                <option value="DRAFT">Draft</option>
                <option value="COMPLETED">Completed</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </Field>

            <Field label="Start date" htmlFor="startDate">
              <input
                id="startDate"
                name="startDate"
                type="date"
                defaultValue={batch.startDate ? batch.startDate.toISOString().split("T")[0] : ""}
                className="input text-xs w-full"
              />
            </Field>

            <Field label="End date" htmlFor="endDate">
              <input
                id="endDate"
                name="endDate"
                type="date"
                defaultValue={batch.endDate ? batch.endDate.toISOString().split("T")[0] : ""}
                className="input text-xs w-full"
              />
            </Field>
          </FormGrid>

          <div className="mt-4 space-y-4">
            <Field label="Schedule / Timing" htmlFor="schedule">
              <input
                id="schedule"
                name="schedule"
                type="text"
                defaultValue={batch.schedule || ""}
                placeholder="Mon, Wed, Fri 4:00 PM – 5:30 PM"
                className="input text-xs w-full"
              />
            </Field>

            <Field label="Description" htmlFor="description">
              <textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={batch.description || ""}
                className="input text-xs w-full resize-none"
              />
            </Field>
          </div>
        </ActionForm>
      </Card>

      {/* Teachers Assignment Form */}
      <Card className="p-6">
        <h3 className="text-sm font-semibold text-foreground mb-1">Assigned Teachers</h3>
        <p className="text-xs text-muted mb-4 pb-2 border-b border-[var(--border)]">
          Allocate faculty members to this batch. Select one lead faculty member.
        </p>

        <form action={handleAssignTeachers} className="space-y-4">
          <div className="space-y-2 border border-[var(--border)] rounded-lg p-3 max-h-60 overflow-y-auto">
            {allTeachers.map((t) => {
              const isAssigned = assignedTeacherIds.has(t.id);
              const isLead = primaryTeacherId === t.id;
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-2 rounded hover:bg-[var(--surface-hover)] text-xs"
                >
                  <label className="flex items-center gap-2 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      name="teacherIds"
                      value={t.id}
                      defaultChecked={isAssigned}
                      className="rounded border-[var(--border)] text-[var(--brand)]"
                    />
                    <div>
                      <p className="font-medium text-foreground">{t.user.name}</p>
                      <p className="text-[10px] text-muted">{t.user.email} &bull; {t.role.name}</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted hover:text-foreground">
                    <input
                      type="radio"
                      name="primaryTeacherId"
                      value={t.id}
                      defaultChecked={isLead}
                      className="text-[var(--brand)]"
                    />
                    <span>Lead</span>
                  </label>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary btn-sm text-xs">
              Save teacher assignments
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
