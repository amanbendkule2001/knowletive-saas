"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StudentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { assertStaffCapacity, assertStudentCapacity, assertStudentCapacityTx } from "@/lib/entitlements";
import { hashPassword } from "@/lib/auth";
import {
  classSchema,
  fieldErrors,
  sectionSchema,
  staffSchema,
  studentSchema,
  type FormState,
} from "@/lib/validation";

const AVATAR_COLORS = ["#4f46e5", "#0d9488", "#ea580c", "#7c3aed", "#be123c", "#0284c7"];

function text(value: FormDataEntryValue | null) {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}

function toDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function studentError(error: unknown, fallback: string) {
  return { error: error instanceof Error ? error.message : fallback };
}

// ─────────────────────────────── Students ───────────────────────────────

export async function createStudentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.students.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const parsed = studentSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    admissionNo: formData.get("admissionNo"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    gender: formData.get("gender"),
    dob: formData.get("dob"),
    bloodGroup: formData.get("bloodGroup"),
    address: formData.get("address"),
    classId: formData.get("classId"),
    sectionId: formData.get("sectionId"),
    guardianName: formData.get("guardianName"),
    guardianPhone: formData.get("guardianPhone"),
    guardianEmail: formData.get("guardianEmail"),
    guardianRelation: formData.get("guardianRelation"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const d = parsed.data;
  if ((d.guardianName && !d.guardianPhone) || (!d.guardianName && d.guardianPhone)) {
    return { error: "Add both the guardian's name and phone number, or leave both blank." };
  }

  try {
    await assertStudentCapacity(ctx);
  } catch (error) {
    return studentError(error, "Student limit reached.");
  }

  let classId = d.classId || null;
  if (d.sectionId) {
    const section = await db.section.findFirst({
      where: { id: d.sectionId, tenantId: ctx.tenant.id },
      select: { id: true, classId: true },
    });
    if (!section) return { error: "That class section was not found in this institute." };
    classId = section.classId;
  }

  const duplicate = await db.student.findFirst({
    where: { tenantId: ctx.tenant.id, admissionNo: d.admissionNo },
    select: { id: true },
  });
  if (duplicate) {
    return { error: "That admission number is already in use.", fieldErrors: { admissionNo: ["Already in use"] } };
  }

  let studentId = "";
  try {
    studentId = await db.$transaction(async (tx) => {
      await assertStudentCapacityTx(tx, ctx.tenant.id, 1);

      const student = await tx.student.create({
        data: {
          tenantId: ctx.tenant.id,
          admissionNo: d.admissionNo,
          firstName: d.firstName,
          lastName: d.lastName,
          email: d.email || null,
          phone: d.phone || null,
          gender: d.gender || null,
          dob: toDate(d.dob),
          bloodGroup: d.bloodGroup || null,
          address: d.address || null,
          classId,
          sectionId: d.sectionId || null,
        },
      });

      if (d.guardianName && d.guardianPhone) {
        const guardian = await tx.guardian.create({
          data: {
            tenantId: ctx.tenant.id,
            name: d.guardianName,
            phone: d.guardianPhone,
            email: d.guardianEmail || null,
            relation: d.guardianRelation || null,
          },
        });
        await tx.studentGuardian.create({
          data: { studentId: student.id, guardianId: guardian.id, isPrimary: true },
        });
      }

      return student.id;
    });
  } catch (error) {
    console.error("[students] create failed", error);
    return studentError(error, "Could not create the student. Please try again.");
  }

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "student.create",
    entity: "Student",
    entityId: studentId,
    meta: { admissionNo: d.admissionNo },
  });

  revalidatePath("/app/students");
  revalidatePath("/app");
  redirect(`/app/students/${studentId}?created=1`);
}

