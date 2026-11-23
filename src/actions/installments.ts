"use server";

import { revalidatePath } from "next/cache";
import { getTenantContext, hasTenantPermission, isStaffMember } from "@/lib/auth";
import { authorizeTenantWrite } from "@/lib/rbac";
import { verifyBranchAccess } from "@/lib/branch";
import type { FormState } from "@/lib/validation";
import {
  createStudentFeePlan,
  updateInstallmentSchedule,
  cancelStudentFeeInstallment,
  generateInstallmentSchedule,
  type ScheduleType,
} from "@/lib/installments";
import {
  initiateDemoPaymentSession,
  processDemoPaymentOutcome,
  type DemoOutcome,
} from "@/lib/demo-payments";
import { db } from "@/lib/db";

/**
 * Creates a formal StudentFeePlan for an individual student with customized installments.
 */
export async function createStudentFeePlanAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const studentId = formData.get("studentId") as string;
  const title = (formData.get("title") as string)?.trim();
  const totalAmountRupees = parseFloat(formData.get("totalAmount") as string);
  const discountAmountRupees = parseFloat((formData.get("discountAmount") as string) || "0");
  const scheduleType = (formData.get("scheduleType") as ScheduleType) || "CUSTOM";
  const installmentCount = parseInt((formData.get("installmentCount") as string) || "4", 10);
  const startDateStr = formData.get("startDate") as string;
  const notes = (formData.get("notes") as string) || undefined;

  if (!studentId || !title || isNaN(totalAmountRupees) || totalAmountRupees <= 0) {
    return { error: "Please provide a valid student, title, and positive fee amount." };
  }

  // Branch isolation check
  const student = await db.student.findFirst({
    where: { id: studentId, tenantId: ctx.tenant.id },
    select: { id: true, branchId: true },
  });

  if (!student) {
    return { error: "Student not found in this institute." };
  }

  const branchCheck = await verifyBranchAccess(ctx, student.branchId);
  if (!branchCheck.ok) {
    return { error: branchCheck.error };
  }

  const totalAmountPaise = Math.round(totalAmountRupees * 100);
  const discountAmountPaise = Math.round((discountAmountRupees || 0) * 100);
  const startDate = startDateStr ? new Date(startDateStr) : new Date();

  try {
    const installments = generateInstallmentSchedule({
      totalAmount: totalAmountPaise,
      discountAmount: discountAmountPaise,
      scheduleType,
      startDate,
      installmentCount,
    });

    const result = await createStudentFeePlan({
      tenantId: ctx.tenant.id,
      branchId: student.branchId,
      studentId,
      title,
      totalAmount: totalAmountPaise,
      discountAmount: discountAmountPaise,
      scheduleType,
      notes,
      installments,
      createdById: ctx.user.id,
    });

    revalidatePath("/app/fees");
    revalidatePath("/portal");
    return { success: "Student fee installment plan created successfully." };
  } catch (err: any) {
    return { error: err.message || "Failed to create fee plan." };
  }
}

/**
 * Updates an installment due date or amount.
 */
export async function updateInstallmentScheduleAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const installmentId = formData.get("installmentId") as string;
  const newDueDateStr = formData.get("newDueDate") as string;
  const newAmountRupeesStr = formData.get("newAmount") as string;
  const reason = (formData.get("reason") as string)?.trim();

  if (!installmentId || !reason) {
    return { error: "Installment ID and reason for schedule change are required." };
  }

  const newDueDate = newDueDateStr ? new Date(newDueDateStr) : undefined;
  const newAmount = newAmountRupeesStr ? Math.round(parseFloat(newAmountRupeesStr) * 100) : undefined;

  try {
    await updateInstallmentSchedule({
      tenantId: ctx.tenant.id,
      installmentId,
      newDueDate,
      newAmount,
      reason,
      changedById: ctx.user.id,
    });

    revalidatePath("/app/fees");
    revalidatePath("/portal");
    return { success: "Installment schedule updated successfully." };
  } catch (err: any) {
    return { error: err.message || "Failed to update installment schedule." };
  }
}

/**
 * Cancels a student installment.
 */
export async function cancelStudentFeeInstallmentAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const installmentId = formData.get("installmentId") as string;
  const reason = (formData.get("reason") as string)?.trim();

  if (!installmentId || !reason) {
    return { error: "Installment ID and cancellation reason are required." };
  }

  try {
    await cancelStudentFeeInstallment({
      tenantId: ctx.tenant.id,
      installmentId,
      reason,
      changedById: ctx.user.id,
    });

    revalidatePath("/app/fees");
    revalidatePath("/portal");
    return { success: "Installment cancelled successfully." };
  } catch (err: any) {
    return { error: err.message || "Failed to cancel installment." };
  }
}

/**
 * Initiates a Demo checkout session for parent/student portal.
 */
export async function initiateDemoCheckoutAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { data?: any }> {
  const ctx = await getTenantContext();
  if (!ctx) return { error: "Authentication required." };

  const studentId = formData.get("studentId") as string;
  const installmentIdsRaw = formData.get("installmentIds") as string;
  const sourceInstallmentId = (formData.get("sourceInstallmentId") as string) || undefined;
  const amountRupees = parseFloat(formData.get("amount") as string);

  if (!studentId || !installmentIdsRaw || isNaN(amountRupees) || amountRupees <= 0) {
    return { error: "Invalid student or payment amount." };
  }

  // Security: If caller is parent, verify guardian relationship
  if (!isStaffMember(ctx)) {
    const isLinked = await db.student.findFirst({
      where: {
        id: studentId,
        tenantId: ctx.tenant.id,
        OR: [
          { guardians: { some: { guardian: { userId: ctx.user.id } } } },
          { userId: ctx.user.id },
        ],
      },
      select: { id: true, branchId: true },
    });

    if (!isLinked) {
      return { error: "Access denied. You can only make payments for your linked students." };
    }
  }

  const installmentIds = installmentIdsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const amountPaise = Math.round(amountRupees * 100);

  try {
    const session = await initiateDemoPaymentSession({
      tenantId: ctx.tenant.id,
      studentId,
      installmentIds,
      sourceInstallmentId: sourceInstallmentId || (installmentIds.length === 1 ? installmentIds[0] : undefined),
      amountPaise,
      customerName: ctx.user.name || "Demo Parent",
      customerPhone: null,
    });

    return {
      success: session.checkoutUrl,
      data: {
        checkoutUrl: session.checkoutUrl,
        sessionToken: session.sessionToken,
      },
    };
  } catch (err: any) {
    return { error: err.message || "Failed to initiate demo payment session." };
  }
}

/**
 * Submits outcome simulation on the Demo checkout page.
 */
export async function submitDemoPaymentOutcomeAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { data?: any }> {
  const sessionToken = formData.get("sessionToken") as string;
  const outcome = (formData.get("outcome") as DemoOutcome) || "SUCCESS";
  const customUtr = (formData.get("customUtr") as string) || undefined;

  if (!sessionToken) {
    return { error: "Session token is required." };
  }

  try {
    const result = await processDemoPaymentOutcome({
      sessionToken,
      outcome,
      customUtr,
    });

    revalidatePath("/portal");
    revalidatePath("/portal/fees");
    revalidatePath("/app/fees");
    revalidatePath("/platform/finance");
    revalidatePath(`/pay/demo/${sessionToken}`);

    return {
      success: `Demo transaction completed with outcome: ${result.sessionStatus}`,
      data: result,
    };
  } catch (err: any) {
    return { error: err.message || "Demo payment simulation failed." };
  }
}
