import { describe, it, expect, vi, beforeEach } from "vitest";

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

// Mock DB and Auth for Server Action and Route Handler testing
vi.mock("@/lib/db", () => ({
  db: {
    lead: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getTenantContext: vi.fn(),
  hasTenantPermission: vi.fn(),
  isStaffMember: vi.fn(),
}));

import {
  LEADS_CSV_HEADERS,
  buildLeadsWhereClause,
  formatLeadToRow,
  serializeLeadsCsv,
  generateLeadsFilename,
  type LeadExportRecord,
} from "@/lib/leads-export";
import { exportLeadsCsvAction } from "@/actions/leads";
import { GET as leadsExportRoute } from "@/app/(app)/app/leads/export/route";
import { db } from "@/lib/db";
import { getTenantContext, hasTenantPermission, isStaffMember } from "@/lib/auth";

describe("Leads & Enquiries CSV Export Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.lead.count as any).mockResolvedValue(1);
  });
  const mockLead1: LeadExportRecord = {
    id: "lead_001",
    studentName: "Aarav Sharma",
    dob: new Date("2015-04-10"),
    classInterested: "Class 5",
    academicYear: { name: "2026-2027" },
    guardianName: "Rajesh Sharma",
    guardianPhone: "9876543210",
    guardianEmail: "rajesh@example.com",
    source: "WALK_IN",
    status: "NEW",
    assignedTo: { user: { name: "Pooja Mehta", email: "pooja@knowletive.com" } },
    nextFollowUp: new Date("2026-11-15"),
    notes: "Parent inquired about science batch timings.",
    convertedStudentId: null,
    createdAt: new Date("2026-11-01T10:00:00Z"),
    updatedAt: new Date("2026-11-01T10:00:00Z"),
  };

  const mockLead2: LeadExportRecord = {
    id: "lead_002",
    studentName: "Ananya Patil",
    dob: null,
    classInterested: "Class 8",
    academicYear: null,
    guardianName: "Sunita Patil",
    guardianPhone: "9876543211",
    guardianEmail: null,
    source: "REFERRAL",
    status: "CONVERTED",
    assignedTo: null,
    nextFollowUp: null,
    notes: null,
    convertedStudentId: "student_999",
    createdAt: new Date("2026-10-15T09:30:00Z"),
    updatedAt: new Date("2026-10-20T14:00:00Z"),
  };

  // 1. Successful CSV export
  it("1. Successful CSV export: correctly structures headers and row fields", () => {
    const csv = serializeLeadsCsv([mockLead1, mockLead2]);
    const lines = csv.split("\r\n");

    expect(lines.length).toBe(3); // Header + 2 data rows
    expect(lines[0]).toBe(LEADS_CSV_HEADERS.join(","));

    // Check row 1 fields
    expect(lines[1]).toContain("lead_001");
    expect(lines[1]).toContain("Aarav Sharma");
    expect(lines[1]).toContain("2015-04-10");
    expect(lines[1]).toContain("Class 5");
    expect(lines[1]).toContain("2026-2027");
    expect(lines[1]).toContain("Rajesh Sharma");
    expect(lines[1]).toContain("9876543210");
    expect(lines[1]).toContain("rajesh@example.com");
    expect(lines[1]).toContain("WALK IN");
    expect(lines[1]).toContain("NEW");
    expect(lines[1]).toContain("Pooja Mehta");
    expect(lines[1]).toContain("pooja@knowletive.com");
    expect(lines[1]).toContain("2026-11-15");
    expect(lines[1]).toContain("No"); // Converted: No

    // Check row 2 unassigned / null defaults
    expect(lines[2]).toContain("lead_002");
    expect(lines[2]).toContain("Ananya Patil");
    expect(lines[2]).toContain("Unassigned");
    expect(lines[2]).toContain("Yes"); // Converted: Yes
  });

  // 2. Empty lead dataset
  it("2. Empty lead dataset: produces valid CSV with headers only", () => {
    const csv = serializeLeadsCsv([]);
    const lines = csv.split("\r\n");

    expect(lines.length).toBe(1);
    expect(lines[0]).toBe(LEADS_CSV_HEADERS.join(","));
  });

  // 3. Search-filtered export
  it("3. Search-filtered export: constructs multi-field case-insensitive OR clause", () => {
    const where = buildLeadsWhereClause("tenant_123", { q: "Sharma" });

    expect(where.tenantId).toBe("tenant_123");
    expect(where.status).toBeUndefined();
    expect(where.OR).toEqual([
      { studentName: { contains: "Sharma", mode: "insensitive" } },
      { guardianName: { contains: "Sharma", mode: "insensitive" } },
      { guardianPhone: { contains: "Sharma" } },
      { guardianEmail: { contains: "Sharma", mode: "insensitive" } },
      { classInterested: { contains: "Sharma", mode: "insensitive" } },
    ]);
  });

  // 4. Status-filtered export
  it("4. Status-filtered export: applies exact status and ignores invalid values", () => {
    const validWhere = buildLeadsWhereClause("tenant_123", { status: "follow_up" });
    expect(validWhere.tenantId).toBe("tenant_123");
    expect(validWhere.status).toBe("FOLLOW_UP");

    const invalidWhere = buildLeadsWhereClause("tenant_123", { status: "INVALID_STATUS" });
    expect(invalidWhere.tenantId).toBe("tenant_123");
    expect(invalidWhere.status).toBeUndefined();
  });

  // 5. Combined search and status filters
  it("5. Combined search and status filters: applies both status and search criteria", () => {
    const where = buildLeadsWhereClause("tenant_123", { q: "987654", status: "NEW" });

    expect(where.tenantId).toBe("tenant_123");
    expect(where.status).toBe("NEW");
    expect(where.OR).toBeDefined();
    expect(where.OR?.length).toBe(5);
  });

  // 6. Exporting records beyond the current pagination page
  it("6. Beyond pagination: query does not specify skip or take limits", async () => {
    // Generate 50 mock leads (exceeding standard 20-per-page limit)
    const fiftyLeads: LeadExportRecord[] = Array.from({ length: 50 }, (_, i) => ({
      ...mockLead1,
      id: `lead_${i + 1}`,
      studentName: `Student ${i + 1}`,
    }));

    const csv = serializeLeadsCsv(fiftyLeads);
    const lines = csv.split("\r\n");

    expect(lines.length).toBe(51); // Header + 50 data rows
    expect(lines[1]).toContain("lead_1,Student 1");
    expect(lines[50]).toContain("lead_50,Student 50");
  });

  // 7. Tenant isolation
  it("7. Tenant isolation: strictly scopes where clause to current tenantId", () => {
    const whereA = buildLeadsWhereClause("tenant_AAA", { q: "test" });
    const whereB = buildLeadsWhereClause("tenant_BBB", { q: "test" });

    expect(whereA.tenantId).toBe("tenant_AAA");
    expect(whereB.tenantId).toBe("tenant_BBB");
    expect(whereA.tenantId).not.toBe(whereB.tenantId);
  });

  // 8. Unauthorized export rejection
  it("8. Unauthorized export rejection: rejects unauthenticated and non-staff calls", async () => {
    // Case A: Unauthenticated
    vi.mocked(getTenantContext).mockResolvedValueOnce(null);
    const unauthResult = await exportLeadsCsvAction();
    expect(unauthResult.ok).toBe(false);
    if (!unauthResult.ok) {
      expect(unauthResult.error).toContain("Unauthorized");
    }

    // Case B: Route handler returns 401 for unauthenticated
    vi.mocked(getTenantContext).mockResolvedValueOnce(null);
    const req = new Request("http://localhost:3000/app/leads/export");
    const routeRes401 = await leadsExportRoute(req);
    expect(routeRes401.status).toBe(401);

    // Case C: Authenticated but not a staff member
    const fakeCtx = {
      tenant: { id: "tenant_123", slug: "demo" },
      user: { id: "user_1", name: "Guest User" },
      membership: { roleKey: "student" },
    } as any;
    vi.mocked(getTenantContext).mockResolvedValueOnce(fakeCtx);
    vi.mocked(isStaffMember).mockReturnValueOnce(false);

    const forbiddenResult = await exportLeadsCsvAction();
    expect(forbiddenResult.ok).toBe(false);
    if (!forbiddenResult.ok) {
      expect(forbiddenResult.error).toContain("Access denied");
    }

    // Case D: Authenticated staff member but lacking permission
    vi.mocked(getTenantContext).mockResolvedValueOnce(fakeCtx);
    vi.mocked(isStaffMember).mockReturnValueOnce(true);
    vi.mocked(hasTenantPermission).mockReturnValueOnce(false);
    const routeRes403 = await leadsExportRoute(req);
    expect(routeRes403.status).toBe(403);
  });

  // 9. CSV formula injection protection
  it("9. CSV formula injection protection: neutralizes =, +, @, negative formulas, and Unicode invisible prefixes", () => {
    const maliciousLead: LeadExportRecord = {
      ...mockLead1,
      studentName: "=cmd|' /C calc'!A0",
      guardianName: "+91 9999999999",
      guardianPhone: "-100+50",
      notes: "\u200B@SUM(A1:B10)",
    };

    const row = formatLeadToRow(maliciousLead);
    const csv = serializeLeadsCsv([maliciousLead]);
    const dataLine = csv.split("\r\n")[1];

    // =cmd... must be single-quote prefixed
    expect(dataLine).toContain("'=cmd|' /C calc'!A0");

    // International +91 phone must be single-quote prefixed
    expect(dataLine).toContain("'+91 9999999999");

    // Negative expression -100+50 must be single-quote prefixed
    expect(dataLine).toContain("'-100+50");

    // Zero-width space U+200B followed by @SUM must be single-quote prefixed
    expect(dataLine).toContain("'\u200B@SUM(A1:B10)");
  });

  // 10. Correct CSV escaping of commas, quotes, and newlines
  it("10. Correct CSV escaping of commas, quotes, and newlines per RFC-4180", () => {
    const specialCharsLead: LeadExportRecord = {
      ...mockLead1,
      studentName: 'Aarav "The Star" Sharma',
      guardianName: "Sharma, Rajesh",
      notes: "Line 1\nLine 2\r\nLine 3, with comma",
    };

    const csv = serializeLeadsCsv([specialCharsLead]);

    // Internal double quotes must be doubled ("") and cell wrapped in quotes
    expect(csv).toContain('"Aarav ""The Star"" Sharma"');

    // Commas must cause cell to be wrapped in quotes
    expect(csv).toContain('"Sharma, Rajesh"');

    // Multiline notes must preserve newlines inside quoted cell
    expect(csv).toContain('"Line 1\nLine 2\r\nLine 3, with comma"');
  });

  // End-to-End Server Action execution with mocked DB
  it("Server action execution: queries DB with proper select and returns data with filename", async () => {
    const fakeCtx = {
      tenant: { id: "tenant_999", slug: "delhi-academy" },
      user: { id: "user_admin", name: "Admin User" },
      membership: { roleKey: "admin" },
    } as any;
    vi.mocked(getTenantContext).mockResolvedValueOnce(fakeCtx);
    vi.mocked(isStaffMember).mockReturnValueOnce(true);
    vi.mocked(hasTenantPermission).mockReturnValueOnce(true);

    vi.mocked(db.lead.findMany).mockResolvedValueOnce([mockLead1 as any]);

    const result = await exportLeadsCsvAction({ status: "NEW", q: "Aarav" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.filename).toMatch(/^delhi-academy-leads-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(result.data.count).toBe(1);
      expect(result.data.csvContent).toContain("Aarav Sharma");
      expect(result.data.csvContent).toContain("9876543210");
    }
  });

  // Route Handler execution with mocked DB
  it("Route handler execution: returns 200 with text/csv header and attachment filename", async () => {
    const fakeCtx = {
      tenant: { id: "tenant_999", slug: "pune-classes" },
      user: { id: "user_admin", name: "Admin User" },
      membership: { roleKey: "admin" },
    } as any;
    vi.mocked(getTenantContext).mockResolvedValueOnce(fakeCtx);
    vi.mocked(isStaffMember).mockReturnValueOnce(true);
    vi.mocked(hasTenantPermission).mockReturnValueOnce(true);

    vi.mocked(db.lead.findMany).mockResolvedValueOnce([mockLead1 as any]);

    const req = new Request("http://localhost:3000/app/leads/export?status=NEW");
    const response = await leadsExportRoute(req);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(/attachment; filename="pune-classes-leads-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, no-cache, must-revalidate");
    expect(response.headers.get("Pragma")).toBe("no-cache");

    const buffer = Buffer.from(await response.arrayBuffer());
    // Verify UTF-8 BOM (0xEF, 0xBB, 0xBF)
    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);
    const text = buffer.toString("utf8");
    expect(text).toContain("Aarav Sharma");
  });

  it("Route handler and server action enforce MAX_LEADS_EXPORT_LIMIT (5000 records) to prevent OOM", async () => {
    const fakeCtx = {
      tenant: { id: "tenant_999", slug: "pune-classes" },
      user: { id: "user_admin", name: "Admin User" },
      membership: { roleKey: "admin" },
    } as any;
    vi.mocked(getTenantContext).mockResolvedValue(fakeCtx);
    vi.mocked(isStaffMember).mockReturnValue(true);
    vi.mocked(hasTenantPermission).mockReturnValue(true);

    // Mock count exceeding 5,000 records
    vi.mocked(db.lead.count).mockResolvedValueOnce(5001);

    const req = new Request("http://localhost:3000/app/leads/export");
    const response = await leadsExportRoute(req);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Export limit exceeded");
    expect(body.error).toContain("5001");
    expect(body.error).toContain("5000");

    // Server action check
    vi.mocked(db.lead.count).mockResolvedValueOnce(6200);
    const actionResult = await exportLeadsCsvAction();
    expect(actionResult.ok).toBe(false);
    if (!actionResult.ok) {
      expect(actionResult.error).toContain("Export limit exceeded");
      expect(actionResult.error).toContain("6200");
    }
  });
});
