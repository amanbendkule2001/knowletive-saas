/**
 * Universal CSV escaping and sanitization utility.
 * Formats cell values per RFC-4180 and neutralizes Formula Injection (CWE-1236).
 */

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";

  // 1. Preserve JavaScript numeric types
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  const text = String(value);

  // 2. Preserve safe finite numeric literals (e.g. "-100", "42.50", "  -100 ", "\t-100")
  if (/^-?\d+(\.\d+)?$/.test(text.trim())) {
    // Preserve source spacing; quote only if containing RFC-4180 delimiters
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  // 3. Inspect stripped content for formula injection triggers
  // Strips ASCII control chars (0x00-0x1F, 0x7F), Unicode whitespace (\s, including \u00A0),
  // Byte Order Mark (\uFEFF), and zero-width format characters (\u200B-\u200D, \u2060)
  const stripped = text.replace(/^[\s\x00-\x1F\x7F\uFEFF\u200B-\u200D\u2060]+/, "");

  // If stripped content begins with =, +, @, or an expression-starting minus sign:
  let sanitized = text;
  if (/^[=+@]/.test(stripped) || (/^-/.test(stripped) && !/^-?\d+(\.\d+)?$/.test(stripped))) {
    sanitized = `'${text}`;
  }

  // 4. RFC-4180 quoting for special characters
  if (/[",\n\r]/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }

  return sanitized;
}

