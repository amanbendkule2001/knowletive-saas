import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => new Map()),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createLeadSchema, convertLeadSchema } from "@/lib/leads-schema";

describe("Stage 1: Leads Management Validation & Workflow Tests", () => {
  it("LEAD INTAKE: Validates lead creation schema strictly", () => {
    const validData = {
      studentName: "Aditya Malhotra",
      guardianName: "Vikram Malhotra",
      guardianPhone: "+91 9876543210",
      guardianEmail: "vikram@example.com",
      classInterested: "Grade 5",
      source: "WEBSITE",
      status: "NEW" as const,
      notes: "Inquiring about admission criteria",
    };

    const parsed = createLeadSchema.safeParse(validData);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.studentName).toBe("Aditya Malhotra");
      expect(parsed.data.guardianName).toBe("Vikram Malhotra");
      expect(parsed.data.guardianPhone).toBe("+91 9876543210");
    }
  });

  it("LEAD INTAKE: Rejects invalid email and missing student/guardian names", () => {
    const invalidData = {
      studentName: "",
      guardianName: "",
      guardianPhone: "123",
      guardianEmail: "not-an-email",
    };

    const parsed = createLeadSchema.safeParse(invalidData);
    expect(parsed.success).toBe(false);
  });

  it("LEAD CONVERSION: Validates conversion schema requiring admission details", () => {
    const conversionPayload = {
      leadId: "lead_123",
      admissionNo: "ADM-2026-901",
      firstName: "Aarav",
      lastName: "Kapoor",
      gender: "MALE",
      classId: "class_1",
      sectionId: "section_1",
    };

    const parsed = convertLeadSchema.safeParse(conversionPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.admissionNo).toBe("ADM-2026-901");
      expect(parsed.data.firstName).toBe("Aarav");
    }
  });
});
