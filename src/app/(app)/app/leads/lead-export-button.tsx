"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/toast";

interface LeadExportButtonProps {
  status?: string;
  q?: string;
  total: number;
}

export function LeadExportButton({ status, q, total }: LeadExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (total === 0 || isExporting) return;
    setIsExporting(true);

    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (q) params.set("q", q);
      const url = `/app/leads/export${params.toString() ? `?${params.toString()}` : ""}`;

      const res = await fetch(url);
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || `Export failed with status ${res.status}`);
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("content-disposition");
      let filename = `knowletive-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      toast.success("Leads exported successfully.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to export leads. Please try again.",
        "Export Failed",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const isOverLimit = total > 5000;
  const isDisabled = total === 0 || isExporting || isOverLimit;

  let buttonTitle = "Export matching leads to CSV";
  if (total === 0) {
    buttonTitle = "No leads matching the current filter to export";
  } else if (isOverLimit) {
    buttonTitle = `Matching ${total} leads exceeds export limit of 5,000. Please narrow search or status filters.`;
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={isDisabled}
      aria-label="Export Leads CSV"
      title={buttonTitle}
      className="btn btn-secondary"
    >
      {isExporting ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Download className="size-3.5" />
      )}
      <span>{isExporting ? "Exporting..." : "Export CSV"}</span>
    </button>
  );
}
