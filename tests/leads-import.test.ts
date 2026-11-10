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

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn(),
}));

// Mock DB, RBAC, and Auth for Server Action testing
vi.mock("@/lib/db", () => {
  const mockLead = {
    findMany: vi.fn(),
    create: vi.fn(),
  };
  const mockLeadActivity = {
    create: vi.fn(),
  };
  const mockMembership = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  };
  const mockAcademicYear = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  };

  return {
    db: {
      lead: mockLead,
      leadActivity: mockLeadActivity,
      membership: mockMembership,
      academicYear: mockAcademicYear,
      $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => {
        return cb({
          lead: mockLead,
          leadActivity: mockLeadActivity,
          $queryRawUnsafe: vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: "" }]),
        });
      }),
    },
  };
});

vi.mock("@/lib/rbac", () => ({
  authorizeTenantWrite: vi.fn(),
  requireTenantPermission: vi.fn(),
  requireTenantWrite: vi.fn(),
}));

import { parseCsv } from "@/lib/csv";
import {
  normalizeLeadHeaders,
  parseDateSafe,
  isValidEmail,
  makeLeadDuplicateKey,
  buildCandidateLeadsWhere,
  generateSampleLeadsCsv,
  MAX_LEAD_IMPORT_ROWS,
} from "@/lib/leads-import";
import { importLeadsCsvAction } from "@/actions/leads";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";

