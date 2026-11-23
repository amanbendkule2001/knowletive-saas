"use client";

import React from "react";
import { Bot, Plus, History, X } from "lucide-react";

interface Props {
  onNewChat: () => void;
  onToggleHistory: () => void;
  onClose: () => void;
  showHistory: boolean;
  currentThreadTitle?: string;
}

export function CopilotHeader({
  onNewChat,
  onToggleHistory,
  onClose,
  showHistory,
  currentThreadTitle,
}: Props) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 select-none">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="relative grid size-8 place-items-center rounded-xl bg-[var(--brand)] text-white shadow-sm shrink-0">
          <Bot className="size-4" />
          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--surface)] bg-emerald-500" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-semibold text-[var(--foreground)] truncate">
              Knowletive Copilot
            </h3>
            <span className="rounded bg-emerald-500/10 px-1 py-0.2 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
              Live
            </span>
          </div>
          <p className="text-[10px] text-[var(--muted)] truncate max-w-[160px]">
            {currentThreadTitle || "Grounded AI Assistant"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onNewChat}
          className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover-surface)] hover:text-[var(--foreground)] transition-colors"
          title="Start new chat"
        >
          <Plus className="size-4" />
        </button>
        <button
          type="button"
          onClick={onToggleHistory}
          className={`grid size-7 place-items-center rounded-lg transition-colors ${
            showHistory
              ? "bg-[var(--brand-surface,rgba(79,70,229,0.1))] text-[var(--brand)]"
              : "text-[var(--muted)] hover:bg-[var(--hover-surface)] hover:text-[var(--foreground)]"
          }`}
          title="Conversation history"
        >
          <History className="size-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover-surface)] hover:text-[var(--foreground)] transition-colors"
          title="Close Copilot"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
