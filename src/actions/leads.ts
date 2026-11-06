"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { assertStudentCapacityTx } from "@/lib/entitlements";
import { fieldErrors, type FormState } from "@/lib/validation";
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
