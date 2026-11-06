"use client";

import { Moon, Sun } from "lucide-react";

export function ThemeToggle({ className = "" }: { className?: string }) {
  function toggle() {
    const root = document.documentElement;
    const dark = root.classList.toggle("dark");
    try {
      localStorage.setItem("kl-theme", dark ? "dark" : "light");
    } catch {
      /* storage can be blocked — theme still applies for this session */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`btn btn-ghost btn-icon ${className}`}
      aria-label="Toggle dark mode"
      title="Toggle theme"
    >
      <Moon className="size-4 dark:hidden" />
      <Sun className="hidden size-4 dark:block" />
    </button>
  );
}
