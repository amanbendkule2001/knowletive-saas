"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  FileCheck,
} from "lucide-react";
import { importStudentsAction } from "@/actions/students";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/validation";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function StudentImportForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    importStudentsAction,
    {},
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Trigger toast notifications on success or failure
  useEffect(() => {
    if (state?.success) {
      toast.success(state.success, "Import Successful");
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } else if (state?.error) {
      const isAccessDenied =
        /denied|permission|access|unauthorized|not authorized|restricted/i.test(state.error);
      if (isAccessDenied) {
        toast.error(state.error, "Permission Denied");
      } else {
        toast.error(state.error, "Import Failed");
      }
    }
  }, [state]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    } else {
      setSelectedFile(null);
    }
  };

  const handleRemoveFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (fileInputRef.current) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInputRef.current.files = dataTransfer.files;
      }
      setSelectedFile(file);
    }
  };

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {/* Error Banner */}
      {state?.error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-soft)] px-3.5 py-3 text-[13px] text-[var(--danger)]"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">{state.error}</p>
          </div>
        </div>
      )}

      {/* Success Banner */}
      {state?.success && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--success-soft)] px-3.5 py-3 text-[13px] text-[var(--success)]"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{state.success}</span>
        </div>
      )}

      {/* File Upload Zone */}
      {selectedFile ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="flex flex-col items-center justify-center rounded-xl border-2 border-solid border-[var(--brand)] bg-[var(--surface-2)] p-6 text-center transition"
        >
          <span className="grid size-12 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <FileCheck className="size-6" />
          </span>
          <div className="mt-3 max-w-full px-2">
            <p
              className="text-sm font-semibold text-[var(--text)] truncate max-w-[280px] sm:max-w-[340px]"
              title={selectedFile.name}
            >
              {selectedFile.name}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {formatFileSize(selectedFile.size)} · Ready to import
            </p>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <label
              htmlFor="file"
              className="btn btn-secondary btn-sm cursor-pointer"
            >
              <Upload className="size-3.5" /> Change file
            </label>
            <button
              type="button"
              onClick={handleRemoveFile}
              className="btn btn-ghost btn-sm text-muted hover:text-[var(--danger)]"
            >
              <X className="size-3.5" /> Remove
            </button>
          </div>
          <input
            ref={fileInputRef}
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={handleFileChange}
            required
          />
        </div>
      ) : (
        <label
          htmlFor="file"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition",
            isDragging
              ? "border-[var(--brand)] bg-[var(--surface-2)]"
              : "border-[var(--border-strong)] hover:border-[var(--brand)] hover:bg-[var(--surface-2)]",
          )}
        >
          <span className="grid size-11 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <FileSpreadsheet className="size-5" />
          </span>
          <span className="mt-3 text-sm font-semibold">Choose a .csv file</span>
          <span className="mt-1 text-xs text-muted">
            Export from Excel or Google Sheets with a header row
          </span>
          <input
            ref={fileInputRef}
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={handleFileChange}
            required
          />
          <span className="btn btn-secondary btn-sm mt-4">
            <Upload className="size-3.5" /> Browse files
          </span>
        </label>
      )}

      {/* Common default password for portal accounts */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5 space-y-1.5">
        <label htmlFor="defaultPassword" className="text-xs font-medium text-[var(--text)]">
          Common default password for Student & Parent accounts
        </label>
        <input
          id="defaultPassword"
          name="defaultPassword"
          type="text"
          defaultValue="Admin@123"
          className="input text-xs"
          placeholder="e.g. Admin@123"
        />
        <p className="text-[11px] text-muted leading-relaxed">
          Dashboard login accounts will be automatically created. Students can sign in using their admission number or email, and parents can sign in using their phone or email with this password.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {pending ? "Importing…" : "Import students"}
        </button>
        <Link href="/app/students" className="btn btn-ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
