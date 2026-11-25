"use client";

import { useState } from "react";
import { BookOpen, Check, Search, X } from "lucide-react";
import { Field } from "@/components/ui/form-field";

interface SubjectOption {
  id: string;
  name: string;
  code?: string | null;
}

export function BatchMultiSubjectFields({
  subjects,
  initialSubjectIds = [],
}: {
  subjects: SubjectOption[];
  initialSubjectIds?: string[];
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSubjectIds);
  const [search, setSearch] = useState("");

  const filtered = subjects.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.code && s.code.toLowerCase().includes(search.toLowerCase()))
  );

  const toggleSubject = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const removeSubject = (id: string) => {
    setSelectedIds((prev) => prev.filter((item) => item !== id));
  };

  const selectAll = () => {
    setSelectedIds(subjects.map((s) => s.id));
  };

  const clearAll = () => {
    setSelectedIds([]);
  };

  return (
    <div className="sm:col-span-2 space-y-3">
      {/* Hidden inputs submitted with the form */}
      <input type="hidden" name="subjectId" value={selectedIds[0] || ""} />
      {selectedIds.map((id) => (
        <input key={id} type="hidden" name="subjectIds" value={id} />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="label text-xs font-medium block">
          Subjects (Multiple Selection)
          <span className="ml-1.5 text-[11px] text-muted font-normal">
            {selectedIds.length === 0
              ? "(General / Multi-Subject Cohort)"
              : `(${selectedIds.length} subject${selectedIds.length > 1 ? "s" : ""} selected)`}
          </span>
        </label>
        <div className="flex items-center gap-2">
          {subjects.length > 3 && (
            <>
              <button
                type="button"
                onClick={selectAll}
                className="text-[11px] text-[var(--brand)] hover:underline font-medium"
              >
                Select All
              </button>
              <span className="text-muted text-[10px]">•</span>
              <button
                type="button"
                onClick={clearAll}
                className="text-[11px] text-muted hover:text-[var(--text)]"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {/* Selected tags */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-[var(--surface-subtle)] border border-[var(--border)] rounded-lg">
          {selectedIds.map((id, index) => {
            const sub = subjects.find((s) => s.id === id);
            if (!sub) return null;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--brand)] text-white shadow-sm"
              >
                <BookOpen className="size-3" />
                <span>{sub.name}</span>
                {index === 0 && (
                  <span className="text-[9px] bg-black/20 px-1 py-0.2 rounded font-normal">
                    Primary
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeSubject(id)}
                  className="rounded hover:bg-black/20 p-0.5 ml-0.5"
                  aria-label={`Remove ${sub.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Subject selection grid */}
      <div className="border border-[var(--border)] rounded-xl p-3 bg-[var(--surface)] space-y-2">
        {subjects.length > 6 && (
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subjects..."
              className="input pl-8 py-1.5 text-xs w-full"
            />
          </div>
        )}

        {filtered.length === 0 ? (
          <p className="text-xs text-muted py-2 text-center">No subjects match search.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto pr-1">
            {filtered.map((s) => {
              const isChecked = selectedIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleSubject(s.id)}
                  className={`flex items-center justify-between p-2 rounded-lg text-left text-xs transition border ${
                    isChecked
                      ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)] font-medium"
                      : "border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text)]"
                  }`}
                >
                  <span className="truncate">
                    {s.name} {s.code ? `(${s.code})` : ""}
                  </span>
                  {isChecked && <Check className="size-3.5 shrink-0 ml-1 text-[var(--brand)]" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted">
        Multiple subjects automatically sync with SyllabusTrack & Examination modules.
      </p>
    </div>
  );
}
