import Link from "next/link";
import { BookOpen, Layers, Trash2, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import { hasFeature } from "@/lib/entitlements";
import {
  createClassAction,
  createSectionAction,
  createSubjectAction,
  deleteSubjectAction,
} from "@/actions/students";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmButton } from "@/components/ui/client-bits";
import { Field, FormGrid } from "@/components/ui/form-field";
import { FeatureLocked } from "@/components/ui/feature-gate";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Progress,
} from "@/components/ui/primitives";
import { num } from "@/lib/format";

export const metadata = { title: "Academics" };

export default async function AcademicsPage() {
  const ctx = await requireTenantPermission("tenant.academics.read");
  const plan = ctx.tenant.subscription?.plan;
  if (!hasFeature(plan, "academics")) {
    return (
      <FeatureLocked
        feature="academics"
        title="Academics"
        description="Classes, sections, subjects and teacher allocation are part of the Growth plan and above."
      />
    );
  }

  const [classes, subjects, staff] = await Promise.all([
    db.classLevel.findMany({
      where: { tenantId: ctx.tenant.id },
      include: {
        sections: {
          include: { _count: { select: { students: true } } },
          orderBy: { name: "asc" },
        },
        _count: { select: { sections: true } },
      },
      orderBy: { order: "asc" },
    }),
    db.subject.findMany({
      where: { tenantId: ctx.tenant.id },
      include: { class: true },
      orderBy: { name: "asc" },
    }),
    db.membership.findMany({
      where: { tenantId: ctx.tenant.id, status: "ACTIVE" },
      include: { user: true },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const canWrite = hasTenantPermission(ctx, "tenant.academics.write");
  const totalStudents = classes.reduce(
    (sum, cls) => sum + cls.sections.reduce((s, section) => s + section._count.students, 0),
    0,
  );
  const totalSections = classes.reduce((sum, cls) => sum + cls._count.sections, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Academics"
        title="Classes, sections & subjects"
        description="The academic structure powers attendance registers, class strength and subject allocation."
        actions={
          <Badge tone="brand">
            {num(classes.length)} classes · {num(totalSections)} sections · {num(totalStudents)} students
          </Badge>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Class levels"
            description="Order controls how classes appear across the product."
            action={<Layers className="size-4 text-[var(--muted)]" />}
          />
          <div className="divide-y divide-[var(--border)]">
            {classes.map((cls) => {
              const strength = cls.sections.reduce((s, section) => s + section._count.students, 0);
              return (
                <div key={cls.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold">{cls.name}</p>
                      <p className="text-[11px] text-muted">
                        {cls._count.sections} section{cls._count.sections === 1 ? "" : "s"} ·{" "}
                        {num(strength)} students
                      </p>
                    </div>
                    <Badge tone="neutral">Order {cls.order}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {cls.sections.map((section) => (
                      <span
                        key={section.id}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px]"
                      >
                        <span className="font-medium">Section {section.name}</span>
                        <span className="text-muted">
                          {section._count.students}/{section.capacity}
                        </span>
                      </span>
                    ))}
                    {cls.sections.length === 0 && (
                      <span className="text-[11px] text-[var(--muted-2)]">No sections yet</span>
                    )}
                  </div>
                </div>
              );
            })}
            {classes.length === 0 && (
              <EmptyState title="No classes yet" description="Add your first class using the form." />
            )}
          </div>
        </Card>

        {canWrite ? (
          <div className="space-y-4">
            <Card>
              <CardHeader title="Add a class" description="e.g. Class 6, FYJC or Batch A." />
              <div className="p-4">
                <ActionForm action={createClassAction} submitLabel="Add class" pendingLabel="Adding…">
                  <FormGrid>
                    <Field label="Class name" htmlFor="className" required>
                      <input id="className" name="name" className="input" required />
                    </Field>
                    <Field label="Display order" htmlFor="order" hint="Lower numbers appear first.">
                      <input
                        id="order"
                        name="order"
                        type="number"
                        min={0}
                        max={100}
                        className="input"
                        defaultValue={classes.length + 1}
                      />
                    </Field>
                  </FormGrid>
                </ActionForm>
              </div>
            </Card>

            <Card>
              <CardHeader title="Add a section" description="Sections belong to a class." />
              <div className="p-4">
                <ActionForm action={createSectionAction} submitLabel="Add section" pendingLabel="Adding…">
                  <FormGrid>
                    <Field label="Class" htmlFor="sectionClassId" required>
                      <select id="sectionClassId" name="classId" className="select" required>
                        <option value="">Choose a class</option>
                        {classes.map((cls) => (
                          <option key={cls.id} value={cls.id}>
                            {cls.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Section name" htmlFor="sectionName" required hint="e.g. A, B or Science.">
                      <input id="sectionName" name="name" className="input" required />
                    </Field>
                    <Field label="Capacity" htmlFor="capacity">
                      <input
                        id="capacity"
                        name="capacity"
                        type="number"
                        min={1}
                        max={500}
                        className="input"
                        defaultValue={40}
                      />
                    </Field>
                  </FormGrid>
                </ActionForm>
              </div>
            </Card>
          </div>
        ) : (
          <Card>
            <CardHeader title="Read-only access" />
            <div className="p-4 text-xs text-muted">
              You can view the academic structure but not change it. Ask an institute admin or principal
              for the <strong>Manage academics</strong> permission.
            </div>
          </Card>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Subjects"
            description="Allocated subjects and the teacher responsible."
            action={<BookOpen className="size-4 text-[var(--muted)]" />}
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Code</th>
                  <th>Class</th>
                  <th>Teacher</th>
                  {canWrite && <th className="text-right">Action</th>}
                </tr>
              </thead>
              <tbody>
                {subjects.map((subject) => {
                  const teacher = staff.find((member) => member.id === subject.teacherId);
                  return (
                    <tr key={subject.id}>
                      <td className="font-medium">{subject.name}</td>
                      <td className="font-mono text-[11px] text-muted">{subject.code ?? "—"}</td>
                      <td className="text-muted">{subject.class?.name ?? "All classes"}</td>
                      <td className="text-muted">{teacher?.user.name ?? "Unassigned"}</td>
                      {canWrite && (
                        <td className="text-right">
                          <form action={deleteSubjectAction}>
                            <input type="hidden" name="subjectId" value={subject.id} />
                            <ConfirmButton
                              className="btn btn-ghost btn-sm text-[var(--danger)]"
                              message={`Delete ${subject.name}? Attendance and student records are unaffected.`}
                            >
                              <Trash2 className="size-3.5" />
                            </ConfirmButton>
                          </form>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {subjects.length === 0 && (
                  <tr>
                    <td colSpan={canWrite ? 5 : 4} className="py-8 text-center text-xs text-muted">
                      No subjects yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {canWrite && (
          <Card>
            <CardHeader title="Add a subject" description="Optional class and teacher allocation." />
            <div className="p-4">
              <ActionForm action={createSubjectAction} submitLabel="Add subject" pendingLabel="Adding…">
                <Field label="Subject name" htmlFor="subjectName" required>
                  <input id="subjectName" name="name" className="input" required />
                </Field>
                <FormGrid>
                  <Field label="Code" htmlFor="subjectCode">
                    <input id="subjectCode" name="code" className="input" placeholder="e.g. MAT-101" />
                  </Field>
                  <Field label="Class" htmlFor="subjectClassId">
                    <select id="subjectClassId" name="classId" className="select" defaultValue="">
                      <option value="">All classes</option>
                      {classes.map((cls) => (
                        <option key={cls.id} value={cls.id}>
                          {cls.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </FormGrid>
                <Field label="Teacher" htmlFor="teacherId">
                  <select id="teacherId" name="teacherId" className="select" defaultValue="">
                    <option value="">Unassigned</option>
                    {staff.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.user.name} — {member.roleId ? member.designation ?? "Staff" : "Staff"}
                      </option>
                    ))}
                  </select>
                </Field>
              </ActionForm>
            </div>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader
          title="Section capacity"
          description="Fill levels for each section, across all classes."
          action={<Users className="size-4 text-[var(--muted)]" />}
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {classes.flatMap((cls) =>
            cls.sections.map((section) => (
              <div key={section.id} className="rounded-xl border border-[var(--border)] p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">
                    {cls.name} — {section.name}
                  </span>
                  <span className="tabular-nums text-muted">
                    {section._count.students}/{section.capacity}
                  </span>
                </div>
                <Progress
                  className="mt-2"
                  value={section._count.students}
                  max={section.capacity}
                  tone={
                    section._count.students / section.capacity > 0.9
                      ? "danger"
                      : section._count.students / section.capacity > 0.75
                        ? "warning"
                        : "success"
                  }
                />
              </div>
            )),
          )}
          {classes.every((cls) => cls.sections.length === 0) && (
            <p className="col-span-full text-center text-xs text-muted">
              Add sections to see capacity insights.
            </p>
          )}
        </div>
      </Card>

      <p className="text-[11px] text-muted">
        Need a yearly structure? Academic years are configured in{" "}
        <Link href="/app/settings" className="link">
          institute settings
        </Link>
        .
      </p>
    </div>
  );
}
