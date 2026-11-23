"use client";

import React from "react";

interface CopilotDataTableProps {
  headers: string[];
  rows: (string | number)[][];
  title?: string;
}

export function CopilotDataTable({ headers, rows, title }: CopilotDataTableProps) {
  if (!rows || rows.length === 0) return null;

  return (
    <div className="my-2.5 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2,var(--surface))] text-xs">
      {title && (
        <div className="border-b border-[var(--border)] bg-[var(--muted-surface,var(--surface-2))] px-3 py-1.5 font-semibold text-[var(--foreground)]">
          {title}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          {headers && headers.length > 0 && (
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted-surface,var(--surface-2))] text-[11px] font-medium text-[var(--muted)]">
                {headers.map((h, i) => (
                  <th key={i} className="px-3 py-1.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-[var(--hover-surface)] transition-colors">
                {row.map((cell, cIdx) => (
                  <td
                    key={cIdx}
                    className={`px-3 py-1.5 ${
                      typeof cell === "number" ? "font-mono tabular-nums text-right" : ""
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
