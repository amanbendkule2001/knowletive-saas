import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantWrite } from "@/lib/rbac";
import { createStudentAction } from "@/actions/students";
import { ActionForm } from "@/components/ui/action-form";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { StudentFields } from "@/components/app/student-fields";

export const metadata = { title: "Add student" };

export default async function NewStudentPage() {
  const ctx = await requireTenantWrite("tenant.students.write");
  const classes = await db.classLevel.findMany({
    where: { tenantId: ctx.tenant.id },
    include: { sections: { orderBy: { name: "asc" } } },
    orderBy: { order: "asc" },
  });

  return (
    <div className="space-y-5">
      <Link
        href="/app/students"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-3.5" /> All students
      </Link>

      <PageHeader
        eyebrow="Admissions"
        title="Add a student"
        description={`Create a student record for ${ctx.tenant.name}. Admission numbers must be unique.`}
      />

      <Card className="mx-auto max-w-3xl">
        <CardHeader
          title="Student profile"
          description={
            classes.length
              ? "Fields marked with * are required."
              : "No classes exist yet — the student can still be added and assigned later."
          }
        />
        <div className="p-4">
          <ActionForm
            action={createStudentAction}
            submitLabel="Create student"
            pendingLabel="Creating…"
            cancelHref="/app/students"
          >
            <StudentFields classes={classes} mode="create" />
          </ActionForm>
        </div>
      </Card>
    </div>
  );
}
