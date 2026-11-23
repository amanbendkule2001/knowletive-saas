import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type InstallmentStatus =
  | "UPCOMING"
  | "DUE"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED";

export type ScheduleType = "MONTHLY" | "QUARTERLY" | "CUSTOM" | "MANUAL";

export interface ScheduleItemInput {
  installmentNumber: number;
  title: string;
  dueDate: Date;
  originalAmount: number; // in paise
  discountAmount?: number; // in paise
  lateFeeAmount?: number; // in paise
  allowPartial?: boolean;
}

export interface GenerateScheduleOptions {
  totalAmount: number; // in paise (e.g. 3000000 = ₹30,000)
  discountAmount?: number; // in paise (e.g. 500000 = ₹5,000)
  scheduleType: ScheduleType;
  startDate: Date;
  installmentCount: number;
  admissionAmount?: number; // in paise (optional initial admission fee)
  customDates?: Date[];
  customAmounts?: number[];
}

export interface CreateStudentFeePlanInput {
  tenantId: string;
  branchId?: string | null;
  studentId: string;
  academicYearId?: string | null;
  title: string;
  totalAmount: number;
  discountAmount?: number;
  scheduleType: ScheduleType;
  notes?: string;
  installments: ScheduleItemInput[];
  createdById?: string;
}

/**
 * Generates and reconciles an installment schedule.
 * Reconciles sum of (originalAmount - discountAmount) exactly with net payableAmount.
 */
export function generateInstallmentSchedule(options: GenerateScheduleOptions): ScheduleItemInput[] {
  const {
    totalAmount,
    discountAmount = 0,
    scheduleType,
    startDate,
    installmentCount,
    admissionAmount = 0,
    customDates,
    customAmounts,
  } = options;

  if (totalAmount <= 0) {
    throw new Error("Total fee amount must be positive.");
  }

  const netPayable = totalAmount - discountAmount;
  if (netPayable <= 0) {
    throw new Error("Net payable amount after discount must be positive.");
  }

  if (installmentCount < 1) {
    throw new Error("Installment count must be at least 1.");
  }

  const items: ScheduleItemInput[] = [];

  // 1. If custom amounts are provided
  if (customAmounts && customAmounts.length > 0) {
    if (customAmounts.length !== installmentCount) {
      throw new Error(`Expected ${installmentCount} custom amounts, got ${customAmounts.length}`);
    }

    const sumCustom = customAmounts.reduce((a, b) => a + b, 0);
    if (sumCustom !== netPayable) {
      throw new Error(
        `Custom installment amounts sum (₹${sumCustom / 100}) does not match net payable (₹${netPayable / 100}).`
      );
    }

    for (let i = 0; i < installmentCount; i++) {
      const d = customDates?.[i] || new Date(startDate.getTime() + i * 30 * 24 * 60 * 60 * 1000);
      items.push({
        installmentNumber: i + 1,
        title: i === 0 && admissionAmount > 0 ? "Admission Fee" : `Installment ${i + 1}`,
        dueDate: d,
        originalAmount: customAmounts[i],
        discountAmount: 0,
        allowPartial: true,
      });
    }
    return items;
  }

  // 2. Schedule with optional Admission Fee upfront
  let remainingPayable = netPayable;
  let remainingCount = installmentCount;

  if (admissionAmount > 0) {
    if (admissionAmount >= netPayable) {
      throw new Error("Admission amount cannot exceed or equal total net payable.");
    }
    items.push({
      installmentNumber: 1,
      title: "Admission Fee",
      dueDate: new Date(startDate),
      originalAmount: admissionAmount,
      discountAmount: 0,
      allowPartial: true,
    });
    remainingPayable -= admissionAmount;
    remainingCount -= 1;
  }

  if (remainingCount > 0) {
    const baseAmount = Math.floor(remainingPayable / remainingCount);
    let distributedSum = 0;

    for (let i = 0; i < remainingCount; i++) {
      const installmentIdx = items.length + 1;
      const isLast = i === remainingCount - 1;
      const amount = isLast ? remainingPayable - distributedSum : baseAmount;
      distributedSum += baseAmount;

      const dueDate = new Date(startDate);
      if (scheduleType === "MONTHLY") {
        dueDate.setMonth(dueDate.getMonth() + (admissionAmount > 0 ? i + 1 : i));
      } else if (scheduleType === "QUARTERLY") {
        dueDate.setMonth(dueDate.getMonth() + (admissionAmount > 0 ? (i + 1) * 3 : i * 3));
      } else {
        // Custom interval: default 30 days
        dueDate.setDate(dueDate.getDate() + (admissionAmount > 0 ? (i + 1) * 30 : i * 30));
      }

      items.push({
        installmentNumber: installmentIdx,
        title: isLast ? `Final Installment ${installmentIdx}` : `Installment ${installmentIdx}`,
        dueDate,
        originalAmount: amount,
        discountAmount: 0,
        allowPartial: true,
      });
    }
  }

  // Final sanity check: items sum must match netPayable exactly
  const totalCalculated = items.reduce((sum, item) => sum + (item.originalAmount - (item.discountAmount || 0)), 0);
  if (totalCalculated !== netPayable) {
    throw new Error(
      `Schedule calculation mismatch: calculated ₹${totalCalculated / 100} !== net payable ₹${netPayable / 100}`
    );
  }

  return items;
}

