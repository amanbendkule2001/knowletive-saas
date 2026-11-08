import { describe, it, expect } from "vitest";
import { escapeCsvCell } from "@/lib/csv";

describe("CSV Security & RFC-4180 Escaping (escapeCsvCell)", () => {
  it("AC-05: Direct formula triggers (=, +, @) prepend single quote", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("+1+1")).toBe("'+1+1");
    expect(escapeCsvCell("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
    expect(escapeCsvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
  });

  it("AC-06: Numeric literals and decimals preserve source spacing without prepending quote", () => {
    // Pure integers and decimals
    expect(escapeCsvCell("-100")).toBe("-100");
    expect(escapeCsvCell("42.50")).toBe("42.50");
    expect(escapeCsvCell("0")).toBe("0");

    // Surrounding whitespace/tab preserved as source text
    expect(escapeCsvCell("  -100 ")).toBe("  -100 ");
    expect(escapeCsvCell("\t-100")).toBe("\t-100");
    expect(escapeCsvCell("  42.50  ")).toBe("  42.50  ");
  });

  it("AC-07: Negative expressions prepend single quote to disarm calculation", () => {
    expect(escapeCsvCell("-100+1")).toBe("'-100+1");
    expect(escapeCsvCell("-cmd|' /C calc'!A0")).toBe("'-cmd|' /C calc'!A0");
    expect(escapeCsvCell("-SUM(A1)")).toBe("'-SUM(A1)");
    expect(escapeCsvCell("-100-50")).toBe("'-100-50");
  });

  it("AC-08: Whitespace, control characters, BOM, and zero-width chars prepend single quote", () => {
    // Standard whitespace and tabs
    expect(escapeCsvCell("  =1+1")).toBe("'  =1+1");
    expect(escapeCsvCell("\t=SUM(A1)")).toBe("'\t=SUM(A1)");
    expect(escapeCsvCell("\r=cmd")).toBe("\"'\r=cmd\"");
    expect(escapeCsvCell("\n=1+1")).toBe("\"'\n=1+1\"");

    // ASCII NUL and control characters
    expect(escapeCsvCell("\x00=calc")).toBe("'\x00=calc");
    expect(escapeCsvCell("\x1F=cmd")).toBe("'\x1F=cmd");

    // Byte Order Mark (BOM)
    expect(escapeCsvCell("\uFEFF=1+1")).toBe("'\uFEFF=1+1");

    // Unicode non-breaking space (Zs category)
    expect(escapeCsvCell("\u00A0=1+1")).toBe("'\u00A0=1+1");

    // Zero-width formatting characters (U+200B-U+200D, U+2060)
    expect(escapeCsvCell("\u200B=1+1")).toBe("'\u200B=1+1");
    expect(escapeCsvCell("\u200C=cmd")).toBe("'\u200C=cmd");
    expect(escapeCsvCell("\u200D+1+1")).toBe("'\u200D+1+1");
    expect(escapeCsvCell("\u2060@SUM(A1)")).toBe("'\u2060@SUM(A1)");
  });

  it("AC-09: Phone numbers with international country code (+) prepend single quote", () => {
    expect(escapeCsvCell("+91 9876543210")).toBe("'+91 9876543210");
    expect(escapeCsvCell("+1-555-0199")).toBe("'+1-555-0199");
    expect(escapeCsvCell("+44 20 7946 0991")).toBe("'+44 20 7946 0991");
  });

  it("AC-10: JavaScript numbers and decimals return unquoted string equivalents", () => {
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(-10.5)).toBe("-10.5");
    expect(escapeCsvCell(0)).toBe("0");
    expect(escapeCsvCell(99.99)).toBe("99.99");
  });

  it("AC-11: RFC-4180 quoting, escaping, null and undefined handling", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
    expect(escapeCsvCell("Normal Text")).toBe("Normal Text");
    expect(escapeCsvCell("Doe, John")).toBe('"Doe, John"');
    expect(escapeCsvCell('Nick "The Star" Name')).toBe('"Nick ""The Star"" Name"');
    expect(escapeCsvCell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
    expect(escapeCsvCell("=SUM(A1, B1)")).toBe("\"'=SUM(A1, B1)\"");
  });
});