export async function updateStudentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.students.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const studentId = String(formData.get("studentId") ?? "");
  const parsed = studentSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    admissionNo: formData.get("admissionNo"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    gender: formData.get("gender"),
    dob: formData.get("dob"),
    bloodGroup: formData.get("bloodGroup"),
    address: formData.get("address"),
    classId: formData.get("classId"),
    sectionId: formData.get("sectionId"),
    guardianName: formData.get("guardianName"),
    guardianPhone: formData.get("guardianPhone"),
    guardianEmail: formData.get("guardianEmail"),
    guardianRelation: formData.get("guardianRelation"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const d = parsed.data;
  const existing = await db.student.findFirst({
    where: { id: studentId, tenantId: ctx.tenant.id },
  });
  if (!existing) return { error: "Student not found." };

  let classId = d.classId || null;
  if (d.sectionId) {
    const section = await db.section.findFirst({
      where: { id: d.sectionId, tenantId: ctx.tenant.id },
      select: { classId: true },
    });
    if (!section) return { error: "That class section was not found in this institute." };
    classId = section.classId;
  }

  const duplicate = await db.student.findFirst({
    where: {
      tenantId: ctx.tenant.id,
      admissionNo: d.admissionNo,
      NOT: { id: studentId },
    },
    select: { id: true },
  });
  if (duplicate) {
    return { error: "That admission number is used by another student.", fieldErrors: { admissionNo: ["Already in use"] } };
  }

  const statusRaw = String(formData.get("status") ?? existing.status);
  const status = ["ACTIVE", "INACTIVE", "ALUMNI"].includes(statusRaw)
    ? (statusRaw as "ACTIVE" | "INACTIVE" | "ALUMNI")
    : existing.status;

  await db.student.update({
    where: { id: studentId },
    data: {
      admissionNo: d.admissionNo,
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email || null,
      phone: d.phone || null,
      gender: d.gender || null,
      dob: toDate(d.dob),
      bloodGroup: d.bloodGroup || null,
      address: d.address || null,
      classId,
      sectionId: d.sectionId || null,
      status,
    },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "student.update",
    entity: "Student",
    entityId: studentId,
    meta: { admissionNo: d.admissionNo },
  });

  revalidatePath("/app/students");
  revalidatePath(`/app/students/${studentId}`);
  revalidatePath("/app");
  return { success: "Student profile saved." };
}

export async function setStudentStatusAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.students.delete", "update");
  if (!auth.ok) redirect("/app/students?denied_action=update");
  const ctx = auth.ctx;
  const studentId = String(formData.get("studentId") ?? "");
  const requested = String(formData.get("status") ?? "");
  const status = ["ACTIVE", "INACTIVE", "ALUMNI"].includes(requested)
    ? (requested as "ACTIVE" | "INACTIVE" | "ALUMNI")
    : "ALUMNI";
  if (!studentId) return;

  const student = await db.student.findFirst({
    where: { id: studentId, tenantId: ctx.tenant.id },
    select: { id: true, admissionNo: true },
  });
  if (!student) return;

  await db.student.update({ where: { id: studentId }, data: { status } });
  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: `student.${status.toLowerCase()}`,
    entity: "Student",
    entityId: studentId,
    meta: { admissionNo: student.admissionNo },
  });

  revalidatePath("/app/students");
  revalidatePath(`/app/students/${studentId}`);
  revalidatePath("/app");
  if (status === "ALUMNI") redirect("/app/students?archived=1");
}

// ─────────────────────────────── CSV import ───────────────────────────────

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = input.replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