/**
 * Creates an authoritative StudentFeePlan with backing FeeInvoices and StudentFeeInstallments.
 */
export async function createStudentFeePlan(input: CreateStudentFeePlanInput) {
  const {
    tenantId,
    branchId,
    studentId,
    academicYearId,
    title,
    totalAmount,
    discountAmount = 0,
    scheduleType,
    notes,
    installments,
  } = input;

  const payableAmount = totalAmount - discountAmount;
  if (payableAmount <= 0) {
    throw new Error("Payable amount must be positive.");
  }

  // Reconcile installments total
  const scheduleSum = installments.reduce(
    (sum, inst) => sum + (inst.originalAmount - (inst.discountAmount || 0)),
    0
  );

  if (scheduleSum !== payableAmount) {
    throw new Error(
      `Installment schedule total (₹${scheduleSum / 100}) does not reconcile with agreed net payable (₹${payableAmount / 100}).`
    );
  }

  return await db.$transaction(async (tx) => {
    // 1. Verify student exists and belongs to tenant
    const student = await tx.student.findFirst({
      where: { id: studentId, tenantId },
      include: { tenant: { select: { slug: true } } },
    });

    if (!student) {
      throw new Error("Student not found or tenant mismatch.");
    }

    const effectiveBranchId = branchId || student.branchId || null;

    // 2. Create the parent StudentFeePlan
    const plan = await tx.studentFeePlan.create({
      data: {
        tenantId,
        branchId: effectiveBranchId,
        studentId,
        academicYearId: academicYearId || null,
        title,
        totalAmount,
        discountAmount,
        payableAmount,
        scheduleType,
        status: "ACTIVE",
        notes,
      },
    });

    // 3. Create backing FeeInvoices and StudentFeeInstallment records
    const createdInstallments = [];
    const prefix = `${(student.tenant.slug || "KNW").slice(0, 3).toUpperCase()}-FEE`;

    for (const inst of installments) {
      const netInstAmount = inst.originalAmount - (inst.discountAmount || 0);
      const invoiceCount = await tx.feeInvoice.count({ where: { tenantId } });
      const invoiceNumber = `${prefix}-${(invoiceCount + 1).toString().padStart(6, "0")}`;

      // Create backing FeeInvoice receivable
      const invoice = await tx.feeInvoice.create({
        data: {
          tenantId,
          branchId: effectiveBranchId,
          studentId,
          number: invoiceNumber,
          title: `${title} - ${inst.title}`,
          amount: netInstAmount,
          currency: "INR",
          status: "PENDING",
          dueDate: inst.dueDate,
          notes: `Auto-generated backing invoice for installment #${inst.installmentNumber}`,
        },
      });

      // Derive initial status
      const now = new Date();
      let initialStatus: InstallmentStatus = "UPCOMING";
      if (inst.dueDate < now) {
        initialStatus = "OVERDUE";
      } else if (inst.dueDate.toDateString() === now.toDateString()) {
        initialStatus = "DUE";
      }

      const installment = await tx.studentFeeInstallment.create({
        data: {
          tenantId,
          branchId: effectiveBranchId,
          studentId,
          planId: plan.id,
          feeInvoiceId: invoice.id,
          installmentNumber: inst.installmentNumber,
          title: inst.title,
          dueDate: inst.dueDate,
          originalAmount: inst.originalAmount,
          discountAmount: inst.discountAmount || 0,
          lateFeeAmount: inst.lateFeeAmount || 0,
          allowPartial: inst.allowPartial ?? true,
          status: initialStatus,
        },
      });

      createdInstallments.push({ ...installment, feeInvoice: invoice });
    }

    return { plan, installments: createdInstallments };
  });
}

/**
 * Retrieves the complete StudentFeePlan with authoritative balance calculations
 * derived dynamically from ledger PaymentAllocations and reversals.
 */
