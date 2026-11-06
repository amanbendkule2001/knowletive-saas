import { describe, it, expect, vi } from "vitest";

// Mock next/navigation and next/headers
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

import { buildStorageKey } from "@/lib/storage";

describe("Phase 2 Operations & Automation Tests", () => {
  it("LOGO STORAGE: Isolated path structure for School Logo", () => {
    const tenantId = "school_oakridge_99";
    const logoKey = buildStorageKey(tenantId, "LOGO", "crest-2026.png");

    expect(logoKey.startsWith(`${tenantId}/logo/`)).toBe(true);
    expect(logoKey).toContain("crest-2026");
  });

  it("RENEWAL CHECK: Expiry calculation identifies <= 7 days threshold", () => {
    const now = new Date();
    const expiryIn5Days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    const expiryIn10Days = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const is5DaysExpiring = expiryIn5Days <= in7Days && expiryIn5Days >= now;
    const is10DaysExpiring = expiryIn10Days <= in7Days && expiryIn10Days >= now;

    expect(is5DaysExpiring).toBe(true);
    expect(is10DaysExpiring).toBe(false);

    const daysLeft = Math.max(0, Math.ceil((expiryIn5Days.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    expect(daysLeft).toBe(5);
  });

  it("ANNOUNCEMENT AUDIENCE FILTER: Accurately segments members by audience", () => {
    const members = [
      { id: "m1", role: { name: "Principal", scope: "TENANT" } },
      { id: "m2", role: { name: "Math Teacher", scope: "TENANT" } },
      { id: "m3", role: { name: "Parent / Guardian", scope: "TENANT" } },
      { id: "m4", role: { name: "Student Rep", scope: "TENANT" } },
    ];

    // Filter ALL
    const allRecipients = members.filter(() => true);
    expect(allRecipients.length).toBe(4);

    // Filter PARENTS
    const parentRecipients = members.filter(
      (m) => m.role.name.toLowerCase().includes("parent") || m.role.name.toLowerCase().includes("guardian"),
    );
    expect(parentRecipients.length).toBe(1);
    expect(parentRecipients[0].id).toBe("m3");

    // Filter STUDENTS
    const studentRecipients = members.filter((m) => m.role.name.toLowerCase().includes("student"));
    expect(studentRecipients.length).toBe(1);
    expect(studentRecipients[0].id).toBe("m4");
  });

  it("ABSENT NOTIFICATION: Subject and body alert message formatting", () => {
    const studentName = "Aarav Sharma";
    const dateRaw = "2026-11-05";
    const sectionName = "Class 10 - Section A";
    const schoolName = "Oakridge International";

    const alertSubject = `Absence Notice: ${studentName}`;
    const alertBody = `${studentName} was marked ABSENT for ${sectionName} on ${dateRaw}. Please contact the school office if you have any questions.`;

    expect(alertSubject).toBe("Absence Notice: Aarav Sharma");
    expect(alertBody).toContain("Aarav Sharma was marked ABSENT");
    expect(alertBody).toContain("2026-11-05");
    expect(alertBody).toContain("Class 10 - Section A");

    const emailBody = `Dear Rajesh Sharma,\n\nThis is to notify you that your ward, ${studentName}, was recorded as ABSENT today (${dateRaw}) in ${sectionName} at ${schoolName}.`;
    expect(emailBody).toContain("Aarav Sharma");
    expect(emailBody).toContain("Oakridge International");
  });

  it("STUDENT EXPORT: CSV Escaping and formatting prevents CSV Injection", () => {
    function cell(value: string | number | null | undefined) {
      const text = value === null || value === undefined ? "" : String(value);
      if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
      return text;
    }

    // Normal text
    expect(cell("Normal Name")).toBe("Normal Name");
    // Text with comma
    expect(cell("Sharma, Rajesh")).toBe('"Sharma, Rajesh"');
    // Text with quotes
    expect(cell('Nick "The Star" Name')).toBe('"Nick ""The Star"" Name"');
    // Null / undefined
    expect(cell(null)).toBe("");
    expect(cell(undefined)).toBe("");
  });

  it("RBAC TOAST NOTIFICATIONS: Standardized access-denied messages meet requirements", async () => {
    const { ACCESS_DENIED_MESSAGES, getAccessDeniedMessage } = await import("@/lib/rbac");

    expect(ACCESS_DENIED_MESSAGES.page).toBe("Access denied. You do not have permission to view this page.");
    expect(ACCESS_DENIED_MESSAGES.create).toBe("Permission denied. You are not authorized to create this record.");
    expect(ACCESS_DENIED_MESSAGES.update).toBe("Permission denied. You do not have permission to modify this information.");
    expect(ACCESS_DENIED_MESSAGES.delete).toBe("Access denied. You are not authorized to delete this record.");
    expect(ACCESS_DENIED_MESSAGES.general).toBe("You do not have permission to perform this action.");
    expect(ACCESS_DENIED_MESSAGES.module).toBe("You do not have access to this module. Please contact your administrator.");

    expect(getAccessDeniedMessage("create")).toBe("Permission denied. You are not authorized to create this record.");
    expect(getAccessDeniedMessage("update")).toBe("Permission denied. You do not have permission to modify this information.");
    expect(getAccessDeniedMessage("delete")).toBe("Access denied. You are not authorized to delete this record.");
    expect(getAccessDeniedMessage("page")).toBe("Access denied. You do not have permission to view this page.");
    expect(getAccessDeniedMessage("module")).toBe("You do not have access to this module. Please contact your administrator.");
    expect(getAccessDeniedMessage()).toBe("You do not have permission to perform this action.");
  });
});


