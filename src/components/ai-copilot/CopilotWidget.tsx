"use client";

import React, { useState, useEffect } from "react";
import { Bot, Sparkles, ChevronLeft } from "lucide-react";
import { CopilotPanel } from "./CopilotPanel";

interface Props {
  hasAccess: boolean;
  tenantName?: string;
  roleKey?: string;
  canViewFees?: boolean;
}

export function CopilotWidget({ hasAccess, tenantName, roleKey, canViewFees }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  // Keyboard shortcut listener: Ctrl+J / Cmd+J to toggle, Escape to close
  useEffect(() => {
    if (!hasAccess) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasAccess, isOpen]);

  // If user does not have AI Copilot access, do not render floating widget
  if (!hasAccess) {
    return null;
  }

  return (
    <>
      {/* Docked Edge Trigger: tucked behind the right edge, reveals on hover/focus/tap */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-24 right-0 z-40 group flex items-center gap-2.5 rounded-l-full rounded-r-none bg-[var(--brand)] pl-2.5 pr-4 py-3 text-white shadow-xl hover:shadow-2xl border-y border-l border-white/20 transition-all duration-300 ease-out translate-x-[calc(100%-24px)] hover:translate-x-0 focus-visible:translate-x-0 active:scale-95 cursor-pointer"
          title="Open AI Copilot (Ctrl + J)"
          aria-label="Open Knowletive AI Copilot"
        >
          {/* Edge tab handle / chevron indicator */}
          <div className="flex items-center justify-center text-white/80 group-hover:text-white transition-colors">
            <ChevronLeft className="size-3.5 transition-transform duration-300 group-hover:rotate-180 group-hover:opacity-60 animate-pulse group-hover:animate-none" />
          </div>

          {/* Bot icon with sparkles (tucked behind right edge until hovered/focused) */}
          <div className="relative shrink-0">
            <Bot className="size-5 transition-transform duration-300 group-hover:scale-110" />
            <Sparkles className="absolute -top-1.5 -right-1.5 size-3 text-amber-300 animate-pulse" />
          </div>

          {/* Copilot label */}
          <span className="text-xs font-semibold tracking-wide whitespace-nowrap">
            Copilot
          </span>

          {/* Keyboard shortcut hint */}
          <span className="hidden sm:inline rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-mono opacity-80 group-hover:opacity-100 whitespace-nowrap">
            Ctrl+J
          </span>
        </button>
      )}

      {/* Floating Copilot Drawer Panel */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 z-50 w-[420px] max-w-[calc(100vw-2rem)] h-[620px] max-h-[calc(100vh-2rem)] rounded-2xl shadow-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-5 duration-200">
          <CopilotPanel
            onClose={() => setIsOpen(false)}
            tenantName={tenantName}
            roleKey={roleKey}
            canViewFees={canViewFees}
          />
        </div>
      )}
    </>
  );
}

export default CopilotWidget;
