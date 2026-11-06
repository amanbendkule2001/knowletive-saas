"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Search,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import {
  enrollStudentsAction,
  dropStudentAction,
  transferStudentAction,
  completeBatchAction,
} from "@/actions/batches";
import { showToast } from "@/components/ui/toast";

type StudentOption = {
  id: string;
  admissionNo: string;
  name: string;
  classSection?: string | null;
};

type TargetBatchOption = {
  id: string;
  name: string;
  code: string;
  capacity: number;
  activeCount: number;
};

export function EnrollStudentsModal({
  batchId,
  batchName,
  capacity,
  currentActive,
  availableStudents,
}: {
  batchId: string;
  batchName: string;
  capacity: number;
  currentActive: number;
  availableStudents: StudentOption[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const remainingCapacity = Math.max(0, capacity - currentActive);

  const filteredStudents = availableStudents.filter((s) => {
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q);
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= remainingCapacity) {
          showToast({
            title: "Capacity reached",
            message: `Only ${remainingCapacity} slot(s) remaining in this batch.`,
            type: "warning",
          });
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of filteredStudents) {
        if (next.size >= remainingCapacity) break;
        next.add(s.id);
      }
      return next;
    });
  };

  const handleEnroll = () => {
    if (selected.size === 0) return;
    startTransition(async () => {
      const res = await enrollStudentsAction(batchId, Array.from(selected));
      if (res.error) {
        showToast({ title: "Enrollment failed", message: res.error, type: "error" });
      } else {
        showToast({ title: "Students enrolled", message: res.success || "Enrollment successful.", type: "success" });
        setOpen(false);
        setSelected(new Set());
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-primary btn-sm flex items-center gap-1.5"
        disabled={remainingCapacity <= 0}
      >
        <UserPlus className="size-3.5" />
        <span>Enroll students</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-xl max-h-[85vh] flex flex-col p-6 shadow-2xl border border-[var(--border)]">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div>
                <h3 className="text-base font-semibold text-foreground">Enroll Students</h3>
                <p className="text-xs text-muted">
                  {batchName} &bull; Capacity: {currentActive}/{capacity} ({remainingCapacity} available)
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-sm p-1 text-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted" />
                <input
                  type="text"
                  placeholder="Search by student name or admission no..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input pl-9 text-xs w-full"
                />
              </div>
              <button
                type="button"
                onClick={selectAllFiltered}
                disabled={remainingCapacity <= selected.size || filteredStudents.length === 0}
                className="btn btn-secondary btn-sm text-xs"
              >
                Select visible
              </button>
            </div>

            <div className="mt-3 flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-[220px]">
              {filteredStudents.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted">
                  No eligible students found in this institute.
                </div>
              ) : (
                filteredStudents.map((s) => {
                  const isChecked = selected.has(s.id);
                  return (
                    <div
                      key={s.id}
                      onClick={() => toggleSelect(s.id)}
                      className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition text-xs ${
                        isChecked
                          ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                          : "border-[var(--border)] hover:border-[var(--border-strong)]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`size-4 rounded flex items-center justify-center border ${
                            isChecked
                              ? "bg-[var(--brand)] border-[var(--brand)] text-white"
                              : "border-[var(--border)]"
                          }`}
                        >
                          {isChecked && <Check className="size-3" />}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{s.name}</p>
                          <p className="text-[11px] text-muted">
                            Adm: {s.admissionNo} {s.classSection ? `• ${s.classSection}` : ""}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-[var(--border)] flex items-center justify-between">
              <div className="text-xs text-muted">
                Selected: <span className="font-semibold text-foreground">{selected.size}</span> / {remainingCapacity}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="btn btn-secondary btn-sm text-xs"
                  disabled={isPending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleEnroll}
                  disabled={selected.size === 0 || isPending}
                  className="btn btn-primary btn-sm text-xs"
                >
                  {isPending ? "Enrolling…" : `Enroll ${selected.size} Student${selected.size === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function DropStudentButton({
  batchId,
  studentId,
  studentName,
}: {
  batchId: string;
  studentId: string;
  studentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleDrop = () => {
    startTransition(async () => {
      const res = await dropStudentAction(batchId, studentId, reason);
      if (res.error) {
        showToast({ title: "Drop failed", message: res.error, type: "error" });
      } else {
        showToast({ title: "Student dropped", message: res.success || "Student dropped.", type: "success" });
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-ghost btn-sm text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)]"
        title="Drop from batch"
      >
        <UserMinus className="size-3.5" />
        <span className="hidden sm:inline">Drop</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 border border-[var(--border)] shadow-xl">
            <h3 className="text-sm font-semibold text-foreground">Drop student from batch?</h3>
            <p className="mt-1 text-xs text-muted">
              Are you sure you want to drop <span className="font-semibold text-foreground">{studentName}</span> from this batch?
              Historical attendance and previous test records are preserved.
            </p>

            <div className="mt-4">
              <label className="label text-xs">Reason (optional)</label>
              <input
                type="text"
                placeholder="e.g. Schedule conflict, student request"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="input text-xs w-full mt-1"
              />
            </div>

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
                onClick={handleDrop}
                disabled={isPending}
                className="btn btn-danger btn-sm text-xs"
              >
                {isPending ? "Dropping…" : "Drop student"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function TransferStudentButton({
  fromBatchId,
  studentId,
  studentName,
  targetBatches,
}: {
  fromBatchId: string;
  studentId: string;
  studentName: string;
  targetBatches: TargetBatchOption[];
}) {
  const [open, setOpen] = useState(false);
  const [toBatchId, setToBatchId] = useState(targetBatches[0]?.id || "");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleTransfer = () => {
    if (!toBatchId) return;
    startTransition(async () => {
      const res = await transferStudentAction(fromBatchId, toBatchId, studentId, reason);
      if (res.error) {
        showToast({ title: "Transfer failed", message: res.error, type: "error" });
      } else {
        showToast({ title: "Student transferred", message: res.success || "Transferred successfully.", type: "success" });
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={targetBatches.length === 0}
        className="btn btn-ghost btn-sm text-xs text-muted hover:text-foreground"
        title="Transfer to another batch"
      >
        <ArrowRightLeft className="size-3.5" />
        <span className="hidden sm:inline">Transfer</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 border border-[var(--border)] shadow-xl">
            <h3 className="text-sm font-semibold text-foreground">Transfer student</h3>
            <p className="mt-1 text-xs text-muted">
              Transfer <span className="font-semibold text-foreground">{studentName}</span> to another active batch in this institute.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="label text-xs">Destination Batch</label>
                <select
                  value={toBatchId}
                  onChange={(e) => setToBatchId(e.target.value)}
                  className="input text-xs w-full mt-1"
                >
                  {targetBatches.map((b) => {
                    const isFull = b.activeCount >= b.capacity;
                    return (
                      <option key={b.id} value={b.id} disabled={isFull}>
                        {b.name} ({b.code}) — {b.activeCount}/{b.capacity} {isFull ? "(FULL)" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="label text-xs">Transfer Reason (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Moved to morning batch"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="input text-xs w-full mt-1"
                />
              </div>
            </div>

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
                onClick={handleTransfer}
                disabled={!toBatchId || isPending}
                className="btn btn-primary btn-sm text-xs"
              >
                {isPending ? "Transferring…" : "Confirm Transfer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function CompleteBatchButton({
  batchId,
  batchName,
  activeCount,
}: {
  batchId: string;
  batchName: string;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleComplete = () => {
    startTransition(async () => {
      const res = await completeBatchAction(batchId);
      if (res.error) {
        showToast({ title: "Completion failed", message: res.error, type: "error" });
      } else {
        showToast({ title: "Batch completed", message: res.success || "Batch completed.", type: "success" });
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-sm text-xs flex items-center gap-1.5"
      >
        <CheckCircle2 className="size-3.5 text-[var(--success)]" />
        <span>Mark completed</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 border border-[var(--border)] shadow-xl">
            <h3 className="text-sm font-semibold text-foreground">Complete batch & term?</h3>
            <p className="mt-1 text-xs text-muted">
              Marking <span className="font-semibold text-foreground">{batchName}</span> as completed will set its status to COMPLETED and graduate all {activeCount} actively enrolled students to COMPLETED status.
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
