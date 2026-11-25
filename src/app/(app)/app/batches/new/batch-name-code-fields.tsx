"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Field } from "@/components/ui/form-field";

function generateCodeFromName(val: string): string {
  const clean = val.trim();
  if (!clean) return "";

  const words = clean.split(/\s+/).filter(Boolean);
  const yearMatch = clean.match(/\b(20\d\d)\b/);
  const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();

  if (words.length === 1) {
    const w = words[0].replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    return `${w.slice(0, 4)}-${year}-A`;
  }

  // Multi-word: take 3 chars of first word + 3 chars of second word
  const parts: string[] = [];
  for (const w of words) {
    const stripped = w.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (stripped && !/^\d{4}$/.test(stripped)) {
      parts.push(stripped.slice(0, 3));
    }
    if (parts.length >= 2) break;
  }

  if (parts.length === 0) {
    return `BATCH-${year}-A`;
  }

  return `${parts.join("-")}-${yearMatch ? year : "A"}`;
}

export function BatchNameCodeFields({
  initialName = "",
  initialCode = "",
}: {
  initialName?: string;
  initialCode?: string;
}) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const [isManual, setIsManual] = useState(Boolean(initialCode));

  const handleNameChange = (val: string) => {
    setName(val);
    if (!isManual) {
      const generated = generateCodeFromName(val);
      setCode(generated);
    }
  };

  const regenerateCode = () => {
    const generated = generateCodeFromName(name);
    setCode(generated);
    setIsManual(false);
  };

  return (
    <>
      <Field label="Batch name" htmlFor="name" required hint="e.g. Physics Advanced JEE 2026">
        <input
          id="name"
          name="name"
          type="text"
          required
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Physics Advanced 2026"
          className="input text-xs w-full font-medium"
        />
      </Field>

      <Field
        label="Batch code"
        htmlFor="code"
        required
        hint="Auto-generated from name. You can customize anytime (e.g. PHY-ADV-A)."
      >
        <div className="relative">
          <input
            id="code"
            name="code"
            type="text"
            required
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().replace(/[^A-Za-z0-9-_]/g, ""));
              setIsManual(true);
            }}
            placeholder="PHY-ADV-A"
            className="input font-mono uppercase text-xs w-full pr-8 font-semibold tracking-wide"
          />
          {name.trim() && (
            <button
              type="button"
              onClick={regenerateCode}
              title="Regenerate code from name"
              className="absolute right-2 top-2 p-1 text-muted hover:text-[var(--brand)] transition rounded"
            >
              <Sparkles className="size-3.5" />
            </button>
          )}
        </div>
      </Field>
    </>
  );
}
