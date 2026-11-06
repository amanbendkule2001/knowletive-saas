"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { hasFeature } from "@/lib/entitlements";
import { runAiJob } from "@/lib/ai";
import { AI_FEATURE_MAP } from "@/lib/catalog";
import { sendNotification } from "@/lib/notifications";
import {
  aiSchema,
  announcementSchema,
  feeInvoiceSchema,
  feePaymentSchema,
  fieldErrors,
  type FormState,
} from "@/lib/validation";

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// ─────────────────────────────── Attendance ───────────────────────────────

const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;
type AttendanceStatusValue = (typeof ATTENDANCE_STATUSES)[number];

export async function markAttendanceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.attendance.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const dateRaw = String(formData.get("date") ?? "");
  const sectionId = String(formData.get("sectionId") ?? "");
  const date = parseDate(dateRaw);
  if (!date) return { error: "Choose a valid attendance date." };
  if (date.getTime() > Date.now() + 86_400_000) {
    return { error: "Attendance cannot be marked for a future date." };
  }

  const section = await db.section.findFirst({
    where: { id: sectionId, tenantId: ctx.tenant.id },
    include: { class: true },
  });
  if (!section) return { error: "Choose a valid class section." };

  const students = await db.student.findMany({
    where: { tenantId: ctx.tenant.id, sectionId, status: "ACTIVE" },
    select: { id: true },
  });
  if (students.length === 0) return { error: "There are no active students in that section." };

  const rows: { studentId: string; status: AttendanceStatusValue }[] = [];
  for (const student of students) {
    const raw = String(formData.get(`status_${student.id}`) ?? "");
    if (ATTENDANCE_STATUSES.includes(raw as AttendanceStatusValue)) {
      rows.push({ studentId: student.id, status: raw as AttendanceStatusValue });
    }
  }
  if (rows.length === 0) return { error: "Mark at least one student before saving." };

  try {
    await db.$transaction(
      rows.map((row) =>
        db.attendance.upsert({
          where: { studentId_date: { studentId: row.studentId, date } },
          update: { status: row.status, markedById: ctx.user.id },
          create: {
            tenantId: ctx.tenant.id,
            studentId: row.studentId,
            date,
            status: row.status,
            markedById: ctx.user.id,
          },
        }),
      ),
    );
  } catch (error) {
    console.error("[attendance] save failed", error);
    return { error: errorMessage(error, "Could not save attendance. Please retry.") };
  }

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "attendance.mark",
    entity: "Attendance",
    meta: {
      date: dateRaw,
      section: `${section.class.name}-${section.name}`,
      students: rows.length,
      present: rows.filter((r) => r.status === "PRESENT" || r.status === "LATE").length,
    },
  });

  // Automated absent alerts: Notify primary guardians of absent students
  const absentRows = rows.filter((r) => r.status === "ABSENT");
  if (absentRows.length > 0) {
    const absentStudentIds = absentRows.map((r) => r.studentId);
    const absentStudents = await db.student.findMany({
      where: { id: { in: absentStudentIds }, tenantId: ctx.tenant.id },
      include: {
        guardians: {
          include: { guardian: true },
          orderBy: { isPrimary: "desc" },
        },
      },
    });

    for (const student of absentStudents) {
      const guardian = student.guardians[0]?.guardian;
      if (!guardian) continue;

      const studentName = `${student.firstName} ${student.lastName}`;
      const alertSubject = `Absence Notice: ${studentName}`;
      const alertBody = `${studentName} was marked ABSENT for ${section.class.name} - ${section.name} on ${dateRaw}. Please contact the school office if you have any questions.`;

      // 1. In-app notification if guardian has a portal account
      if (guardian.userId) {
        await sendNotification({
          tenantId: ctx.tenant.id,
          recipientUserId: guardian.userId,
          channel: "IN_APP",
          template: "attendance_absent",
          to: guardian.email || guardian.phone,
          subject: alertSubject,
          body: alertBody,
          meta: { studentId: student.id, date: dateRaw, sectionId },
        }).catch((err) => console.error("[attendance:notify] In-app failed:", err));
      }

      // 2. Email alert if guardian email is present
      if (guardian.email) {
        await sendNotification({
          tenantId: ctx.tenant.id,
          recipientUserId: guardian.userId ?? null,
          channel: "EMAIL",
          template: "attendance_absent",
          to: guardian.email,
          subject: `[${ctx.tenant.name}] ${alertSubject}`,
          body: `Dear ${guardian.name},\n\nThis is to notify you that ${studentName} was recorded as ABSENT on ${dateRaw} in ${section.class.name} - ${section.name} at ${ctx.tenant.name}.\n\nIf you have already submitted a leave request or if this record is unexpected, please contact the school administration office.\n\nWarm regards,\n${ctx.tenant.name}`,
          meta: { studentId: student.id, date: dateRaw },
        }).catch((err) => console.error("[attendance:notify] Email failed:", err));
      }
    }
  }

  revalidatePath("/app/attendance");
  revalidatePath("/app");
  return {
    success: `Attendance saved for ${rows.length} student${rows.length === 1 ? "" : "s"} in ${section.class.name} — ${section.name}.`,
  };
}

