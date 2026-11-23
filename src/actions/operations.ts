"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";
import { hasTenantPermission, type TenantContext } from "@/lib/auth";
import { resolveUserBranchScope } from "@/lib/branch";
import { writeAudit } from "@/lib/audit";
import { hasFeature } from "@/lib/entitlements";
import { runAiJob } from "@/lib/ai";
import { AI_FEATURE_MAP } from "@/lib/catalog";
import { evaluateAiPermission } from "@/lib/ai-permissions";
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
    select: { id: true, firstName: true, lastName: true, branchId: true },
  });
  if (!student) return { error: "That student was not found in this institute." };

  const branchScope = await resolveUserBranchScope(ctx);
  if (branchScope.isBranchScoped && student.branchId && !branchScope.allowedBranchIds.includes(student.branchId)) {
    return { error: "Access denied. You cannot create invoices for a student in another branch." };
  }

  const amount = Math.round(d.amount * 100);
  const number = await nextFeeNumber(ctx.tenant.id, ctx.tenant.slug);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const invoice = await db.feeInvoice.create({
    data: {
      tenantId: ctx.tenant.id,
      studentId: student.id,
      branchId: student.branchId ?? branchScope.assignedBranchId ?? null,
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
  const writeAuth = await authorizeTenantWrite("tenant.fees.write", "update");
  let ctx: TenantContext;
  if (writeAuth.ok) {
    ctx = writeAuth.ctx;
  } else {
    // Check if user has offline fee collection permission (e.g. Front Desk)
    const offlineAuth = await authorizeTenantWrite("tenant.fees.collect_offline", "update");
    if (!offlineAuth.ok) return { error: writeAuth.error };
    ctx = offlineAuth.ctx;
  }

  const parsed = feePaymentSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    reference: formData.get("reference") ?? "",
  });
  if (!parsed.success) return fieldErrors(parsed.error);

  const d = parsed.data;
  const amount = Math.round(d.amount * 100);

  // If user only has collect_offline, restrict method strictly to CASH or CHEQUE
  const hasFullWrite = hasTenantPermission(ctx, "tenant.fees.write");
  if (!hasFullWrite && d.method !== "CASH" && d.method !== "CHEQUE") {
    return { error: "Front desk offline fee collection is restricted to Cash and Cheque payments." };
  }

  const branchScope = await resolveUserBranchScope(ctx);

  const result = await db.$transaction(async (tx) => {
    // 1. Acquire exclusive PostgreSQL row-level lock on the target FeeInvoice
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "FeeInvoice"
      WHERE id = ${d.invoiceId} AND "tenantId" = ${ctx.tenant.id}
      FOR UPDATE
    `;
    if (!rows || rows.length === 0) {
      return { error: "Fee invoice not found." };
    }

    // 2. Re-read invoice inside transaction under the lock
    const invoice = await tx.feeInvoice.findFirst({
      where: { id: d.invoiceId, tenantId: ctx.tenant.id },
      include: { student: { select: { firstName: true, lastName: true, branchId: true } } },
    });
    if (!invoice) return { error: "Fee invoice not found." };
    if (invoice.status === "PAID") return { error: "This invoice is already fully paid." };
    if (invoice.status === "WAIVED") return { error: "This invoice has been waived." };

    // Enforce branch isolation
    const invoiceBranchId = invoice.branchId || invoice.student.branchId;
    if (branchScope.isBranchScoped && invoiceBranchId && !branchScope.allowedBranchIds.includes(invoiceBranchId)) {
      return { error: "Access denied. You cannot collect fees for another branch." };
    }

    // 3. Re-calculate current outstanding balance from fresh locked database state
    const outstanding = invoice.amount - invoice.paidAmount;
    if (outstanding <= 0) {
      return { error: "This invoice has no outstanding balance." };
    }
    if (amount > outstanding) {
      return { error: `The outstanding balance is ₹${(outstanding / 100).toLocaleString("en-IN")}.` };
    }

    const paidAmount = invoice.paidAmount + amount;
    const fullyPaid = paidAmount >= invoice.amount;
    const effectiveBranchId = invoiceBranchId || branchScope.assignedBranchId || null;

    // 4. Create FeePayment record inside tx
    await tx.feePayment.create({
      data: {
        tenantId: ctx.tenant.id,
        feeInvoiceId: invoice.id,
        branchId: effectiveBranchId,
        amount,
        method: d.method,
        reference: d.reference || null,
        collectedById: ctx.user.id,
      },
    });

    // Issue Layer 1 Immutable PaymentReceipt for offline collection
    const receiptCount = await tx.paymentReceipt.count({ where: { tenantId: ctx.tenant.id } });
    const receiptNumber = `RCPT-OFFLINE-${(receiptCount + 1).toString().padStart(6, "0")}`;

    const receipt = await tx.paymentReceipt.create({
      data: {
        tenantId: ctx.tenant.id,
        studentId: invoice.studentId,
        branchId: effectiveBranchId,
        receiptNumber,
        amount,
        currency: "INR",
        method: d.method,
        reference: d.reference || null,
        provider: "cashier",
        payerName: `${invoice.student.firstName} ${invoice.student.lastName}`,
        createdById: ctx.user.id,
      },
    });

    // Create 1:1 PaymentReceiptBalance
    await tx.paymentReceiptBalance.create({
      data: {
        tenantId: ctx.tenant.id,
        receiptId: receipt.id,
        allocatedAmount: amount,
        unappliedAmount: 0,
        status: "FULLY_ALLOCATED",
      },
    });

    // Create PaymentAllocation linking receipt to fee invoice
    await tx.paymentAllocation.create({
      data: {
        tenantId: ctx.tenant.id,
        receiptId: receipt.id,
        studentId: invoice.studentId,
        feeInvoiceId: invoice.id,
        amount,
      },
    });

    // 5. Update FeeInvoice with new balance and status inside tx
    await tx.feeInvoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount,
        status: fullyPaid ? "PAID" : "PARTIAL",
        paidAt: fullyPaid ? new Date() : null,
      },
    });

    // 6. Record offline ledger entry (OFFLINE_RECORD) for audit without inflating online payable balance
    if (effectiveBranchId) {
      const lastEntry = await tx.branchLedgerEntry.findFirst({
        where: { tenantId: ctx.tenant.id, branchId: effectiveBranchId },
        orderBy: { postedAt: "desc" },
        select: { balanceAfter: true },
      });
      const onlineBalance = lastEntry?.balanceAfter ?? 0;
      await tx.branchLedgerEntry.create({
        data: {
          tenantId: ctx.tenant.id,
          branchId: effectiveBranchId,
          entryType: "CREDIT_SETTLEMENT",
          channel: "OFFLINE_RECORD",
          amount,
          balanceAfter: onlineBalance, // OFFLINE cash/cheque does NOT increase online payable balance
          referenceType: "FEE_PAYMENT",
          referenceId: invoice.id,
          description: `Offline ${d.method} collection of ₹${(amount / 100).toLocaleString("en-IN")}`,
          createdById: ctx.user.id,
        },
      });
    }

    // 6. Invalidate stale payment links:
    // If invoice is fully paid, cancel all remaining OPEN links for this invoice.
    // If partial payment, cancel any open links whose amount exceeds remaining outstanding balance.
    const remainingOutstanding = invoice.amount - paidAmount;
    if (fullyPaid) {
      await tx.feePaymentLink.updateMany({
        where: { feeInvoiceId: invoice.id, status: "OPEN" },
        data: { status: "CANCELED" },
      });
    } else if (remainingOutstanding > 0) {
      await tx.feePaymentLink.updateMany({
        where: {
          feeInvoiceId: invoice.id,
          status: "OPEN",
          amount: { gt: remainingOutstanding },
        },
        data: { status: "CANCELED" },
      });
    }

    return {
      success: `Payment of ₹${(amount / 100).toLocaleString("en-IN")} recorded for ${invoice.student.firstName} ${invoice.student.lastName}.`,
      invoiceNumber: invoice.number,
      invoiceId: invoice.id,
      amount,
    };
  });

  if ("error" in result) {
    return { error: result.error };
  }

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "fee.payment.record",
    entity: "FeeInvoice",
    entityId: result.invoiceId,
    meta: { amount: result.amount, method: d.method, number: result.invoiceNumber },
  });

  revalidatePath("/app/fees");
  revalidatePath(`/app/fees/${result.invoiceId}`);
  revalidatePath("/app");
  return {
    success: result.success,
  };
}

export async function waiveFeeInvoiceAction(formData: FormData) {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) redirect("/app/fees?denied_action=update");
  const ctx = auth.ctx;
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) return;

  const result = await db.$transaction(async (tx) => {
    // 1. Acquire exclusive PostgreSQL row-level lock on FeeInvoice
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "FeeInvoice"
      WHERE id = ${invoiceId} AND "tenantId" = ${ctx.tenant.id}
      FOR UPDATE
    `;
    if (!rows || rows.length === 0) return null;

    const invoice = await tx.feeInvoice.findFirst({
      where: { id: invoiceId, tenantId: ctx.tenant.id },
    });
    if (!invoice || invoice.status === "PAID") return null;

    await tx.feeInvoice.update({ where: { id: invoiceId }, data: { status: "WAIVED" } });

    // 2. Invalidate any open payment links for the waived invoice
    await tx.feePaymentLink.updateMany({
      where: { feeInvoiceId: invoiceId, status: "OPEN" },
      data: { status: "CANCELED" },
    });

    return invoice;
  });

  if (!result) return;

  await writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "fee.invoice.waive",
    entity: "FeeInvoice",
    entityId: invoiceId,
    meta: { number: result.number, amount: result.amount },
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

  // Centralized AI permission evaluation: Verified Owner by default, others explicit grant
  const aiAuth = evaluateAiPermission(ctx, "tenant.ai.use");
  if (!aiAuth.ok) return { error: aiAuth.error };

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
  if (link.status === "CANCELED") return { error: "This payment link has been canceled." };
  if (link.feeInvoice.status === "PAID" || link.feeInvoice.status === "WAIVED") {
    return { error: "This invoice has already been settled or waived." };
  }

  const isExpired = link.status === "EXPIRED" || link.expiresAt < new Date();
  if (isExpired) {
    if (link.status === "OPEN") {
      await db.feePaymentLink.update({
        where: { id: link.id },
        data: { status: "EXPIRED" },
      });
    }
    return { error: "This payment link has expired. Please contact the school to issue a new payment link." };
  }

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
  if (!link || link.status === "PAID" || link.status === "CANCELED") return;

  const isExpired = link.status === "EXPIRED" || link.expiresAt < new Date();
  const isTimelySubmission = link.submittedAt != null && link.submittedAt <= link.expiresAt;
  if (isExpired && !isTimelySubmission) {
    if (link.status === "OPEN") {
      await db.feePaymentLink.update({
        where: { id: link.id },
        data: { status: "EXPIRED" },
      });
    }
    return;
  }

  if (link.feeInvoice.status === "PAID" || link.feeInvoice.status === "WAIVED") {
    return;
  }

  const { settleFeePaymentLink } = await import("@/lib/payments");
  const settled = await settleFeePaymentLink({
    provider: "manual",
    referenceId: link.id,
    amountPaid: link.amount,
  });

  if (!settled) return;

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
