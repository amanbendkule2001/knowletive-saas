import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/primitives";
import { ExamCreateForm } from "./exam-create-form";

export const metadata = { title: "Schedule New Examination" };

export default async function NewExamPage() {
  const ctx = await requireTenantPermission("tenant.exams.write");

  const now = new Date();
  const defaultStartDate = now.toISOString().split("T")[0];
  const defaultEndDate = new Date(now.getTime() + 7 * 86400000).toISOString().split("T")[0];

  const [academicYears, classes, batches, gradeScales, syllabusTracks] = await Promise.all([
    db.academicYear.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { startDate: "desc" },
    }),
    db.classLevel.findMany({
      where: { tenantId: ctx.tenant.id },
      include: {
        sections: {
          orderBy: { name: "asc" },
        },
      },
      orderBy: { order: "asc" },
    }),
    db.batch.findMany({
      where: { tenantId: ctx.tenant.id, status: "ACTIVE" },
      orderBy: { name: "asc" },
    }),
    db.gradeScale.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    db.syllabusTrack.findMany({
      where: { tenantId: ctx.tenant.id },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/app/exams" className="btn btn-ghost btn-sm text-zinc-500 hover:text-zinc-800">
          <ArrowLeft className="h-4 w-4" /> Back to Examinations
        </Link>
      </div>

      <PageHeader
        title="Schedule New Examination"
        description="Configure examination scope, select target academic unit (conventional class or coaching batch), and assign assessment timeline."
      />

      <ExamCreateForm
        academicYears={academicYears}
        classes={classes}
        batches={batches}
        gradeScales={gradeScales}
        syllabusTracks={syllabusTracks}
        defaultStartDate={defaultStartDate}
        defaultEndDate={defaultEndDate}
      />
    </div>
  );
}