/** Plain `form action` wrapper so the register saves without a client island. */
export async function saveAttendanceRegisterAction(formData: FormData): Promise<void> {
  const result = await markAttendanceAction({}, formData);
  const params = new URLSearchParams({
    date: String(formData.get("date") ?? ""),
    sectionId: String(formData.get("sectionId") ?? ""),
  });
  if (result.error) params.set("error", result.error);
  else params.set("saved", "1");
  redirect(`/app/attendance?${params.toString()}`);
}

// ─────────────────────────────── Fees ───────────────────────────────

async function nextFeeNumber(tenantId: string, slug: string) {
  const prefix = `${slug.slice(0, 3).toUpperCase()}-FEE`;
  const year = new Date().getFullYear();
  let n = (await db.feeInvoice.count({ where: { tenantId } })) + 1;
  for (let attempt = 0; attempt < 50; attempt++) {
    const number = `${prefix}-${year}-${String(n).padStart(4, "0")}`;
    const clash = await db.feeInvoice.findFirst({ where: { tenantId, number }, select: { id: true } });
    if (!clash) return number;
    n++;
  }
  return `${prefix}-${year}-${Date.now().toString().slice(-6)}`;
}

export async function createFeeInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const parsed = feeInvoiceSchema.safeParse({
    studentId: formData.get("studentId"),
    title: formData.get("title"),
    amount: formData.get("amount"),
    dueDate: formData.get("dueDate"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const d = parsed.data;
  const dueDate = parseDate(d.dueDate);
  if (!dueDate) return { error: "Choose a valid due date." };

  const student = await db.student.findFirst({
    where: { id: d.studentId, tenantId: ctx.tenant.id },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!student) return { error: "That student was not found in this institute." };

  const amount = Math.round(d.amount * 100);
  const number = await nextFeeNumber(ctx.tenant.id, ctx.tenant.slug);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const invoice = await db.feeInvoice.create({
    data: {
      tenantId: ctx.tenant.id,
      studentId: student.id,
      number,
      title: d.title,
      amount,
      dueDate,
      status: dueDate < today ? "OVERDUE" : "PENDING",
      notes: d.notes || null,
    },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "fee.invoice.create",
    entity: "FeeInvoice",
    entityId: invoice.id,
    meta: { number, amount, student: `${student.firstName} ${student.lastName}` },
  });

  revalidatePath("/app/fees");
  revalidatePath("/app");
  redirect(`/app/fees/${invoice.id}?created=1`);
}

export async function recordFeePaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const parsed = feePaymentSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const d = parsed.data;
  const invoice = await db.feeInvoice.findFirst({
    where: { id: d.invoiceId, tenantId: ctx.tenant.id },
    include: { student: { select: { firstName: true, lastName: true } } },
  });
  if (!invoice) return { error: "Fee invoice not found." };
  if (invoice.status === "PAID") return { error: "This invoice is already fully paid." };
  if (invoice.status === "WAIVED") return { error: "This invoice has been waived." };

  const amount = Math.round(d.amount * 100);
  const outstanding = invoice.amount - invoice.paidAmount;
  if (amount > outstanding) {
    return { error: `The outstanding balance is ₹${(outstanding / 100).toLocaleString("en-IN")}.` };
  }

  const paidAmount = invoice.paidAmount + amount;
  const fullyPaid = paidAmount >= invoice.amount;

  await db.$transaction([
    db.feePayment.create({
      data: {
        tenantId: ctx.tenant.id,
        feeInvoiceId: invoice.id,
        amount,
        method: d.method,
        reference: d.reference || null,
        collectedById: ctx.user.id,
      },
    }),
    db.feeInvoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount,
        status: fullyPaid ? "PAID" : "PARTIAL",
        paidAt: fullyPaid ? new Date() : null,
      },
    }),
  ]);

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "fee.payment.record",
    entity: "FeeInvoice",
    entityId: invoice.id,
    meta: { amount, method: d.method, number: invoice.number },
  });

  revalidatePath("/app/fees");
  revalidatePath(`/app/fees/${invoice.id}`);
  revalidatePath("/app");
  return {
    success: `Payment of ₹${(amount / 100).toLocaleString("en-IN")} recorded for ${invoice.student.firstName} ${invoice.student.lastName}.`,
  };
}