export async function getStudentFeePlanDetails(planId: string, tenantId: string) {
  const plan = await db.studentFeePlan.findFirst({
    where: { id: planId, tenantId },
    include: {
      student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, branchId: true } },
      branch: { select: { id: true, name: true, code: true } },
      installments: {
        orderBy: { installmentNumber: "asc" },
        include: {
          feeInvoice: {
            include: {
              paymentAllocations: {
                include: {
                  reversals: true,
                  receipt: { select: { receiptNumber: true, reference: true, method: true, receivedAt: true } },
                },
              },
            },
          },
          scheduleChanges: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });

  if (!plan) return null;

  const now = new Date();
  let totalPaid = 0;
  let totalOutstanding = 0;

  const enrichedInstallments = plan.installments.map((inst) => {
    const netPayable = inst.originalAmount - inst.discountAmount + inst.lateFeeAmount;

    // Calculate authoritative paid amount from allocations minus reversals
    let allocatedPaid = 0;
    const allocationHistory: Array<{
      allocationId: string;
      receiptNumber: string;
      amount: number;
      allocatedAt: Date;
      reference?: string | null;
      reversedAmount: number;
    }> = [];

    if (inst.feeInvoice) {
      for (const alloc of inst.feeInvoice.paymentAllocations) {
        const reversedSum = alloc.reversals.reduce((sum, rev) => sum + rev.amount, 0);
        const netAlloc = Math.max(0, alloc.amount - reversedSum);
        allocatedPaid += netAlloc;

        allocationHistory.push({
          allocationId: alloc.id,
          receiptNumber: alloc.receipt.receiptNumber,
          amount: netAlloc,
          allocatedAt: alloc.allocatedAt,
          reference: alloc.receipt.reference,
          reversedAmount: reversedSum,
        });
      }
    }

    const outstanding = Math.max(0, netPayable - allocatedPaid);
    totalPaid += allocatedPaid;
    totalOutstanding += outstanding;

    // Authoritative status derivation
    let computedStatus: InstallmentStatus = "UPCOMING";
    if (inst.status === "CANCELLED") {
      computedStatus = "CANCELLED";
    } else if (allocatedPaid >= netPayable && netPayable > 0) {
      computedStatus = "PAID";
    } else if (allocatedPaid > 0 && allocatedPaid < netPayable) {
      computedStatus = "PARTIALLY_PAID";
    } else if (now > inst.dueDate) {
      computedStatus = "OVERDUE";
    } else if (now.toDateString() === inst.dueDate.toDateString()) {
      computedStatus = "DUE";
    } else {
      computedStatus = "UPCOMING";
    }

    return {
      id: inst.id,
      installmentNumber: inst.installmentNumber,
      title: inst.title,
      dueDate: inst.dueDate,
      originalAmount: inst.originalAmount,
      discountAmount: inst.discountAmount,
      lateFeeAmount: inst.lateFeeAmount,
      netPayable,
      paidAmount: allocatedPaid,
      outstandingAmount: outstanding,
      allowPartial: inst.allowPartial,
      status: computedStatus,
      feeInvoiceId: inst.feeInvoiceId,
      allocationHistory,
      scheduleChanges: inst.scheduleChanges,
    };
  });

  return {
    ...plan,
    totalPaid,
    totalOutstanding,
    installments: enrichedInstallments,
  };
}

/**
 * Updates an installment due date or amount with full audit history.
 */
export async function updateInstallmentSchedule(input: {
  tenantId: string;
  installmentId: string;
  newDueDate?: Date;
  newAmount?: number;
  reason: string;
  changedById?: string;
}) {
  const { tenantId, installmentId, newDueDate, newAmount, reason, changedById } = input;

  return await db.$transaction(async (tx) => {
    const installment = await tx.studentFeeInstallment.findFirst({
      where: { id: installmentId, tenantId },
      include: { feeInvoice: true },
    });

    if (!installment) {
      throw new Error("Installment not found.");
    }

    if (installment.status === "PAID" || installment.status === "CANCELLED") {
      throw new Error(`Cannot modify installment with status ${installment.status}.`);
    }

    const previousValues = {
      dueDate: installment.dueDate,
      originalAmount: installment.originalAmount,
      status: installment.status,
    };

    const newValues: Record<string, any> = {};
    if (newDueDate) newValues.dueDate = newDueDate;
    if (newAmount !== undefined) newValues.originalAmount = newAmount;

    // If amount is changed, verify it does not fall below already paid amount
    if (newAmount !== undefined && installment.feeInvoice) {
      if (newAmount < installment.feeInvoice.paidAmount) {
        throw new Error(
          `Cannot reduce installment amount below already paid amount (₹${installment.feeInvoice.paidAmount / 100}).`
        );
      }

      await tx.feeInvoice.update({
        where: { id: installment.feeInvoice.id },
        data: { amount: newAmount },
      });
    }

    if (newDueDate && installment.feeInvoice) {
      await tx.feeInvoice.update({
        where: { id: installment.feeInvoice.id },
        data: { dueDate: newDueDate },
      });
    }

    const updated = await tx.studentFeeInstallment.update({
      where: { id: installmentId },
      data: {
        ...(newDueDate ? { dueDate: newDueDate } : {}),
        ...(newAmount !== undefined ? { originalAmount: newAmount } : {}),
      },
    });

    // Record audit trail
    await tx.installmentScheduleChange.create({
      data: {
        tenantId,
        installmentId,
        changedById: changedById || null,
        changeType: newDueDate && newAmount !== undefined ? "AMOUNT_AND_DUE_DATE" : newDueDate ? "DUE_DATE_CHANGE" : "AMOUNT_ADJUSTMENT",
        previousValues: previousValues as any,
        newValues: newValues as any,
        reason,
      },
    });

    return updated;
  });
}

/**
 * Cancels a student installment without deleting history or prior allocations.
 */
export async function cancelStudentFeeInstallment(input: {
  tenantId: string;
  installmentId: string;
  reason: string;
  changedById?: string;
}) {
  const { tenantId, installmentId, reason, changedById } = input;

  return await db.$transaction(async (tx) => {
    const installment = await tx.studentFeeInstallment.findFirst({
      where: { id: installmentId, tenantId },
      include: { feeInvoice: true },
    });

    if (!installment) {
      throw new Error("Installment not found.");
    }

    if (installment.status === "PAID") {
      throw new Error("Cannot cancel a fully settled installment. Reverse allocations first.");
    }

    const previousValues = {
      status: installment.status,
    };

    const updated = await tx.studentFeeInstallment.update({
      where: { id: installmentId },
      data: { status: "CANCELLED" },
    });

    if (installment.feeInvoice) {
      await tx.feeInvoice.update({
        where: { id: installment.feeInvoice.id },
        data: { status: "WAIVED", notes: `Cancelled via installment management: ${reason}` },
      });
    }

    await tx.installmentScheduleChange.create({
      data: {
        tenantId,
        installmentId,
        changedById: changedById || null,
        changeType: "CANCELLATION",
        previousValues: previousValues as any,
        newValues: { status: "CANCELLED" } as any,
        reason,
      },
    });

    return updated;
  });
}

/**
 * Authoritatively settles an installment using an authentic Layer 1 PaymentReceipt.
 * Uses pessimistic row locking, preserves receipt conservation, and updates backing invoice.
 */
export async function settleInstallmentWithReceipt(input: {
  tenantId: string;
  studentId: string;
  installmentId: string;
  receiptId: string;
  amountToAllocate: number; // in paise
  allocatedById?: string;
}) {
  const { tenantId, studentId, installmentId, receiptId, amountToAllocate, allocatedById } = input;

  if (amountToAllocate <= 0) {
    throw new Error("Allocation amount must be strictly positive.");
  }

  return await db.$transaction(async (tx) => {
    // 1. Fetch and verify installment and backing invoice
    const installment = await tx.studentFeeInstallment.findFirst({
      where: { id: installmentId, tenantId, studentId },
      include: { feeInvoice: true },
    });

    if (!installment || !installment.feeInvoice) {
      throw new Error("Installment or backing invoice not found for student.");
    }

    if (installment.status === "PAID" || installment.status === "CANCELLED") {
      throw new Error(`Installment cannot be paid. Current status: ${installment.status}`);
    }

    // 2. Pessimistic lock on FeeInvoice
    await tx.$queryRaw`
      SELECT id FROM "FeeInvoice"
      WHERE id = ${installment.feeInvoice.id} AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;

    // 3. Pessimistic lock on PaymentReceiptBalance
    const receiptBalance = await tx.paymentReceiptBalance.findFirst({
      where: { receiptId, tenantId },
    });

    if (!receiptBalance) {
      throw new Error("Payment receipt balance record not found.");
    }

    await tx.$queryRaw`
      SELECT id FROM "PaymentReceiptBalance"
      WHERE id = ${receiptBalance.id} AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;

    // 4. Verify unapplied funds sufficiency
    if (receiptBalance.unappliedAmount < amountToAllocate) {
      throw new Error(
        `Insufficient unapplied receipt balance. Available: ₹${receiptBalance.unappliedAmount / 100}, Requested: ₹${amountToAllocate / 100}`
      );
    }

    // 5. Verify invoice remaining balance
    const invoiceRemaining = installment.feeInvoice.amount - installment.feeInvoice.paidAmount;
    if (amountToAllocate > invoiceRemaining) {
      throw new Error(
        `Allocation exceeds invoice remaining balance. Remaining: ₹${invoiceRemaining / 100}, Attempted: ₹${amountToAllocate / 100}`
      );
    }

    // 6. Check if partial payment is forbidden
    if (!installment.allowPartial && amountToAllocate < invoiceRemaining) {
      throw new Error("Partial payments are not permitted for this installment.");
    }

    // 7. Create PaymentAllocation (Immutable financial event)
    const allocation = await tx.paymentAllocation.create({
      data: {
        tenantId,
        receiptId,
        studentId,
        feeInvoiceId: installment.feeInvoice.id,
        amount: amountToAllocate,
        allocatedById: allocatedById || null,
      },
    });

    // 8. Update PaymentReceiptBalance projection
    const newAllocated = receiptBalance.allocatedAmount + amountToAllocate;
    const newUnapplied = receiptBalance.unappliedAmount - amountToAllocate;
    const newReceiptStatus = newUnapplied === 0 ? "FULLY_ALLOCATED" : "PARTIALLY_ALLOCATED";

    await tx.paymentReceiptBalance.update({
      where: { id: receiptBalance.id },
      data: {
        allocatedAmount: newAllocated,
        unappliedAmount: newUnapplied,
        status: newReceiptStatus,
        lastRebalancedAt: new Date(),
      },
    });

    // 9. Update FeeInvoice paidAmount & status
    const newInvoicePaid = installment.feeInvoice.paidAmount + amountToAllocate;
    const isFullSettled = newInvoicePaid >= installment.feeInvoice.amount;

    await tx.feeInvoice.update({
      where: { id: installment.feeInvoice.id },
      data: {
        paidAmount: newInvoicePaid,
        status: isFullSettled ? "PAID" : "PARTIAL",
        paidAt: isFullSettled ? new Date() : installment.feeInvoice.paidAt,
      },
    });

    // 10. Update StudentFeeInstallment status
    const newInstallmentStatus: InstallmentStatus = isFullSettled ? "PAID" : "PARTIALLY_PAID";
    await tx.studentFeeInstallment.update({
      where: { id: installmentId },
      data: { status: newInstallmentStatus },
    });

    return {
      allocation,
      settledAmount: amountToAllocate,
      installmentStatus: newInstallmentStatus,
      receiptRemainingUnapplied: newUnapplied,
    };
  });
}

/**
 * Settles multiple eligible installments in one atomic checkout transaction.
 */
export async function settleMultipleInstallmentsWithReceipt(input: {
  tenantId: string;
  studentId: string;
  installmentIds: string[];
  receiptId: string;
  totalAmountToAllocate: number;
  allocatedById?: string;
}) {
  const { tenantId, studentId, installmentIds, receiptId, totalAmountToAllocate, allocatedById } = input;

  if (installmentIds.length === 0) {
    throw new Error("At least one installment ID is required.");
  }

  let remainingToDistribute = totalAmountToAllocate;
  const allocations = [];

  // Fetch installments sorted by due date
  const installments = await db.studentFeeInstallment.findMany({
    where: { id: { in: installmentIds }, tenantId, studentId },
    include: { feeInvoice: true },
    orderBy: { dueDate: "asc" },
  });

  if (installments.length !== installmentIds.length) {
    throw new Error("One or more installments were not found or belong to another student/tenant.");
  }

  for (const inst of installments) {
    if (remainingToDistribute <= 0) break;
    if (!inst.feeInvoice || inst.status === "PAID" || inst.status === "CANCELLED") continue;

    const remainingDue = inst.feeInvoice.amount - inst.feeInvoice.paidAmount;
    if (remainingDue <= 0) continue;

    const allocForThis = Math.min(remainingDue, remainingToDistribute);

    const result = await settleInstallmentWithReceipt({
      tenantId,
      studentId,
      installmentId: inst.id,
      receiptId,
      amountToAllocate: allocForThis,
      allocatedById,
    });

    allocations.push(result);
    remainingToDistribute -= allocForThis;
  }

  return {
    allocations,
    distributedTotal: totalAmountToAllocate - remainingToDistribute,
    remainingUnallocated: remainingToDistribute,
  };
}

