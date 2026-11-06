import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
  required,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string[] | undefined;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-[var(--danger)]">*</span>}
      </label>
      {children}
      {hint && !error?.length && <p className="hint">{hint}</p>}
      {error?.length ? <p className="field-error">{error[0]}</p> : null}
    </div>
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  return (
    <div
      className={cn(
        "grid gap-4",
        cols === 2 && "sm:grid-cols-2",
        cols === 3 && "sm:grid-cols-2 lg:grid-cols-3",
      )}
    >
      {children}
    </div>
  );
}

/** A compact summary block used at the top of create/edit forms. */
export function FormIntro({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-2)] px-3.5 py-3">
      <p className="text-[13px] font-semibold">{title}</p>
      {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
    </div>
  );
}
