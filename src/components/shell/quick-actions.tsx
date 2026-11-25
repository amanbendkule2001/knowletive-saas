"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Banknote,
  CalendarCheck2,
  ChevronDown,
  Layers,
  Megaphone,
  Plus,
  UserCheck,
  UserPlus,
} from "lucide-react";

export function QuickActionsDropdown() {
  const [open, setOpen] = useState(false);

  const actions = [
    {
      label: "New Admission",
      description: "Direct student enrollment & fee setup",
      href: "/app/students/new",
      icon: UserPlus,
      color: "text-blue-500 bg-blue-500/10",
    },
    {
      label: "New Lead / Enquiry",
      description: "Capture inquiry & auto-fill lead",
      href: "/app/leads",
      icon: UserCheck,
      color: "text-amber-500 bg-amber-500/10",
    },
    {
      label: "Collect Fee",
      description: "Record offline fee payment",
      href: "/app/fees",
      icon: Banknote,
      color: "text-emerald-500 bg-emerald-500/10",
    },
    {
      label: "Mark Attendance",
      description: "Daily batch & student check-in",
      href: "/app/attendance",
      icon: CalendarCheck2,
      color: "text-purple-500 bg-purple-500/10",
    },
    {
      label: "Create Batch",
      description: "Setup new academic batch",
      href: "/app/batches/new",
      icon: Layers,
      color: "text-indigo-500 bg-indigo-500/10",
    },
    {
      label: "Send Announcement",
      description: "Broadcast message to students",
      href: "/app/announcements",
      icon: Megaphone,
      color: "text-rose-500 bg-rose-500/10",
    },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand)] px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-95 sm:px-3"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Plus className="size-3.5 stroke-[2.5]" />
        <span className="hidden sm:inline">Quick Action</span>
        <ChevronDown className="size-3 opacity-80" />
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-30 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className="animate-in absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl">
            <div className="px-2 py-1.5 border-b border-[var(--border)] mb-1">
              <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                Instant Actions
              </span>
            </div>
            <div className="space-y-0.5">
              {actions.map((act) => {
                const Icon = act.icon;
                return (
                  <Link
                    key={act.href + act.label}
                    href={act.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg p-2 transition hover:bg-[var(--surface-hover)] group"
                  >
                    <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${act.color}`}>
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--text)] group-hover:text-[var(--brand)]">
                        {act.label}
                      </p>
                      <p className="truncate text-[10px] text-muted">
                        {act.description}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