export async function importStudentsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.students.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file to import." };
  if (file.size > 2 * 1024 * 1024) return { error: "The CSV must be smaller than 2 MB." };

  let rows: string[][];
  try {
    rows = parseCsv(await file.text());
  } catch {
    return { error: "Could not read that file. Export CSV from Excel or Google Sheets first." };
  }
  if (rows.length < 2) return { error: "The CSV needs a header row and at least one student row." };

  const header = rows.shift()!.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const index = (name: string) => header.indexOf(name);
  const col = (row: string[], name: string) => {
    const i = index(name);
    return i >= 0 ? row[i]?.trim() ?? "" : "";
  };

  if (index("admissionno") < 0 || index("firstname") < 0 || index("lastname") < 0) {
    return { error: "The CSV must include admissionNo, firstName and lastName columns." };
  }

  // FIX-04: Deterministic upfront limit check on parsed data rows before DB queries or writes
  if (rows.length > 300) {
    return {
      error: `This file contains ${rows.length} student records, which exceeds the maximum limit of 300 rows per import. No records were imported. Please split your file into batches of 300 or fewer.`,
    };
  }

  const [classes, sections, existing, plan] = await Promise.all([
    db.classLevel.findMany({ where: { tenantId: ctx.tenant.id } }),
    db.section.findMany({ where: { tenantId: ctx.tenant.id } }),
    db.student.findMany({ where: { tenantId: ctx.tenant.id }, select: { admissionNo: true } }),
    db.plan.findUnique({ where: { id: ctx.tenant.subscription?.planId ?? "" } }),
  ]);

  const classByName = new Map(classes.map((c) => [c.name.toLowerCase(), c]));
  const sectionByKey = new Map(sections.map((s) => [`${s.classId}:${s.name.toLowerCase()}`, s]));
  const existingNos = new Set(existing.map((s) => s.admissionNo.toLowerCase()));

  type Candidate = {
    admissionNo: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    gender: string | null;
    dob: Date | null;
    address: string | null;
    status: StudentStatus;
    classId: string | null;
    sectionId: string | null;
    guardianName: string | null;
    guardianPhone: string | null;
    guardianEmail: string | null;
    guardianRelation: string | null;
  };

  const candidates: Candidate[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  const validStatuses = new Set<StudentStatus>(["ACTIVE", "INACTIVE", "ALUMNI"]);

  for (const [i, row] of rows.entries()) {
    const admissionNo = col(row, "admissionno");
    const firstName = col(row, "firstname");
    const lastName = col(row, "lastname");
    if (!admissionNo || !firstName || !lastName) {
      skipped.push(`Row ${i + 2}: missing admission number or name`);
      continue;
    }
    const key = admissionNo.toLowerCase();
    if (existingNos.has(key) || seen.has(key)) {
      skipped.push(`Row ${i + 2}: admission number ${admissionNo} already exists`);
      continue;
    }
    seen.add(key);

    // FIX-02 & FIX-03: Address mapping and strict StudentStatus enum validation
    const address = col(row, "address") || null;
    const rawStatus = col(row, "status").trim().toUpperCase();
    let status: StudentStatus;
    if (!rawStatus) {
      status = "ACTIVE";
    } else if (validStatuses.has(rawStatus as StudentStatus)) {
      status = rawStatus as StudentStatus;
    } else {
      skipped.push(`Row ${i + 2}: invalid status '${rawStatus}'. Allowed statuses are ACTIVE, INACTIVE, ALUMNI.`);
      continue;
    }

    const className = (col(row, "class") || col(row, "classname")).toLowerCase();
    const sectionName = (col(row, "section") || col(row, "sectionname")).toLowerCase();
    const cls = className ? classByName.get(className) : undefined;
    const section = cls && sectionName ? sectionByKey.get(`${cls.id}:${sectionName}`) : undefined;

    const genderRaw = col(row, "gender").toUpperCase();
    const dob = toDate(col(row, "dob") || null);

    candidates.push({
      admissionNo,
      firstName,
      lastName,
      email: col(row, "email") || null,
      phone: col(row, "phone") || null,
      gender: ["MALE", "FEMALE", "OTHER"].includes(genderRaw) ? genderRaw : null,
      dob,
      address,
      status,
      classId: section?.classId ?? cls?.id ?? null,
      sectionId: section?.id ?? null,
      guardianName: col(row, "guardianname") || null,
      guardianPhone: col(row, "guardianphone") || null,
      guardianEmail: col(row, "guardianemail") || null,
      guardianRelation: col(row, "guardianrelation") || null,
    });
  }

  if (candidates.length === 0) {
    return { error: skipped[0] ?? "No valid student rows were found in that CSV." };
  }

  if (plan) {
    const count = await db.student.count({
      where: { tenantId: ctx.tenant.id, status: { not: "ALUMNI" } },
    });
    if (count + candidates.length > plan.maxStudents) {
      return {
        error: `This import would exceed your ${plan.name} plan limit of ${plan.maxStudents} students. Import fewer rows or upgrade.`,
      };
    }
  }

  let created = 0;
  for (const c of candidates) {
    try {
      await db.$transaction(async (tx) => {
        await assertStudentCapacityTx(tx, ctx.tenant.id, 1);
        const student = await tx.student.create({
          data: {
            tenantId: ctx.tenant.id,
            admissionNo: c.admissionNo,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            phone: c.phone,
            gender: c.gender,
            dob: c.dob,
            address: c.address,
            status: c.status,
            classId: c.classId,
            sectionId: c.sectionId,
          },
        });
        if (c.guardianName && c.guardianPhone) {
          const guardian = await tx.guardian.create({
            data: {
              tenantId: ctx.tenant.id,
              name: c.guardianName,
              phone: c.guardianPhone,
              email: c.guardianEmail,
              relation: c.guardianRelation,
            },
          });
          await tx.studentGuardian.create({
            data: { studentId: student.id, guardianId: guardian.id, isPrimary: true },
          });
        }
      });
      created++;
    } catch {
      skipped.push(`Row for ${c.admissionNo}: could not be saved`);
    }
  }

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "student.import",
    entity: "Student",
    meta: { created, skipped: skipped.length },
  });

  revalidatePath("/app/students");
  revalidatePath("/app");

  if (created === 0) {
    return {
      error: `No students were imported. ${skipped.slice(0, 4).join(" · ")}`.trim(),
    };
  }

  return {
    success: `Imported ${created} student${created === 1 ? "" : "s"}${
      skipped.length ? `. Skipped ${skipped.length} row${skipped.length === 1 ? "" : "s"}: ${skipped.slice(0, 3).join(" · ")}` : ""
    }.`,
  };
}