export async function waiveFeeInvoiceAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) redirect("/app/fees?denied_action=update");
  const ctx = auth.ctx;
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) return;
  const invoice = await db.feeInvoice.findFirst({
    where: { id: invoiceId, tenantId: ctx.tenant.id },
  });
  if (!invoice || invoice.status === "PAID") return;

  await db.feeInvoice.update({ where: { id: invoiceId }, data: { status: "WAIVED" } });
  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "fee.invoice.waive",
    entity: "FeeInvoice",
    entityId: invoiceId,
    meta: { number: invoice.number, amount: invoice.amount },
  });
  revalidatePath("/app/fees");
  revalidatePath(`/app/fees/${invoiceId}`);
  revalidatePath("/app");
}

// ─────────────────────────────── Announcements ───────────────────────────────

export async function createAnnouncementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.announcements.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const parsed = announcementSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    audience: formData.get("audience"),
    pinned: formData.get("pinned") ?? undefined,
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const announcement = await db.announcement.create({
    data: {
      tenantId: ctx.tenant.id,
      title: parsed.data.title,
      body: parsed.data.body,
      audience: parsed.data.audience,
      pinned: !!parsed.data.pinned,
      authorId: ctx.user.id,
    },
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "announcement.publish",
    entity: "Announcement",
    entityId: announcement.id,
    meta: { audience: announcement.audience, title: announcement.title },
  });

  // Find all active memberships in this tenant
  const memberships = await db.membership.findMany({
    where: { tenantId: ctx.tenant.id, status: "ACTIVE" },
    include: { user: { select: { id: true, email: true, name: true } }, role: { select: { name: true, scope: true } } },
  });

  const targetMembers = memberships.filter((m) => {
    if (announcement.audience === "ALL") return true;
    if (announcement.audience === "STAFF") return m.role?.scope === "TENANT";
    if (announcement.audience === "PARENTS") return m.role?.name?.toLowerCase().includes("parent") || m.role?.name?.toLowerCase().includes("guardian");
    if (announcement.audience === "STUDENTS") return m.role?.name?.toLowerCase().includes("student");
    return false;
  });

  // Fire-and-forget: create NotificationLog rows for each recipient
  if (targetMembers.length > 0) {
    await Promise.allSettled(
      targetMembers.map((m) =>
        sendNotification({
          tenantId: ctx.tenant.id,
          recipientUserId: m.userId,
          channel: "IN_APP",
          template: "announcement",
          to: m.user.email ?? "",
          subject: announcement.title,
          body: announcement.body ?? announcement.title,
          meta: { announcementId: announcement.id, audience: announcement.audience },
        }),
      ),
    );
  }

  revalidatePath("/app/announcements");
  revalidatePath("/app");
  return { success: "Announcement published to the selected audience." };
}

export async function toggleAnnouncementPinAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.announcements.write", "update");
  if (!auth.ok) redirect("/app/announcements?denied_action=update");
  const ctx = auth.ctx;
  const announcementId = String(formData.get("announcementId") ?? "");
  if (!announcementId) return;
  const announcement = await db.announcement.findFirst({
    where: { id: announcementId, tenantId: ctx.tenant.id },
  });
  if (!announcement) return;
  await db.announcement.update({
    where: { id: announcementId },
    data: { pinned: !announcement.pinned },
  });
  revalidatePath("/app/announcements");
}

export async function deleteAnnouncementAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.announcements.write", "delete");
  if (!auth.ok) redirect("/app/announcements?denied_action=delete");
  const ctx = auth.ctx;
  const announcementId = String(formData.get("announcementId") ?? "");
  if (!announcementId) return;
  const announcement = await db.announcement.findFirst({
    where: { id: announcementId, tenantId: ctx.tenant.id },
  });
  if (!announcement) return;
  await db.announcement.delete({ where: { id: announcementId } });
  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "announcement.delete",
    entity: "Announcement",
    entityId: announcementId,
    meta: { title: announcement.title },
  });
  revalidatePath("/app/announcements");
  revalidatePath("/app");
}

// ─────────────────────────────── AI Studio ───────────────────────────────

