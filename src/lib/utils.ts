import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Deterministic, dependency-free ID helper for invoice / receipt numbers. */
export function sequenceNumber(prefix: string, n: number) {
  return `${prefix}-${String(n).padStart(5, "0")}`;
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

export function safeInt(value: string | undefined, fallback: number, max = 100) {
  const n = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, 1), max);
}

export function safeReturnTo(value: string | undefined | null) {
  if (!value) return null;
  // Only allow same-origin, absolute-path redirects.
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