// ─────────────────────────────── Parents / guardians ───────────────────────────────

const guardianSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  phone: z.string().trim().min(6, "Phone number is required").max(20),
  email: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("")),
  relation: z.string().trim().max(30).optional().or(z.literal("")),
  occupation: z.string().trim().max(60).optional().or(z.literal("")),
  studentId: z.string().optional().or(z.literal("")),
});

export async function createGuardianAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.parents.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const parsed = guardianSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    relation: formData.get("relation"),
    occupation: formData.get("occupation"),
    studentId: formData.get("studentId"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const d = parsed.data;
  let studentId: string | null = null;
  if (d.studentId) {
    const student = await db.student.findFirst({
      where: { id: d.studentId, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    if (!student) return { error: "That student was not found in this institute." };
    studentId = student.id;
  }

  const guardian = await db.$transaction(async (tx) => {
    const created = await tx.guardian.create({
      data: {
        tenantId: ctx.tenant.id,
        name: d.name,
        phone: d.phone,
        email: d.email || null,
        relation: d.relation || null,
        occupation: d.occupation || null,
      },
    });
    if (studentId) {
      const links = await tx.studentGuardian.count({ where: { studentId } });
      await tx.studentGuardian.create({
        data: { studentId, guardianId: created.id, isPrimary: links === 0 },
      });
    }
    return created;
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "guardian.create",
    entity: "Guardian",
    entityId: guardian.id,
    meta: { name: guardian.name },
  });

  revalidatePath("/app/parents");
  revalidatePath("/app/students");
  if (studentId) revalidatePath(`/app/students/${studentId}`);
  redirect(`/app/parents/${guardian.id}?created=1`);
}

export async function updateGuardianAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.parents.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const guardianId = String(formData.get("guardianId") ?? "");
  const parsed = guardianSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    relation: formData.get("relation"),
    occupation: formData.get("occupation"),
    studentId: formData.get("studentId"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const existing = await db.guardian.findFirst({
    where: { id: guardianId, tenantId: ctx.tenant.id },
  });
  if (!existing) return { error: "Parent record not found." };

  const d = parsed.data;
  let studentId: string | null = null;
  if (d.studentId) {
    const student = await db.student.findFirst({
      where: { id: d.studentId, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    if (!student) return { error: "That student was not found in this institute." };
    studentId = student.id;
  }

  await db.$transaction(async (tx) => {
    await tx.guardian.update({
      where: { id: guardianId },
      data: {
        name: d.name,
        phone: d.phone,
        email: d.email || null,
        relation: d.relation || null,
        occupation: d.occupation || null,
      },
    });
    if (studentId) {
      const link = await tx.studentGuardian.findUnique({
        where: { studentId_guardianId: { studentId, guardianId } },
      });
      if (!link) {
        const links = await tx.studentGuardian.count({ where: { studentId } });
        await tx.studentGuardian.create({
          data: { studentId, guardianId, isPrimary: links === 0 },
        });
      }
    }
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "guardian.update",
    entity: "Guardian",
    entityId: guardianId,
  });

  revalidatePath("/app/parents");
  revalidatePath(`/app/parents/${guardianId}`);
  revalidatePath("/app/students");
  if (studentId) revalidatePath(`/app/students/${studentId}`);
  return { success: "Parent details saved." };
}

export async function unlinkGuardianAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.parents.write", "update");
  const guardianId = String(formData.get("guardianId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  if (!auth.ok) {
    if (studentId) redirect(`/app/students/${studentId}?denied_action=update`);
    if (guardianId) redirect(`/app/parents/${guardianId}?denied_action=update`);
    redirect("/app/parents?denied_action=update");
  }
  const ctx = auth.ctx;
  if (!guardianId || !studentId) return;

  const [guardian, student] = await Promise.all([
    db.guardian.findFirst({ where: { id: guardianId, tenantId: ctx.tenant.id } }),
    db.student.findFirst({ where: { id: studentId, tenantId: ctx.tenant.id } }),
  ]);
  if (!guardian || !student) return;

  await db.studentGuardian.deleteMany({ where: { guardianId, studentId } });
  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "guardian.unlink",
    entity: "Guardian",
    entityId: guardianId,
    meta: { studentId },
  });
  revalidatePath(`/app/parents/${guardianId}`);
  revalidatePath(`/app/students/${studentId}`);
}

export async function deleteGuardianAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.parents.write", "delete");
  if (!auth.ok) redirect("/app/parents?denied_action=delete");
  const ctx = auth.ctx;
  const guardianId = String(formData.get("guardianId") ?? "");
  if (!guardianId) return;
  const guardian = await db.guardian.findFirst({
    where: { id: guardianId, tenantId: ctx.tenant.id },
  });
  if (!guardian) return;

  await db.$transaction([
    db.studentGuardian.deleteMany({ where: { guardianId } }),
    db.guardian.delete({ where: { id: guardianId } }),
  ]);
  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "guardian.delete",
    entity: "Guardian",
    entityId: guardianId,
    meta: { name: guardian.name },
  });
  revalidatePath("/app/parents");
  redirect("/app/parents?deleted=1");
}

// ─────────────────────────────── Staff ───────────────────────────────

export async function inviteStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.staff.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const parsed = staffSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    roleId: formData.get("roleId"),
    designation: formData.get("designation"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const d = parsed.data;
  const role = await db.role.findFirst({
    where: { id: d.roleId, tenantId: ctx.tenant.id, scope: "TENANT" },
  });
  if (!role) return { error: "Choose a valid role for this institute." };

  try {
    await assertStaffCapacity(ctx);
  } catch (error) {
    return studentError(error, "Staff limit reached.");
  }

  const existing = await db.user.findUnique({
    where: { email: d.email },
    include: { memberships: { where: { tenantId: ctx.tenant.id } } },
  });

  if (existing?.memberships.length) {
    return { error: "That person is already a member of this institute." };
  }
  if (existing?.isPlatformOwner) {
    return { error: "Platform owners already have support access and cannot be added as staff." };
  }

  if (existing) {
    await db.membership.create({
      data: {
        tenantId: ctx.tenant.id,
        userId: existing.id,
        roleId: role.id,
        designation: d.designation || null,
        phone: d.phone || null,
        status: "ACTIVE",
      },
    });
    await writeAudit({
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: "staff.add_existing",
      entity: "User",
      entityId: existing.id,
      meta: { role: role.key, email: d.email },
    });
    revalidatePath("/app/staff");
    revalidatePath("/app");
    return { success: `${existing.name} was added with the role ${role.name}.` };
  }

  const user = await db.user.create({
    data: {
      email: d.email,
      name: d.name,
      passwordHash: await hashPassword(d.password),
      status: "ACTIVE",
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      memberships: {
        create: {
          tenantId: ctx.tenant.id,
          roleId: role.id,
          designation: d.designation || null,
          phone: d.phone || null,
          status: "ACTIVE",
        },
      },
    },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "staff.invite",
    entity: "User",
    entityId: user.id,
    meta: { role: role.key, email: user.email },
  });

  revalidatePath("/app/staff");
  revalidatePath("/app");
  return {
    success: `${user.name} can now sign in at /login with the role ${role.name}. Share the temporary password securely.`,
  };
}

export async function updateStaffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.staff.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const membershipId = String(formData.get("membershipId") ?? "");
  const roleId = String(formData.get("roleId") ?? "");
  const statusRaw = String(formData.get("status") ?? "ACTIVE");
  const designation = text(formData.get("designation"));
  const phone = text(formData.get("phone"));

  const membership = await db.membership.findFirst({
    where: { id: membershipId, tenantId: ctx.tenant.id },
    include: { user: true },
  });
  if (!membership) return { error: "Staff member not found." };

  const role = await db.role.findFirst({
    where: { id: roleId, tenantId: ctx.tenant.id, scope: "TENANT" },
  });
  if (!role) return { error: "Choose a valid role for this institute." };

  const status = statusRaw === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
  if (membership.isOwner && (status !== "ACTIVE" || role.key !== "INSTITUTE_ADMIN")) {
    return { error: "The institute owner must keep the Institute Admin role and stay active." };
  }

  await db.membership.update({
    where: { id: membershipId },
    data: { roleId: role.id, designation, phone, status },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "staff.update",
    entity: "Membership",
    entityId: membershipId,
    meta: { role: role.key, status, user: membership.user.email },
  });

  revalidatePath("/app/staff");
  revalidatePath(`/app/staff/${membershipId}`);
  revalidatePath("/app");
  return { success: `${membership.user.name}'s access was updated.` };
}

