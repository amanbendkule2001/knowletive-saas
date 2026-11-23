import { VALID_LEAD_STATUSES } from "@/lib/leads-export";
import type { LeadStatus, Prisma } from "@prisma/client";

export const MAX_LEAD_IMPORT_ROWS = 300;

export const VALID_LEAD_SOURCES = [
  "WALK_IN",
  "PHONE",
  "WEBSITE",
  "REFERRAL",
  "SOCIAL",
  "OTHER",
] as const;

export type LeadSource = (typeof VALID_LEAD_SOURCES)[number];

export type LeadImportRowError = {
  row: number;
  studentName?: string;
  field?: string;
  message: string;
};

export type LeadImportSummary = {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  duplicates: number;
  errors: LeadImportRowError[];
};

export type ParsedLeadRecord = {
  rowNumber: number;
  studentName: string;
  dob: Date | null;
  classInterested: string | null;
  academicYearId: string | null;
  academicYearName: string | null;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string | null;
  source: LeadSource;
  status: LeadStatus;
  assignedStaffEmail: string | null;
  assignedToId: string | null;
  nextFollowUp: Date | null;
  converted: boolean;
  notes: string | null;
};

// Aliases mapping for header normalization
const HEADER_ALIASES: Record<string, string> = {
  // Student Name
  studentname: "studentName",
  student: "studentName",
  prospectivestudent: "studentName",
  name: "studentName",
  student_name: "studentName",

  // Date of Birth
  dob: "dob",
  dateofbirth: "dob",
  date_of_birth: "dob",
  birthdate: "dob",

  // Class Interested
  classinterested: "classInterested",
  class: "classInterested",
  grade: "classInterested",
  gradeinterested: "classInterested",
  class_interested: "classInterested",

  // Academic Year
  academicyear: "academicYear",
  academicyearname: "academicYear",
  session: "academicYear",
  academic_year: "academicYear",
  year: "academicYear",

  // Guardian Name
  guardianname: "guardianName",
  guardian: "guardianName",
  parentname: "guardianName",
  parent: "guardianName",
  guardian_name: "guardianName",
  fathername: "guardianName",
  mothername: "guardianName",

  // Guardian Phone
  guardianphone: "guardianPhone",
  phone: "guardianPhone",
  contact: "guardianPhone",
  guardianmobile: "guardianPhone",
  mobile: "guardianPhone",
  guardian_phone: "guardianPhone",
  contactnumber: "guardianPhone",
  phone_number: "guardianPhone",

  // Guardian Email
  guardianemail: "guardianEmail",
  email: "guardianEmail",
  parentemail: "guardianEmail",
  guardian_email: "guardianEmail",

  // Source
  source: "source",
  enquirysource: "source",
  leadsource: "source",
  channel: "source",

  // Status
  status: "status",
  leadstatus: "status",
  lead_status: "status",

  // Assigned Staff Email
  assignedstaffemail: "assignedStaffEmail",
  assignedtoemail: "assignedStaffEmail",
  staffemail: "assignedStaffEmail",
  assignedstaff: "assignedStaffEmail",
  assigned_staff_email: "assignedStaffEmail",
  assignedto: "assignedStaffEmail",

  // Next Follow-Up
  nextfollowup: "nextFollowUp",
  followup: "nextFollowUp",
  followupdate: "nextFollowUp",
  next_follow_up: "nextFollowUp",

  // Converted
  converted: "converted",
  isconverted: "converted",
  enrolled: "converted",

  // Notes
  notes: "notes",
  note: "notes",
  remark: "notes",
  remarks: "notes",
  enquirynotes: "notes",
  comments: "notes",
};

/**
 * Normalizes raw CSV header tokens into canonical property keys.
 */
export function normalizeLeadHeaders(rawHeaders: string[]): Record<string, number> {
  const headerMap: Record<string, number> = {};

  rawHeaders.forEach((raw, index) => {
    const clean = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const canonical = HEADER_ALIASES[clean];
    if (canonical && !(canonical in headerMap)) {
      headerMap[canonical] = index;
    }
  });

  return headerMap;
}

/**
 * Validates and strictly parses calendar dates formatted as YYYY-MM-DD.
 * Rejects nonexistent dates such as leap-year violations (e.g. 2023-02-29, 2024-02-31).
 */
export function parseDateSafe(value: string | undefined): Date | null | "INVALID" {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return "INVALID";

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (year < 1900 || year > 2100) return "INVALID";
  if (month < 1 || month > 12) return "INVALID";

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (day < 1 || day > daysInMonth[month - 1]) {
    return "INVALID";
  }

  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Validates and normalizes enquiry sources against actual application values.
 */
export function normalizeAndValidateSource(
  rawSource: string | undefined,
): { ok: true; source: LeadSource } | { ok: false; error: string } {
  if (!rawSource || !rawSource.trim()) {
    return { ok: true, source: "WALK_IN" };
  }

  const clean = rawSource.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (VALID_LEAD_SOURCES.includes(clean as LeadSource)) {
    return { ok: true, source: clean as LeadSource };
  }

  // Handle common aliases
  if (clean === "WALK_IN_VISIT" || clean === "WALKIN") return { ok: true, source: "WALK_IN" };
  if (clean === "PHONE_CALL" || clean === "CALL" || clean === "TELEPHONE") return { ok: true, source: "PHONE" };
  if (clean === "WEBSITE_FORM" || clean === "WEB" || clean === "ONLINE") return { ok: true, source: "WEBSITE" };
  if (clean === "PARENT_REFERRAL" || clean === "WORD_OF_MOUTH") return { ok: true, source: "REFERRAL" };
  if (clean === "SOCIAL_MEDIA" || clean === "INSTAGRAM" || clean === "FACEBOOK") return { ok: true, source: "SOCIAL" };

  return {
    ok: false,
    error: `Invalid source "${rawSource}". Supported sources are: ${VALID_LEAD_SOURCES.join(", ")}.`,
  };
}

/**
 * Validates and normalizes phone numbers while preserving international notation (+).
 */
export function validateAndNormalizePhone(
  rawPhone: string | undefined,
): { ok: true; phone: string } | { ok: false; error: string } {
  if (!rawPhone || !rawPhone.trim()) {
    return { ok: true, phone: "Not provided" };
  }

  const trimmed = rawPhone.trim();
  if (!/^\+?[\d\s\-()]{6,25}$/.test(trimmed)) {
    return {
      ok: false,
      error: `Invalid phone number "${rawPhone}". Allowed characters are digits, spaces, hyphens, parentheses, and an optional leading +.`,
    };
  }

  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length < 6 || digitsOnly.length > 15) {
    return {
      ok: false,
      error: `Invalid phone number "${rawPhone}". Must contain between 6 and 15 digits (contains ${digitsOnly.length}).`,
    };
  }

  const hasPlus = trimmed.startsWith("+");
  const normalized = (hasPlus ? "+" : "") + trimmed.replace(/^\+/, "").replace(/\s+/g, " ").trim();

  if (normalized.length > 20) {
    const compact = (hasPlus ? "+" : "") + digitsOnly;
    return { ok: true, phone: compact.slice(0, 20) };
  }

  return { ok: true, phone: normalized };
}

