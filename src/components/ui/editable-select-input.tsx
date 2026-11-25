"use client";

import { useState, useEffect } from "react";
import { Sparkles, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EditableSelectOption {
  value: string;
  label: string;
}

interface EditableSelectInputProps {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  options: EditableSelectOption[];
  dropdownPlaceholder?: string;
  quickChips?: string[];
  helperText?: string;
  className?: string;
}

export function EditableSelectInput({
  name,
  defaultValue = "",
  placeholder = "Type or select...",
  required = false,
  options,
  dropdownPlaceholder = "Pick from list…",
  quickChips,
  helperText,
  className,
}: EditableSelectInputProps) {
  const [val, setVal] = useState(defaultValue);

  useEffect(() => {
    setVal(defaultValue);
  }, [defaultValue]);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        {/* Directly editable text input */}
        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            name={name}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={placeholder}
            required={required}
            className="input w-full pr-8 text-sm"
          />
          {val ? (
            <button
              type="button"
              onClick={() => setVal("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-[var(--text)] transition p-0.5 rounded"
              title="Clear input"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        {/* Preset dropdown selector */}
        <div className="sm:w-56 shrink-0">
          <div className="relative">
            <select
              className="select w-full text-xs cursor-pointer pr-8 font-medium"
              value={options.some((o) => o.value.toLowerCase() === val.toLowerCase()) ? val : ""}
              onChange={(e) => {
                if (e.target.value) {
                  setVal(e.target.value);
                }
              }}
            >
              <option value="">{dropdownPlaceholder}</option>
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Quick selection chips if provided */}
      {quickChips && quickChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-muted flex items-center gap-1 font-medium">
            <Sparkles className="size-3 text-[var(--brand)]" /> Quick pick:
          </span>
          {quickChips.map((chip) => {
            const isSelected = val.toLowerCase() === chip.toLowerCase();
            return (
              <button
                key={chip}
                type="button"
                onClick={() => setVal(chip)}
                className={cn(
                  "px-2 py-0.5 text-[11px] rounded-md border transition font-medium",
                  isSelected
                    ? "bg-[var(--brand-soft)] border-[var(--brand)] text-[var(--brand)] shadow-sm"
                    : "bg-[var(--surface-sunken)] border-[var(--border)] text-muted hover:text-[var(--text)] hover:border-[var(--border-strong)]"
                )}
              >
                {chip}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Helper text */}
      <p className="text-[11px] text-muted flex items-center justify-between">
        <span>{helperText || "✏️ Editable text — select from dropdown or type any custom value"}</span>
        {val ? (
          <span className="text-[var(--brand)] font-semibold truncate max-w-[200px] ml-2">
            Selected: {val}
          </span>
        ) : null}
      </p>
    </div>
  );
}