export async function removeStaffAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.staff.write", "delete");
  if (!auth.ok) redirect("/app/staff?denied_action=delete");
  const ctx = auth.ctx;
  const membershipId = String(formData.get("membershipId") ?? "");
  if (!membershipId) return;
  const membership = await db.membership.findFirst({
    where: { id: membershipId, tenantId: ctx.tenant.id },
    include: { user: true },
  });
  if (!membership || membership.isOwner) return;

  await db.membership.delete({ where: { id: membershipId } });
  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "staff.remove",
    entity: "Membership",
    entityId: membershipId,
    meta: { user: membership.user.email },
  });

  revalidatePath("/app/staff");
  revalidatePath("/app");
  redirect("/app/staff?removed=1");
}

// ─────────────────────────────── Academics ───────────────────────────────

export async function createClassAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.academics.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const parsed = classSchema.safeParse({
    name: formData.get("name"),
    order: formData.get("order") ?? 0,
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const exists = await db.classLevel.findFirst({
    where: { tenantId: ctx.tenant.id, name: parsed.data.name },
  });
  if (exists) return { error: "A class with that name already exists." };

  const created = await db.classLevel.create({
    data: { tenantId: ctx.tenant.id, name: parsed.data.name, order: parsed.data.order },
  });
  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "academics.class.create",
    entity: "ClassLevel",
    entityId: created.id,
    meta: { name: created.name },
  });
  revalidatePath("/app/academics");
  return { success: `${created.name} added.` };
}

