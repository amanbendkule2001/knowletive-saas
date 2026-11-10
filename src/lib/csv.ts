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

/**
 * Custom error thrown when a CSV string violates RFC-4180 syntax.
 */
export class CsvParseError extends Error {
  line: number;
  column: number;

  constructor(message: string, line: number, column: number) {
    super(`Malformed CSV at line ${line}, column ${column}: ${message}`);
    this.name = "CsvParseError";
    this.line = line;
    this.column = column;
    Object.setPrototypeOf(this, CsvParseError.prototype);
  }
}

/**
 * Strict RFC-4180 compliant CSV parser state machine.
 *
 * Supports:
 * - UTF-8 BOM stripping
 * - Commas inside quoted fields
 * - Escaped double quotes ("") inside quoted fields
 * - Multiline quoted fields (preserves embedded CRLF/LF)
 * - CRLF (\r\n) and LF (\n) record delimiters
 *
 * Strictly rejects:
 * - Unclosed quotes
 * - Characters illegally placed after closing quote before delimiter
 * - Quotes appearing inside unquoted fields
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  if (!text) return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";

  type State = "START" | "UNQUOTED" | "QUOTED" | "AFTER_QUOTE";
  let state: State = "START";

  let line = 1;
  let col = 0;
  let quoteStartLine = 1;
  let quoteStartCol = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    col++;

    switch (state) {
      case "START": {
        if (ch === '"') {
          state = "QUOTED";
          quoteStartLine = line;
          quoteStartCol = col;
        } else if (ch === ",") {
          currentRow.push("");
        } else if (ch === "\r") {
          if (text[i + 1] === "\n") {
            i++;
          }
          if (currentRow.length > 0) {
            currentRow.push("");
            rows.push(currentRow);
            currentRow = [];
          }
          line++;
          col = 0;
        } else if (ch === "\n") {
          if (currentRow.length > 0) {
            currentRow.push("");
            rows.push(currentRow);
            currentRow = [];
          }
          line++;
          col = 0;
        } else {
          currentField += ch;
          state = "UNQUOTED";
        }
        break;
      }

      case "UNQUOTED": {
        if (ch === '"') {
          throw new CsvParseError(
            'Unexpected quote character inside unquoted field. Quoted fields must start with a quote.',
            line,
            col,
          );
        } else if (ch === ",") {
          currentRow.push(currentField);
          currentField = "";
          state = "START";
        } else if (ch === "\r") {
          if (text[i + 1] === "\n") {
            i++;
          }
          currentRow.push(currentField);
          currentField = "";
          rows.push(currentRow);
          currentRow = [];
          state = "START";
          line++;
          col = 0;
        } else if (ch === "\n") {
          currentRow.push(currentField);
          currentField = "";
          rows.push(currentRow);
          currentRow = [];
          state = "START";
          line++;
          col = 0;
        } else {
          currentField += ch;
        }
        break;
      }

      case "QUOTED": {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            // Escaped quote: "" -> "
            currentField += '"';
            i++;
            col++;
          } else {
            // End of quoted field
            state = "AFTER_QUOTE";
          }
        } else if (ch === "\n") {
          currentField += ch;
          line++;
          col = 0;
        } else if (ch === "\r") {
          currentField += ch;
          if (text[i + 1] === "\n") {
            currentField += "\n";
            i++;
          }
          line++;
          col = 0;
        } else {
          currentField += ch;
        }
        break;
      }

      case "AFTER_QUOTE": {
        if (ch === ",") {
          currentRow.push(currentField);
          currentField = "";
          state = "START";
        } else if (ch === "\r") {
          if (text[i + 1] === "\n") {
            i++;
          }
          currentRow.push(currentField);
          currentField = "";
          rows.push(currentRow);
          currentRow = [];
          state = "START";
          line++;
          col = 0;
        } else if (ch === "\n") {
          currentRow.push(currentField);
          currentField = "";
          rows.push(currentRow);
          currentRow = [];
          state = "START";
          line++;
          col = 0;
        } else {
          throw new CsvParseError(
            `Unexpected character '${ch}' after closing quote before field delimiter.`,
            line,
            col,
          );
        }
        break;
      }
    }
  }

  // End of input handling
  if (state === "QUOTED") {
    throw new CsvParseError(
      "Unclosed quote detected. File ended before closing quote was reached.",
      quoteStartLine,
      quoteStartCol,
    );
  }

  if (state === "UNQUOTED" || state === "AFTER_QUOTE") {
    currentRow.push(currentField);
    rows.push(currentRow);
  } else if (state === "START" && currentRow.length > 0) {
    currentRow.push("");
    rows.push(currentRow);
  }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