export function isValidEmail(email: string): boolean {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email.trim());
}

/**
 * Builds a bounded Prisma where clause matching only candidate lead records
 * for the incoming batch, preserving strict tenant isolation while avoiding full-table scans.
 */
export function buildCandidateLeadsWhere(
  tenantId: string,
  records: Array<{
    studentName?: string | null;
    guardianPhone?: string | null;
    guardianEmail?: string | null;
  }>,
): Prisma.LeadWhereInput {
  const names = new Set<string>();
  const emails = new Set<string>();
  const phones = new Set<string>();

  for (const r of records) {
    if (r.studentName && r.studentName.trim()) {
      names.add(r.studentName.trim());
    }
    if (r.guardianEmail && r.guardianEmail.trim() && r.guardianEmail.includes("@")) {
      emails.add(r.guardianEmail.trim().toLowerCase());
    }
    if (r.guardianPhone && r.guardianPhone.trim() && r.guardianPhone !== "Not provided") {
      const rawP = r.guardianPhone.trim();
      phones.add(rawP);
      const digits = rawP.replace(/\D/g, "");
      if (digits.length >= 6) {
        phones.add(digits);
        if (digits.length > 10) {
          phones.add(digits.slice(-10));
        }
      }
    }
  }

  // If there are no candidate criteria, return impossible condition to avoid matching anything
  if (names.size === 0 && emails.size === 0 && phones.size === 0) {
    return { tenantId, id: "no_match_possible" };
  }

  const orClauses: Prisma.LeadWhereInput[] = [];
  if (names.size > 0) {
    orClauses.push({ studentName: { in: Array.from(names), mode: "insensitive" } });
  }
  if (emails.size > 0) {
    orClauses.push({ guardianEmail: { in: Array.from(emails), mode: "insensitive" as const } });
  }
  if (phones.size > 0) {
    orClauses.push({ guardianPhone: { in: Array.from(phones) } });
  }

  return {
    tenantId,
    OR: orClauses,
  };
}

/**
 * Generates a deterministic duplicate matching key for leads.
 */
export function makeLeadDuplicateKey(studentName: string, phoneOrEmail: string): string {
  const cleanName = studentName.trim().toLowerCase().replace(/\s+/g, " ");
  if (phoneOrEmail.includes("@")) {
    return `${cleanName}|${phoneOrEmail.trim().toLowerCase()}`;
  }
  const digits = phoneOrEmail.replace(/\D/g, "");
  const cleanPhone = digits.length > 10 ? digits.slice(-10) : digits;
  return `${cleanName}|${cleanPhone}`;
}

/**
 * Generates sample CSV template content for leads import.
 */
export function generateSampleLeadsCsv(): string {
  const headers = [
    "Student Name",
    "Date of Birth",
    "Class Interested",
    "Academic Year",
    "Guardian Name",
    "Guardian Phone",
    "Guardian Email",
    "Source",
    "Status",
    "Assigned Staff Email",
    "Next Follow-Up",
    "Converted",
    "Notes",
  ];

  const sampleRows = [
    [
      "Aarav Sharma",
      "2014-05-12",
      "Grade 6",
      "",
      "Rajesh Sharma",
      "+91 9876543210",
      "rajesh.sharma@example.com",
      "WEBSITE",
      "NEW",
      "",
      "2026-11-20",
      "No",
      "Interested in CBSE syllabus and transportation",
    ],
    [
      "Diya Patel",
      "2012-08-22",
      "Grade 8",
      "",
      "Sanjay Patel",
      "+91 9876543211",
      "sanjay.patel@example.com",
      "WALK_IN",
      "CONTACTED",
      "",
      "2026-11-25",
      "No",
      "Scheduled campus tour next Monday",
    ],
    [
      "Rohan Verma",
      "2010-02-14",
      "Grade 10",
      "",
      "Sunita Verma",
      "+91 9876543212",
      "sunita.verma@example.com",
      "REFERRAL",
      "INTERESTED",
      "",
      "2026-11-28",
      "No",
      "Ready for entrance assessment",
    ],
  ];

  const escapeCell = (c: string) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  const csvLines = [
    headers.map(escapeCell).join(","),
    ...sampleRows.map((r) => r.map(escapeCell).join(",")),
  ];

  return csvLines.join("\r\n");
}
