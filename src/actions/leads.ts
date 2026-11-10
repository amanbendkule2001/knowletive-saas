"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getTenantContext, hasTenantPermission, isStaffMember } from "@/lib/auth";
import { authorizeTenantWrite } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { assertStudentCapacityTx } from "@/lib/entitlements";
import { fieldErrors, type FormState } from "@/lib/validation";
import { parseCsv, CsvParseError } from "@/lib/csv";
import { STAFF_ROLE_KEYS } from "@/lib/catalog";
import {
  buildLeadsWhereClause,
  leadsExportSelect,
  serializeLeadsCsv,
  generateLeadsFilename,
  type LeadExportRecord,
  VALID_LEAD_STATUSES,
  MAX_LEADS_EXPORT_LIMIT,
} from "@/lib/leads-export";
import {
  MAX_LEAD_IMPORT_ROWS,
  normalizeLeadHeaders,
  parseDateSafe,
  isValidEmail,
  makeLeadDuplicateKey,
  buildCandidateLeadsWhere,
  normalizeAndValidateSource,
  validateAndNormalizePhone,
  type LeadImportSummary,
  type LeadImportRowError,
  type LeadSource,
} from "@/lib/leads-import";
import type { LeadStatus } from "@prisma/client";

function toDate(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

import { createLeadSchema, convertLeadSchema } from "@/lib/leads-schema";
const leadSchema = createLeadSchema;

export async function createLeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.leads.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const parsed = leadSchema.safeParse({
    studentName: formData.get("studentName"),
    dob: formData.get("dob"),
    guardianName: formData.get("guardianName"),
    guardianPhone: formData.get("guardianPhone"),
    guardianEmail: formData.get("guardianEmail"),
    classInterested: formData.get("classInterested"),
    academicYearId: formData.get("academicYearId"),
    source: formData.get("source") || "WALK_IN",
    status: (formData.get("status") as LeadStatus) || "NEW",
    assignedToId: formData.get("assignedToId"),
    nextFollowUp: formData.get("nextFollowUp"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const d = parsed.data;

  // Validate assigned staff belongs to this tenant if provided
  let assignedToId: string | null = null;
  if (d.assignedToId) {
    const staff = await db.membership.findFirst({
      where: { id: d.assignedToId, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    if (staff) assignedToId = staff.id;
  }

  // Validate academic year belongs to this tenant if provided
  let academicYearId: string | null = null;
  if (d.academicYearId) {
    const year = await db.academicYear.findFirst({
      where: { id: d.academicYearId, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    if (year) academicYearId = year.id;
  }

  let leadId = "";
  try {
    leadId = await db.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          tenantId: ctx.tenant.id,
          studentName: d.studentName,
          dob: toDate(d.dob),
          guardianName: d.guardianName,
          guardianPhone: d.guardianPhone,
          guardianEmail: d.guardianEmail || null,
          classInterested: d.classInterested || null,
          academicYearId,
          source: d.source || "WALK_IN",
          status: d.status,
          assignedToId,
          nextFollowUp: toDate(d.nextFollowUp),
          notes: d.notes || null,
        },
      });

      await tx.leadActivity.create({
        data: {
          tenantId: ctx.tenant.id,
          leadId: lead.id,
          actorId: ctx.user.id,
          action: "CREATED",
          notes: d.notes ? `Initial enquiry: ${d.notes}` : "Enquiry registered in system.",
        },
      });

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "lead.create",
          entity: "Lead",
          entityId: lead.id,
          meta: { studentName: d.studentName, phone: d.guardianPhone, status: d.status },
        },
        tx
      );

      return lead.id;
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create lead enquiry.";
    console.error("[leads] create failed:", err);
    return { error: message };
  }

  revalidatePath("/app/leads");
  revalidatePath("/app");
  redirect(`/app/leads/${leadId}?created=1`);
}

export async function updateLeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.leads.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const leadId = String(formData.get("leadId") ?? "").trim();
  if (!leadId) return { error: "Lead ID is required." };

  const existing = await db.lead.findFirst({
    where: { id: leadId, tenantId: ctx.tenant.id },
  });
  if (!existing) return { error: "Lead enquiry not found in this institute." };

  const parsed = leadSchema.safeParse({
    studentName: formData.get("studentName"),
    dob: formData.get("dob"),
    guardianName: formData.get("guardianName"),
    guardianPhone: formData.get("guardianPhone"),
    guardianEmail: formData.get("guardianEmail"),
    classInterested: formData.get("classInterested"),
    academicYearId: formData.get("academicYearId"),
    source: formData.get("source") || existing.source,
    status: (formData.get("status") as LeadStatus) || existing.status,
    assignedToId: formData.get("assignedToId"),
    nextFollowUp: formData.get("nextFollowUp"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const d = parsed.data;

  let assignedToId: string | null = null;
  if (d.assignedToId) {
    const staff = await db.membership.findFirst({
      where: { id: d.assignedToId, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    if (staff) assignedToId = staff.id;
  }

  const statusChanged = existing.status !== d.status;

  try {
    await db.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: leadId },
        data: {
          studentName: d.studentName,
          dob: toDate(d.dob),
          guardianName: d.guardianName,
          guardianPhone: d.guardianPhone,
          guardianEmail: d.guardianEmail || null,
          classInterested: d.classInterested || null,
          academicYearId: d.academicYearId || null,
          source: d.source || existing.source,
          status: d.status,
          assignedToId,
          nextFollowUp: toDate(d.nextFollowUp),
          notes: d.notes || null,
        },
      });

      if (statusChanged) {
        await tx.leadActivity.create({
          data: {
            tenantId: ctx.tenant.id,
            leadId,
            actorId: ctx.user.id,
            action: "STATUS_CHANGE",
            notes: `Status changed from ${existing.status} to ${d.status}.`,
          },
        });
      }

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "lead.update",
          entity: "Lead",
          entityId: leadId,
          meta: { status: d.status, statusChanged },
        },
        tx
      );
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update lead details.";
    console.error("[leads] update failed:", err);
    return { error: message };
  }

  revalidatePath("/app/leads");
  revalidatePath(`/app/leads/${leadId}`);
  return { success: "Lead details saved." };
}

export async function logLeadActivityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.leads.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const leadId = String(formData.get("leadId") ?? "").trim();
  const action = String(formData.get("action") ?? "NOTE").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const nextFollowUp = String(formData.get("nextFollowUp") ?? "").trim();

  if (!leadId) return { error: "Lead ID is required." };
  if (!notes) return { error: "Please enter activity or call notes." };

  const lead = await db.lead.findFirst({
    where: { id: leadId, tenantId: ctx.tenant.id },
  });
  if (!lead) return { error: "Lead not found in this institute." };

  try {
    await db.$transaction(async (tx) => {
      await tx.leadActivity.create({
        data: {
          tenantId: ctx.tenant.id,
          leadId,
          actorId: ctx.user.id,
          action: action || "NOTE",
          notes,
        },
      });

      if (nextFollowUp) {
        await tx.lead.update({
          where: { id: leadId },
          data: { nextFollowUp: toDate(nextFollowUp) },
        });
      }

      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "lead.activity_logged",
          entity: "Lead",
          entityId: leadId,
          meta: { actionType: action },
        },
        tx
      );
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to log activity.";
    console.error("[leads] log activity failed:", err);
    return { error: message };
  }

  revalidatePath(`/app/leads/${leadId}`);
  revalidatePath("/app/leads");
  return { success: "Activity logged successfully." };
}

export async function deleteLeadAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.leads.delete", "delete");
  const leadId = String(formData.get("leadId") ?? "").trim();
  if (!auth.ok) {
    if (leadId) redirect(`/app/leads/${leadId}?denied_action=delete`);
    redirect("/app/leads?denied_action=delete");
  }
  const ctx = auth.ctx;

  if (!leadId) return;

  const lead = await db.lead.findFirst({
    where: { id: leadId, tenantId: ctx.tenant.id },
  });
  if (!lead) return;

  if (lead.status === "CONVERTED" || lead.convertedStudentId) {
    redirect(`/app/leads/${leadId}?error=${encodeURIComponent("Converted leads cannot be deleted because an official student record exists.")}`);
  }

  await db.lead.delete({
    where: { id: leadId },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "lead.delete",
    entity: "Lead",
    entityId: leadId,
    meta: { studentName: lead.studentName },
  });

  revalidatePath("/app/leads");
  redirect("/app/leads?deleted=1");
}

export async function draftLeadReplyAction(
  _prev: FormState & { reply?: string },
  formData: FormData
): Promise<FormState & { reply?: string }> {
  const auth = await authorizeTenantWrite("tenant.leads.write", "general");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const leadId = String(formData.get("leadId") ?? "").trim();
  const lead = await db.lead.findFirst({
    where: { id: leadId, tenantId: ctx.tenant.id },
  });
  if (!lead) return { error: "Lead not found in this institute." };

  const reply = `Admission Enquiry Reply — ${ctx.tenant.name}

Dear ${lead.guardianName},

Thank you for your interest in ${ctx.tenant.name} regarding admission for ${lead.studentName}${lead.classInterested ? ` into ${lead.classInterested}` : ""}. We would be delighted to assist you with the admission process.

Next Steps
• We invite you to visit our campus for an interactive session and campus tour (Monday to Saturday, 9:00 AM – 3:00 PM).
• Our admissions desk has recorded your enquiry for ${lead.classInterested || "the upcoming session"}.
• Please confirm your preferred date and time for the campus visit.

Documents Checklist
• Student's Birth Certificate & Aadhaar card copy
• Transfer Certificate (TC) & previous academic report card
• 4 passport-size photographs of the student
• Guardian identity and address proof

Please feel free to contact us if you have any questions regarding the curriculum, fee schedule, or transport routes.

Warm regards,
Admissions Office
${ctx.tenant.name}`;

  return { success: "Reply draft generated successfully.", reply };
}

const convertSchema = convertLeadSchema;

export async function convertLeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.leads.convert", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const parsed = convertSchema.safeParse({
    leadId: formData.get("leadId"),
    admissionNo: formData.get("admissionNo"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    dob: formData.get("dob"),
    gender: formData.get("gender"),
    bloodGroup: formData.get("bloodGroup"),
    address: formData.get("address"),
    classId: formData.get("classId"),
    sectionId: formData.get("sectionId"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const d = parsed.data;

  let createdStudentId = "";
  try {
    createdStudentId = await db.$transaction(async (tx) => {
      // 1. PESSIMISTIC ROW-LOCK: lock the tenant record to serialize concurrent admissions
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${ctx.tenant.id} FOR UPDATE`;

      // 2. RE-VERIFY LEAD with lock
      const lead = await tx.lead.findFirst({
        where: { id: d.leadId, tenantId: ctx.tenant.id },
      });
      if (!lead) throw new Error("Lead enquiry not found in this institute.");
      if (lead.status === "CONVERTED" || lead.convertedStudentId) {
        throw new Error("This lead has already been converted to an active student.");
      }

      // 3. TRANSACTIONAL QUOTA CHECK (enforced under the Tenant lock)
      await assertStudentCapacityTx(tx, ctx.tenant.id, 1);

      // 4. ADMISSION NUMBER UNIQUENESS
      const duplicateNo = await tx.student.findFirst({
        where: { tenantId: ctx.tenant.id, admissionNo: d.admissionNo },
        select: { id: true },
      });
      if (duplicateNo) {
        throw new Error(`Admission number "${d.admissionNo}" is already in use.`);
      }

      // 5. CLASS & SECTION VALIDATION
      let classId: string | null = d.classId || null;
      if (d.sectionId) {
        const section = await tx.section.findFirst({
          where: { id: d.sectionId, tenantId: ctx.tenant.id },
          select: { id: true, classId: true },
        });
        if (!section) throw new Error("That class section was not found in this institute.");
        classId = section.classId;
      }

      // 6. GUARDIAN DEDUPLICATION BY PHONE
      let guardianId: string;
      const existingGuardian = await tx.guardian.findFirst({
        where: { tenantId: ctx.tenant.id, phone: lead.guardianPhone },
      });
      if (existingGuardian) {
        guardianId = existingGuardian.id;
      } else {
        const newGuardian = await tx.guardian.create({
          data: {
            tenantId: ctx.tenant.id,
            name: lead.guardianName,
            phone: lead.guardianPhone,
            email: lead.guardianEmail || null,
          },
        });
        guardianId = newGuardian.id;
      }

      // 7. CREATE STUDENT
      const student = await tx.student.create({
        data: {
          tenantId: ctx.tenant.id,
          admissionNo: d.admissionNo,
          firstName: d.firstName,
          lastName: d.lastName,
          dob: toDate(d.dob) || lead.dob,
          gender: d.gender || null,
          bloodGroup: d.bloodGroup || null,
          address: d.address || null,
          classId,
          sectionId: d.sectionId || null,
          status: "ACTIVE",
        },
      });

      // 8. LINK STUDENT TO GUARDIAN
      await tx.studentGuardian.create({
        data: {
          studentId: student.id,
          guardianId,
          isPrimary: true,
        },
      });

      // 9. UPDATE LEAD TO CONVERTED
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: "CONVERTED",
          convertedStudentId: student.id,
        },
      });

      // 10. CREATE LEAD ACTIVITY RECORD
      await tx.leadActivity.create({
        data: {
          tenantId: ctx.tenant.id,
          leadId: lead.id,
          actorId: ctx.user.id,
          action: "CONVERTED",
          notes: `Converted to Student (Admission No: ${d.admissionNo})`,
        },
      });

      // 11. ATOMIC AUDIT LOG
      await writeAudit(
        {
          tenantId: ctx.tenant.id,
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "lead.convert",
          entity: "Student",
          entityId: student.id,
          meta: { leadId: lead.id, admissionNo: d.admissionNo },
        },
        tx
      );

      return student.id;
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to convert lead to student.";
    console.error("[leads] conversion failed:", err);
    return { error: message };
  }

  revalidatePath("/app/leads");
  revalidatePath(`/app/leads/${d.leadId}`);
  revalidatePath("/app/students");
  revalidatePath(`/app/students/${createdStudentId}`);
  revalidatePath("/app");
  redirect(`/app/students/${createdStudentId}?converted_from_lead=1`);
}

export async function exportLeadsCsvAction(filters?: {
  status?: string;
  q?: string;
}): Promise<
  | { ok: true; data: { filename: string; csvContent: string; count: number } }
  | { ok: false; error: string }
> {
  const ctx = await getTenantContext();
  if (!ctx) {
    return { ok: false, error: "Unauthorized access" };
  }
  if (!isStaffMember(ctx) || !hasTenantPermission(ctx, "tenant.leads.read")) {
    return {
      ok: false,
      error: "Access denied. You do not have permission to export leads.",
    };
  }

  const where = buildLeadsWhereClause(ctx.tenant.id, filters);

  const totalMatching = await db.lead.count({ where });
  if (totalMatching > MAX_LEADS_EXPORT_LIMIT) {
    return {
      ok: false,
      error: `Export limit exceeded. Your query matches ${totalMatching} leads, which exceeds the maximum limit of ${MAX_LEADS_EXPORT_LIMIT} records per export. Please narrow your query using search or status filters.`,
    };
  }

  const CHUNK_SIZE = 1000;
  const leads: LeadExportRecord[] = [];
  for (let offset = 0; offset < totalMatching; offset += CHUNK_SIZE) {
    const chunk = (await db.lead.findMany({
      where,
      select: leadsExportSelect,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: offset,
      take: CHUNK_SIZE,
    })) as unknown as LeadExportRecord[];
    leads.push(...chunk);
  }

  const filename = generateLeadsFilename(ctx.tenant.slug);
  const csvContent = serializeLeadsCsv(leads);

  return {
    ok: true,
    data: {
      filename,
      csvContent,
      count: leads.length,
    },
  };
}

export async function importLeadsCsvAction(
  formData: FormData,
): Promise<
  | { ok: true; summary: LeadImportSummary; message: string }
  | { ok: false; error: string; summary?: LeadImportSummary }
> {
  const auth = await authorizeTenantWrite("tenant.leads.write", "create");
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }
  const ctx = auth.ctx;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Please choose a CSV file to import." };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, error: "The CSV file must be smaller than 2 MB." };
  }

  let rows: string[][];
  try {
    const text = await file.text();
    rows = parseCsv(text);
  } catch (err: unknown) {
    const errorMsg =
      err instanceof CsvParseError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not parse CSV file. Ensure it is encoded in UTF-8 format.";
    return {
      ok: false,
      error: errorMsg,
    };
  }

  if (rows.length < 2) {
    return {
      ok: false,
      error: "The CSV needs a header row and at least one lead data row.",
    };
  }

  const rawHeaders = rows.shift()!;
  const headerMap = normalizeLeadHeaders(rawHeaders);

  if (!("studentName" in headerMap)) {
    return {
      ok: false,
      error: "The CSV must include a 'Student Name' column.",
    };
  }

  const dataRows = rows;
  if (dataRows.length > MAX_LEAD_IMPORT_ROWS) {
    return {
      ok: false,
      error: `This file contains ${dataRows.length} lead records, which exceeds the maximum limit of ${MAX_LEAD_IMPORT_ROWS} rows per import. No records were imported. Please split your file into batches of ${MAX_LEAD_IMPORT_ROWS} or fewer.`,
    };
  }

  // Pre-scan candidate prospective student identifiers from CSV to bound database duplicate checks
  const candidateRows = dataRows.map((r) => ({
    studentName: headerMap["studentName"] !== undefined ? r[headerMap["studentName"]] : null,
    guardianPhone: headerMap["guardianPhone"] !== undefined ? r[headerMap["guardianPhone"]] : null,
    guardianEmail: headerMap["guardianEmail"] !== undefined ? r[headerMap["guardianEmail"]] : null,
  }));
  const candidateLeadsWhere = buildCandidateLeadsWhere(ctx.tenant.id, candidateRows);

  // Pre-fetch tenant context dependencies to validate relational integrity
  // Note: Bounded candidate query avoids fetching unrelated tenant leads
  // Staff memberships must be ACTIVE and have an authorized staff role (no parents/students/inactive)
  const [existingLeads, staffMembers, academicYears] = await Promise.all([
    db.lead.findMany({
      where: candidateLeadsWhere,
      select: {
        id: true,
        studentName: true,
        guardianPhone: true,
        guardianEmail: true,
      },
    }),
    db.membership.findMany({
      where: {
        tenantId: ctx.tenant.id,
        status: "ACTIVE",
        role: { key: { in: Array.from(STAFF_ROLE_KEYS) } },
      },
      select: {
        id: true,
        user: { select: { email: true } },
        role: { select: { key: true } },
      },
    }),
    db.academicYear.findMany({
      where: { tenantId: ctx.tenant.id },
      select: { id: true, name: true },
    }),
  ]);

  const staffByEmail = new Map<string, string>();
  for (const m of staffMembers) {
    if (m.user?.email) staffByEmail.set(m.user.email.toLowerCase().trim(), m.id);
  }

  const yearMap = new Map<string, string>();
  for (const y of academicYears) {
    yearMap.set(y.name.toLowerCase().trim(), y.id);
    yearMap.set(y.id, y.id);
  }

  // Set of existing duplicate keys in database
  const existingDupKeys = new Set<string>();
  for (const l of existingLeads) {
    if (l.guardianPhone && l.guardianPhone !== "Not provided" && /\d/.test(l.guardianPhone)) {
      existingDupKeys.add(makeLeadDuplicateKey(l.studentName, l.guardianPhone));
    }
    if (l.guardianEmail && l.guardianEmail.includes("@")) {
      existingDupKeys.add(makeLeadDuplicateKey(l.studentName, l.guardianEmail));
    }
  }

  const seenInFile = new Set<string>();
  const errors: LeadImportRowError[] = [];
  const validRecords: Array<{
    studentName: string;
    dob: Date | null;
    classInterested: string | null;
    academicYearId: string | null;
    guardianName: string;
    guardianPhone: string;
    guardianEmail: string | null;
    source: LeadSource;
    status: LeadStatus;
    assignedToId: string | null;
    nextFollowUp: Date | null;
    notes: string | null;
  }> = [];

  let duplicatesCount = 0;
  let failedCount = 0;

  for (let idx = 0; idx < dataRows.length; idx++) {
    const row = dataRows[idx];
    const rowNumber = idx + 2; // header is row 1

    const getVal = (key: string): string => {
      const colIdx = headerMap[key];
      return colIdx !== undefined && colIdx < row.length ? (row[colIdx]?.trim() ?? "") : "";
    };

    const studentName = getVal("studentName");
    const rawDob = getVal("dob");
    const classInterested = getVal("classInterested") || null;
    const rawYear = getVal("academicYear");
    const guardianName = getVal("guardianName");
    const rawPhone = getVal("guardianPhone");
    const guardianEmail = getVal("guardianEmail");
    const rawSource = getVal("source");
    const rawStatus = getVal("status");
    const staffEmail = getVal("assignedStaffEmail");
    const rawFollowUp = getVal("nextFollowUp");
    const notes = getVal("notes") || null;

    let rowHasError = false;

    // 1. Validate required student name
    if (!studentName || studentName.length < 2) {
      errors.push({
        row: rowNumber,
        field: "Student Name",
        message: "Student name is required and must be at least 2 characters.",
      });
      rowHasError = true;
    } else if (studentName.length > 80) {
      errors.push({
        row: rowNumber,
        studentName,
        field: "Student Name",
        message: "Student name exceeds maximum 80 characters.",
      });
      rowHasError = true;
    }

    // 2. Validate and normalize phone
    const phoneRes = validateAndNormalizePhone(rawPhone);
    let finalGuardianPhone = "Not provided";
    if (!phoneRes.ok) {
      errors.push({
        row: rowNumber,
        studentName,
        field: "Guardian Phone",
        message: phoneRes.error,
      });
      rowHasError = true;
    } else {
      finalGuardianPhone = phoneRes.phone;
    }

    const finalGuardianName = guardianName || (studentName ? `Guardian of ${studentName}` : "Guardian");

    // 3. Validate guardian email
    let finalGuardianEmail: string | null = null;
    if (guardianEmail) {
      if (!isValidEmail(guardianEmail)) {
        errors.push({
          row: rowNumber,
          studentName,
          field: "Guardian Email",
          message: `Invalid email address format "${guardianEmail}".`,
        });
        rowHasError = true;
      } else {
        finalGuardianEmail = guardianEmail.toLowerCase();
      }
    }

    // 4. Validate DOB (strict YYYY-MM-DD calendar date)
    let finalDob: Date | null = null;
    if (rawDob) {
      const parsed = parseDateSafe(rawDob);
      if (parsed === "INVALID") {
        errors.push({
          row: rowNumber,
          studentName,
          field: "Date of Birth",
          message: `Invalid Date of Birth "${rawDob}". Expected format: YYYY-MM-DD (valid calendar date).`,
        });
        rowHasError = true;
      } else {
        finalDob = parsed;
      }
    }

    // 5. Validate nextFollowUp (strict YYYY-MM-DD calendar date)
    let finalFollowUp: Date | null = null;
    if (rawFollowUp) {
      const parsed = parseDateSafe(rawFollowUp);
      if (parsed === "INVALID") {
        errors.push({
          row: rowNumber,
          studentName,
          field: "Next Follow-Up",
          message: `Invalid Next Follow-Up date "${rawFollowUp}". Expected format: YYYY-MM-DD (valid calendar date).`,
        });
        rowHasError = true;
      } else {
        finalFollowUp = parsed;
      }
    }

    // 6. Validate source
    const sourceRes = normalizeAndValidateSource(rawSource);
    let finalSource: LeadSource = "WALK_IN";
    if (!sourceRes.ok) {
      errors.push({
        row: rowNumber,
        studentName,
        field: "Source",
        message: sourceRes.error,
      });
      rowHasError = true;
    } else {
      finalSource = sourceRes.source;
    }

    // 7. Validate status
    let finalStatus: LeadStatus = "NEW";
    if (rawStatus) {
      const upper = rawStatus.toUpperCase();
      if (VALID_LEAD_STATUSES.includes(upper as LeadStatus)) {
        finalStatus = upper as LeadStatus;
      } else {
        errors.push({
          row: rowNumber,
          studentName,
          field: "Status",
          message: `Invalid status "${rawStatus}". Valid values are: ${VALID_LEAD_STATUSES.join(", ")}.`,
        });
        rowHasError = true;
      }
    }

    // 8. Validate assigned staff email (active staff membership only)
    let assignedToId: string | null = null;
    if (staffEmail) {
      const matchedStaffId = staffByEmail.get(staffEmail.toLowerCase());
      if (!matchedStaffId) {
        errors.push({
          row: rowNumber,
          studentName,
          field: "Assigned Staff",
          message: `Assigned staff email "${staffEmail}" does not belong to an active staff member in this institute.`,
        });
        rowHasError = true;
      } else {
        assignedToId = matchedStaffId;
      }
    }

    // 9. Validate academic year
    let academicYearId: string | null = null;
    if (rawYear) {
      const matchedYearId = yearMap.get(rawYear.toLowerCase()) || yearMap.get(rawYear);
      if (!matchedYearId) {
        errors.push({
          row: rowNumber,
          studentName,
          field: "Academic Year",
          message: `Academic year "${rawYear}" was not found in this institute.`,
        });
        rowHasError = true;
      } else {
        academicYearId = matchedYearId;
      }
    }

    if (rowHasError) {
      failedCount++;
      continue;
    }

    // 10. Duplicate detection (in-file & database)
    const phoneKey = finalGuardianPhone && finalGuardianPhone !== "Not provided" && /\d/.test(finalGuardianPhone)
      ? makeLeadDuplicateKey(studentName, finalGuardianPhone)
      : null;
    const emailKey = finalGuardianEmail && finalGuardianEmail.includes("@")
      ? makeLeadDuplicateKey(studentName, finalGuardianEmail)
      : null;

    let isDuplicate = false;
    let duplicateReason = "";

    if (phoneKey && seenInFile.has(phoneKey)) {
      isDuplicate = true;
      duplicateReason = `Duplicate lead inside this CSV file for student "${studentName}" and phone "${finalGuardianPhone}".`;
    } else if (emailKey && seenInFile.has(emailKey)) {
      isDuplicate = true;
      duplicateReason = `Duplicate lead inside this CSV file for student "${studentName}" and email "${finalGuardianEmail}".`;
    } else if (phoneKey && existingDupKeys.has(phoneKey)) {
      isDuplicate = true;
      duplicateReason = `Existing lead already registered for student "${studentName}" with phone "${finalGuardianPhone}".`;
    } else if (emailKey && existingDupKeys.has(emailKey)) {
      isDuplicate = true;
      duplicateReason = `Existing lead already registered for student "${studentName}" with email "${finalGuardianEmail}".`;
    }

    if (isDuplicate) {
      duplicatesCount++;
      errors.push({
        row: rowNumber,
        studentName,
        field: "Duplicate",
        message: duplicateReason,
      });
      continue;
    }

    // Register seen keys
    if (phoneKey) seenInFile.add(phoneKey);
    if (emailKey) seenInFile.add(emailKey);

    validRecords.push({
      studentName,
      dob: finalDob,
      classInterested,
      academicYearId,
      guardianName: finalGuardianName,
      guardianPhone: finalGuardianPhone,
      guardianEmail: finalGuardianEmail,
      source: finalSource,
      status: finalStatus,
      assignedToId,
      nextFollowUp: finalFollowUp,
      notes,
    });
  }

  let actualImported = 0;

  // 11. Persist valid records transactionally with concurrency lock
  if (validRecords.length > 0) {
    try {
      await db.$transaction(
        async (tx) => {
          // Concurrency: Acquire tenant-scoped PostgreSQL advisory lock for import serialization.
          // Note: pg_advisory_xact_lock returns void in PostgreSQL, so cast to ::text for Prisma $queryRawUnsafe.
          try {
            await tx.$queryRawUnsafe(
              `SELECT pg_advisory_xact_lock(hashtext($1))::text`,
              `lead_import_${ctx.tenant.id}`,
            );
          } catch (lockErr: unknown) {
            const lockMsg = lockErr instanceof Error ? lockErr.message : "Lock acquisition failed";
            throw new Error(`Concurrency lock acquisition failed: ${lockMsg}`);
          }

          // Re-query database duplicates under transaction lock to handle concurrent race conditions.
          // Bounded strictly to candidates from validRecords to avoid fetching unrelated tenant leads.
          // Must occur strictly AFTER successful advisory lock acquisition.
          const currentDbLeads = await tx.lead.findMany({
            where: buildCandidateLeadsWhere(ctx.tenant.id, validRecords),
            select: { studentName: true, guardianPhone: true, guardianEmail: true },
          });

          const currentDupKeys = new Set<string>();
          for (const l of currentDbLeads) {
            if (l.guardianPhone && l.guardianPhone !== "Not provided" && /\d/.test(l.guardianPhone)) {
              currentDupKeys.add(makeLeadDuplicateKey(l.studentName, l.guardianPhone));
            }
            if (l.guardianEmail && l.guardianEmail.includes("@")) {
              currentDupKeys.add(makeLeadDuplicateKey(l.studentName, l.guardianEmail));
            }
          }

          const recordsToInsert: typeof validRecords = [];
          for (const record of validRecords) {
            const pKey = record.guardianPhone && record.guardianPhone !== "Not provided" && /\d/.test(record.guardianPhone)
              ? makeLeadDuplicateKey(record.studentName, record.guardianPhone)
              : null;
            const eKey = record.guardianEmail && record.guardianEmail.includes("@")
              ? makeLeadDuplicateKey(record.studentName, record.guardianEmail)
              : null;

            if ((pKey && currentDupKeys.has(pKey)) || (eKey && currentDupKeys.has(eKey))) {
              duplicatesCount++;
              errors.push({
                row: 0,
                studentName: record.studentName,
                field: "Duplicate",
                message: `Existing lead already registered for student "${record.studentName}" (detected during concurrent import).`,
              });
            } else {
              recordsToInsert.push(record);
              if (pKey) currentDupKeys.add(pKey);
              if (eKey) currentDupKeys.add(eKey);
            }
          }

          for (const record of recordsToInsert) {
            const lead = await tx.lead.create({
              data: {
                tenantId: ctx.tenant.id,
                studentName: record.studentName,
                dob: record.dob,
                classInterested: record.classInterested,
                academicYearId: record.academicYearId,
                guardianName: record.guardianName,
                guardianPhone: record.guardianPhone,
                guardianEmail: record.guardianEmail,
                source: record.source,
                status: record.status,
                assignedToId: record.assignedToId,
                nextFollowUp: record.nextFollowUp,
                notes: record.notes,
              },
            });

            await tx.leadActivity.create({
              data: {
                tenantId: ctx.tenant.id,
                leadId: lead.id,
                actorId: ctx.user.id,
                action: "CREATED",
                notes: "Imported via CSV batch.",
              },
            });
          }

          actualImported = recordsToInsert.length;
        },
        { timeout: 30000 },
      );
    } catch (dbErr: unknown) {
      const msg = dbErr instanceof Error ? dbErr.message : "Database write failed during CSV import.";
      return {
        ok: false,
        error: `Import transaction failed: ${msg}. No records were imported.`,
      };
    }

    // 12. Post-commit audit and revalidation
    // Reliable audit failure policy: Audit errors post-commit do NOT fail the user's successful import
    try {
      await writeAudit({
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "lead.import",
        entity: "Lead",
        meta: {
          total: dataRows.length,
          imported: actualImported,
          skipped: duplicatesCount,
          failed: failedCount,
          duplicates: duplicatesCount,
        },
      });
    } catch (auditErr) {
      console.error("[leads] Audit log failed after successful commit:", auditErr);
    }

    try {
      revalidatePath("/app/leads");
    } catch (revalErr) {
      console.error("[leads] revalidatePath failed:", revalErr);
    }
  }

  const summary: LeadImportSummary = {
    total: dataRows.length,
    imported: actualImported,
    skipped: duplicatesCount,
    failed: failedCount,
    duplicates: duplicatesCount,
    errors,
  };

  if (actualImported === 0) {
    return {
      ok: false,
      error: `No leads were imported. ${duplicatesCount} duplicate(s) skipped, ${failedCount} row(s) failed validation.`,
      summary,
    };
  }

  return {
    ok: true,
    summary,
    message: `Imported ${actualImported} lead${actualImported === 1 ? "" : "s"}${
      duplicatesCount > 0 ? `, skipped ${duplicatesCount} duplicate${duplicatesCount === 1 ? "" : "s"}` : ""
    }${failedCount > 0 ? `, ${failedCount} row${failedCount === 1 ? "" : "s"} failed` : ""}.`,
  };
}
