import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantWrite } from "@/lib/rbac";
import { updateStudentAction } from "@/actions/students";
import { ActionForm } from "@/components/ui/action-form";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { StudentFields } from "@/components/app/student-fields";

export const metadata = { title: "Edit student" };

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantWrite("tenant.students.write");
  const { id } = await params;

  const [student, classes] = await Promise.all([
    db.student.findFirst({ where: { id, tenantId: ctx.tenant.id } }),
    db.classLevel.findMany({
      where: { tenantId: ctx.tenant.id },
      include: { sections: { orderBy: { name: "asc" } } },
      orderBy: { order: "asc" },
    }),
  ]);
  if (!student) notFound();

  return (
    <div className="space-y-5">
      <Link
        href={`/app/students/${student.id}`}
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-3.5" /> Back to profile
      </Link>

      <PageHeader
        eyebrow="Student"
        title={`Edit ${student.firstName} ${student.lastName}`}
        description="Changes are recorded in the institute audit trail. Guardians are managed from the Parents page."
      />

      <Card className="mx-auto max-w-3xl">
        <CardHeader title="Profile details" description="Fields marked with * are required." />
        <div className="p-4">
          <ActionForm
            action={updateStudentAction}
            submitLabel="Save changes"
            pendingLabel="Saving…"
            cancelHref={`/app/students/${student.id}`}
          >
            <input type="hidden" name="studentId" value={student.id} />
            <StudentFields classes={classes} student={student} mode="edit" />
          </ActionForm>
        </div>
      </Card>
    </div>
  );
}