export async function runAiAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.ai.use", "general");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;
  const plan = ctx.tenant.subscription?.plan;
  if (!plan || !hasFeature(plan, "ai")) {
    return { error: "AI Studio is not included in your current plan. Upgrade in Billing to use it." };
  }

  const parsed = aiSchema.safeParse({
    feature: formData.get("feature"),
    prompt: formData.get("prompt"),
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const feature = AI_FEATURE_MAP.get(parsed.data.feature);
  if (!feature) return { error: "Choose a valid AI module." };

  let jobId = "";
  try {
    const result = await runAiJob({
      tenantId: ctx.tenant.id,
      userId: ctx.user.id,
      featureKey: feature.key,
      prompt: parsed.data.prompt,
      creditLimit: plan.aiCreditsMonthly,
      instituteName: ctx.tenant.name,
      instituteType: ctx.tenant.type,
    });
    jobId = result.job.id;
  } catch (error) {
    console.error("[ai] run failed", error);
    return { error: errorMessage(error, "The AI request failed. Please try again.") };
  }

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "ai.run",
    entity: "AiJob",
    entityId: jobId,
    meta: { feature: feature.key, credits: feature.credits },
  });

  revalidatePath("/app/ai");
  revalidatePath("/app");
  redirect(`/app/ai?job=${jobId}`);
}

export async function deleteAiJobAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.ai.use", "delete");
  if (!auth.ok) redirect("/app/ai?denied_action=delete");
  const ctx = auth.ctx;
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;
  const job = await db.aiJob.findFirst({ where: { id: jobId, tenantId: ctx.tenant.id } });
  if (!job) return;
  await db.aiJob.delete({ where: { id: jobId } });
  revalidatePath("/app/ai");
}

// ─────────────────────────────── Fee Payment Link & Verification ───────────────────────────────

export async function submitPaymentProofAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "").trim();
  const utrReference = String(formData.get("utrReference") ?? "").trim();
  const payerName = String(formData.get("payerName") ?? "").trim();
  const payerPhone = String(formData.get("payerPhone") ?? "").trim();
  const payerNotes = String(formData.get("payerNotes") ?? "").trim();

  if (!token) return { error: "Invalid payment link." };
  if (!utrReference || utrReference.length < 6 || utrReference.length > 50) {
    return { error: "Please enter a valid Bank UTR / Transaction Reference number (minimum 6 characters)." };
  }
  if (!payerName) {
    return { error: "Please enter the payer's name." };
  }

  const link = await db.feePaymentLink.findUnique({
    where: { token },
    include: {
      tenant: true,
      feeInvoice: {
        include: {
          student: true,
        },
      },
    },
  });

  if (!link) return { error: "Payment link not found or expired." };
  if (link.status === "PAID") return { error: "This invoice has already been settled and verified." };

  await db.feePaymentLink.update({
    where: { id: link.id },
    data: {
      utrReference,
      payerName,
      payerPhone: payerPhone || null,
      payerNotes: payerNotes || null,
      submittedAt: new Date(),
    },
  });

  // Notify school accountants in-app
  await db.notificationLog.create({
    data: {
      tenantId: link.tenantId,
      channel: "IN_APP",
      template: "fee.payment_submitted",
      to: link.tenant.email,
      subject: `Payment proof submitted: ${link.feeInvoice.number}`,
      body: `UTR ${utrReference} submitted for ₹${(link.amount / 100).toLocaleString("en-IN")} by ${payerName} for ${link.feeInvoice.student.firstName} ${link.feeInvoice.student.lastName}.`,
      status: "SENT",
    },
  });

  await writeAudit({
    tenantId: link.tenantId,
    actorName: payerName,
    action: "fee.payment_link.submitted",
    entity: "FeePaymentLink",
    entityId: link.id,
    meta: { utrReference, amount: link.amount, number: link.feeInvoice.number },
  });

  revalidatePath(`/pay/${token}`);
  return { success: "Payment details submitted! The school accounts office will verify the bank credit and issue your receipt." };
}

export async function verifyFeePaymentLinkAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) redirect("/app/fees?denied_action=update");
  const ctx = auth.ctx;
  const linkId = String(formData.get("linkId") ?? "");
  if (!linkId) return;

  const link = await db.feePaymentLink.findFirst({
    where: { id: linkId, tenantId: ctx.tenant.id },
    include: {
      feeInvoice: {
        include: { student: true },
      },
    },
  });
  if (!link || link.status === "PAID") return;

  const { settleFeePaymentLink } = await import("@/lib/payments");
  await settleFeePaymentLink({
    provider: "manual",
    referenceId: link.id,
    amountPaid: link.amount,
  });

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "fee.payment_link.verified",
    entity: "FeePaymentLink",
    entityId: link.id,
    meta: { utr: link.utrReference, amount: link.amount, invoice: link.feeInvoice.number },
  });

  revalidatePath("/app/fees");
  revalidatePath(`/app/fees/${link.feeInvoiceId}`);
  revalidatePath(`/pay/${link.token}`);
}
