import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/primitives";
import { createSyllabusAction } from "@/actions/syllabus";

export const metadata = { title: "Create Syllabus — SyllabusTrack" };

export default async function NewSyllabusPage() {
  const ctx = await requireTenantPermission("tenant.syllabus.write");

  const [academicYears, subjects, classes, batches, teachers] = await Promise.all([
    db.academicYear.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { startDate: "desc" },
    }),
    db.subject.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { name: "asc" },
    }),
    db.classLevel.findMany({
      where: { tenantId: ctx.tenant.id },
      include: { sections: { orderBy: { name: "asc" } } },
      orderBy: { order: "asc" },
    }),
    db.batch.findMany({
      where: { tenantId: ctx.tenant.id, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
    }),
    db.membership.findMany({
      where: {
        tenantId: ctx.tenant.id,
        status: "ACTIVE",
        role: { key: "TEACHER" },
      },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Link href="/app/syllabus" className="hover:text-foreground flex items-center gap-1 transition">
          <ArrowLeft className="size-3.5" />
          <span>Back to SyllabusTrack</span>
        </Link>
      </div>

      <PageHeader
        title="Create New Syllabus"
        description="Establish curriculum goals, timeline, and assign target classes or coaching batches."
      />

      <form
        action={async (formData: FormData) => {
          "use server";
          await createSyllabusAction({}, formData);
        }}
        className="card p-6 border border-[var(--border)] shadow-sm space-y-6"
      >
        {/* Core Metadata */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground border-b border-[var(--border)] pb-2">
            1. Core Syllabus Metadata
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="label text-xs">Syllabus Title *</label>
              <input
                id="name"
                name="name"
                required
                placeholder="e.g. Class 10 Physics (CBSE)"
                className="input text-xs w-full mt-1"
              />
            </div>

            <div>
              <label htmlFor="code" className="label text-xs">Syllabus Code *</label>
              <input
                id="code"
                name="code"
                required
                placeholder="e.g. SYL-PHY-10A"
                className="input text-xs w-full mt-1"
              />
              <p className="text-[11px] text-muted mt-1">Unique identifier within your institute.</p>
            </div>
          </div>

          <div>
            <label htmlFor="description" className="label text-xs">Description / Learning Scope (optional)</label>
            <textarea
              id="description"
              name="description"
              rows={3}
              placeholder="Comprehensive board curriculum covering mechanics, thermodynamics, and optics..."
              className="input text-xs w-full mt-1"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="academicYearId" className="label text-xs">Academic Year *</label>
              <select id="academicYearId" name="academicYearId" required className="input text-xs w-full mt-1">
                {academicYears.map((ay) => (
                  <option key={ay.id} value={ay.id}>
                    {ay.name} {ay.isActive ? "(Current)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="subjectId" className="label text-xs">Subject *</label>
              <select id="subjectId" name="subjectId" required className="input text-xs w-full mt-1">
                <option value="">Select subject...</option>
                {subjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name} {sub.code ? `(${sub.code})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Academic Group Targeting (Conventional School vs Coaching Academy) */}
        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-semibold text-foreground border-b border-[var(--border)] pb-2 flex items-center gap-1.5">
            <span>2. Target Academic Group</span>
            <span className="text-[11px] font-normal text-muted">(School Classroom or Coaching Batch)</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex items-start gap-3 p-3.5 rounded-lg border border-[var(--border)] hover:border-[var(--brand)] cursor-pointer transition">
              <input
                type="radio"
                name="targetType"
                value="CLASS_SECTION"
                defaultChecked
                className="mt-0.5"
              />
              <div>
                <p className="text-xs font-semibold text-foreground">Conventional School (Class & Section)</p>
                <p className="text-[11px] text-muted mt-0.5">
                  Targets standard grade classrooms (e.g. Class 10 &bull; Section A).
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3.5 rounded-lg border border-[var(--border)] hover:border-[var(--brand)] cursor-pointer transition">
              <input
                type="radio"
                name="targetType"
                value="BATCH"
                className="mt-0.5"
              />
              <div>
                <p className="text-xs font-semibold text-foreground">Coaching Academy (Batch)</p>
                <p className="text-[11px] text-muted mt-0.5">
                  Targets flexible coaching schedules (e.g. NEET Morning Crash Course).
                </p>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="classId" className="label text-xs">Class Level (if conventional school)</label>
              <select id="classId" name="classId" className="input text-xs w-full mt-1">
                <option value="">Select Class...</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="batchId" className="label text-xs">Target Batch (if coaching academy)</label>
              <select id="batchId" name="batchId" className="input text-xs w-full mt-1">
                <option value="">Select Batch...</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Planned Timeline */}
        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-semibold text-foreground border-b border-[var(--border)] pb-2">
            3. Delivery Milestones
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="startDate" className="label text-xs">Planned Start Date</label>
              <input id="startDate" name="startDate" type="date" className="input text-xs w-full mt-1" />
            </div>

            <div>
              <label htmlFor="targetDate" className="label text-xs">Target Completion Date</label>
              <input id="targetDate" name="targetDate" type="date" className="input text-xs w-full mt-1" />
            </div>
          </div>
        </div>

        {/* Assigned Faculty */}
        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-semibold text-foreground border-b border-[var(--border)] pb-2">
            4. Faculty Assignments
          </h3>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {teachers.length === 0 ? (
              <p className="text-xs text-muted py-2">No active teacher accounts found in this institute.</p>
            ) : (
              teachers.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-[var(--border)] hover:bg-[var(--accent)] cursor-pointer text-xs"
                >
                  <div className="flex items-center gap-2">
                    <input type="checkbox" name="teacherIds" value={t.id} />
                    <div>
                      <p className="font-medium text-foreground">{t.user.name}</p>
                      <p className="text-[11px] text-muted">{t.user.email}</p>
                    </div>
                  </div>
                  <span className="badge badge-neutral text-[10px]">Faculty</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border)]">
          <Link href="/app/syllabus" className="btn btn-secondary btn-sm">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary btn-sm">
            Create Syllabus
          </button>
        </div>
      </form>
    </div>
  );
}