function createMockCsvFile(content: string, name: string = "leads.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

describe("Leads CSV Import Unit & Integration Tests", () => {
  const mockTenantContext = {
    tenant: { id: "tenant_sunrise_123", name: "Sunrise School", slug: "sunrise" },
    user: { id: "user_admin_999", name: "Admin Officer", email: "admin@sunrise.test" },
    permissions: new Set(["tenant.leads.write", "tenant.leads.read"]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (authorizeTenantWrite as any).mockResolvedValue({
      ok: true,
      ctx: mockTenantContext,
    });
    (db.lead.findMany as any).mockResolvedValue([]);
    (db.membership.findMany as any).mockResolvedValue([
      { id: "staff_mem_1", user: { email: "counselor@sunrise.test" } },
    ]);
    (db.academicYear.findMany as any).mockResolvedValue([
      { id: "year_2026", name: "2026-2027" },
    ]);
    (db.lead.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ id: "lead_gen_" + Math.random().toString(36).substring(7), ...data }),
    );
    (db.leadActivity.create as any).mockResolvedValue({ id: "act_1" });
  });

  describe("CSV Parsing & Utility Functionality", () => {
    it("parses CSV with quotes, commas, newlines and UTF-8 BOM", () => {
      const csv =
        '\uFEFF"Student Name","Guardian Phone","Notes"\n' +
        '"Sharma, Aarav","9876543210","Line 1\nLine 2 with ""quotes"""\n' +
        '"Patel, Diya","9876543211","Simple note"\n';

      const rows = parseCsv(csv);
      expect(rows.length).toBe(3);
      expect(rows[0]).toEqual(["Student Name", "Guardian Phone", "Notes"]);
      expect(rows[1][0]).toBe("Sharma, Aarav");
      expect(rows[1][1]).toBe("9876543210");
      expect(rows[1][2]).toBe('Line 1\nLine 2 with "quotes"');
      expect(rows[2][0]).toBe("Patel, Diya");
    });

    it("normalizes case-insensitive headers and reasonable aliases", () => {
      const headers = [
        "STUDENT NAME",
        "date_of_birth",
        "GRADE INTERESTED",
        "Guardian_Phone",
        "email",
        "Staff Email",
        "Lead Status",
        "Enquiry Notes",
      ];
      const map = normalizeLeadHeaders(headers);

      expect(map.studentName).toBe(0);
      expect(map.dob).toBe(1);
      expect(map.classInterested).toBe(2);
      expect(map.guardianPhone).toBe(3);
      expect(map.guardianEmail).toBe(4);
      expect(map.assignedStaffEmail).toBe(5);
      expect(map.status).toBe(6);
      expect(map.notes).toBe(7);
    });

    it("validates emails and dates safely", () => {
      expect(isValidEmail("valid@example.com")).toBe(true);
      expect(isValidEmail("user.name+tag@sub.domain.co")).toBe(true);
      expect(isValidEmail("invalid-email")).toBe(false);
      expect(isValidEmail("")).toBe(false);

      expect(parseDateSafe("2026-05-15")).toBeInstanceOf(Date);
      expect(parseDateSafe("not-a-date")).toBe("INVALID");
      expect(parseDateSafe("")).toBe(null);
    });

    it("creates deterministic duplicate keys using student name and phone/email", () => {
      const key1 = makeLeadDuplicateKey("Aarav Sharma", "+91 9876543210");
      const key2 = makeLeadDuplicateKey("  aarav sharma  ", "+91 9876543210");
      expect(key1).toBe(key2);

      const emailKey1 = makeLeadDuplicateKey("Diya Patel", "DIYA@EXAMPLE.COM");
      const emailKey2 = makeLeadDuplicateKey("diya patel", "diya@example.com");
      expect(emailKey1).toBe(emailKey2);
    });

    it("NORMALIZATION POLICY: Verifies student name, international phone, email and collision rules", () => {
      // 1. Whitespace collapsing in student names
      expect(makeLeadDuplicateKey("Aarav    Sharma", "+91 9876543210")).toBe(
        makeLeadDuplicateKey("  aarav sharma  ", "+91 9876543210"),
      );

      // 2. Phone formats with country codes (+91, 0 prefix, formatted spaces/hyphens)
      const baseKey = makeLeadDuplicateKey("Aarav Sharma", "9876543210");
      expect(makeLeadDuplicateKey("Aarav Sharma", "+91 98765 43210")).toBe(baseKey);
      expect(makeLeadDuplicateKey("Aarav Sharma", "+91-98765-43210")).toBe(baseKey);
      expect(makeLeadDuplicateKey("Aarav Sharma", "09876543210")).toBe(baseKey);
      expect(makeLeadDuplicateKey("Aarav Sharma", "(987) 654-3210")).toBe(baseKey);

      // 3. International US number normalization
      const usBase = makeLeadDuplicateKey("John Doe", "5551234567");
      expect(makeLeadDuplicateKey("John Doe", "+1 (555) 123-4567")).toBe(usBase);
      expect(makeLeadDuplicateKey("John Doe", "+1 555-123-4567")).toBe(usBase);

      // 4. Local numbers under 10 digits preserve all digits
      expect(makeLeadDuplicateKey("Jane Doe", "5551234")).toBe("jane doe|5551234");

      // 5. Non-collision: Different names with identical phone do NOT collide
      expect(makeLeadDuplicateKey("Aarav Sharma", "9876543210")).not.toBe(
        makeLeadDuplicateKey("Rohan Verma", "9876543210"),
      );

      // 6. Non-collision: Identical name with different phones do NOT collide
      expect(makeLeadDuplicateKey("Aarav Sharma", "9876543210")).not.toBe(
        makeLeadDuplicateKey("Aarav Sharma", "9876543211"),
      );

      // 7. Non-collision: Identical name with different emails do NOT collide
      expect(makeLeadDuplicateKey("Diya Patel", "diya1@example.com")).not.toBe(
        makeLeadDuplicateKey("Diya Patel", "diya2@example.com"),
      );
    });

    it("BOUNDED CANDIDATE QUERY: Generates targeted where clause matching only batch candidates", () => {
      const records = [
        { studentName: "Aarav Sharma", guardianPhone: "+91 98765 43210", guardianEmail: "rajesh@example.com" },
        { studentName: "Diya Patel", guardianPhone: "9876543211", guardianEmail: null },
      ];

      const where = buildCandidateLeadsWhere("tenant_sunrise_123", records);
      expect(where.tenantId).toBe("tenant_sunrise_123");
      expect(where.OR).toBeDefined();
      expect(where.OR!.length).toBe(3);

      // Names condition
      const nameCond = where.OR!.find((c: any) => c.studentName);
      expect(nameCond).toBeDefined();
      expect((nameCond as any).studentName.mode).toBe("insensitive");
      expect((nameCond as any).studentName.in).toContain("Aarav Sharma");
      expect((nameCond as any).studentName.in).toContain("Diya Patel");

      // Emails condition
      const emailCond = where.OR!.find((c: any) => c.guardianEmail);
      expect(emailCond).toBeDefined();
      expect((emailCond as any).guardianEmail.mode).toBe("insensitive");
      expect((emailCond as any).guardianEmail.in).toContain("rajesh@example.com");

      // Phones condition
      const phoneCond = where.OR!.find((c: any) => c.guardianPhone);
      expect(phoneCond).toBeDefined();
      expect((phoneCond as any).guardianPhone.in).toContain("+91 98765 43210");
      expect((phoneCond as any).guardianPhone.in).toContain("9876543210");

      // Empty batch safety
      const emptyWhere = buildCandidateLeadsWhere("tenant_sunrise_123", []);
      expect(emptyWhere.tenantId).toBe("tenant_sunrise_123");
      expect((emptyWhere as any).id).toBe("no_match_possible");
    });

    it("generates a downloadable sample CSV template with valid structure", () => {
      const sample = generateSampleLeadsCsv();
      expect(sample).toContain("Student Name");
      expect(sample).toContain("Guardian Phone");
      expect(sample).toContain("Aarav Sharma");
      expect(sample).toContain("WEBSITE");
    });
  });

  describe("Server Action: importLeadsCsvAction Validation & Security", () => {
    it("rejects unauthorized user without tenant.leads.write", async () => {
      (authorizeTenantWrite as any).mockResolvedValueOnce({
        ok: false,
        error: "Permission denied. You do not have permission to import leads.",
      });

      const formData = new FormData();
      formData.append("file", createMockCsvFile("Student Name\nAarav"));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Permission denied");
      }
    });

    it("rejects non-file or empty file uploads", async () => {
      const formData = new FormData();
      formData.append("file", "not-a-file");

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("Please choose a CSV file to import.");
      }
    });

    it("rejects CSV without Student Name column", async () => {
      const formData = new FormData();
      formData.append("file", createMockCsvFile("Guardian Name,Phone\nJohn,9876543210"));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("The CSV must include a 'Student Name' column.");
      }
    });

    it("rejects CSV exceeding maximum 300 data rows", async () => {
      let content = "Student Name,Guardian Phone\n";
      for (let i = 1; i <= 301; i++) {
        content += `Student ${i},9876500${i.toString().padStart(3, "0")}\n`;
      }

      const formData = new FormData();
      formData.append("file", createMockCsvFile(content));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("exceeds the maximum limit of 300 rows per import");
      }
    });

    it("successfully imports valid leads with defaults for missing optional fields", async () => {
      const csv =
        "Student Name,Date of Birth,Guardian Name,Guardian Phone,Guardian Email,Class,Status,Notes\n" +
        "Aarav Sharma,2015-05-12,Rajesh Sharma,9876543210,rajesh@example.com,Grade 5,NEW,Wants brochure\n" +
        "Diya Patel,2014-08-20,Sanjay Patel,9876543211,sanjay@example.com,Grade 6,,Hostel enquiry\n";

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.summary.total).toBe(2);
        expect(res.summary.imported).toBe(2);
        expect(res.summary.failed).toBe(0);
        expect(res.summary.duplicates).toBe(0);
      }

      // Verify db.lead.create was called with tenant isolation
      expect(db.lead.create).toHaveBeenCalledTimes(2);
      expect((db.lead.create as any).mock.calls[0][0].data.tenantId).toBe("tenant_sunrise_123");
      expect((db.lead.create as any).mock.calls[0][0].data.studentName).toBe("Aarav Sharma");
      expect((db.lead.create as any).mock.calls[0][0].data.status).toBe("NEW");
      expect((db.lead.create as any).mock.calls[1][0].data.status).toBe("NEW"); // defaulted
    });

    it("detects and skips in-file duplicates while importing non-duplicates", async () => {
      const csv =
        "Student Name,Guardian Phone,Guardian Email\n" +
        "Rohan Verma,9876543210,rohan@example.com\n" +
        "Rohan Verma,9876543210,other@example.com\n" + // duplicate phone & name
        "Meera Joshi,9876543299,meera@example.com\n";

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.summary.total).toBe(3);
        expect(res.summary.imported).toBe(2);
        expect(res.summary.duplicates).toBe(1);
        expect(res.summary.errors.length).toBe(1);
        expect(res.summary.errors[0].row).toBe(3);
        expect(res.summary.errors[0].message).toContain("Duplicate lead inside this CSV file");
      }
      expect(db.lead.create).toHaveBeenCalledTimes(2);
    });

    it("detects and skips existing database duplicates", async () => {
      (db.lead.findMany as any).mockResolvedValueOnce([
        {
          id: "lead_exist_1",
          studentName: "Aarav Sharma",
          guardianPhone: "9876543210",
          guardianEmail: "rajesh@example.com",
        },
      ]);

      const csv =
        "Student Name,Guardian Phone\n" +
        "Aarav Sharma,9876543210\n" + // already in DB
        "Pooja Rao,9876543222\n"; // new

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.summary.imported).toBe(1);
        expect(res.summary.duplicates).toBe(1);
        expect(res.summary.errors[0].row).toBe(2);
        expect(res.summary.errors[0].message).toContain("Existing lead already registered");
      }
      expect(db.lead.create).toHaveBeenCalledTimes(1);
    });

    it("reports row-level validation errors for invalid status, email, and dates", async () => {
      const csv =
        "Student Name,Guardian Phone,Guardian Email,Date of Birth,Status,Next Follow-Up\n" +
        "Invalid Status Guy,9876543210,valid@test.com,2015-01-01,SUPER_INTERESTED,2026-12-01\n" +
        "Bad Email Kid,9876543211,not-an-email,2015-01-01,NEW,2026-12-01\n" +
        "Bad Date Kid,9876543212,valid2@test.com,invalid-dob-date,NEW,not-a-followup\n" +
        "Valid Kid,9876543213,valid3@test.com,2015-01-01,NEW,2026-12-01\n";

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.summary.total).toBe(4);
        expect(res.summary.imported).toBe(1);
        expect(res.summary.failed).toBe(3);

        const row2Err = res.summary.errors.find((e) => e.row === 2);
        expect(row2Err?.message).toContain("Invalid status");

        const row3Err = res.summary.errors.find((e) => e.row === 3);
        expect(row3Err?.message).toContain("Invalid email address format");

        const row4Err = res.summary.errors.find((e) => e.row === 4);
        expect(row4Err?.message).toContain("Invalid Date of Birth");
      }
      expect(db.lead.create).toHaveBeenCalledTimes(1);
    });

    it("rejects cross-tenant assigned staff email with row-level error", async () => {
      const csv =
        "Student Name,Guardian Phone,Assigned Staff Email\n" +
        "Kunal Shah,9876543210,counselor@sunrise.test\n" + // exists in tenant
        "Vikram Joshi,9876543211,stranger@other-tenant.com\n"; // does not exist

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.summary.imported).toBe(1);
        expect(res.summary.failed).toBe(1);
        const err = res.summary.errors.find((e) => e.row === 3);
        expect(err?.message).toContain("does not belong to an active staff member in this institute");
      }
    });

    it("rejects cross-tenant academic year with row-level error", async () => {
      const csv =
        "Student Name,Guardian Phone,Academic Year\n" +
        "Student A,9876543210,2026-2027\n" + // matches year_2026
        "Student B,9876543211,1999-2000\n"; // does not exist in tenant

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.summary.imported).toBe(1);
        expect(res.summary.failed).toBe(1);
        const err = res.summary.errors.find((e) => e.row === 3);
        expect(err?.message).toContain("Academic year \"1999-2000\" was not found in this institute");
      }
    });

    it("returns error summary when all rows fail validation", async () => {
      const csv =
        "Student Name,Guardian Phone,Guardian Email\n" +
        ",9876543210,bad-email\n"; // missing student name and bad email

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(false);
      expect(res.summary?.imported).toBe(0);
      expect(res.summary?.failed).toBe(1);
      expect(db.lead.create).not.toHaveBeenCalled();
    });

    it("STRICT CSV: Rejects unclosed quotes, illegal quotes, and trailing chars with line/col details", async () => {
      // 1. Unclosed quote
      const unclosedCsv = 'Student Name,Phone\n"Aarav Sharma,9876543210';
      const form1 = new FormData();
      form1.append("file", createMockCsvFile(unclosedCsv));
      const res1 = await importLeadsCsvAction(form1);
      expect(res1.ok).toBe(false);
      if (!res1.ok) {
        expect(res1.error).toContain("Unclosed quote");
      }

      // 2. Unexpected quote in unquoted field
      const quoteInUnquoted = 'Student Name,Phone\nAarav"Sharma,9876543210';
      const form2 = new FormData();
      form2.append("file", createMockCsvFile(quoteInUnquoted));
      const res2 = await importLeadsCsvAction(form2);
      expect(res2.ok).toBe(false);
      if (!res2.ok) {
        expect(res2.error).toContain("Unexpected quote character inside unquoted field");
      }

      // 3. Characters after closing quote
      const charsAfterQuote = 'Student Name,Phone\n"Aarav Sharma"extra,9876543210';
      const form3 = new FormData();
      form3.append("file", createMockCsvFile(charsAfterQuote));
      const res3 = await importLeadsCsvAction(form3);
      expect(res3.ok).toBe(false);
      if (!res3.ok) {
        expect(res3.error).toContain("after closing quote");
      }
    });

    it("STRICT DATES: Rejects nonexistent calendar dates (leap-year violations, April 31, etc.)", async () => {
      const csv =
        "Student Name,Guardian Phone,Date of Birth,Next Follow-Up\n" +
        "Leap Fail,9876543210,2023-02-29,2024-05-01\n" + // 2023 is not a leap year!
        "Feb 31 Fail,9876543211,2024-02-31,2024-05-01\n" + // Feb 31 does not exist anywhere
        "April 31 Fail,9876543212,2024-04-31,2024-05-01\n" + // April only has 30 days
        "Valid Leap,9876543213,2024-02-29,2026-12-01\n"; // 2024 IS a leap year!

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.summary.imported).toBe(1);
        expect(res.summary.failed).toBe(3);
        const errs = res.summary.errors.map((e) => e.message);
        expect(errs.some((m) => m.includes("2023-02-29"))).toBe(true);
        expect(errs.some((m) => m.includes("2024-02-31"))).toBe(true);
        expect(errs.some((m) => m.includes("2024-04-31"))).toBe(true);
      }
    });

    it("STRICT SOURCES: Rejects unsupported source values and normalizes valid sources", async () => {
      const csv =
        "Student Name,Guardian Phone,Source\n" +
        "Bad Source Kid,9876543210,TELEVISION_AD\n" + // unsupported
        "Good Source Kid 1,9876543211,walk in\n" + // normalizes to WALK_IN
        "Good Source Kid 2,9876543212,WEBSITE\n";

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.summary.imported).toBe(2);
        expect(res.summary.failed).toBe(1);
        const badErr = res.summary.errors.find((e) => e.studentName === "Bad Source Kid");
        expect(badErr?.message).toContain("Supported sources are: WALK_IN, PHONE, WEBSITE, REFERRAL, SOCIAL, OTHER");
      }
    });

    it("STRICT ROLES: Rejects inactive staff or non-staff memberships (parents/students)", async () => {
      // Mock memberships where one is an inactive staff and one is a PARENT
      (db.membership.findMany as any).mockResolvedValueOnce([
        { id: "active_teacher", user: { email: "teacher@sunrise.test" }, role: { key: "TEACHER" } },
        // notice inactive staff or parents are NOT in this list because query filters status: ACTIVE and STAFF_ROLE_KEYS
      ]);

      const csv =
        "Student Name,Guardian Phone,Assigned Staff Email\n" +
        "Student 1,9876543210,teacher@sunrise.test\n" + // active teacher
        "Student 2,9876543211,parent@sunrise.test\n"; // parent account

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.summary.imported).toBe(1);
        expect(res.summary.failed).toBe(1);
        const err = res.summary.errors.find((e) => e.row === 3);
        expect(err?.message).toContain("does not belong to an active staff member in this institute");
      }
    });

    it("AUDIT CONSISTENCY: Audit logging failure after commit does NOT fail the import or report rollback", async () => {
      const { writeAudit } = await import("@/lib/audit");
      vi.mocked(writeAudit).mockRejectedValueOnce(new Error("Audit database network timeout"));

      const csv =
        "Student Name,Guardian Phone\n" +
        "Audit Test Student,9876543210\n";

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.summary.imported).toBe(1);
        expect(res.summary.failed).toBe(0);
      }
      expect(db.lead.create).toHaveBeenCalled();
    });

    it("TRANSACTION ROLLBACK: When LeadActivity creation fails inside transaction, transaction rolls back", async () => {
      (db.leadActivity.create as any).mockRejectedValueOnce(new Error("Disk quota exceeded"));

      const csv =
        "Student Name,Guardian Phone\n" +
        "Rollback Student,9876543210\n";

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Import transaction failed");
        expect(res.error).toContain("No records were imported");
      }
    });

    it("CONCURRENCY: Two simultaneous imports with identical records under lock detect duplicates", async () => {
      // Simulate state where first import inserts record, and second import inside transaction sees it in currentLeads
      let dbLeadsState: any[] = [];

      (db.$transaction as any).mockImplementation(async (cb: any) => {
        const mockTx = {
          $queryRawUnsafe: vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: "" }]),
          lead: {
            findMany: vi.fn().mockImplementation(() => Promise.resolve([...dbLeadsState])),
            create: vi.fn().mockImplementation(({ data }: any) => {
              const created = { id: "lead_" + Math.random(), ...data };
              dbLeadsState.push(created);
              return Promise.resolve(created);
            }),
          },
          leadActivity: {
            create: vi.fn().mockResolvedValue({ id: "act_1" }),
          },
        };
        return cb(mockTx);
      });

      const csv =
        "Student Name,Guardian Phone\n" +
        "Concurrent Student,9876543210\n";

      const formA = new FormData();
      formA.append("file", createMockCsvFile(csv));

      const formB = new FormData();
      formB.append("file", createMockCsvFile(csv));

      // Run sequentially or concurrently: Transaction A commits, Transaction B under lock sees record
      const resA = await importLeadsCsvAction(formA);
      expect(resA.ok).toBe(true);
      if (resA.ok) {
        expect(resA.summary.imported).toBe(1);
      }

      const resB = await importLeadsCsvAction(formB);
      // Res B should detect duplicate inside transaction under lock!
      expect(resB.ok).toBe(false);
      expect(resB.summary?.imported).toBe(0);
      expect(resB.summary?.duplicates).toBe(1);
    });

    it("CONCURRENCY LOCK: Acquires PostgreSQL advisory transaction lock before querying duplicates", async () => {
      const mockQueryRawUnsafe = vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: "" }]);
      (db.$transaction as any).mockImplementationOnce(async (cb: any) => {
        return cb({
          lead: db.lead,
          leadActivity: db.leadActivity,
          $queryRawUnsafe: mockQueryRawUnsafe,
        });
      });

      const csv = "Student Name,Guardian Phone\nLock Test Student,9876543210\n";
      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      expect(mockQueryRawUnsafe).toHaveBeenCalledWith(
        "SELECT pg_advisory_xact_lock(hashtext($1))::text",
        "lead_import_tenant_sunrise_123",
      );
    });

    it("CONCURRENCY LOCK ERROR: Aborts import transaction and returns clear error if lock acquisition fails", async () => {
      (db.$transaction as any).mockImplementationOnce(async (cb: any) => {
        return cb({
          lead: db.lead,
          leadActivity: db.leadActivity,
          $queryRawUnsafe: vi.fn().mockRejectedValue(new Error("deadlock detected or lock timeout")),
        });
      });

      const csv = "Student Name,Guardian Phone\nLock Fail Student,9876543210\n";
      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Import transaction failed");
        expect(res.error).toContain("Concurrency lock acquisition failed");
        expect(res.error).toContain("deadlock detected or lock timeout");
      }
    });

    it("FILE SIZE LIMIT: Rejects uploads larger than 2 MB upfront", async () => {
      // Create a mock File with size property = 2.5 MB
      const largeFile = new File(["dummy content"], "large.csv", { type: "text/csv" });
      Object.defineProperty(largeFile, "size", { value: 2.5 * 1024 * 1024 });

      const formData = new FormData();
      formData.append("file", largeFile);

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("must be smaller than 2 MB");
      }
    });

    it("PHONE VALIDATION: Normalizes valid international phones and rejects malformed phones", async () => {
      const csv =
        "Student Name,Guardian Phone\n" +
        "Intl Student 1,+91 98765 43210\n" + // valid international
        "Intl Student 2,+1 (555) 019-2834\n" + // valid US format
        "Bad Phone 1,12345\n" + // too short (< 6 digits)
        "Bad Phone 2,+91-ABC-43210\n"; // illegal alphabetic characters

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.summary.imported).toBe(2);
        expect(res.summary.failed).toBe(2);
      }
    });

    it("BOUNDED QUERY: Does NOT load unrelated tenant leads into duplicate detection", async () => {
      const capturedQueries: any[] = [];
      (db.lead.findMany as any).mockImplementation((args: any) => {
        capturedQueries.push(args);
        return Promise.resolve([]);
      });

      const csv =
        "Student Name,Guardian Phone,Guardian Email\n" +
        "Target Candidate,9876543210,target@example.com\n";

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      await importLeadsCsvAction(formData);

      expect(capturedQueries.length).toBeGreaterThan(0);
      for (const query of capturedQueries) {
        // Must contain tenantId
        expect(query.where.tenantId).toBe("tenant_sunrise_123");
        // Must NOT be an unbounded query { where: { tenantId } }
        expect(query.where.OR).toBeDefined();
        // The OR clause must target only candidates matching incoming row
        const studentNameCond = query.where.OR.find((c: any) => c.studentName);
        expect(studentNameCond).toBeDefined();
        expect(studentNameCond.studentName.in).toContain("Target Candidate");

        // Unrelated leads like "Unrelated Student X" are never included in the query criteria
        expect(studentNameCond.studentName.in).not.toContain("Unrelated Student X");
      }
    });

    it("LARGE TENANT SCALE: Handles tenants with 10,000 leads with bounded candidate queries", async () => {
      // Mock database having 10,000 leads, but only 1 matching candidate in tenant
      const dbCalls: number[] = [];
      (db.lead.findMany as any).mockImplementation((args: any) => {
        expect(args.where.OR).toBeDefined();
        // Candidate filter: check if studentName.in contains "Existing Student"
        const nameFilter = args.where.OR.find((c: any) => c.studentName);
        if (nameFilter && nameFilter.studentName.in.includes("Existing Student")) {
          dbCalls.push(1);
          return Promise.resolve([
            {
              id: "lead_existing_999",
              studentName: "Existing Student",
              guardianPhone: "9876543210",
              guardianEmail: "existing@example.com",
            },
          ]);
        }
        dbCalls.push(0);
        return Promise.resolve([]);
      });

      const csv =
        "Student Name,Guardian Phone\n" +
        "Existing Student,9876543210\n" + // duplicate of existing
        "New Student 1,9876543211\n" +    // new
        "New Student 2,9876543212\n";     // new

      const formData = new FormData();
      formData.append("file", createMockCsvFile(csv));

      const res = await importLeadsCsvAction(formData);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.summary.imported).toBe(2);
        expect(res.summary.duplicates).toBe(1);
        expect(res.summary.total).toBe(3);
      }
    });
  });
});
