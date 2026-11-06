import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id="kl-mark" x1="4" y1="2" x2="37" y2="39" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="0.5" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#kl-mark)" />
      <path
        d="M12 10.5V29.5"
        stroke="white"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path
        d="M27 10.5L15.5 20L27 29.5"
        stroke="white"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="28.6" cy="20" r="2.1" fill="white" opacity="0.92" />
    </svg>
  );
}

export function Logo({
  href = "/",
  size = 34,
  showText = true,
  subtitle,
  className,
}: {
  href?: string | null;
  size?: number;
  showText?: boolean;
  subtitle?: string;
  className?: string;
}) {
  const content = (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      {showText && (
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold tracking-tight">Knowletive</span>
          {subtitle && (
            <span className="block truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
              {subtitle}
            </span>
          )}
        </span>
      )}
    </span>
  );
  return href ? (
    <Link href={href} className="inline-flex items-center" aria-label="Knowletive home">
      {content}
    </Link>
  ) : (
    content
  );
}
