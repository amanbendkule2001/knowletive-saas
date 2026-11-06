import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantWrite } from "@/lib/rbac";
import { createGuardianAction } from "@/actions/students";
import { ActionForm } from "@/components/ui/action-form";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Field, FormGrid, FormIntro } from "@/components/ui/form-field";

export const metadata = { title: "Add parent" };

export default async function NewParentPage() {
  const ctx = await requireTenantWrite("tenant.parents.write");
  const students = await db.student.findMany({
    where: { tenantId: ctx.tenant.id, status: "ACTIVE" },
    include: { section: { include: { class: true } } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 500,
  });

  return (
    <div className="space-y-5">
      <Link
        href="/app/parents"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-3.5" /> All parents
      </Link>

      <PageHeader
        eyebrow="People"
        title="Add a parent or guardian"
        description="Guardians can be linked to one or more students. A guardian added here starts with one child link, if selected."
      />

      <Card className="mx-auto max-w-3xl">
        <CardHeader title="Guardian details" />
        <div className="p-4">
          <ActionForm
            action={createGuardianAction}
            submitLabel="Create parent"
            pendingLabel="Creating…"
            cancelHref="/app/parents"
          >
            <FormGrid>
              <Field label="Full name" htmlFor="name" required>
                <input id="name" name="name" className="input" autoComplete="name" required />
              </Field>
              <Field label="Phone number" htmlFor="phone" required>
                <input id="phone" name="phone" type="tel" className="input" autoComplete="tel" required />
              </Field>
              <Field label="Email" htmlFor="email" hint="Optional. Used for email notices.">
                <input id="email" name="email" type="email" className="input" autoComplete="email" />
              </Field>
              <Field label="Relationship" htmlFor="relation">
                <select id="relation" name="relation" className="select" defaultValue="Father">
                  <option value="Father">Father</option>
                  <option value="Mother">Mother</option>
                  <option value="Guardian">Guardian</option>
                  <option value="Grandparent">Grandparent</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="Occupation" htmlFor="occupation">
                <input id="occupation" name="occupation" className="input" placeholder="Optional" />
              </Field>
              <Field label="Link student" htmlFor="studentId" hint="You can link more children later.">
                <select id="studentId" name="studentId" className="select" defaultValue="">
                  <option value="">No student yet</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.firstName} {student.lastName} · {student.admissionNo}
                      {student.section ? ` · ${student.section.class.name}-${student.section.name}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </FormGrid>

            <FormIntro
              title="Privacy"
              description="Guardian contact details are visible only to institute staff with parent permissions. They are never shared across institutes."
            />
          </ActionForm>
        </div>
      </Card>
    </div>
  );
}
