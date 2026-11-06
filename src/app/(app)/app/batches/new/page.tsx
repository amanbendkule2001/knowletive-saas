import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { createBatchAction } from "@/actions/batches";
import { ActionForm } from "@/components/ui/action-form";
import { Field, FormGrid } from "@/components/ui/form-field";
import { Card, PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Create Batch" };

export default async function NewBatchPage() {
  const ctx = await requireTenantPermission("tenant.batches.write");

  const [academicYears, subjects, teachers] = await Promise.all([
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
      select: { id: true, user: { select: { name: true, email: true } }, role: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const defaultYearId = academicYears.find((y) => y.isActive)?.id || academicYears[0]?.id || "";

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Create New Batch"
        description="Configure a subject group, coaching cohort, or specialized academic batch."
        actions={
          <Link href="/app/batches" className="btn btn-secondary btn-sm flex items-center gap-1.5">
            <ArrowLeft className="size-3.5" />
            <span>Back to batches</span>
          </Link>
        }
      />

      <Card className="p-6">
        <ActionForm
          action={createBatchAction}
          submitLabel="Create batch"
          pendingLabel="Creating batch…"
        >
          <FormGrid>
            <Field label="Batch name" htmlFor="name" required hint="e.g. Physics Advanced JEE 2026">
              <input
                id="name"
                name="name"
                type="text"
                required
                placeholder="Physics Advanced 2026"
                className="input text-xs w-full"
              />
            </Field>

            <Field label="Batch code" htmlFor="code" required hint="Unique alphanumeric code (e.g. PHY-ADV-A)">
              <input
                id="code"
                name="code"
                type="text"
                required
                placeholder="PHY-ADV-A"
                className="input font-mono uppercase text-xs w-full"
              />
            </Field>

            <Field label="Academic year" htmlFor="academicYearId" required>
              <select
                id="academicYearId"
                name="academicYearId"
                required
                defaultValue={defaultYearId}
                className="input text-xs w-full"
              >
                {academicYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name} {y.isActive ? "(Current)" : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Subject (optional)" htmlFor="subjectId" hint="Leave empty for general/all-subject cohorts">
              <select id="subjectId" name="subjectId" defaultValue="" className="input text-xs w-full">
                <option value="">General / Multi-Subject</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.code ? `(${s.code})` : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Maximum capacity" htmlFor="capacity" required hint="Maximum students allowed">
              <input
                id="capacity"
                name="capacity"
                type="number"
                min="1"
                max="1000"
                defaultValue="30"
                required
                className="input text-xs w-full"
              />
            </Field>

            <Field label="Initial status" htmlFor="status" required>
              <select id="status" name="status" defaultValue="ACTIVE" className="input text-xs w-full">
                <option value="ACTIVE">Active (Accepts enrollments)</option>
                <option value="DRAFT">Draft (Setup mode)</option>
              </select>
            </Field>

            <Field label="Start date" htmlFor="startDate">
              <input id="startDate" name="startDate" type="date" className="input text-xs w-full" />
            </Field>

            <Field label="End date" htmlFor="endDate">
              <input id="endDate" name="endDate" type="date" className="input text-xs w-full" />
            </Field>
          </FormGrid>

          <div className="mt-4 space-y-4">
            <Field label="Schedule / Timing" htmlFor="schedule" hint="e.g. Mon, Wed, Fri 4:00 PM – 5:30 PM (Room 204)">
              <input
                id="schedule"
                name="schedule"
                type="text"
                placeholder="Mon, Wed, Fri 4:00 PM – 5:30 PM"
                className="input text-xs w-full"
              />
            </Field>

            <Field label="Description" htmlFor="description">
              <textarea
                id="description"
                name="description"
                rows={3}
                placeholder="Target curriculum, syllabus goals, or prerequisite requirements..."
                className="input text-xs w-full resize-none"
              />
            </Field>

            <div>
              <label className="label text-xs mb-2 block font-medium">Assigned Teachers</label>
              {teachers.length === 0 ? (
                <p className="text-xs text-muted">No teachers found in this institute.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-[var(--border)] rounded-lg p-3 max-h-48 overflow-y-auto">
                  {teachers.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-[var(--surface-hover)] cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        name="teacherIds"
                        value={t.id}
                        className="rounded border-[var(--border)] text-[var(--brand)]"
                      />
                      <span className="font-medium text-foreground">{t.user.name}</span>
                      <span className="text-[11px] text-muted">({t.role.name})</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
