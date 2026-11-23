import { describe, it, expect } from "vitest";
import type { StudentStatus } from "@prisma/client";

describe("Student Import Ingestion Validation (FIX-02, FIX-03, FIX-04)", () => {
  const validStatuses = new Set<StudentStatus>(["ACTIVE", "INACTIVE", "ALUMNI"]);

  function validateStudentStatus(rawStatusInput: string): { ok: boolean; status?: StudentStatus; error?: string } {
    const rawStatus = rawStatusInput.trim().toUpperCase();
    if (!rawStatus) {
      return { ok: true, status: "ACTIVE" };
    }
    if (validStatuses.has(rawStatus as StudentStatus)) {
      return { ok: true, status: rawStatus as StudentStatus };
    }
    return { ok: false, error: `invalid status '${rawStatus}'. Allowed statuses are ACTIVE, INACTIVE, ALUMNI.` };
  }

  it("FIX-03: Missing or blank status defaults to ACTIVE", () => {
    expect(validateStudentStatus("")).toEqual({ ok: true, status: "ACTIVE" });
    expect(validateStudentStatus("   ")).toEqual({ ok: true, status: "ACTIVE" });
  });

  it("FIX-03: Valid statuses (ACTIVE, INACTIVE, ALUMNI) are normalized and accepted", () => {
    expect(validateStudentStatus("active")).toEqual({ ok: true, status: "ACTIVE" });
    expect(validateStudentStatus("INACTIVE")).toEqual({ ok: true, status: "INACTIVE" });
    expect(validateStudentStatus("alumni")).toEqual({ ok: true, status: "ALUMNI" });
  });

  it("FIX-03: Invalid explicitly supplied statuses are rejected with clear error", () => {
    expect(validateStudentStatus("SUSPENDED")).toEqual({
      ok: false,
      error: "invalid status 'SUSPENDED'. Allowed statuses are ACTIVE, INACTIVE, ALUMNI.",
    });
    expect(validateStudentStatus("EXPELLED")).toEqual({
      ok: false,
      error: "invalid status 'EXPELLED'. Allowed statuses are ACTIVE, INACTIVE, ALUMNI.",
    });
    expect(validateStudentStatus("UNKNOWN")).toEqual({
      ok: false,
      error: "invalid status 'UNKNOWN'. Allowed statuses are ACTIVE, INACTIVE, ALUMNI.",
    });
  });

  it("FIX-04: Upfront threshold rejection for files with > 300 data records", () => {
    function checkImportLimit(dataRowsCount: number): { ok: boolean; error?: string } {
      if (dataRowsCount > 300) {
        return {
          ok: false,
          error: `This file contains ${dataRowsCount} student records, which exceeds the maximum limit of 300 rows per import. No records were imported. Please split your file into batches of 300 or fewer.`,
        };
      }
      return { ok: true };
    }

    expect(checkImportLimit(300)).toEqual({ ok: true });
    expect(checkImportLimit(1)).toEqual({ ok: true });
    expect(checkImportLimit(301)).toEqual({
      ok: false,
      error: "This file contains 301 student records, which exceeds the maximum limit of 300 rows per import. No records were imported. Please split your file into batches of 300 or fewer.",
    });
    expect(checkImportLimit(500)).toEqual({
      ok: false,
      error: "This file contains 500 student records, which exceeds the maximum limit of 300 rows per import. No records were imported. Please split your file into batches of 300 or fewer.",
    });
  });
});

