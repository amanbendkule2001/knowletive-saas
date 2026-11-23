"use client";

import React, { useEffect, useRef } from "react";
import { Bot, Sparkles } from "lucide-react";
import { CopilotMessage, MessageItem } from "./CopilotMessage";
import { CopilotSuggestions } from "./CopilotSuggestions";

interface Props {
  messages: MessageItem[];
  isStreaming: boolean;
  onSelectSuggestion: (prompt: string) => void;
  tenantName?: string;
  roleKey?: string;
  canViewFees?: boolean;
}

export function CopilotMessages({
  messages,
  isStreaming,
  onSelectSuggestion,
  tenantName,
  roleKey,
  canViewFees = true,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const isTeacher = roleKey === "TEACHER";

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-between overflow-y-auto p-4">
        <div className="my-auto flex flex-col items-center text-center space-y-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-[var(--brand-surface,rgba(79,70,229,0.1))] text-[var(--brand)] shadow-sm">
            <Bot className="size-6" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">
              Knowletive AI Copilot
            </h3>
            <p className="text-xs text-[var(--muted)] max-w-xs mt-1">
              {isTeacher
                ? `Ask questions about ${tenantName || "your institute"}'s batch attendance, student attendance records, and teaching progress.`
                : `Ask questions about ${tenantName || "your institute"}'s student census, attendance patterns, and financial overviews.`}
            </p>
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--border)]">
          <CopilotSuggestions
            onSelect={onSelectSuggestion}
            roleKey={roleKey}
            canViewFees={canViewFees}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-1">
      {messages.map((msg) => (
        <CopilotMessage key={msg.id} message={msg} />
      ))}

      {isStreaming && (
        <div className="flex items-center gap-2 py-2 text-xs text-[var(--muted)]">
          <div className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-[var(--brand)] animate-bounce [animation-delay:-0.3s]" />
            <span className="size-1.5 rounded-full bg-[var(--brand)] animate-bounce [animation-delay:-0.15s]" />
            <span className="size-1.5 rounded-full bg-[var(--brand)] animate-bounce" />
          </div>
          <span className="text-[11px]">Analyzing grounded data…</span>
        </div>
      )}
    </div>
  );
}
