const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function money(minor: number, currency = "INR", compact = false) {
  const key = `${currency}:${compact}`;
  let fmt = currencyFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: compact ? 1 : 0,
      notation: compact ? "compact" : "standard",
    });
    currencyFormatters.set(key, fmt);
  }
  return fmt.format(minor / 100);
}

export function num(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

export function pct(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const shortDateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" });
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" });

export function date(value: Date | string | null | undefined) {
  if (!value) return "—";
  return dateFmt.format(new Date(value));
}

export function shortDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return shortDateFmt.format(new Date(value));
}

export function monthLabel(value: Date | string) {
  return monthFmt.format(new Date(value));
}

export function timeAgo(value: Date | string | null | undefined) {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date(value);
}

export function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: Date, b: Date) {
  return Math.ceil((b.getTime() - a.getTime()) / 86_400_000);
}

export function addDays(d: Date, days: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function addMonths(d: Date, months: number) {
  const copy = new Date(d);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

export function startOfMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function startOfDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** "12 Aug 2026" for <input type="date">-free display of ISO dates. */
export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
