"use client";

import React, { useRef, useEffect } from "react";
import { ArrowUp, Square } from "lucide-react";

interface Props {
  input: string;
  setInput: (val: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

export function CopilotInput({
  input,
  setInput,
  onSend,
  onStop,
  isStreaming,
  disabled,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && input.trim() && !disabled) {
        onSend();
      }
    }
  };

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="relative flex items-end rounded-xl border border-[var(--border)] bg-[var(--surface-2,var(--surface))] p-1.5 focus-within:border-[var(--brand)] focus-within:ring-1 focus-within:ring-[var(--brand)] transition-all">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question or query data…"
          rows={1}
          disabled={disabled}
          maxLength={4000}
          className="w-full resize-none bg-transparent px-2.5 py-1 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none max-h-28"
        />

        <div className="flex items-center gap-1 shrink-0 pb-0.5">
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="grid size-7 place-items-center rounded-lg bg-[var(--danger,#f43f5e)] text-white hover:opacity-90 transition-opacity"
              title="Stop generating"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={!input.trim() || disabled}
              className="grid size-7 place-items-center rounded-lg bg-[var(--brand)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
              title="Send message (Enter)"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-[var(--muted)]">
        <span>Press <kbd className="font-mono">Enter</kbd> to send, <kbd className="font-mono">Shift+Enter</kbd> for newline</span>
        {input.length > 3000 && <span>{input.length} / 4000</span>}
      </div>
    </div>
  );
}
