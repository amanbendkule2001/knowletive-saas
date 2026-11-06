"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, BookOpen, Layers } from "lucide-react";
import { createExaminationAction } from "@/actions/exams";

type AcademicYearOption = { id: string; name: string };
type SectionOption = { id: string; name: string };
type ClassOption = { id: string; name: string; sections: SectionOption[] };
type BatchOption = { id: string; name: string; code: string };
type GradeScaleOption = { id: string; name: string; code: string; isDefault: boolean };
type SyllabusOption = { id: string; name: string; code: string };

export function ExamCreateForm({
  academicYears,
  classes,
  batches,
  gradeScales,
  syllabusTracks,
  defaultStartDate,
  defaultEndDate,
}: {
  academicYears: AcademicYearOption[];
  classes: ClassOption[];
  batches: BatchOption[];
  gradeScales: GradeScaleOption[];
  syllabusTracks: SyllabusOption[];
  defaultStartDate: string;
  defaultEndDate: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [examType, setExamType] = useState("UNIT_TEST");
  const [targetType, setTargetType] = useState<"CLASS_SECTION" | "BATCH">("CLASS_SECTION");
  const [academicYearId, setAcademicYearId] = useState(academicYears[0]?.id || "");
  const [gradeScaleId, setGradeScaleId] = useState(
    gradeScales.find((g) => g.isDefault)?.id || gradeScales[0]?.id || ""
  );
  const [syllabusTrackId, setSyllabusTrackId] = useState("");
  const [classId, setClassId] = useState(classes[0]?.id || "");
  const [sectionId, setSectionId] = useState("");
  const [batchId, setBatchId] = useState(batches[0]?.id || "");
  const [term, setTerm] = useState("Term 1");
  const [instructions, setInstructions] = useState("");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);

  const activeClass = classes.find((c) => c.id === classId);

  // Auto-generate exam code from title
  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!code || code === title.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 20)) {
      setCode(val.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 20));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const payload = {
        title,
        code,
        examType,
        targetType,
        academicYearId,
        gradeScaleId,
        syllabusTrackId: syllabusTrackId || null,
        classId: targetType === "CLASS_SECTION" ? classId : null,
        sectionId: targetType === "CLASS_SECTION" && sectionId ? sectionId : null,
        batchId: targetType === "BATCH" ? batchId : null,
        term: term || null,
        instructions: instructions || null,
        startDate,
        endDate,
      };

      const res = await createExaminationAction(payload);
      if (!res.ok) {
        setError(res.error || "Failed to schedule examination.");
      } else if (res.data?.id) {
        router.push(`/app/exams/${res.data.id}`);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="card p-6 bg-base-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm space-y-6">
      {error && (
        <div className="p-3.5 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm rounded-xl flex items-center gap-2 border border-red-200 dark:border-red-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Target Type Selector */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider block">
          Academic Targeting Model *
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setTargetType("CLASS_SECTION")}
            className={`p-4 rounded-xl border text-left flex items-start gap-3 transition-all ${
              targetType === "CLASS_SECTION"
                ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-200"
                : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 text-zinc-600 dark:text-zinc-400"
            }`}
          >
            <BookOpen className="h-5 w-5 mt-0.5 text-indigo-600 shrink-0" />
            <div>
              <div className="font-semibold text-sm">Conventional School Target</div>
              <div className="text-xs opacity-75 mt-0.5">
                Target by academic ClassLevel with optional Section specificity.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setTargetType("BATCH")}
            className={`p-4 rounded-xl border text-left flex items-start gap-3 transition-all ${
              targetType === "BATCH"
                ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-200"
                : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 text-zinc-600 dark:text-zinc-400"
            }`}
          >
            <Layers className="h-5 w-5 mt-0.5 text-indigo-600 shrink-0" />
            <div>
              <div className="font-semibold text-sm">Coaching & Cohort Batch</div>
              <div className="text-xs opacity-75 mt-0.5">
                Target a dedicated specialized batch and its enrolled student roster.
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Basic Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Examination Title *
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="e.g. Mid-Term Assessment 2026"
            className="input input-bordered w-full text-sm mt-1"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Assessment Code *
          </label>
          <input
            type="text"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. MID-2026"
            className="input input-bordered w-full text-sm mt-1 font-mono uppercase"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Examination Type *
          </label>
          <select
            value={examType}
            onChange={(e) => setExamType(e.target.value)}
            className="select select-bordered w-full text-sm mt-1"
          >
            <option value="UNIT_TEST">Unit Test</option>
            <option value="MID_TERM">Mid Term Exam</option>
            <option value="FINAL">Final Board / Annual</option>
            <option value="MOCK_TEST">Mock Test</option>
            <option value="PRACTICAL">Practical Assessment</option>
            <option value="ASSIGNMENT">Graded Assignment</option>
            <option value="CUSTOM">Custom Assessment</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Academic Year *
          </label>
          <select
            value={academicYearId}
            onChange={(e) => setAcademicYearId(e.target.value)}
            className="select select-bordered w-full text-sm mt-1"
          >
            {academicYears.map((ay) => (
              <option key={ay.id} value={ay.id}>
                {ay.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Grading Scale System *
          </label>
          <select
            value={gradeScaleId}
            onChange={(e) => setGradeScaleId(e.target.value)}
            className="select select-bordered w-full text-sm mt-1"
          >
            {gradeScales.map((gs) => (
              <option key={gs.id} value={gs.id}>
                {gs.name} {gs.isDefault ? "(Default)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Target Selection Conditional Inputs */}
      <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60 space-y-3">
        <h4 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
          Target Assignment Details
        </h4>

        {targetType === "CLASS_SECTION" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Class *
              </label>
              <select
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value);
                  setSectionId("");
                }}
                className="select select-bordered w-full text-sm mt-1"
              >
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Section (Optional)
              </label>
              <select
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                className="select select-bordered w-full text-sm mt-1"
              >
                <option value="">All Sections</option>
                {activeClass?.sections.map((sec) => (
                  <option key={sec.id} value={sec.id}>
                    Section {sec.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div>
            <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Coaching Batch *
            </label>
            <select
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="select select-bordered w-full text-sm mt-1"
            >
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name} ({batch.code})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Timeline & Term */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Start Date *
          </label>
          <input
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="input input-bordered w-full text-sm mt-1"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            End Date *
          </label>
          <input
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input input-bordered w-full text-sm mt-1"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Assessment Term / Cycle
          </label>
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="e.g. Semester 1, Unit 2"
            className="input input-bordered w-full text-sm mt-1"
          />
        </div>
      </div>

      {/* Curriculum Coverage Integration */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Linked SyllabusTrack (Optional)
          </label>
          <select
            value={syllabusTrackId}
            onChange={(e) => setSyllabusTrackId(e.target.value)}
            className="select select-bordered w-full text-sm mt-1"
          >
            <option value="">No linked curriculum</option>
            {syllabusTracks.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name} ({st.code})
              </option>
            ))}
          </select>
          <span className="text-[11px] text-zinc-500 mt-0.5 block">
            Correlates assessment results with completed chapters and topics.
          </span>
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            General Examination Instructions
          </label>
          <textarea
            rows={2}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. Bring scientific calculator, no electronic devices permitted..."
            className="textarea textarea-bordered w-full text-xs mt-1"
          />
        </div>
      </div>

      {/* Submit Button */}
      <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="btn btn-ghost text-sm"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="btn btn-primary text-sm flex items-center gap-2"
        >
          {isPending ? "Scheduling..." : "Schedule Examination & Proceed →"}
        </button>
      </div>
    </form>
  );
}
