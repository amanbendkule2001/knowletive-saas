"use client";

import { useState, useRef, type ChangeEvent } from "react";
import { Upload, Loader2, Download, AlertTriangle, CheckCircle2, XCircle, X } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { importLeadsCsvAction } from "@/actions/leads";
import { generateSampleLeadsCsv, type LeadImportSummary } from "@/lib/leads-import";

export function LeadImportButton() {
  const [isImporting, setIsImporting] = useState(false);
  const [summary, setSummary] = useState<LeadImportSummary | null>(null);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      toast.error("Please upload a valid .csv file.", "Invalid File Format");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsImporting(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await importLeadsCsvAction(formData);
      if (res.ok) {
        toast.success(res.message, "Import Complete");
        if (res.summary) {
          setSummary(res.summary);
          setShowSummaryModal(true);
        }
      } else {
        toast.error(res.error, "Import Failed");
        if (res.summary && (res.summary.failed > 0 || res.summary.duplicates > 0)) {
          setSummary(res.summary);
          setShowSummaryModal(true);
        }
      }
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to import leads. Please try again.",
        "Import Error",
      );
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const downloadSampleTemplate = () => {
    const csvContent = generateSampleLeadsCsv();
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sample-leads-template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleFileSelect}
        aria-label="Upload Leads CSV File"
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isImporting}
        aria-label="Import Leads CSV"
        title="Import leads from a CSV file"
        className="btn btn-secondary"
      >
        {isImporting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Upload className="size-3.5" />
        )}
        <span>{isImporting ? "Importing…" : "Import CSV"}</span>
      </button>

      {/* Import Summary Modal */}
      {showSummaryModal && summary && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-summary-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in"
        >
          <div className="relative w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-[var(--border)]">
              <div>
                <h3 id="import-summary-title" className="text-base font-semibold leading-none">
                  Leads CSV Import Summary
                </h3>
                <p className="mt-1 text-xs text-muted">
                  Batch processing report for your uploaded CSV file.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSummaryModal(false)}
                className="rounded-lg p-1.5 text-muted hover:bg-[var(--surface-2)] hover:text-foreground"
                aria-label="Close summary modal"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Metrics cards */}
            <div className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-center">
                <span className="text-xs text-muted">Total Rows</span>
                <p className="mt-1 text-xl font-bold">{summary.total}</p>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-center text-emerald-600 dark:text-emerald-400">
                <span className="text-xs font-medium flex items-center justify-center gap-1">
                  <CheckCircle2 className="size-3" /> Imported
                </span>
                <p className="mt-1 text-xl font-bold">{summary.imported}</p>
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-center text-amber-600 dark:text-amber-400">
                <span className="text-xs font-medium flex items-center justify-center gap-1">
                  <AlertTriangle className="size-3" /> Skipped / Dupes
                </span>
                <p className="mt-1 text-xl font-bold">{summary.duplicates}</p>
              </div>

              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-center text-rose-600 dark:text-rose-400">
                <span className="text-xs font-medium flex items-center justify-center gap-1">
                  <XCircle className="size-3" /> Failed
                </span>
                <p className="mt-1 text-xl font-bold">{summary.failed}</p>
              </div>
            </div>

            {/* Detailed Row Errors */}
            {summary.errors.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">
                  Row Validation & Duplicate Details ({summary.errors.length})
                </h4>
                <div className="max-h-56 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-2)] divide-y divide-[var(--border)] text-xs">
                  {summary.errors.map((err, idx) => (
                    <div key={idx} className="p-2.5 flex items-start gap-2">
                      <span className="badge badge-neutral shrink-0 text-[10px]">
                        Row {err.row}
                      </span>
                      {err.field && (
                        <span className="font-semibold text-muted shrink-0">
                          [{err.field}]
                        </span>
                      )}
                      <span className="text-[var(--text)] leading-relaxed flex-1">
                        {err.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Modal actions */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={downloadSampleTemplate}
                className="btn btn-secondary btn-sm"
              >
                <Download className="size-3.5" /> Download Sample Template
              </button>
              <button
                type="button"
                onClick={() => setShowSummaryModal(false)}
                className="btn btn-primary btn-sm"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
