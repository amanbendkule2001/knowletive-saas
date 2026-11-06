import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui/primitives";
import { CreateGradeScaleModal, DeleteGradeScaleButton } from "./grading-client-bits";

export const metadata = { title: "Grading Systems & Scales" };

export default async function GradingPage() {
  const ctx = await requireTenantPermission("tenant.exams.manage_grading");
  const canManage = hasTenantPermission(ctx, "tenant.exams.manage_grading");

  const scales = await db.gradeScale.findMany({
    where: { tenantId: ctx.tenant.id },
    include: {
      bands: {
        orderBy: { minPercentage: "desc" },
      },
      _count: {
        select: { examinations: true },
      },
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/app/exams" className="btn btn-ghost btn-sm text-zinc-500 hover:text-zinc-800">
          <ArrowLeft className="h-4 w-4" /> Back to Examinations
        </Link>
      </div>

      <PageHeader
        title="Institutional Grading Scales"
        description="Configure academic evaluation scales, letter grade thresholds, grade point weights, and pass/fail boundaries."
        actions={canManage ? <CreateGradeScaleModal /> : undefined}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {scales.map((scale) => (
          <Card key={scale.id} className="p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
                    {scale.name}
                  </h3>
                  {scale.isDefault && (
                    <span className="badge badge-primary badge-xs">Default</span>
                  )}
                  {scale.isSystem && (
                    <span className="badge badge-neutral badge-xs">System</span>
                  )}
                </div>
                <div className="text-xs text-zinc-400 font-mono mt-0.5">
                  Code: {scale.code} • Used in {scale._count.examinations} exams
                </div>
                {scale.description && (
                  <p className="text-xs text-zinc-500 mt-1">{scale.description}</p>
                )}
              </div>

              {!scale.isSystem && scale._count.examinations === 0 && canManage && (
                <DeleteGradeScaleButton scaleId={scale.id} scaleName={scale.name} />
              )}
            </div>

            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="table w-full text-xs">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    <th>Grade</th>
                    <th className="text-right">Min %</th>
                    <th className="text-right">Max %</th>
                    <th className="text-right">Grade Point</th>
                    <th className="text-center">Threshold</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {scale.bands.map((band) => (
                    <tr key={band.id}>
                      <td className="font-bold text-zinc-900 dark:text-zinc-100">
                        {band.letterGrade}
                      </td>
                      <td className="text-right font-mono text-zinc-600 dark:text-zinc-400">
                        {band.minPercentage}%
                      </td>
                      <td className="text-right font-mono text-zinc-600 dark:text-zinc-400">
                        {band.maxPercentage}%
                      </td>
                      <td className="text-right font-mono font-semibold">
                        {band.gradePoint}
                      </td>
                      <td className="text-center">
                        <span
                          className={`badge badge-xs ${
                            band.isPassing ? "badge-success" : "badge-error"
                          }`}
                        >
                          {band.isPassing ? "Pass" : "Fail"}
                        </span>
                      </td>
                      <td className="text-zinc-500 text-[11px]">{band.remarks || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