export async function createSectionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.academics.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const parsed = sectionSchema.safeParse({
    classId: formData.get("classId"),
    name: formData.get("name"),
    capacity: formData.get("capacity") ?? 40,
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const cls = await db.classLevel.findFirst({
    where: { id: parsed.data.classId, tenantId: ctx.tenant.id },
  });
  if (!cls) return { error: "That class was not found in this institute." };

  const exists = await db.section.findFirst({
    where: { classId: cls.id, name: parsed.data.name },
  });
  if (exists) return { error: "That section already exists for this class." };

  const created = await db.section.create({
    data: {
      tenantId: ctx.tenant.id,
      classId: cls.id,
      name: parsed.data.name,
      capacity: parsed.data.capacity,
    },
  });
  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "academics.section.create",
    entity: "Section",
    entityId: created.id,
    meta: { class: cls.name, section: created.name },
  });
  revalidatePath("/app/academics");
  return { success: `${cls.name} — Section ${created.name} added.` };
}

const subjectSchema = z.object({
  name: z.string().trim().min(2, "Subject name is required").max(60),
  code: z.string().trim().max(20).optional().or(z.literal("")),
  classId: z.string().optional().or(z.literal("")),
  teacherId: z.string().optional().or(z.literal("")),
});

export async function createSubjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.academics.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const parsed = subjectSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    classId: formData.get("classId"),
    teacherId: formData.get("teacherId"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const d = parsed.data;
  if (d.classId) {
    const cls = await db.classLevel.findFirst({
      where: { id: d.classId, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    if (!cls) return { error: "That class was not found in this institute." };
  }
  if (d.teacherId) {
    const teacher = await db.membership.findFirst({
      where: { id: d.teacherId, tenantId: ctx.tenant.id },
      select: { id: true },
    });
    if (!teacher) return { error: "That teacher was not found in this institute." };
  }

  const created = await db.subject.create({
    data: {
      tenantId: ctx.tenant.id,
      name: d.name,
      code: d.code || null,
      classId: d.classId || null,
      teacherId: d.teacherId || null,
    },
  });
  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "academics.subject.create",
    entity: "Subject",
    entityId: created.id,
    meta: { name: created.name },
  });
  revalidatePath("/app/academics");
  return { success: `${created.name} added.` };
}

export async function deleteSubjectAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.academics.write", "delete");
  if (!auth.ok) redirect("/app/academics?denied_action=delete");
  const ctx = auth.ctx;
  const subjectId = String(formData.get("subjectId") ?? "");
  if (!subjectId) return;
  const subject = await db.subject.findFirst({
    where: { id: subjectId, tenantId: ctx.tenant.id },
  });
  if (!subject) return;
  await db.subject.delete({ where: { id: subjectId } });
  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "academics.subject.delete",
    entity: "Subject",
    entityId: subjectId,
    meta: { name: subject.name },
  });
  revalidatePath("/app/academics");
}
