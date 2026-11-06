import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Award, CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { getTenantContext } from "@/lib/auth";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import { verifySnapshotChecksum } from "@/lib/exam-snapshot";

export const metadata = { title: "Assessment Report Card" };

export default async function PortalResultDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");

  const result = await db.examResult.findFirst({
    where: { id, tenantId: ctx.tenant.id },
    include: {
      exam: {
        include: {
          academicYear: true,
          subjects: {
            include: { subject: true },
            orderBy: { order: "asc" },
          },
        },
      },
      student: {
        include: {
          section: { include: { class: true } },
        },
      },
      snapshots: {
        orderBy: { generatedAt: "desc" },
        take: 1,
      },
    },
  });

  // Strict check 1: Result existence
  if (!result) {
    notFound();
  }

  // Strict check 2: Unpublished results must never be visible to students or parents
  if (!result.exam.isPublished) {
    notFound();
  }

  // Strict check 3: Candidate ownership or linked Guardian relationship verification
  const isStudentSelf = result.student.userId === ctx.user.id;
  const isLinkedGuardian = !isStudentSelf
    ? await db.studentGuardian.findFirst({
        where: {
          studentId: result.studentId,
          guardian: { userId: ctx.user.id },
        },
      })
    : null;

  if (!isStudentSelf && !isLinkedGuardian) {
    // Unauthorized access: strictly rejected server-side
    notFound();
  }

  const latestSnapshot = result.snapshots[0];
  const checksumVerification = latestSnapshot
    ? verifySnapshotChecksum(latestSnapshot.snapshotData, latestSnapshot.checksum)
    : null;

  type SubjectEntry = {
    subjectName: string;
    subjectCode: string | null;
    maxMarks: number;
    passingMarks: number;
    marksObtained: number | null;
    isAbsent: boolean;
    isExempted: boolean;
    isPassed: boolean;
  };

  const snapshotPayload = latestSnapshot?.snapshotData as {
    subjects?: SubjectEntry[];
    metadata?: { publishedAt: string; publishedBy: string };
  } | null;

  const subjects = snapshotPayload?.subjects || [];
  const candidateName = `${result.student.firstName} ${result.student.lastName}`.trim();
  const className = result.student.section?.class?.name || "Class";
  const sectionName = result.student.section?.name ? ` - ${result.student.section.name}` : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/portal"
          className="btn btn-ghost btn-sm text-muted hover:text-foreground inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="size-4" /> Back to Portal
        </Link>
        {checksumVerification?.isValid ? (
          <Badge tone="success">
            <ShieldCheck className="size-3.5" /> Cryptographically Verified
          </Badge>
        ) : (
          <Badge tone="warning">
            <ShieldAlert className="size-3.5" /> Verification Pending
          </Badge>
        )}
      </div>

      <PageHeader
        eyebrow={`${result.exam.academicYear.name} · ${result.exam.examType}`}
        title={result.exam.title}
        description={`Authoritative official report card for ${candidateName} (${result.student.admissionNo}).`}
      />

      {/* Candidate Performance Overview */}
      <Card className="p-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-6 border-b border-[var(--border)]">
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider block">Candidate</span>
            <span className="font-semibold text-sm text-foreground">{candidateName}</span>
            <span className="text-xs text-muted block mt-0.5">{className}{sectionName}</span>
          </div>
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider block">Total Marks</span>
            <span className="font-mono font-semibold text-base text-foreground">
              {result.totalMarksObtained} <span className="text-xs text-muted">/ {result.totalMaxMarks}</span>
            </span>
          </div>
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider block">Percentage</span>
            <span className="font-mono font-bold text-base text-indigo-600 dark:text-indigo-400">
              {result.percentage}%
            </span>
          </div>
          <div>
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider block">Outcome</span>
            <Badge tone={result.resultStatus === "PASS" ? "success" : "danger"} className="mt-1">
              {result.resultStatus} {result.grade ? `(${result.grade})` : ""}
            </Badge>
          </div>
        </div>

        {/* Subject-Wise Assessment Table */}
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3 flex items-center gap-1.5">
            <Award className="size-3.5 text-indigo-500" /> Subject-Wise Evaluation
          </h3>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="table w-full text-xs">
              <thead>
                <tr className="bg-[var(--surface-2)] text-muted">
                  <th className="text-left py-2.5 px-3">Subject</th>
                  <th className="text-right py-2.5 px-3">Passing Marks</th>
                  <th className="text-right py-2.5 px-3">Max Marks</th>
                  <th className="text-right py-2.5 px-3">Marks Obtained</th>
                  <th className="text-center py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {subjects.map((sub, idx) => (
                  <tr key={idx} className="hover:bg-[var(--surface-2)]/50">
                    <td className="py-2.5 px-3 font-medium text-foreground">
                      {sub.subjectName} {sub.subjectCode ? `(${sub.subjectCode})` : ""}
                    </td>
                    <td className="text-right py-2.5 px-3 font-mono text-muted">{sub.passingMarks}</td>
                    <td className="text-right py-2.5 px-3 font-mono text-muted">{sub.maxMarks}</td>
                    <td className="text-right py-2.5 px-3 font-mono font-semibold text-foreground">
                      {sub.isAbsent
                        ? "ABSENT"
                        : sub.isExempted
                          ? "EXEMPTED"
                          : sub.marksObtained !== null
                            ? sub.marksObtained
                            : "-"}
                    </td>
                    <td className="text-center py-2.5 px-3">
                      <span
                        className={`badge badge-xs font-semibold ${
                          sub.isPassed ? "badge-success" : "badge-error"
                        }`}
                      >
                        {sub.isPassed ? "PASS" : "FAIL"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cryptographic Snapshot Integrity Verification Footer */}
        {latestSnapshot && (
          <div className="mt-6 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-500" /> Immutable Assessment Snapshot
              </span>
              <span className="text-muted text-[11px]">
                Generated {new Date(latestSnapshot.generatedAt).toLocaleString()}
              </span>
            </div>
            <p className="text-[11px] text-muted font-mono break-all">
              SHA-256 Checksum: <span className="text-foreground">{latestSnapshot.checksum}</span>
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
