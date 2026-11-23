"use client";

import React, { useState } from "react";
import { Database, AlertCircle, ChevronDown, ChevronUp, CheckCircle } from "lucide-react";

export interface ToolSourceItem {
  toolName: string;
  success: boolean;
  code?: string;
  data?: unknown;
  disclaimer?: string;
}

interface Props {
  sources: ToolSourceItem[];
}

export function CopilotSourceReference({ sources }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!sources || sources.length === 0) return null;

  const hasDisclaimer = sources.some((s) => s.disclaimer);

  return (
    <div className="mt-2 space-y-1 text-xs">
      {/* Explicit Disclaimer Alert if attendance fallback or previous date used */}
      {sources.map((s, idx) => {
        if (!s.disclaimer) return null;
        return (
          <div
            key={idx}
            className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300"
          >
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            <span className="text-[11px] leading-tight">{s.disclaimer}</span>
          </div>
        );
      })}

      {/* Accordion toggle for verified tool grounding */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--muted)] hover:bg-[var(--hover-surface)] hover:text-[var(--foreground)] transition-colors"
      >
        <Database className="size-3 text-[var(--brand)]" />
        <span>Grounding Sources ({sources.length} tool{sources.length === 1 ? "" : "s"})</span>
        {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      </button>

      {expanded && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2,var(--surface))] p-2.5 space-y-2 text-[11px] animate-in fade-in">
          {sources.map((s, i) => {
            const isRestricted =
              !s.success &&
              (s.code === "DENIED" ||
                s.code === "DOMAIN_READ_DENIED" ||
                s.code === "BATCH_ACCESS_DENIED");
            return (
              <div key={i} className="flex items-center justify-between border-b border-[var(--border)] pb-1.5 last:border-none last:pb-0">
                <div className="flex items-center gap-1.5 font-mono">
                  {s.success ? (
                    <CheckCircle className="size-3 text-emerald-500 shrink-0" />
                  ) : isRestricted ? (
                    <AlertCircle className="size-3 text-amber-500 shrink-0" />
                  ) : (
                    <AlertCircle className="size-3 text-rose-500 shrink-0" />
                  )}
                  <span className="font-semibold text-[var(--foreground)]">{s.toolName}</span>
                </div>
                <span className="text-[10px] text-[var(--muted)]">
                  {s.success ? "Verified Ground Truth" : isRestricted ? "Access Restricted" : "Execution Failed"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
