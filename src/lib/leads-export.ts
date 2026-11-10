import { escapeCsvCell } from "@/lib/csv";
import type { Prisma, LeadStatus } from "@prisma/client";

export const VALID_LEAD_STATUSES: LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "FOLLOW_UP",
  "INTERESTED",
  "CONVERTED",
  "LOST",
];

export const MAX_LEADS_EXPORT_LIMIT = 5000;

export const LEADS_CSV_HEADERS = [
  "Lead ID",
  "Student Name",
  "Date of Birth",
  "Class Interested",
  "Academic Year",
  "Guardian Name",
  "Guardian Phone",
  "Guardian Email",
  "Source",
  "Status",
  "Assigned Staff",
  "Assigned Staff Email",
  "Next Follow-Up",
  "Converted",
  "Notes",
  "Created Date",
  "Last Updated Date",
] as const;

export type LeadExportRecord = {
  id: string;
  studentName: string;
  dob: Date | null;
  classInterested: string | null;
  academicYear: { name: string } | null;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string | null;
  source: string;
  status: LeadStatus;
  assignedTo: { user: { name: string; email: string } } | null;
  nextFollowUp: Date | null;
  notes: string | null;
  convertedStudentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const leadsExportSelect = {
  id: true,
  studentName: true,
  dob: true,
  classInterested: true,
  academicYear: { select: { name: true } },
  guardianName: true,
  guardianPhone: true,
  guardianEmail: true,
  source: true,
  status: true,
  assignedTo: { select: { user: { select: { name: true, email: true } } } },
  nextFollowUp: true,
  notes: true,
  convertedStudentId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Builds a strictly tenant-isolated Prisma where input for leads export,
 * mirroring the exact filtering semantics of the Leads page.
 */
export function buildLeadsWhereClause(
  tenantId: string,
  filters?: { status?: string; q?: string },
): Prisma.LeadWhereInput {
  const q = (filters?.q ?? "").trim();
  const rawStatus = (filters?.status ?? "").trim().toUpperCase();
  const statusFilter = VALID_LEAD_STATUSES.includes(rawStatus as LeadStatus)
    ? (rawStatus as LeadStatus)
    : undefined;

  return {
    tenantId,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(q
      ? {
          OR: [
            { studentName: { contains: q, mode: "insensitive" } },
            { guardianName: { contains: q, mode: "insensitive" } },
            { guardianPhone: { contains: q } },
            { guardianEmail: { contains: q, mode: "insensitive" } },
            { classInterested: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

/** Formats a single lead record into an array of cell values. */
export function formatLeadToRow(lead: LeadExportRecord): string[] {
  return [
    lead.id,
    lead.studentName,
    lead.dob ? lead.dob.toISOString().slice(0, 10) : "",
    lead.classInterested ?? "",
    lead.academicYear?.name ?? "",
    lead.guardianName,
    lead.guardianPhone,
    lead.guardianEmail ?? "",
    lead.source.replace(/_/g, " "),
    lead.status.replace(/_/g, " "),
    lead.assignedTo?.user.name ?? "Unassigned",
    lead.assignedTo?.user.email ?? "",
    lead.nextFollowUp ? lead.nextFollowUp.toISOString().slice(0, 10) : "",
    lead.convertedStudentId ? "Yes" : "No",
    lead.notes ?? "",
    lead.createdAt ? lead.createdAt.toISOString().slice(0, 10) : "",
    lead.updatedAt ? lead.updatedAt.toISOString().slice(0, 10) : "",
  ];
}

/**
 * Serializes lead records to an RFC-4180 CSV string with Formula Injection
 * defenses applied to every cell via escapeCsvCell.
 */
export function serializeLeadsCsv(leads: LeadExportRecord[]): string {
  const rows = leads.map(formatLeadToRow);
  return [LEADS_CSV_HEADERS, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");
}

/** Generates a sanitized export filename incorporating tenant slug and current date. */
export function generateLeadsFilename(slug: string, exportDate: Date = new Date()): string {
  const sanitizedSlug = slug.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "knowletive";
  const stamp = exportDate.toISOString().slice(0, 10);
  return `${sanitizedSlug}-leads-${stamp}.csv`;
}
