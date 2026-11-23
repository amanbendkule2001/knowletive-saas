import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/coachgenie-logo.png"
      alt="Coachgenie Logo"
      width={size}
      height={size}
      className={cn("shrink-0 object-contain drop-shadow-sm", className)}
      style={{ width: size, height: size }}
    />
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
          <span className="block truncate text-[15px] font-semibold tracking-tight">Coachgenie</span>
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
    <Link href={href} className="inline-flex items-center" aria-label="Coachgenie home">
      {content}
    </Link>
  ) : (
    content
  );
}
