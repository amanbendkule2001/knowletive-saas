"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus, Sliders, Trash2, X } from "lucide-react";
import { createGradeScaleAction, deleteGradeScaleAction } from "@/actions/exams";

type BandInput = {
  letterGrade: string;
  gradePoint: number;
  minPercentage: number;
  maxPercentage: number;
  isPassing: boolean;
  remarks: string;
  order: number;
};

export function CreateGradeScaleModal() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const [bands, setBands] = useState<BandInput[]>([
    { letterGrade: "A+", gradePoint: 10, minPercentage: 90, maxPercentage: 100, isPassing: true, remarks: "Outstanding", order: 1 },
    { letterGrade: "A", gradePoint: 9, minPercentage: 80, maxPercentage: 89.99, isPassing: true, remarks: "Excellent", order: 2 },
    { letterGrade: "B", gradePoint: 7, minPercentage: 60, maxPercentage: 79.99, isPassing: true, remarks: "Good", order: 3 },
    { letterGrade: "C", gradePoint: 5, minPercentage: 40, maxPercentage: 59.99, isPassing: true, remarks: "Pass", order: 4 },
    { letterGrade: "F", gradePoint: 0, minPercentage: 0, maxPercentage: 39.99, isPassing: false, remarks: "Fail", order: 5 },
  ]);

  const addBand = () => {
    setBands((prev) => [
      ...prev,
      {
        letterGrade: "D",
        gradePoint: 4,
        minPercentage: 33,
        maxPercentage: 39.99,
        isPassing: true,
        remarks: "Marginal Pass",
        order: prev.length + 1,
      },
    ]);
  };

  const removeBand = (idx: number) => {
    setBands((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateBand = <K extends keyof BandInput>(idx: number, field: K, val: BandInput[K]) => {
    setBands((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  const handleSave = () => {
    setError(null);
    if (!name.trim() || !code.trim()) {
      setError("Name and code are required.");
      return;
    }
    if (bands.length < 2) {
      setError("At least two grade bands are required.");
      return;
    }

    startTransition(async () => {
      const res = await createGradeScaleAction({
        name,
        code,
        description: description || null,
        isDefault,
        bands,
      });

      if (!res.ok) {
        setError(res.error || "Failed to create grade scale.");
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
        className="btn btn-primary text-sm flex items-center gap-1.5"
      >
        <Plus className="h-4 w-4" /> Create Grading Scale
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-3xl max-h-[90vh] flex flex-col p-6 shadow-2xl bg-base-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Sliders className="h-5 w-5 text-indigo-500" />
                Configure New Performance Grading Scale
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-sm p-1 text-zinc-400 hover:text-zinc-600"
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Scale Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!code) setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 20));
                    }}
                    placeholder="e.g. ICSE 7-Band Scale"
                    className="input input-bordered w-full text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Scale Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="e.g. ICSE-7"
                    className="input input-bordered w-full text-sm mt-1 font-mono uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Description
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional notes or board standard references..."
                  className="input input-bordered w-full text-xs mt-1"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="checkbox checkbox-sm checkbox-primary"
                />
                <label htmlFor="isDefault" className="text-xs text-zinc-700 dark:text-zinc-300 font-medium">
                  Set as default grading scale for future examinations
                </label>
              </div>

              {/* Bands List */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    Grade Bands ({bands.length})
                  </h4>
                  <button
                    type="button"
                    onClick={addBand}
                    className="btn btn-outline btn-xs flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add Band
                  </button>
                </div>

                <div className="space-y-2">
                  {bands.map((band, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700/60 grid grid-cols-2 md:grid-cols-6 gap-2 items-center text-xs"
                    >
                      <div>
                        <span className="text-zinc-400 block text-[10px]">Letter</span>
                        <input
                          type="text"
                          value={band.letterGrade}
                          onChange={(e) => updateBand(idx, "letterGrade", e.target.value)}
                          className="input input-bordered input-xs w-full font-bold"
                        />
                      </div>
                      <div>
                        <span className="text-zinc-400 block text-[10px]">Min %</span>
                        <input
                          type="number"
                          step="0.01"
                          value={band.minPercentage}
                          onChange={(e) => updateBand(idx, "minPercentage", Number(e.target.value))}
                          className="input input-bordered input-xs w-full font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-zinc-400 block text-[10px]">Max %</span>
                        <input
                          type="number"
                          step="0.01"
                          value={band.maxPercentage}
                          onChange={(e) => updateBand(idx, "maxPercentage", Number(e.target.value))}
                          className="input input-bordered input-xs w-full font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-zinc-400 block text-[10px]">Grade Point</span>
                        <input
                          type="number"
                          step="0.1"
                          value={band.gradePoint}
                          onChange={(e) => updateBand(idx, "gradePoint", Number(e.target.value))}
                          className="input input-bordered input-xs w-full font-mono"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 pt-3">
                        <input
                          type="checkbox"
                          checked={band.isPassing}
                          onChange={(e) => updateBand(idx, "isPassing", e.target.checked)}
                          className="checkbox checkbox-xs checkbox-success"
                        />
                        <span className="text-[11px]">Pass</span>
                      </div>
                      <div className="text-right pt-3">
                        {bands.length > 2 && (
                          <button
                            type="button"
                            onClick={() => removeBand(idx)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
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
                {isPending ? "Saving..." : "Save Grading Scale"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function DeleteGradeScaleButton({ scaleId, scaleName }: { scaleId: string; scaleName: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleDelete = () => {
    if (!confirm(`Are you sure you want to delete scale '${scaleName}'?`)) return;

    startTransition(async () => {
      const res = await deleteGradeScaleAction(scaleId);
      if (!res.ok) {
        alert(res.error || "Failed to delete grading scale.");
      } else {
        router.refresh();
      }
    });
  };

  return (
    <button
      onClick={handleDelete}
      disabled={isPending}
      className="btn btn-ghost btn-xs text-red-500 hover:text-red-700"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

