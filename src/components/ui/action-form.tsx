"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { FormState } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  pendingLabel = "Saving…",
  cancelHref,
  className,
  submitClassName,
  footer,
  variant = "primary",
}: {
  action: Action;
  children: React.ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  cancelHref?: string;
  className?: string;
  submitClassName?: string;
  footer?: React.ReactNode;
  variant?: "primary" | "danger";
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const errors = state?.fieldErrors
    ? Object.entries(state.fieldErrors).filter(([, v]) => v && v.length > 0)
    : [];

  useEffect(() => {
    if (!state?.error) return;
    const isAccessDenied =
      /denied|permission|access|unauthorized|not authorized|restricted/i.test(state.error);
    if (isAccessDenied) {
      toast.error(state.error, "Permission Denied");
    }
  }, [state?.error]);

  return (
    <form action={formAction} className={cn("space-y-4", className)} noValidate>
      {state?.error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-soft)] px-3.5 py-3 text-[13px] text-[var(--danger)]"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">{state.error}</p>
            {errors.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-xs opacity-90">
                {errors.map(([key, value]) => (
                  <li key={key}>{value?.[0]}</li>
                ))}
              </ul>
            )}
          </div>
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
      {children}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "btn",
            variant === "danger" ? "btn-danger" : "btn-primary",
            submitClassName,
          )}
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {pending ? pendingLabel : submitLabel}
        </button>
        {cancelHref && (
          <Link href={cancelHref} className="btn btn-ghost">
            Cancel
          </Link>
        )}
        {footer}
      </div>
    </form>
  );
}

export function SubmitButton({
  children,
  className,
  pendingLabel,
  variant = "primary",
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn("btn", `btn-${variant}`, className)}>
      {pending && <Loader2 className="size-3.5 animate-spin" />}
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
