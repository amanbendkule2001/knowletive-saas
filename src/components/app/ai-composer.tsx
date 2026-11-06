"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import type { AiFeatureDef } from "@/lib/catalog";
import type { FormState } from "@/lib/validation";
import { runAiAction } from "@/actions/operations";
import { cn } from "@/lib/utils";

/**
 * Module picker + prompt box. Kept as a client island so the selected module
 * can update the placeholder and credit cost without shipping the rest of the
 * page to the browser.
 */
export function AiComposer({
  features,
  creditsRemaining,
  canUse,
}: {
  features: AiFeatureDef[];
  creditsRemaining: number;
  canUse: boolean;
}) {
  const [selected, setSelected] = useState(features[0]?.key ?? "");
  const [state, formAction, pending] = useActionState<FormState, FormData>(runAiAction, {});
  const feature = features.find((item) => item.key === selected) ?? features[0];
  const affordable = !!feature && feature.credits <= creditsRemaining;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state?.error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-soft)] px-3.5 py-3 text-[13px] text-[var(--danger)]"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      {state?.success && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--success-soft)] px-3.5 py-3 text-[13px] text-[var(--success)]"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{state.success}</span>
        </div>
      )}

      <fieldset disabled={!canUse || pending}>
        <legend className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-2)]">
          Choose a module
        </legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {features.map((item) => {
            const active = item.key === selected;
            return (
              <label
                key={item.key}
                className={cn(
                  "cursor-pointer rounded-xl border px-3 py-2.5 transition",
                  active
                    ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                    : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]",
                )}
              >
                <input
                  type="radio"
                  name="feature"
                  value={item.key}
                  checked={active}
                  onChange={() => setSelected(item.key)}
                  className="sr-only"
                />
                <span className="flex items-start justify-between gap-2">
                  <span className="text-[12px] font-medium">{item.label}</span>
                  <span className="shrink-0 rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-muted">
                    {item.credits} cr
                  </span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[10px] leading-relaxed text-muted">
                  {item.description}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="prompt">
          Your brief
        </label>
        <textarea
          id="prompt"
          name="prompt"
          className="input min-h-40"
          rows={8}
          maxLength={6000}
          required
          disabled={!canUse || pending}
          placeholder={feature?.placeholder}
        />
        <p className="hint">
          Add context the model cannot guess: class, subject, marks, tone and any constraints.
          Outputs are drafts — review before sharing with parents or students.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
        <p className="text-[11px] text-muted">
          {feature ? `${feature.credits} credit${feature.credits === 1 ? "" : "s"} per run` : "Choose a module"} ·{" "}
          <span className={creditsRemaining <= 0 ? "text-[var(--danger)]" : ""}>
            {creditsRemaining} left this month
          </span>
        </p>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!canUse || pending || !affordable}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {pending ? "Generating…" : affordable ? "Generate draft" : "Not enough credits"}
        </button>
      </div>
    </form>
  );
}
