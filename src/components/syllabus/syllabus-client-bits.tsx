"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { showToast } from "@/components/ui/toast";
import {
  createChapterAction,
  createTopicAction,
  updateTopicProgressAction,
  createLessonPlanAction,
  updateSyllabusAction,
} from "@/actions/syllabus";
import type { TopicProgressStatus } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Add Chapter Modal
// ─────────────────────────────────────────────────────────────

export function AddChapterButton({ syllabusId }: { syllabusId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("syllabusId", syllabusId);

    startTransition(async () => {
      const res = await createChapterAction({}, formData);
      if (res.error) {
        showToast({ title: "Failed to add chapter", message: res.error, type: "error" });
      } else {
        showToast({ title: "Chapter added", message: "Chapter created successfully.", type: "success" });
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-primary btn-sm flex items-center gap-1.5"
      >
        <Plus className="size-3.5" />
        <span>Add Unit / Chapter</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg p-6 shadow-2xl border border-[var(--border)]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold text-foreground">Add Unit / Chapter</h3>
              <button
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-sm p-1 text-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="label text-xs">Chapter / Unit Title *</label>
                <input
                  name="title"
                  required
                  placeholder="e.g. Unit 1: Thermodynamics"
                  className="input text-xs w-full mt-1"
                />
              </div>

              <div>
                <label className="label text-xs">Description (optional)</label>
                <textarea
                  name="description"
                  rows={2}
                  placeholder="Summary of topics covered..."
                  className="input text-xs w-full mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Estimated Teaching Hours</label>
                  <input
                    name="estimatedHours"
                    type="number"
                    step="0.5"
                    defaultValue="4"
                    className="input text-xs w-full mt-1"
                  />
                </div>
                <div>
                  <label className="label text-xs">Sequence Order</label>
                  <input
                    name="order"
                    type="number"
                    placeholder="Auto"
                    className="input text-xs w-full mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Planned Start</label>
                  <input name="plannedStartDate" type="date" className="input text-xs w-full mt-1" />
                </div>
                <div>
                  <label className="label text-xs">Planned Completion</label>
                  <input name="plannedEndDate" type="date" className="input text-xs w-full mt-1" />
                </div>
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="btn btn-secondary btn-sm text-xs"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isPending} className="btn btn-primary btn-sm text-xs">
                  {isPending ? "Saving…" : "Save Chapter"}
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
// Add Topic Modal
// ─────────────────────────────────────────────────────────────

export function AddTopicButton({
  syllabusId,
  chapterId,
  chapterTitle,
}: {
  syllabusId: string;
  chapterId: string;
  chapterTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("syllabusId", syllabusId);
    formData.set("chapterId", chapterId);

    startTransition(async () => {
      const res = await createTopicAction({}, formData);
      if (res.error) {
        showToast({ title: "Failed to add topic", message: res.error, type: "error" });
      } else {
        showToast({ title: "Topic added", message: "Topic created successfully.", type: "success" });
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-sm text-xs flex items-center gap-1"
      >
        <Plus className="size-3" />
        <span>Add Topic</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg p-6 shadow-2xl border border-[var(--border)]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div>
                <h3 className="text-base font-semibold text-foreground">Add Topic</h3>
                <p className="text-xs text-muted">In chapter: {chapterTitle}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-sm p-1 text-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="label text-xs">Topic Title *</label>
                <input
                  name="title"
                  required
                  placeholder="e.g. Carnot Cycle & Efficiency"
                  className="input text-xs w-full mt-1"
                />
              </div>

              <div>
                <label className="label text-xs">Learning Objectives</label>
                <textarea
                  name="learningObjectives"
                  rows={2}
                  placeholder="Students will be able to derive efficiency and solve numericals..."
                  className="input text-xs w-full mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Estimated Minutes</label>
                  <input
                    name="estimatedMinutes"
                    type="number"
                    defaultValue="45"
                    className="input text-xs w-full mt-1"
                  />
                </div>
                <div>
                  <label className="label text-xs">Planned Date</label>
                  <input name="plannedDate" type="date" className="input text-xs w-full mt-1" />
                </div>
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="btn btn-secondary btn-sm text-xs"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isPending} className="btn btn-primary btn-sm text-xs">
                  {isPending ? "Saving…" : "Save Topic"}
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
// Update Topic Progress Modal
// ─────────────────────────────────────────────────────────────

export function UpdateProgressButton({
  syllabusId,
  topicId,
  topicTitle,
  currentStatus,
}: {
  syllabusId: string;
  topicId: string;
  topicTitle: string;
  currentStatus: TopicProgressStatus;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<TopicProgressStatus>(currentStatus);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("syllabusId", syllabusId);
    formData.set("topicId", topicId);
    formData.set("status", status);

    startTransition(async () => {
      const res = await updateTopicProgressAction({}, formData);
      if (res.error) {
        showToast({ title: "Update failed", message: res.error, type: "error" });
      } else {
        showToast({ title: "Progress updated", message: `Topic marked as ${status}.`, type: "success" });
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-ghost btn-sm text-xs flex items-center gap-1 hover:bg-[var(--accent)]"
        title="Update teaching status"
      >
        <Clock className="size-3.5 text-muted" />
        <span className="hidden sm:inline">Update</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 shadow-2xl border border-[var(--border)]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div>
                <h3 className="text-base font-semibold text-foreground">Update Topic Progress</h3>
                <p className="text-xs text-muted truncate max-w-xs">{topicTitle}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-sm p-1 text-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="label text-xs">Completion Status *</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "SKIPPED"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStatus(s)}
                      className={`p-2 rounded-lg border text-xs font-medium text-left transition ${
                        status === s
                          ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                          : "border-[var(--border)] hover:border-[var(--border-strong)] text-muted"
                      }`}
                    >
                      {s.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>

              {status === "COMPLETED" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">Completion Date</label>
                    <input
                      name="completedDate"
                      type="date"
                      defaultValue={new Date().toISOString().split("T")[0]}
                      className="input text-xs w-full mt-1"
                    />
                  </div>
                  <div>
                    <label className="label text-xs">Completed Hours</label>
                    <input
                      name="completedHours"
                      type="number"
                      step="0.5"
                      defaultValue="1"
                      className="input text-xs w-full mt-1"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="label text-xs">Teacher Notes / Remarks (optional)</label>
                <textarea
                  name="notes"
                  rows={2}
                  placeholder="e.g. Covered numericals, students need practice on formula derivation..."
                  className="input text-xs w-full mt-1"
                />
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="btn btn-secondary btn-sm text-xs"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isPending} className="btn btn-primary btn-sm text-xs">
                  {isPending ? "Updating…" : "Save Progress"}
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
// Add Lesson Plan Modal (with offline AI template integration)
// ─────────────────────────────────────────────────────────────

export function AddLessonPlanButton({
  syllabusId,
  chapters,
}: {
  syllabusId: string;
  chapters: Array<{
    id: string;
    title: string;
    topics: Array<{ id: string; title: string }>;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState(chapters[0]?.id || "");
  const [selectedTopicId, setSelectedTopicId] = useState(chapters[0]?.topics[0]?.id || "");
  const [title, setTitle] = useState("");
  const [objectives, setObjectives] = useState("");
  const [methodology, setMethodology] = useState("");
  const [materials, setMaterials] = useState("");
  const [homework, setHomework] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const currentChapter = chapters.find((c) => c.id === selectedChapterId);
  const currentTopic = currentChapter?.topics.find((t) => t.id === selectedTopicId);

  // Offline Pedagogy Generator (0 paid APIs, 100% self-contained)
  function handleGenerateOfflineTemplate() {
    const topicName = currentTopic?.title || "Topic Lesson";
    setTitle(`Lesson: ${topicName}`);
    setObjectives(`1. Understand the core principles of ${topicName}.\n2. Solve practice problems and apply key formulas.\n3. Identify real-world applications.`);
    setMethodology(`1. Hook (5m): Pose an engaging thought problem related to ${topicName}.\n2. Instruction (20m): Explain fundamental definitions and demonstrate key examples on the board.\n3. Guided Practice (15m): Group problem solving with teacher circulation.\n4. Exit Ticket (5m): 3 quick questions to gauge comprehension.`);
    setMaterials(`Textbook chapter reference, whiteboard markers, printed question worksheet.`);
    setHomework(`Review textbook summary questions 1-5; complete assigned practice set.`);
    showToast({ title: "Template generated", message: "Structured lesson plan loaded.", type: "success" });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("syllabusId", syllabusId);
    formData.set("chapterId", selectedChapterId);
    formData.set("topicId", selectedTopicId);
    formData.set("title", title);
    formData.set("objectives", objectives);
    formData.set("methodology", methodology);
    formData.set("materials", materials);
    formData.set("homework", homework);

    startTransition(async () => {
      const res = await createLessonPlanAction({}, formData);
      if (res.error) {
        showToast({ title: "Failed to create plan", message: res.error, type: "error" });
      } else {
        showToast({ title: "Lesson plan created", message: "Lesson plan saved successfully.", type: "success" });
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={chapters.length === 0}
        className="btn btn-primary btn-sm flex items-center gap-1.5"
      >
        <Plus className="size-3.5" />
        <span>Create Lesson Plan</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl border border-[var(--border)]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div>
                <h3 className="text-base font-semibold text-foreground">Create Lesson Plan</h3>
                <p className="text-xs text-muted">Plan pedagogy, duration, and learning outcomes</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-sm p-1 text-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Target Chapter *</label>
                  <select
                    value={selectedChapterId}
                    onChange={(e) => {
                      setSelectedChapterId(e.target.value);
                      const chap = chapters.find((c) => c.id === e.target.value);
                      setSelectedTopicId(chap?.topics[0]?.id || "");
                    }}
                    className="input text-xs w-full mt-1"
                  >
                    {chapters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label text-xs">Target Topic *</label>
                  <select
                    value={selectedTopicId}
                    onChange={(e) => setSelectedTopicId(e.target.value)}
                    className="input text-xs w-full mt-1"
                  >
                    {currentChapter?.topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="label text-xs">Lesson Title *</label>
                <button
                  type="button"
                  onClick={handleGenerateOfflineTemplate}
                  className="btn btn-ghost btn-sm text-xs text-[var(--brand)] hover:bg-[var(--brand-soft)] flex items-center gap-1"
                >
                  <Sparkles className="size-3" />
                  <span>Auto-fill Template</span>
                </button>
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. Introduction to Carnot Engines"
                className="input text-xs w-full"
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Planned Date *</label>
                  <input
                    name="plannedDate"
                    type="date"
                    required
                    defaultValue={new Date().toISOString().split("T")[0]}
                    className="input text-xs w-full mt-1"
                  />
                </div>
                <div>
                  <label className="label text-xs">Duration (Minutes)</label>
                  <input
                    name="durationMinutes"
                    type="number"
                    defaultValue="45"
                    className="input text-xs w-full mt-1"
                  />
                </div>
              </div>

              <div>
                <label className="label text-xs">Learning Objectives</label>
                <textarea
                  value={objectives}
                  onChange={(e) => setObjectives(e.target.value)}
                  rows={2}
                  placeholder="Key concepts students will master..."
                  className="input text-xs w-full mt-1"
                />
              </div>

              <div>
                <label className="label text-xs">Teaching Methodology / Activity</label>
                <textarea
                  value={methodology}
                  onChange={(e) => setMethodology(e.target.value)}
                  rows={3}
                  placeholder="1. Hook (5m), 2. Direct Instruction (20m), 3. Practice (15m)..."
                  className="input text-xs w-full mt-1"
                />
              </div>

              <div>
                <label className="label text-xs">Materials / Textbooks / References</label>
                <input
                  value={materials}
                  onChange={(e) => setMaterials(e.target.value)}
                  placeholder="e.g. Chapter 4 NCERT, Lab kit, Diagram slides"
                  className="input text-xs w-full mt-1"
                />
              </div>

              <div>
                <label className="label text-xs">Homework / Assessment</label>
                <input
                  value={homework}
                  onChange={(e) => setHomework(e.target.value)}
                  placeholder="e.g. Exercise 4.2 Questions 1-5"
                  className="input text-xs w-full mt-1"
                />
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="btn btn-secondary btn-sm text-xs"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isPending || !title} className="btn btn-primary btn-sm text-xs">
                  {isPending ? "Creating…" : "Save Lesson Plan"}
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
// Complete Syllabus Button
// ─────────────────────────────────────────────────────────────

export function CompleteSyllabusButton({
  syllabusId,
  syllabusName,
}: {
  syllabusId: string;
  syllabusName: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleComplete() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("status", "COMPLETED");
      const res = await updateSyllabusAction(syllabusId, {}, formData);
      if (res.error) {
        showToast({ title: "Completion failed", message: res.error, type: "error" });
      } else {
        showToast({ title: "Syllabus completed", message: "Syllabus marked as COMPLETED.", type: "success" });
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-sm text-xs flex items-center gap-1.5"
      >
        <CheckCircle2 className="size-3.5 text-[var(--success)]" />
        <span>Mark Completed</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 border border-[var(--border)] shadow-xl">
            <h3 className="text-sm font-semibold text-foreground">Complete Syllabus?</h3>
            <p className="mt-1 text-xs text-muted">
              Marking <span className="font-semibold text-foreground">{syllabusName}</span> as completed signals that full term curriculum has been delivered.
            </p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="btn btn-secondary btn-sm text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleComplete}
                disabled={isPending}
                className="btn btn-primary btn-sm text-xs"
              >
                {isPending ? "Completing…" : "Confirm Completion"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
