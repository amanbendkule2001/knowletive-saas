import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Award,
  BookOpen,
  Calendar,
  FileCheck,
  History,
  ShieldCheck,
  Sliders,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import {
  Badge,
  Card,
  EmptyState,
  StatCard,
  Tone,
} from "@/components/ui/primitives";
import {
  ConfigureSubjectsModal,
  AutoEnrollStudentsButton,
  MarksEntryGrid,
  PublishResultsModal,
  StudentReportCardModal,
  DeleteExamButton,
  ExportResultsCsvButton,
} from "@/components/exams/exam-client-bits";
import type { ExamStatus } from "@prisma/client";

function examStatusTone(status: ExamStatus): Tone {
  switch (status) {
    case "PUBLISHED":
      return "success";
    case "EVALUATED":
      return "info";
    case "IN_PROGRESS":
      return "brand";
    case "SCHEDULED":
      return "warning";
    case "DRAFT":
      return "neutral";
    case "ARCHIVED":
      return "neutral";
    default:
      return "neutral";
  }
}

export default async function ExamStudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; subjectId?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const activeTab = sp.tab || "overview";
  const selectedSubjectId = sp.subjectId;

  const ctx = await requireTenantPermission("tenant.exams.read");
  const canWrite = hasTenantPermission(ctx, "tenant.exams.write");
  const canVerifyMarks = hasTenantPermission(ctx, "tenant.exams.verify_marks");
  const canPublish = hasTenantPermission(ctx, "tenant.exams.publish_results");

  const [exam, availableSubjects] = await Promise.all([
    db.examination.findFirst({
      where: { id, tenantId: ctx.tenant.id },
      include: {
        academicYear: true,
        gradeScale: {
          include: {
            bands: { orderBy: { order: "asc" } },
          },
        },
        class: true,
        section: true,
        batch: true,
        syllabusTrack: true,
        createdBy: {
          include: { user: true },
        },
        subjects: {
          include: {
            subject: true,
            marks: {
              include: { student: true },
            },
          },
          orderBy: { order: "asc" },
        },
        enrollments: {
          include: {
            student: true,
            marks: true,
            result: {
              include: {
                snapshots: true,
              },
            },
          },
          orderBy: [
            { student: { lastName: "asc" } },
            { student: { firstName: "asc" } },
          ],
        },
        results: {
          include: {
            student: true,
            snapshots: true,
          },
          orderBy: [{ rank: "asc" }, { percentage: "desc" }],
        },
        revisionEvents: {
          include: {
            examSubject: { include: { subject: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    }),
    db.subject.findMany({
      where: { tenantId: ctx.tenant.id },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!exam) notFound();

  const targetLabel =
    exam.targetType === "BATCH"
      ? `Batch: ${exam.batch?.name || "N/A"}`
      : `Class: ${exam.class?.name || "N/A"}${exam.section ? ` (Sec ${exam.section.name})` : " (All Sections)"}`;

  // Subject selected for marks entry
  const currentExamSubject =
    exam.subjects.find((s) => s.id === selectedSubjectId) || exam.subjects[0];

  // Map enrolled students with marks for the selected subject
  const markGridStudents = exam.enrollments.map((enr) => {
    const existingMark = currentExamSubject
      ? enr.marks.find((m) => m.examSubjectId === currentExamSubject.id)
      : null;

    return {
      id: enr.student.id,
      name: `${enr.student.firstName} ${enr.student.lastName}`.trim(),
      admissionNo: enr.student.admissionNo,
      rollNumber: enr.rollNumber,
      currentMarks: existingMark?.marksObtained ?? null,
      isAbsent: existingMark?.isAbsent ?? false,
      isExempted: existingMark?.isExempted ?? false,
      feedback: existingMark?.feedback ?? null,
      evaluationStatus: existingMark?.evaluationStatus ?? "PENDING",
    };
  });

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link href="/app/exams" className="btn btn-ghost btn-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="h-4 w-4" /> Back to Examinations
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {canWrite && !exam.isPublished && (
            <ConfigureSubjectsModal
              examId={exam.id}
              availableSubjects={availableSubjects}
              initialSubjects={exam.subjects.map((s) => ({
                subjectId: s.subjectId,
                examDate: s.examDate.toISOString(),
                startTime: s.startTime,
                endTime: s.endTime,
                roomNo: s.roomNo,
                maxMarks: s.maxMarks,
                passingMarks: s.passingMarks,
                weightage: s.weightage,
                order: s.order,
              }))}
            />
          )}

          {!exam.isPublished && (
            <AutoEnrollStudentsButton examId={exam.id} targetLabel={targetLabel} />
          )}

          {canPublish && !exam.isPublished && exam.enrollments.length > 0 && exam.subjects.length > 0 && (
            <PublishResultsModal
              examId={exam.id}
              examTitle={exam.title}
              enrolledCount={exam.enrollments.length}
              subjectCount={exam.subjects.length}
              gradeScaleName={exam.gradeScale.name}
            />
          )}

          {canWrite && !exam.isPublished && (
            <DeleteExamButton examId={exam.id} examTitle={exam.title} />
          )}
        </div>
      </div>

      {/* Examination Header Card */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-zinc-900 to-zinc-800 text-white shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="badge badge-primary text-xs font-mono uppercase tracking-wider font-semibold">
                {exam.code}
              </span>
              <Badge tone={examStatusTone(exam.status)}>{exam.status}</Badge>
              {exam.isPublished && (
                <span className="badge badge-success inline-flex items-center gap-1 text-xs font-medium">
                  <ShieldCheck className="h-3.5 w-3.5" /> Published Report Cards
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white mt-1.5">{exam.title}</h1>
            <p className="text-xs text-zinc-300 mt-1">
              {targetLabel} • {exam.term || "Regular Assessment"} • {exam.academicYear.name}
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs text-zinc-300">
            <div className="text-right">
              <span className="text-zinc-400 block">Assessment Period</span>
              <span className="font-medium text-white">
                {new Date(exam.startDate).toLocaleDateString()} – {new Date(exam.endDate).toLocaleDateString()}
              </span>
            </div>
            <div className="text-right">
              <span className="text-zinc-400 block">Grading Scale</span>
              <span className="font-medium text-white">{exam.gradeScale.name}</span>
            </div>
          </div>
        </div>

        {exam.instructions && (
          <div className="p-3 rounded-xl bg-white/10 text-xs text-zinc-200 border border-white/10">
            <strong>Candidate Instructions:</strong> {exam.instructions}
          </div>
        )}
      </div>

      {/* Tabs Navigation */}
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <nav className="flex space-x-6">
          {[
            { key: "overview", label: "Overview & Schedule", icon: Calendar },
            { key: "subjects", label: `Subjects (${exam.subjects.length})`, icon: BookOpen },
            { key: "roster", label: `Enrolled Students (${exam.enrollments.length})`, icon: Users },
            { key: "marks", label: "Marks Entry & Evaluation", icon: FileCheck },
            { key: "results", label: `Results & Report Cards (${exam.results.length})`, icon: Award },
            { key: "audit", label: "Revision Audit Trail", icon: History },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <Link
                key={tab.key}
                href={`/app/exams/${exam.id}?tab=${tab.key}${
                  currentExamSubject ? `&subjectId=${currentExamSubject.id}` : ""
                }`}
                className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-all ${
                  isActive
                    ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 font-semibold"
                    : "border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* TAB 1: OVERVIEW & SCHEDULE */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Assessment Subjects" value={exam.subjects.length} sub="Configured exams" />
            <StatCard label="Enrolled Candidates" value={exam.enrollments.length} sub="Active candidates" />
            <StatCard
              label="Grading System"
              value={exam.gradeScale.code}
              sub={`${exam.gradeScale.bands.length} performance bands`}
            />
            <StatCard
              label="Report Cards Status"
              value={exam.isPublished ? "Published" : "In Progress"}
              sub={exam.publishedAt ? new Date(exam.publishedAt).toLocaleDateString() : "Pending review"}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-5 space-y-4">
              <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-indigo-500" /> Assessment Schedule
              </h3>
              {exam.subjects.length === 0 ? (
                <EmptyState
                  title="No subjects scheduled yet"
                  description="Add subjects, timings, and marks to set up this examination."
                />
              ) : (
                <div className="space-y-2.5">
                  {exam.subjects.map((sub) => (
                    <div
                      key={sub.id}
                      className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {sub.subject.name}
                        </div>
                        <div className="text-zinc-500 mt-0.5">
                          {new Date(sub.examDate).toLocaleDateString()} • {sub.startTime || "TBD"} – {sub.endTime || "TBD"}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                          Max: {sub.maxMarks} (Pass: {sub.passingMarks})
                        </span>
                        <div className="text-zinc-400">Room: {sub.roomNo || "General Hall"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-5 space-y-4">
              <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Sliders className="h-4 w-4 text-indigo-500" /> Configured Grade Scale ({exam.gradeScale.name})
              </h3>
              <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                <table className="table w-full text-xs">
                  <thead>
                    <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      <th>Grade</th>
                      <th className="text-right">Percentage Range</th>
                      <th className="text-right">Grade Point</th>
                      <th className="text-center">Threshold</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {exam.gradeScale.bands.map((b) => (
                      <tr key={b.id}>
                        <td className="font-bold text-zinc-900 dark:text-zinc-100">{b.letterGrade}</td>
                        <td className="text-right font-mono text-zinc-600 dark:text-zinc-400">
                          {b.minPercentage}% – {b.maxPercentage}%
                        </td>
                        <td className="text-right font-mono font-semibold">{b.gradePoint}</td>
                        <td className="text-center">
                          <span className={`badge badge-xs ${b.isPassing ? "badge-success" : "badge-error"}`}>
                            {b.isPassing ? "Pass" : "Fail"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: SUBJECTS LIST */}
      {activeTab === "subjects" && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
              Examination Subjects & Evaluation Parameters
            </h3>
            {canWrite && !exam.isPublished && (
              <ConfigureSubjectsModal
                examId={exam.id}
                availableSubjects={availableSubjects}
                initialSubjects={exam.subjects.map((s) => ({
                  subjectId: s.subjectId,
                  examDate: s.examDate.toISOString(),
                  startTime: s.startTime,
                  endTime: s.endTime,
                  roomNo: s.roomNo,
                  maxMarks: s.maxMarks,
                  passingMarks: s.passingMarks,
                  weightage: s.weightage,
                  order: s.order,
                }))}
              />
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="table w-full text-xs">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                  <th>Order</th>
                  <th>Subject</th>
                  <th>Date & Time</th>
                  <th>Room / Hall</th>
                  <th className="text-right">Max Marks</th>
                  <th className="text-right">Passing Marks</th>
                  <th className="text-right">Weightage</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {exam.subjects.map((sub, idx) => (
                  <tr key={sub.id}>
                    <td className="text-zinc-400 font-mono">{idx + 1}</td>
                    <td className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {sub.subject.name} {sub.subject.code ? `(${sub.subject.code})` : ""}
                    </td>
                    <td className="text-zinc-600 dark:text-zinc-400">
                      {new Date(sub.examDate).toLocaleDateString()} {sub.startTime ? `• ${sub.startTime}` : ""}
                    </td>
                    <td className="text-zinc-600 dark:text-zinc-400">{sub.roomNo || "-"}</td>
                    <td className="text-right font-mono font-medium">{sub.maxMarks}</td>
                    <td className="text-right font-mono font-medium">{sub.passingMarks}</td>
                    <td className="text-right font-mono">{sub.weightage}x</td>
                    <td className="text-center">
                      <Link
                        href={`/app/exams/${exam.id}?tab=marks&subjectId=${sub.id}`}
                        className="btn btn-ghost btn-xs text-indigo-600 dark:text-indigo-400"
                      >
                        Enter Marks →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 3: ENROLLED STUDENTS */}
      {activeTab === "roster" && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <div>
              <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
                Enrolled Candidates
              </h3>
              <p className="text-xs text-zinc-500">
                Students registered to sit for this examination.
              </p>
            </div>
            {!exam.isPublished && (
              <AutoEnrollStudentsButton examId={exam.id} targetLabel={targetLabel} />
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="table w-full text-xs">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                  <th>#</th>
                  <th>Student Name</th>
                  <th>Admission No</th>
                  <th>Roll Number</th>
                  <th className="text-center">Participation Status</th>
                  <th className="text-right">Marks Logged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {exam.enrollments.map((enr, idx) => (
                  <tr key={enr.id}>
                    <td className="text-zinc-400 font-mono">{idx + 1}</td>
                    <td className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {enr.student.firstName} {enr.student.lastName}
                    </td>
                    <td className="text-zinc-500 font-mono">{enr.student.admissionNo}</td>
                    <td className="text-zinc-500 font-mono">{enr.rollNumber || "-"}</td>
                    <td className="text-center">
                      <span className="badge badge-sm badge-success font-medium">
                        {enr.status}
                      </span>
                    </td>
                    <td className="text-right font-mono text-zinc-500">
                      {enr.marks.length} / {exam.subjects.length} subjects
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 4: MARKS ENTRY GRID */}
      {activeTab === "marks" && (
        <div className="space-y-4">
          {exam.subjects.length === 0 ? (
            <EmptyState
              title="No subjects available"
              description="Configure subjects for this examination before entering marks."
            />
          ) : (
            <>
              {/* Subject Tabs */}
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {exam.subjects.map((sub) => {
                  const isSelected = currentExamSubject?.id === sub.id;
                  return (
                    <Link
                      key={sub.id}
                      href={`/app/exams/${exam.id}?tab=marks&subjectId=${sub.id}`}
                      className={`btn btn-sm text-xs rounded-xl ${
                        isSelected
                          ? "btn-primary font-semibold"
                          : "btn-secondary text-zinc-600 dark:text-zinc-400"
                      }`}
                    >
                      {sub.subject.name}
                    </Link>
                  );
                })}
              </div>

              {currentExamSubject && (
                <MarksEntryGrid
                  examId={exam.id}
                  examSubjectId={currentExamSubject.id}
                  maxMarks={currentExamSubject.maxMarks}
                  passingMarks={currentExamSubject.passingMarks}
                  subjectName={currentExamSubject.subject.name}
                  students={markGridStudents}
                  canVerify={canVerifyMarks && !exam.isPublished}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 5: RESULTS & REPORT CARDS */}
      {activeTab === "results" && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <div>
              <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Award className="h-5 w-5 text-indigo-500" />
                Institutional Performance & Published Results
              </h3>
              <p className="text-xs text-zinc-500">
                Authoritative computed percentages, ranks, and immutable cryptographic snapshots.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <ExportResultsCsvButton examId={exam.id} isPublished={exam.isPublished} />
              {canPublish && !exam.isPublished && (
                <PublishResultsModal
                  examId={exam.id}
                  examTitle={exam.title}
                  enrolledCount={exam.enrollments.length}
                  subjectCount={exam.subjects.length}
                  gradeScaleName={exam.gradeScale.name}
                />
              )}
            </div>
          </div>

          {exam.results.length === 0 ? (
            <EmptyState
              title="Results have not been calculated yet"
              description="Complete mark evaluations and click 'Calculate & Publish Results' to issue official report cards."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="table w-full text-xs">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    <th className="w-14 text-center">Rank</th>
                    <th>Candidate</th>
                    <th>Adm No</th>
                    <th className="text-right">Total Marks</th>
                    <th className="text-right">Percentage</th>
                    <th className="text-center">Grade</th>
                    <th className="text-center">Points</th>
                    <th className="text-center">Result</th>
                    <th className="text-right">Report Card</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {exam.results.map((res) => {
                    const snapshot = res.snapshots[0];
                    return (
                      <tr key={res.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                        <td className="text-center font-bold text-sm text-indigo-600 dark:text-indigo-400">
                          {res.rank ? `#${res.rank}` : "-"}
                        </td>
                        <td className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {res.student.firstName} {res.student.lastName}
                        </td>
                        <td className="text-zinc-500 font-mono">{res.student.admissionNo}</td>
                        <td className="text-right font-mono font-medium">
                          {res.totalMarksObtained} / {res.totalMaxMarks}
                        </td>
                        <td className="text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                          {res.percentage}%
                        </td>
                        <td className="text-center font-bold">{res.grade || "N/A"}</td>
                        <td className="text-center font-mono">{res.gradePoint ?? "-"}</td>
                        <td className="text-center">
                          <span
                            className={`badge badge-xs font-semibold ${
                              res.resultStatus === "PASS" ? "badge-success" : "badge-error"
                            }`}
                          >
                            {res.resultStatus}
                          </span>
                        </td>
                        <td className="text-right">
                          {snapshot ? (
                            <StudentReportCardModal
                              snapshot={snapshot.snapshotData as unknown as Parameters<typeof StudentReportCardModal>[0]["snapshot"]}
                              checksum={snapshot.checksum}
                            />
                          ) : (
                            <span className="text-zinc-400 text-[11px]">Unpublished</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* TAB 6: AUDIT REVISION TRAIL */}
      {activeTab === "audit" && (
        <Card className="p-5 space-y-4">
          <div className="pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <History className="h-5 w-5 text-indigo-500" />
              Auditable Marks Revision History
            </h3>
            <p className="text-xs text-zinc-500">
              Every score adjustment is protected by immutable PostgreSQL event triggers.
            </p>
          </div>

          {exam.revisionEvents.length === 0 ? (
            <EmptyState
              title="No mark revision events recorded"
              description="Any mark updates or evaluation status transitions will appear here in chronological order."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="table w-full text-xs">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    <th>Timestamp</th>
                    <th>Subject</th>
                    <th>Evaluator</th>
                    <th className="text-right">Old Score</th>
                    <th className="text-right">New Score</th>
                    <th className="text-center">Status Transition</th>
                    <th>Justification Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {exam.revisionEvents.map((evt) => (
                    <tr key={evt.id}>
                      <td className="text-zinc-500 font-mono text-[11px]">
                        {new Date(evt.createdAt).toLocaleString()}
                      </td>
                      <td className="font-medium text-zinc-900 dark:text-zinc-100">
                        {evt.examSubject.subject.name}
                      </td>
                      <td className="text-zinc-600 dark:text-zinc-300 font-medium">
                        {evt.actorName}
                      </td>
                      <td className="text-right font-mono text-zinc-400">
                        {evt.oldMarks !== null ? evt.oldMarks : "-"}
                      </td>
                      <td className="text-right font-mono font-bold text-zinc-900 dark:text-zinc-100">
                        {evt.newMarks !== null ? evt.newMarks : "-"}
                      </td>
                      <td className="text-center font-mono text-[11px]">
                        <span className="text-zinc-400">{evt.oldStatus || "INIT"}</span> →{" "}
                        <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                          {evt.newStatus}
                        </span>
                      </td>
                      <td className="text-zinc-600 dark:text-zinc-300 italic">{evt.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
