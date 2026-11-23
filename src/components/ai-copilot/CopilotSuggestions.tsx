"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

interface Props {
  onSelect: (prompt: string) => void;
  roleKey?: string;
  canViewFees?: boolean;
}

export function CopilotSuggestions({ onSelect, roleKey, canViewFees = true }: Props) {
  const pathname = usePathname() || "/app";
  const isTeacher = roleKey === "TEACHER";

  let suggestions: string[] = [];

  if (isTeacher) {
    if (pathname.includes("/attendance") || pathname.includes("/batches")) {
      suggestions = [
        "Summarize attendance for my assigned batches",
        "Identify students with attendance below 75%",
        "Which students were absent recently in my batches?",
      ];
    } else if (pathname.includes("/syllabus")) {
      suggestions = [
        "What is our syllabus progress?",
        "Show lesson plans for my subjects",
        "Summarize attendance for my assigned batches",
      ];
    } else {
      suggestions = [
        "Summarize attendance for my assigned batches",
        "Identify students with attendance below 75%",
        "Which students were absent recently in my batches?",
      ];
    }
  } else if (pathname.includes("/attendance")) {
    suggestions = [
      "Summarize today's attendance figures",
      "Identify students with attendance below 75%",
      "How many students were marked late?",
    ];
  } else if (pathname.includes("/fees") && canViewFees) {
    suggestions = [
      "What is our total outstanding fee balance?",
      "Show overdue fee invoice summary",
      "Which class has the largest unpaid balance?",
    ];
  } else if (pathname.includes("/students")) {
    suggestions = [
      "What is our total student strength?",
      "Break down student enrollment by class",
      "Identify students with attendance below 75%",
    ];
  } else if (pathname.includes("/exams")) {
    suggestions = [
      "Summarize recent exam results",
      "Which subject had the lowest pass percentage?",
      "Show grade distribution breakdown",
    ];
  } else {
    // Default dashboard prompts
    suggestions = [
      "What is our current student strength?",
      "Summarize today's attendance",
      ...(canViewFees ? ["Show outstanding fees summary"] : ["Identify students with attendance below 75%"]),
    ];
  }

  return (
    <div className="flex flex-col gap-1.5 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted)]">
        <Sparkles className="size-3 text-[var(--brand)]" />
        <span>Suggested questions:</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((prompt, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(prompt)}
            className="rounded-full border border-[var(--border)] bg-[var(--surface-2,var(--surface))] px-2.5 py-1 text-left text-xs text-[var(--foreground)] hover:border-[var(--brand)] hover:bg-[var(--hover-surface)] transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
