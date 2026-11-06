import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "badge-neutral",
  brand: "badge-brand",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  info: "badge-info",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return <span className={cn("badge", toneClass[tone], className)}>{children}</span>;
}

export function statusTone(status: string): Tone {
  switch (status.toUpperCase()) {
    case "ACTIVE":
    case "PAID":
    case "SUCCEEDED":
    case "PRESENT":
      return "success";
    case "TRIAL":
    case "TRIALING":
    case "PENDING":
    case "OPEN":
    case "LATE":
    case "INVITED":
      return "warning";
    case "SUSPENDED":
    case "PAST_DUE":
    case "OVERDUE":
    case "FAILED":
    case "ABSENT":
    case "CHURNED":
    case "CANCELED":
    case "EXPIRED":
      return "danger";
    case "PARTIAL":
    case "PAUSED":
    case "EXCUSED":
      return "info";
    default:
      return "neutral";
  }
}

export function statusLabel(status: string) {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--brand)]">
            {eyebrow}
          </p>
        )}
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return <Tag className={cn("card", className)}>{children}</Tag>;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "brand",
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const inner = (
    <div className="card card-hover h-full p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted">{label}</p>
        {icon && (
          <span
            className={cn(
              "grid size-8 place-items-center rounded-lg",
              tone === "brand" && "bg-[var(--brand-soft)] text-[var(--brand)]",
              tone === "success" && "bg-[var(--success-soft)] text-[var(--success)]",
              tone === "warning" && "bg-[var(--warning-soft)] text-[var(--warning)]",
              tone === "danger" && "bg-[var(--danger-soft)] text-[var(--danger)]",
              tone === "info" && "bg-[var(--info-soft)] text-[var(--info)]",
              tone === "neutral" && "bg-[var(--surface-3)] text-muted",
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

export function Avatar({
  name,
  color = "#4f46e5",
  size = 32,
  className,
}: {
  name: string;
  color?: string;
  size?: number;
  className?: string;
}) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold text-white", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 70%, #000))`,
      }}
    >
      {letters}
    </span>
  );
}

export function Progress({
  value,
  max = 100,
  tone = "brand",
  className,
}: {
  value: number;
  max?: number;
  tone?: "brand" | "success" | "warning" | "danger";
  className?: string;
}) {
  const width = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const bg = {
    brand: "var(--brand)",
    success: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
  }[tone];
  return (
    <div className={cn("meter", className)} aria-hidden>
      <span style={{ width: `${width}%`, background: bg }} />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && (
        <div className="mb-3 grid size-11 place-items-center rounded-xl bg-[var(--surface-2)] text-[var(--muted)]">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <span className="min-w-0 text-right text-[13px] font-medium">{children}</span>
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  icon,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const bg = {
    neutral: "bg-[var(--surface-2)]",
    brand: "bg-[var(--brand-soft)]",
    success: "bg-[var(--success-soft)]",
    warning: "bg-[var(--warning-soft)]",
    danger: "bg-[var(--danger-soft)]",
    info: "bg-[var(--info-soft)]",
  }[tone];
  const fg = {
    neutral: "text-[var(--muted)]",
    brand: "text-[var(--brand)]",
    success: "text-[var(--success)]",
    warning: "text-[var(--warning)]",
    danger: "text-[var(--danger)]",
    info: "text-[var(--info)]",
  }[tone];
  return (
    <div className={cn("flex gap-3 rounded-xl px-3.5 py-3 text-sm", bg)}>
      {icon && <div className={cn("mt-0.5 shrink-0", fg)}>{icon}</div>}
      <div className="min-w-0">
        {title && <p className={cn("text-[13px] font-semibold", fg)}>{title}</p>}
        <div className={cn("text-[13px] leading-relaxed", title ? "mt-0.5 text-muted" : fg)}>{children}</div>
      </div>
    </div>
  );
}

export function PageToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      {children}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  query,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  query?: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v) params.set(k, v);
    params.set("page", String(p));
    return `${basePath}?${params.toString()}`;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-muted">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        {page > 1 ? (
          <Link href={href(page - 1)} className="btn btn-secondary btn-sm">
            Previous
          </Link>
        ) : (
          <span className="btn btn-secondary btn-sm pointer-events-none opacity-45">Previous</span>
        )}
        <span className="px-2 font-medium">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className="btn btn-secondary btn-sm">
            Next
          </Link>
        ) : (
          <span className="btn btn-secondary btn-sm pointer-events-none opacity-45">Next</span>
        )}
      </div>
    </div>
  );
}
