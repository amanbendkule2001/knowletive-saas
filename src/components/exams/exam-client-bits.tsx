"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Archive,
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  Download,
  Edit3,
  FileCheck,
  FileText,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  saveExamSubjectsAction,
  autoEnrollEligibleStudentsAction,
  enterMarksBulkAction,
  verifyExamSubjectMarksAction,
  calculateAndPublishResultsAction,
  correctPublishedMarkAction,
  deleteExaminationAction,
  exportExamResultsCsvAction,
  cancelExaminationAction,
  reopenEvaluatedExamAction,
  archiveExaminationAction,
  updateEnrollmentStatusAction,
} from "@/actions/exams";

// ─────────────────────────────────────────────────────────────
// 1. CONFIGURE SUBJECTS MODAL
// ─────────────────────────────────────────────────────────────

type SubjectOption = { id: string; name: string; code: string | null };

type ExamSubjectRow = {
  subjectId: string;
  examDate: string;
  startTime: string;
  endTime: string;
  roomNo: string;
  maxMarks: number;
  passingMarks: number;
  weightage: number;
  order: number;
};

export function ConfigureSubjectsModal({
  examId,
  availableSubjects,
  initialSubjects,
}: {
  examId: string;
  availableSubjects: SubjectOption[];
  initialSubjects: Array<{
    subjectId: string;
    examDate: string;
    startTime: string | null;
    endTime: string | null;
    roomNo: string | null;
    maxMarks: number;
    passingMarks: number;
    weightage: number;
    order: number;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [rows, setRows] = useState<ExamSubjectRow[]>(() => {
    if (initialSubjects.length > 0) {
      return initialSubjects.map((s) => ({
        subjectId: s.subjectId,
        examDate: s.examDate.split("T")[0],
        startTime: s.startTime || "",
        endTime: s.endTime || "",
        roomNo: s.roomNo || "",
        maxMarks: s.maxMarks,
        passingMarks: s.passingMarks,
        weightage: s.weightage,
        order: s.order,
      }));
    }
    return [
      {
        subjectId: availableSubjects[0]?.id || "",
        examDate: new Date().toISOString().split("T")[0],
        startTime: "09:00",
        endTime: "12:00",
        roomNo: "Hall 1",
        maxMarks: 100,
        passingMarks: 35,
        weightage: 1.0,
        order: 1,
      },
    ];
  });

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        subjectId: availableSubjects[0]?.id || "",
        examDate: new Date().toISOString().split("T")[0],
        startTime: "09:00",
        endTime: "12:00",
        roomNo: "Hall 1",
        maxMarks: 100,
        passingMarks: 35,
        weightage: 1.0,
        order: prev.length + 1,
      },
    ]);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateRow = <K extends keyof ExamSubjectRow>(idx: number, field: K, val: ExamSubjectRow[K]) => {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  const handleSave = () => {
    setError(null);
    if (rows.length === 0) {
      setError("Please add at least one subject.");
      return;
    }

    startTransition(async () => {
      const res = await saveExamSubjectsAction({
        examId,
        subjects: rows,
      });

      if (!res.ok) {
        setError(res.error || "Failed to save subjects.");
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-secondary inline-flex items-center gap-1.5 text-sm"
      >
        <Calendar className="h-4 w-4" />
        Configure Subjects & Schedule
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-4xl max-h-[90vh] flex flex-col p-6 shadow-2xl bg-base-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Examination Assessment Schedule
                </h3>
                <p className="text-sm text-zinc-500">
                  Assign subjects, test dates, times, rooms, maximum marks, and passing cut-offs.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-sm p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="my-3 p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm rounded-lg flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto py-4 space-y-4">
              {rows.map((row, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/60 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      Subject #{idx + 1}
                    </span>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="text-red-500 hover:text-red-700 text-xs inline-flex items-center gap-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="md:col-span-2">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Subject *
                      </label>
                      <select
                        value={row.subjectId}
                        onChange={(e) => updateRow(idx, "subjectId", e.target.value)}
                        className="input select select-bordered w-full text-sm mt-1"
                      >
                        {availableSubjects.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.name} {sub.code ? `(${sub.code})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Exam Date *
                      </label>
                      <input
                        type="date"
                        value={row.examDate}
                        onChange={(e) => updateRow(idx, "examDate", e.target.value)}
                        className="input input-bordered w-full text-sm mt-1"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Room / Hall
                      </label>
                      <input
                        type="text"
                        value={row.roomNo}
                        placeholder="e.g. Hall A"
                        onChange={(e) => updateRow(idx, "roomNo", e.target.value)}
                        className="input input-bordered w-full text-sm mt-1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div>
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Start Time
                      </label>
                      <input
                        type="time"
                        value={row.startTime}
                        onChange={(e) => updateRow(idx, "startTime", e.target.value)}
                        className="input input-bordered w-full text-sm mt-1"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        End Time
                      </label>
                      <input
                        type="time"
                        value={row.endTime}
                        onChange={(e) => updateRow(idx, "endTime", e.target.value)}
                        className="input input-bordered w-full text-sm mt-1"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Max Marks *
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        value={row.maxMarks}
                        onChange={(e) => updateRow(idx, "maxMarks", Number(e.target.value))}
                        className="input input-bordered w-full text-sm mt-1"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Passing Marks *
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="1000"
                        value={row.passingMarks}
                        onChange={(e) => updateRow(idx, "passingMarks", Number(e.target.value))}
                        className="input input-bordered w-full text-sm mt-1"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Weightage
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="10"
                        value={row.weightage}
                        onChange={(e) => updateRow(idx, "weightage", Number(e.target.value))}
                        className="input input-bordered w-full text-sm mt-1"
                      />
                    </div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addRow}
                className="btn btn-outline btn-sm w-full border-dashed flex items-center justify-center gap-1 text-zinc-600 dark:text-zinc-400"
              >
                <Plus className="h-4 w-4" /> Add Another Subject
              </button>
            </div>

            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn btn-ghost text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleSave}
                className="btn btn-primary text-sm flex items-center gap-1.5"
              >
                {isPending ? "Saving Schedule..." : "Save Assessment Schedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 2. AUTO-ENROLL STUDENTS BUTTON
// ─────────────────────────────────────────────────────────────

export function AutoEnrollStudentsButton({
  examId,
  targetLabel,
}: {
  examId: string;
  targetLabel: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  const handleEnroll = () => {
    setMessage(null);
    startTransition(async () => {
      const res = await autoEnrollEligibleStudentsAction(examId);
      if (!res.ok) {
        alert(res.error || "Failed to auto-enroll students.");
      } else {
        setMessage(`Successfully enrolled ${res.data?.enrolledCount} students.`);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {message && <span className="text-xs text-emerald-600 dark:text-emerald-400">{message}</span>}
      <button
        onClick={handleEnroll}
        disabled={isPending}
        className="btn btn-secondary inline-flex items-center gap-1.5 text-sm"
      >
        <Users className="h-4 w-4" />
        {isPending ? "Enrolling..." : `Auto-Enroll from ${targetLabel}`}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 3. BULK MARKS ENTRY GRID COMPONENT
// ─────────────────────────────────────────────────────────────

type EnrolledStudent = {
  id: string;
  name: string;
  admissionNo: string;
  rollNumber: string | null;
  currentMarks: number | null;
  isAbsent: boolean;
  isExempted: boolean;
  feedback: string | null;
  evaluationStatus: string;
  enrollmentStatus?: string;
  enrollmentId?: string;
};

export function MarksEntryGrid({
  examId,
  examSubjectId,
  maxMarks,
  passingMarks,
  subjectName,
  students,
  canVerify,
}: {
  examId: string;
  examSubjectId: string;
  maxMarks: number;
  passingMarks: number;
  subjectName: string;
  students: EnrolledStudent[];
  canVerify: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("Regular examination evaluation entry.");
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const router = useRouter();

  const [studentEntries, setStudentEntries] = useState(
    students.map((s) => ({
      studentId: s.id,
      marksObtained: s.currentMarks,
      isAbsent: s.isAbsent,
      isExempted: s.isExempted,
      feedback: s.feedback || "",
    }))
  );

  const updateEntry = (idx: number, field: string, val: unknown) => {
    setStudentEntries((prev) => {
      const next = [...prev];
      if (field === "isAbsent" && val === true) {
        next[idx] = { ...next[idx], isAbsent: true, isExempted: false, marksObtained: null };
      } else if (field === "isExempted" && val === true) {
        next[idx] = { ...next[idx], isExempted: true, isAbsent: false, marksObtained: null };
      } else {
        next[idx] = { ...next[idx], [field]: val };
      }
      return next;
    });
  };

  const handleSubmit = (submitForVerification: boolean) => {
    setFeedbackMsg(null);
    if (!reason.trim()) {
      setFeedbackMsg({ type: "error", text: "Please enter an auditable evaluation reason." });
      return;
    }

    startTransition(async () => {
      const res = await enterMarksBulkAction({
        examId,
        examSubjectId,
        entries: studentEntries,
        reason,
        submitForVerification,
      });

      if (!res.ok) {
        setFeedbackMsg({ type: "error", text: res.error || "Failed to save marks." });
      } else {
        setFeedbackMsg({
          type: "success",
          text: submitForVerification
            ? `Submitted marks for ${res.data?.updatedCount} students for verification.`
            : `Saved draft marks for ${res.data?.updatedCount} students.`,
        });
        router.refresh();
      }
    });
  };

  const handleVerify = () => {
    setFeedbackMsg(null);
    startTransition(async () => {
      const res = await verifyExamSubjectMarksAction(examId, examSubjectId);
      if (!res.ok) {
        setFeedbackMsg({ type: "error", text: res.error || "Failed to verify marks." });
      } else {
        setFeedbackMsg({ type: "success", text: "Subject marks verified and locked successfully." });
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div>
          <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-indigo-500" />
            {subjectName} Assessment Evaluation
          </h4>
          <p className="text-xs text-zinc-500 mt-0.5">
            Max Marks: <span className="font-medium text-zinc-700 dark:text-zinc-300">{maxMarks}</span> |
            Passing: <span className="font-medium text-zinc-700 dark:text-zinc-300">{passingMarks}</span> |
            Roster: <span className="font-medium text-zinc-700 dark:text-zinc-300">{students.length} students</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canVerify && (
            <button
              onClick={handleVerify}
              disabled={isPending}
              className="btn btn-outline btn-sm border-emerald-600 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center gap-1.5"
            >
              <FileCheck className="h-4 w-4" />
              Verify & Lock Marks
            </button>
          )}
          <button
            onClick={() => handleSubmit(false)}
            disabled={isPending}
            className="btn btn-secondary btn-sm flex items-center gap-1.5"
          >
            <Save className="h-4 w-4" />
            Save Draft
          </button>
          <button
            onClick={() => handleSubmit(true)}
            disabled={isPending}
            className="btn btn-primary btn-sm flex items-center gap-1.5"
          >
            <Send className="h-4 w-4" />
            Submit for Review
          </button>
        </div>
      </div>

      {feedbackMsg && (
        <div
          className={`p-3 text-sm rounded-lg flex items-center gap-2 ${
            feedbackMsg.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
              : "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
          }`}
        >
          {feedbackMsg.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-base-100">
        <table className="table w-full text-sm">
          <thead>
            <tr className="bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 text-xs">
              <th className="w-12">#</th>
              <th>Student</th>
              <th>Adm No / Roll</th>
              <th className="w-36">Marks (Max {maxMarks})</th>
              <th className="w-24 text-center">Absent</th>
              <th className="w-24 text-center">Exempted</th>
              <th>Feedback / Remarks</th>
              <th className="w-28 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {students.map((student, idx) => {
              const entry = studentEntries[idx];
              const isLocked = student.evaluationStatus === "VERIFIED";
              const isCandidateExempted = student.enrollmentStatus === "EXEMPTED";
              const isCandidateAbsent = student.enrollmentStatus === "ABSENT";
              const isCandidateWithdrawn = student.enrollmentStatus === "WITHDRAWN";
              const isCandidateRestricted = isCandidateExempted || isCandidateAbsent || isCandidateWithdrawn;
              const inputDisabled = isLocked || isCandidateRestricted;

              return (
                <tr key={student.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                  <td className="text-zinc-400 text-xs">{idx + 1}</td>
                  <td className="font-medium text-zinc-900 dark:text-zinc-100">
                    <div>{student.name}</div>
                    {isCandidateExempted && (
                      <span className="badge badge-info badge-xs mt-0.5">Exam Exempted</span>
                    )}
                    {isCandidateAbsent && (
                      <span className="badge badge-error badge-xs mt-0.5">Exam Absent</span>
                    )}
                    {isCandidateWithdrawn && (
                      <span className="badge badge-neutral badge-xs mt-0.5">Withdrawn</span>
                    )}
                  </td>
                  <td className="text-zinc-500 text-xs">
                    {student.admissionNo} {student.rollNumber ? `• Roll: ${student.rollNumber}` : ""}
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max={maxMarks}
                      disabled={inputDisabled || entry.isAbsent || entry.isExempted}
                      value={entry.marksObtained !== null && entry.marksObtained !== undefined ? entry.marksObtained : ""}
                      onChange={(e) =>
                        updateEntry(idx, "marksObtained", e.target.value === "" ? null : Number(e.target.value))
                      }
                      placeholder={
                        isCandidateExempted
                          ? "EXM (Exam)"
                          : isCandidateAbsent
                          ? "ABS (Exam)"
                          : isCandidateWithdrawn
                          ? "WTH"
                          : entry.isAbsent
                          ? "ABS"
                          : entry.isExempted
                          ? "EXM"
                          : "0"
                      }
                      className={`input input-bordered input-sm w-28 text-right font-mono font-medium ${
                        entry.marksObtained !== null && entry.marksObtained < passingMarks
                          ? "border-amber-500 text-amber-600 dark:text-amber-400"
                          : ""
                      }`}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      disabled={inputDisabled}
                      checked={entry.isAbsent}
                      onChange={(e) => updateEntry(idx, "isAbsent", e.target.checked)}
                      className="checkbox checkbox-sm checkbox-error"
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      disabled={inputDisabled}
                      checked={entry.isExempted}
                      onChange={(e) => updateEntry(idx, "isExempted", e.target.checked)}
                      className="checkbox checkbox-sm checkbox-info"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      disabled={inputDisabled}
                      value={entry.feedback}
                      onChange={(e) => updateEntry(idx, "feedback", e.target.value)}
                      placeholder="Optional feedback..."
                      className="input input-bordered input-sm w-full text-xs"
                    />
                  </td>
                  <td className="text-center">
                    <span
                      className={`badge text-[11px] font-medium ${
                        student.evaluationStatus === "VERIFIED"
                          ? "badge-success text-emerald-700 dark:text-emerald-300"
                          : student.evaluationStatus === "SUBMITTED"
                          ? "badge-info text-blue-700 dark:text-blue-300"
                          : student.evaluationStatus === "DRAFT"
                          ? "badge-warning text-amber-700 dark:text-amber-300"
                          : "badge-neutral text-zinc-500"
                      }`}
                    >
                      {student.evaluationStatus}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/30 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="flex-1 max-w-xl">
          <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
            Evaluation Reason / Audit Justification *
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Regular unit test grading, re-evaluation request, etc."
            className="input input-bordered input-sm w-full mt-1 text-xs"
          />
        </div>

        <div className="text-xs text-zinc-500 flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
          All mark revisions are permanently tracked in ExamMarksRevisionEvent logs.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 4. PUBLISH RESULTS MODAL
// ─────────────────────────────────────────────────────────────

export function PublishResultsModal({
  examId,
  examTitle,
  enrolledCount,
  subjectCount,
  gradeScaleName,
}: {
  examId: string;
  examTitle: string;
  enrolledCount: number;
  subjectCount: number;
  gradeScaleName: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handlePublish = () => {
    setError(null);
    startTransition(async () => {
      const res = await calculateAndPublishResultsAction({ examId });
      if (!res.ok) {
        setError(res.error || "Failed to publish examination results.");
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-primary inline-flex items-center gap-1.5 text-sm shadow-md"
      >
        <Award className="h-4 w-4" />
        Calculate & Publish Results
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg p-6 shadow-2xl bg-base-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Award className="h-5 w-5 text-indigo-500" />
                Publish Examination Results
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-sm p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm rounded-lg flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
              <p>
                Publishing <strong className="text-zinc-900 dark:text-zinc-100">{examTitle}</strong> will:
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <li>
                  Calculate weighted percentages, letter grades and grade points for{" "}
                  <strong>{enrolledCount} students</strong> across <strong>{subjectCount} subjects</strong> using{" "}
                  <strong>{gradeScaleName}</strong>.
                </li>
                <li>Compute institutional ranks and subject-level pass/fail thresholds.</li>
                <li>
                  Generate <strong>immutable cryptographic snapshots</strong> (SHA-256 verified) for all report cards.
                </li>
                <li>Make verified results visible to students and parents on the Portal.</li>
              </ul>
            </div>

            <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn btn-ghost text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handlePublish}
                className="btn btn-primary text-sm flex items-center gap-1.5"
              >
                {isPending ? "Computing & Publishing..." : "Confirm & Publish Results"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 5. STUDENT REPORT CARD MODAL & VIEWER
// ─────────────────────────────────────────────────────────────

type SnapshotDetails = {
  institute: { name: string };
  exam: { title: string; code: string; academicYear: string };
  student: { name: string; admissionNo: string; rollNumber: string | null };
  performance: {
    totalMaxMarks: number;
    totalMarksObtained: number;
    percentage: number;
    grade: string;
    gradePoint: number;
    rank: number | null;
    resultStatus: string;
  };
  subjects: Array<{
    subjectName: string;
    maxMarks: number;
    passingMarks: number;
    marksObtained: number | null;
    isAbsent: boolean;
    isExempted: boolean;
    isPassed: boolean;
  }>;
  metadata: { publishedAt: string; publishedBy: string };
};

export function StudentReportCardModal({
  snapshot,
  checksum,
}: {
  snapshot: SnapshotDetails;
  checksum: string;
}) {
  const [open, setOpen] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-ghost btn-xs text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1"
      >
        <FileText className="h-3.5 w-3.5" /> View Card
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm print:p-0 print:bg-white">
          <div className="card w-full max-w-2xl max-h-[90vh] flex flex-col p-6 shadow-2xl bg-base-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden print:border-none print:shadow-none print:max-h-full">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800 print:hidden">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                Verified Immutable Report Card
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrint}
                  className="btn btn-outline btn-xs flex items-center gap-1"
                >
                  <Printer className="h-3.5 w-3.5" /> Print
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="btn btn-ghost btn-xs p-1 text-zinc-400 hover:text-zinc-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Report Header */}
              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {snapshot.institute.name}
                </h2>
                <h4 className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                  Official Assessment Report Card
                </h4>
                <p className="text-xs text-zinc-500">
                  {snapshot.exam.title} • {snapshot.exam.academicYear}
                </p>
              </div>

              {/* Student Info Box */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60 text-xs">
                <div>
                  <span className="text-zinc-400 block">Student Name</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {snapshot.student.name}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400 block">Admission No</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {snapshot.student.admissionNo}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400 block">Roll Number</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {snapshot.student.rollNumber || "N/A"}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400 block">Overall Status</span>
                  <span
                    className={`font-bold ${
                      snapshot.performance.resultStatus === "PASS"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {snapshot.performance.resultStatus}
                  </span>
                </div>
              </div>

              {/* Subject Breakdown Table */}
              <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                <table className="table w-full text-xs">
                  <thead>
                    <tr className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      <th>Subject</th>
                      <th className="text-right">Max Marks</th>
                      <th className="text-right">Passing</th>
                      <th className="text-right">Marks Obtained</th>
                      <th className="text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {snapshot.subjects.map((sub, idx) => (
                      <tr key={idx}>
                        <td className="font-medium text-zinc-900 dark:text-zinc-100">
                          {sub.subjectName}
                        </td>
                        <td className="text-right text-zinc-500 font-mono">{sub.maxMarks}</td>
                        <td className="text-right text-zinc-500 font-mono">{sub.passingMarks}</td>
                        <td className="text-right font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                          {sub.isAbsent
                            ? "ABS"
                            : sub.isExempted
                            ? "EXM"
                            : sub.marksObtained !== null
                            ? sub.marksObtained
                            : "-"}
                        </td>
                        <td className="text-center">
                          <span
                            className={`badge badge-xs ${
                              sub.isPassed ? "badge-success" : "badge-error"
                            }`}
                          >
                            {sub.isPassed ? "Pass" : "Fail"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Performance Summary Badges */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60">
                  <span className="text-[11px] text-zinc-500 block">Total Marks</span>
                  <span className="text-base font-bold font-mono text-zinc-900 dark:text-zinc-100">
                    {snapshot.performance.totalMarksObtained} / {snapshot.performance.totalMaxMarks}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60">
                  <span className="text-[11px] text-zinc-500 block">Percentage</span>
                  <span className="text-base font-bold font-mono text-indigo-600 dark:text-indigo-400">
                    {snapshot.performance.percentage}%
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60">
                  <span className="text-[11px] text-zinc-500 block">Grade & Points</span>
                  <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    {snapshot.performance.grade} ({snapshot.performance.gradePoint} GP)
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60">
                  <span className="text-[11px] text-zinc-500 block">Rank</span>
                  <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                    {snapshot.performance.rank ? `#${snapshot.performance.rank}` : "N/A"}
                  </span>
                </div>
              </div>

              {/* Verification & Checksum Footer */}
              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex flex-col md:flex-row md:items-center justify-between text-[11px] text-zinc-400 gap-2 font-mono">
                <div>
                  Published By: {snapshot.metadata.publishedBy} • {new Date(snapshot.metadata.publishedAt).toLocaleDateString()}
                </div>
                <div className="truncate max-w-xs" title={`SHA-256 Checksum: ${checksum}`}>
                  SHA-256: {checksum.slice(0, 16)}...
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 6. DELETE EXAM BUTTON
// ─────────────────────────────────────────────────────────────

export function DeleteExamButton({ examId, examTitle }: { examId: string; examTitle: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleDelete = () => {
    if (!confirm(`Are you sure you want to delete examination '${examTitle}'? This cannot be undone.`)) {
      return;
    }

    startTransition(async () => {
      const res = await deleteExaminationAction(examId);
      if (!res.ok) {
        alert(res.error || "Failed to delete examination.");
      } else {
        router.push("/app/exams");
      }
    });
  };

  return (
    <button
      onClick={handleDelete}
      disabled={isPending}
      className="btn btn-ghost btn-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 inline-flex items-center gap-1.5"
    >
      <Trash2 className="h-4 w-4" />
      {isPending ? "Deleting..." : "Delete Exam"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// 7. EXPORT RESULTS CSV BUTTON
// ─────────────────────────────────────────────────────────────

export function ExportResultsCsvButton({
  examId,
  isPublished,
}: {
  examId: string;
  isPublished: boolean;
}) {
  const [loading, setLoading] = useState(false);

  if (!isPublished) return null;

  const handleExport = async () => {
    try {
      setLoading(true);
      const res = await exportExamResultsCsvAction(examId);
      if (!res.ok || !res.data) {
        alert(res.error || "Failed to export results CSV");
        return;
      }
      const blob = new Blob([res.data.csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", res.data.filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Export failed";
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      className="btn btn-secondary btn-sm text-xs inline-flex items-center gap-1.5"
    >
      <Download className="h-4 w-4" />
      {loading ? "Exporting..." : "Export CSV"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// 8. CORRECT PUBLISHED MARK MODAL
// ─────────────────────────────────────────────────────────────

export type CandidateSubjectMark = {
  examSubjectId: string;
  subjectName: string;
  subjectCode: string | null;
  maxMarks: number;
  currentMarks: number | null;
  isAbsent: boolean;
  isExempted: boolean;
  version: number;
};

export function CorrectPublishedMarkModal({
  examId,
  studentId,
  studentName,
  admissionNo,
  subjects,
}: {
  examId: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  subjects: CandidateSubjectMark[];
}) {
  const [open, setOpen] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.examSubjectId || "");
  const [newMark, setNewMark] = useState<string>("");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const router = useRouter();

  const currentSubject = subjects.find((s) => s.examSubjectId === selectedSubjectId) || subjects[0];

  const handleOpen = () => {
    setErrorMsg(null);
    setIsStale(false);
    setSuccessMsg(null);
    setSelectedSubjectId(subjects[0]?.examSubjectId || "");
    setNewMark(subjects[0]?.currentMarks !== null && subjects[0]?.currentMarks !== undefined ? String(subjects[0]?.currentMarks) : "");
    setReason("");
    setOpen(true);
  };

  const handleSubjectChange = (subjectId: string) => {
    setSelectedSubjectId(subjectId);
    const sub = subjects.find((s) => s.examSubjectId === subjectId);
    setNewMark(sub?.currentMarks !== null && sub?.currentMarks !== undefined ? String(sub.currentMarks) : "");
    setErrorMsg(null);
    setIsStale(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSubject) return;

    setErrorMsg(null);
    setIsStale(false);
    setSuccessMsg(null);

    const numericMark = Number(newMark);
    if (isNaN(numericMark) || numericMark < 0) {
      setErrorMsg("Marks must be a non-negative number.");
      return;
    }
    if (numericMark > currentSubject.maxMarks) {
      setErrorMsg(`Marks cannot exceed maximum marks (${currentSubject.maxMarks}).`);
      return;
    }
    if (reason.trim().length < 10) {
      setErrorMsg("A detailed audit justification (minimum 10 characters) is required.");
      return;
    }

    startTransition(async () => {
      const res = await correctPublishedMarkAction({
        examId,
        examSubjectId: currentSubject.examSubjectId,
        studentId,
        newMark: numericMark,
        expectedVersion: currentSubject.version,
        reason: reason.trim(),
      });

      if (!res.ok) {
        if (res.code === "STALE_VERSION") {
          setIsStale(true);
          setErrorMsg("The mark has been modified by another process. Please refresh the page before trying again.");
        } else {
          setErrorMsg(res.error || "Failed to correct published mark.");
        }
      } else {
        setSuccessMsg("Mark corrected successfully! Updated ranking and snapshots have been generated.");
        setTimeout(() => {
          setOpen(false);
          router.refresh();
        }, 1000);
      }
    });
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="btn btn-ghost btn-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/40 inline-flex items-center gap-1"
        title="Authorized Mark Correction"
      >
        <Edit3 className="h-3.5 w-3.5" /> Correct Mark
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg p-6 shadow-2xl bg-base-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-amber-500" />
                  Correct Published Mark
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {studentName} • Adm No: <span className="font-mono">{admissionNo}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-xs p-1 text-zinc-400 hover:text-zinc-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs rounded-xl border border-red-200 dark:border-red-800 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <span>{errorMsg}</span>
                  {isStale && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        router.refresh();
                      }}
                      className="btn btn-outline btn-xs mt-1.5 flex items-center gap-1 text-red-700 dark:text-red-300 border-red-300"
                    >
                      <RefreshCw className="h-3 w-3" /> Refresh Results Now
                    </button>
                  )}
                </div>
              </div>
            )}

            {successMsg && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                  Assessment Subject *
                </label>
                <select
                  value={selectedSubjectId}
                  onChange={(e) => handleSubjectChange(e.target.value)}
                  disabled={isPending || isStale}
                  className="select select-bordered select-sm w-full mt-1 text-xs"
                >
                  {subjects.map((sub) => (
                    <option key={sub.examSubjectId} value={sub.examSubjectId}>
                      {sub.subjectName} (Max: {sub.maxMarks}) — Current: {sub.currentMarks !== null ? sub.currentMarks : "None"} [v{sub.version}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs">
                <div>
                  <span className="text-zinc-400 block">Current Mark</span>
                  <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">
                    {currentSubject?.currentMarks !== null && currentSubject?.currentMarks !== undefined ? currentSubject.currentMarks : "N/A"} / {currentSubject?.maxMarks}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400 block">Tracked Version</span>
                  <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                    v{currentSubject?.version}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                  Corrected Mark *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  max={currentSubject?.maxMarks ?? 1000}
                  value={newMark}
                  onChange={(e) => setNewMark(e.target.value)}
                  disabled={isPending || isStale}
                  placeholder={`0 - ${currentSubject?.maxMarks ?? 100}`}
                  className="input input-bordered input-sm w-full mt-1 text-xs font-mono"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                  Audit Justification * (min 10 characters)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={isPending || isStale}
                  placeholder="e.g. Question 5 revaluation approved by Academic Board"
                  className="textarea textarea-bordered textarea-sm w-full mt-1 text-xs"
                  rows={2}
                  required
                />
                <span className="text-[10px] text-zinc-400 block mt-0.5">
                  {reason.trim().length} / 10 characters minimum
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 text-[11px] text-amber-800 dark:text-amber-300">
                Correcting this mark will recalculate exam-wide ranks, record an immutable revision event, and generate a new snapshot version for all affected candidates.
              </div>

              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="btn btn-ghost btn-sm text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || isStale || reason.trim().length < 10}
                  className="btn btn-primary btn-sm text-xs flex items-center gap-1.5"
                >
                  {isPending ? "Applying Correction..." : "Commit Correction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 8. LIFECYCLE ACTION CONTROLS: CANCEL, ARCHIVE, REOPEN
// ─────────────────────────────────────────────────────────────

export function CancelExamModal({
  examId,
  examTitle,
  currentStatus,
}: {
  examId: string;
  examTitle: string;
  currentStatus: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleCancel = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 10) {
      setError("Cancellation justification must be at least 10 characters long.");
      return;
    }

    startTransition(async () => {
      const res = await cancelExaminationAction({
        examId,
        reason,
      });

      if (!res.ok) {
        setError(res.error || "Failed to cancel examination");
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-error btn-outline btn-sm text-xs flex items-center gap-1.5"
      >
        <X className="h-3.5 w-3.5" /> Cancel Exam
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                <AlertCircle className="h-5 w-5" />
                <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100">Cancel Examination</h3>
              </div>
              <button onClick={() => setOpen(false)} className="btn btn-ghost btn-circle btn-xs text-zinc-400">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-500">
              Cancelling <strong>{examTitle}</strong> (currently {currentStatus}) will transition the examination to <strong>ARCHIVED</strong>. This action is irreversible; candidate marks and schedule will be permanently frozen.
            </p>

            {error && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 text-rose-700 dark:text-rose-400 text-xs">
                {error}
              </div>
            )}

            <form onSubmit={handleCancel} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                  Cancellation Justification * (min 10 characters)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={isPending}
                  placeholder="e.g. Examination postponed to next semester by Academic Council decision"
                  className="textarea textarea-bordered textarea-sm w-full mt-1 text-xs"
                  rows={3}
                  required
                />
                <span className="text-[10px] text-zinc-400 block mt-0.5">
                  {reason.trim().length} / 10 characters minimum
                </span>
              </div>

              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="btn btn-ghost btn-sm text-xs"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isPending || reason.trim().length < 10}
                  className="btn btn-error btn-sm text-xs"
                >
                  {isPending ? "Cancelling..." : "Confirm Cancellation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export function ArchiveExamModal({
  examId,
  examTitle,
}: {
  examId: string;
  examTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleArchive = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await archiveExaminationAction({
        examId,
        reason: reason.trim() || undefined,
      });

      if (!res.ok) {
        setError(res.error || "Failed to archive examination");
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-neutral btn-outline btn-sm text-xs flex items-center gap-1.5"
      >
        <Archive className="h-3.5 w-3.5" /> Archive Examination
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                <Archive className="h-5 w-5" />
                <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100">Archive Examination</h3>
              </div>
              <button onClick={() => setOpen(false)} className="btn btn-ghost btn-circle btn-xs text-zinc-400">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-500">
              Archiving <strong>{examTitle}</strong> will seal the examination permanently. Published report cards remain accessible to students/parents, but no further mark updates, corrections, or status changes will be permitted.
            </p>

            {error && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 text-rose-700 dark:text-rose-400 text-xs">
                {error}
              </div>
            )}

            <form onSubmit={handleArchive} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                  Archival Note (optional)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={isPending}
                  placeholder="e.g. End-of-term regular archival; all report cards verified"
                  className="textarea textarea-bordered textarea-sm w-full mt-1 text-xs"
                  rows={2}
                />
              </div>

              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="btn btn-ghost btn-sm text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn btn-neutral btn-sm text-xs"
                >
                  {isPending ? "Archiving..." : "Confirm Archival"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export function ReopenEvaluatedExamModal({
  examId,
  examTitle,
}: {
  examId: string;
  examTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleReopen = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 10) {
      setError("Reopening justification must be at least 10 characters long.");
      return;
    }

    startTransition(async () => {
      const res = await reopenEvaluatedExamAction({
        examId,
        reason,
      });

      if (!res.ok) {
        setError(res.error || "Failed to reopen evaluation");
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-warning btn-outline btn-sm text-xs flex items-center gap-1.5"
      >
        <RotateCcw className="h-3.5 w-3.5" /> Reopen Evaluation
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-5 w-5" />
                <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100">Reopen Evaluation</h3>
              </div>
              <button onClick={() => setOpen(false)} className="btn btn-ghost btn-circle btn-xs text-zinc-400">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-500">
              Reopening <strong>{examTitle}</strong> will transition its status from <strong>EVALUATED</strong> back to <strong>IN_PROGRESS</strong> and unlock candidate marks so examiners can make corrections prior to publishing.
            </p>

            {error && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 text-rose-700 dark:text-rose-400 text-xs">
                {error}
              </div>
            )}

            <form onSubmit={handleReopen} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                  Reopening Justification * (min 10 characters)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={isPending}
                  placeholder="e.g. Head examiner requested un-verifying Mathematics marks for review"
                  className="textarea textarea-bordered textarea-sm w-full mt-1 text-xs"
                  rows={3}
                  required
                />
                <span className="text-[10px] text-zinc-400 block mt-0.5">
                  {reason.trim().length} / 10 characters minimum
                </span>
              </div>

              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="btn btn-ghost btn-sm text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || reason.trim().length < 10}
                  className="btn btn-warning btn-sm text-xs"
                >
                  {isPending ? "Reopening..." : "Confirm Reopen"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 12. UPDATE ENROLLMENT STATUS MODAL
// ─────────────────────────────────────────────────────────────

export function UpdateEnrollmentStatusModal({
  enrollmentId,
  studentName,
  admissionNo,
  currentStatus,
  hasExistingScores = false,
  disabled = false,
}: {
  enrollmentId: string;
  studentName: string;
  admissionNo: string;
  currentStatus: string;
  hasExistingScores?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(currentStatus);
  const [remarks, setRemarks] = useState("");
  const [overwriteExistingMarks, setOverwriteExistingMarks] = useState(false);
  const [requiresOverwriteConfirmation, setRequiresOverwriteConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleOpen = () => {
    setStatus(currentStatus);
    setRemarks("");
    setOverwriteExistingMarks(false);
    setRequiresOverwriteConfirmation(false);
    setError(null);
    setOpen(true);
  };

  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus);
    setError(null);
    if ((newStatus === "EXEMPTED" || newStatus === "ABSENT") && hasExistingScores) {
      setRequiresOverwriteConfirmation(true);
    } else {
      setRequiresOverwriteConfirmation(false);
      setOverwriteExistingMarks(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await updateEnrollmentStatusAction({
        enrollmentId,
        status: status as "ELIGIBLE" | "ABSENT" | "EXEMPTED" | "WITHDRAWN",
        remarks: remarks.trim() || null,
        overwriteExistingMarks,
      });

      if (!res.ok) {
        if (res.code === "EXISTING_MARKS_PRESENT") {
          setRequiresOverwriteConfirmation(true);
        }
        setError(res.error || "Failed to update enrollment status.");
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className="btn btn-ghost btn-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-1"
        title="Manage Candidate Participation Status"
      >
        <Edit3 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Status</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-base-100 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-6 max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Users className="h-5 w-5 text-indigo-500" />
                  Candidate Participation Status
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {studentName} • Adm No: <span className="font-mono">{admissionNo}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-circle btn-xs text-zinc-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 text-rose-700 dark:text-rose-400 text-xs flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider block mb-1">
                  Participation Status *
                </label>
                <select
                  value={status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  disabled={isPending}
                  className="select select-bordered select-sm w-full text-xs font-medium"
                >
                  <option value="ELIGIBLE">ELIGIBLE (Active Candidate)</option>
                  <option value="EXEMPTED">EXEMPTED (Exempt from All Subjects)</option>
                  <option value="ABSENT">ABSENT (Absent from All Assessments)</option>
                  <option value="WITHDRAWN">WITHDRAWN (Excluded from Exam)</option>
                </select>

                <div className="mt-2 text-[11px] p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 space-y-1">
                  {status === "ELIGIBLE" && (
                    <p>Candidate is actively enrolled and expected to sit for subject assessments.</p>
                  )}
                  {status === "EXEMPTED" && (
                    <p>
                      <strong>Candidate Exemption:</strong> Propagates verified exemption to all subjects.
                      Published result outcome is <strong>WITHHELD</strong>, grade <strong>EXM</strong>, and institutional rank is <strong>null</strong>.
                    </p>
                  )}
                  {status === "ABSENT" && (
                    <p>
                      <strong>Candidate Absence:</strong> Propagates verified absence to all subjects.
                      Published result outcome is <strong>FAIL</strong> with 0%, lowest grade band, and institutional rank is <strong>null</strong>.
                    </p>
                  )}
                  {status === "WITHDRAWN" && (
                    <p>
                      <strong>Withdrawn:</strong> Candidate is completely excluded from Cartesian completeness verification, evaluation, and published rosters.
                    </p>
                  )}
                </div>
              </div>

              {(requiresOverwriteConfirmation || (hasExistingScores && (status === "EXEMPTED" || status === "ABSENT"))) && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>Existing Subject-Level Marks Overwrite Confirmation</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    This candidate has existing subject-level records (numeric scores, subject exemptions, or absences). Applying candidate-level <strong>{status}</strong> will replace them with verified placeholder marks. (Original marks are safely preserved and will be restored if reverted to ELIGIBLE).
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer pt-1 font-medium text-xs">
                    <input
                      type="checkbox"
                      checked={overwriteExistingMarks}
                      onChange={(e) => setOverwriteExistingMarks(e.target.checked)}
                      disabled={isPending}
                      className="checkbox checkbox-xs checkbox-warning"
                    />
                    <span>I confirm overwriting existing subject marks for this candidate</span>
                  </label>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider block mb-1">
                  Administrative Remarks / Justification
                </label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  disabled={isPending}
                  placeholder="e.g. Medical certificate approved by principal; or transferred out"
                  className="textarea textarea-bordered textarea-sm w-full text-xs"
                  rows={2}
                />
              </div>

              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="btn btn-ghost btn-sm text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || (requiresOverwriteConfirmation && !overwriteExistingMarks)}
                  className="btn btn-primary btn-sm text-xs"
                >
                  {isPending ? "Updating..." : "Save Status"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
