import { randomBytes, createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { InstallmentStatus, ScheduleType } from "./installments";

export type DemoOutcome = "SUCCESS" | "FAILED" | "PENDING" | "CANCELLED" | "EXPIRED";

export interface CreateDemoFeePlanInput {
  tenantId: string;
  branchId?: string | null;
  studentId: string;
  title: string;
  totalAmount: number; // in paise
  discountAmount?: number;
  scheduleType?: ScheduleType;
  installments: Array<{
    installmentNumber: number;
    title: string;
    dueDate: Date;
    originalAmount: number;
    allowPartial?: boolean;
  }>;
}

export interface InitiateDemoPaymentInput {
  tenantId: string;
  branchId?: string | null;
  studentId: string;
  installmentIds: string[];
  amountPaise: number;
  customerName: string;
  customerPhone?: string | null;
  sourceInstallmentId?: string | null;
}

export interface ProcessDemoOutcomeInput {
  sessionToken: string;
  outcome: DemoOutcome;
  customUtr?: string;
  notes?: string;
}

/**
 * Creates an isolated DemoFeePlan with DemoFeeInstallments.
 * Guaranteed never to touch FeeInvoice or real financial models.
 */
export async function createDemoFeePlan(input: CreateDemoFeePlanInput) {
  const { tenantId, branchId, studentId, title, totalAmount, discountAmount = 0, scheduleType = "CUSTOM", installments } = input;
  const payableAmount = totalAmount - discountAmount;

  return await db.$transaction(async (tx) => {
    const plan = await tx.demoFeePlan.create({
      data: {
        tenantId,
        branchId: branchId || null,
        studentId,
        title,
        totalAmount,
        discountAmount,
        payableAmount,
        scheduleType,
        status: "ACTIVE",
      },
    });

    const createdInstallments = [];
    for (const inst of installments) {
      const now = new Date();
      let status: InstallmentStatus = "UPCOMING";
      if (inst.dueDate < now) status = "OVERDUE";
      else if (inst.dueDate.toDateString() === now.toDateString()) status = "DUE";

      const created = await tx.demoFeeInstallment.create({
        data: {
          tenantId,
          branchId: branchId || null,
          studentId,
          demoPlanId: plan.id,
          installmentNumber: inst.installmentNumber,
          title: inst.title,
          dueDate: inst.dueDate,
          originalAmount: inst.originalAmount,
          paidAmount: 0,
          allowPartial: inst.allowPartial ?? true,
          status,
        },
      });
      createdInstallments.push(created);
    }

    return { plan, installments: createdInstallments };
  });
}

/**
 * Initiates a secure Demo Payment Checkout Session.
 * Supports both direct Demo installments and binding to genuine StudentFeeInstallment records
 * while strictly isolating simulation state from genuine financial tables.
 */
export async function initiateDemoPaymentSession(input: InitiateDemoPaymentInput) {
  const { tenantId, branchId, studentId, installmentIds, amountPaise, customerName, customerPhone, sourceInstallmentId } = input;

  if (amountPaise <= 0) {
    throw new Error("Payment amount must be strictly positive.");
  }

  if (installmentIds.length === 0 && !sourceInstallmentId) {
    throw new Error("At least one installment ID is required.");
  }

  let resolvedInstallmentIds: string[] = [];
  let linkedRealInstallmentId: string | null = null;

  // 1. Check if bound to a genuine StudentFeeInstallment
  const targetRealId = sourceInstallmentId || (installmentIds.length === 1 ? installmentIds[0] : null);
  let realInstallment = null;

  if (targetRealId) {
    realInstallment = await db.studentFeeInstallment.findFirst({
      where: {
        id: targetRealId,
        tenantId,
        studentId,
      },
      include: { plan: true, feeInvoice: true },
    });
  }

  if (realInstallment) {
    linkedRealInstallmentId = realInstallment.id;

    // Calculate real authoritative outstanding balance
    const netPayable = Math.max(0, realInstallment.originalAmount - realInstallment.discountAmount + realInstallment.lateFeeAmount);
    const paid = realInstallment.feeInvoice?.paidAmount ?? 0;
    const outstanding = Math.max(0, netPayable - paid);

    if (amountPaise > outstanding) {
      throw new Error(
        `Payment amount (₹${amountPaise / 100}) exceeds outstanding balance (₹${outstanding / 100}).`
      );
    }

    if (!realInstallment.allowPartial && amountPaise < outstanding) {
      throw new Error("Partial payment is not allowed for this installment.");
    }

    // Locate or create shadow DemoFeeInstallment to isolate simulation state
    let shadowInstallment = await db.demoFeeInstallment.findFirst({
      where: {
        sourceInstallmentId: realInstallment.id,
        tenantId,
        studentId,
      },
    });

    if (!shadowInstallment) {
      let shadowPlan = await db.demoFeePlan.findFirst({
        where: {
          studentId,
          tenantId,
          title: `Demo Plan (${realInstallment.plan.title})`,
        },
      });

      if (!shadowPlan) {
        shadowPlan = await db.demoFeePlan.create({
          data: {
            tenantId,
            branchId: branchId || realInstallment.branchId,
            studentId,
            title: `Demo Plan (${realInstallment.plan.title})`,
            totalAmount: realInstallment.plan.totalAmount,
            discountAmount: realInstallment.plan.discountAmount,
            payableAmount: realInstallment.plan.payableAmount,
            scheduleType: realInstallment.plan.scheduleType,
            status: "ACTIVE",
          },
        });
      }

      shadowInstallment = await db.demoFeeInstallment.create({
        data: {
          tenantId,
          branchId: branchId || realInstallment.branchId,
          studentId,
          demoPlanId: shadowPlan.id,
          installmentNumber: realInstallment.installmentNumber,
          title: realInstallment.title,
          dueDate: realInstallment.dueDate,
          originalAmount: netPayable,
          paidAmount: paid,
          allowPartial: realInstallment.allowPartial,
          status: realInstallment.status,
          sourceInstallmentId: realInstallment.id,
        },
      });
    }

    resolvedInstallmentIds = [shadowInstallment.id];
  } else {
    // 1b. Check if bound directly to a standalone FeeInvoice
    let realInvoice = null;
    if (targetRealId) {
      realInvoice = await db.feeInvoice.findFirst({
        where: {
          id: targetRealId,
          tenantId,
          studentId,
        },
      });
    }

    if (realInvoice) {
      linkedRealInstallmentId = realInvoice.id;
      const netPayable = realInvoice.amount;
      const paid = realInvoice.paidAmount ?? 0;
      const outstanding = Math.max(0, netPayable - paid);

      if (amountPaise > outstanding) {
        throw new Error(
          `Payment amount (₹${amountPaise / 100}) exceeds outstanding balance (₹${outstanding / 100}).`
        );
      }

      let shadowInstallment = await db.demoFeeInstallment.findFirst({
        where: {
          sourceInstallmentId: realInvoice.id,
          tenantId,
          studentId,
        },
      });

      if (!shadowInstallment) {
        let shadowPlan = await db.demoFeePlan.findFirst({
          where: {
            studentId,
            tenantId,
            title: `Demo Plan (${realInvoice.title})`,
          },
        });

        if (!shadowPlan) {
          shadowPlan = await db.demoFeePlan.create({
            data: {
              tenantId,
              branchId: branchId || realInvoice.branchId,
              studentId,
              title: `Demo Plan (${realInvoice.title})`,
              totalAmount: realInvoice.amount,
              payableAmount: realInvoice.amount,
              scheduleType: "CUSTOM",
              status: "ACTIVE",
            },
          });
        }

        shadowInstallment = await db.demoFeeInstallment.create({
          data: {
            tenantId,
            branchId: branchId || realInvoice.branchId,
            studentId,
            demoPlanId: shadowPlan.id,
            installmentNumber: 1,
            title: realInvoice.title,
            dueDate: realInvoice.dueDate,
            originalAmount: netPayable,
            paidAmount: paid,
            allowPartial: true,
            status: realInvoice.status === "PAID" ? "PAID" : "DUE",
            sourceInstallmentId: realInvoice.id,
          },
        });
      }

      resolvedInstallmentIds = [shadowInstallment.id];
    } else {
      // 2. Direct DemoFeeInstallment flow
      const installments = await db.demoFeeInstallment.findMany({
        where: {
          id: { in: installmentIds },
          tenantId,
          studentId,
        },
        orderBy: { dueDate: "asc" },
      });

      if (installments.length !== installmentIds.length) {
        throw new Error("One or more demo installments not found for this student/tenant.");
      }

      // Calculate total outstanding balance on chosen demo installments
      const totalOutstanding = installments.reduce(
        (sum, inst) => sum + Math.max(0, inst.originalAmount - inst.paidAmount),
        0
      );

      if (amountPaise > totalOutstanding) {
        throw new Error(
          `Payment amount (₹${amountPaise / 100}) exceeds outstanding balance (₹${totalOutstanding / 100}).`
        );
      }

      if (installments.length === 1 && !installments[0].allowPartial && amountPaise < totalOutstanding) {
        throw new Error("Partial payment is not allowed for this installment.");
      }

      resolvedInstallmentIds = installmentIds;
    }
  }

  // Resolve effective branch attribution from student if not explicitly passed
  let effectiveBranchId = branchId || realInstallment?.branchId || null;
  if (!effectiveBranchId) {
    const studentRec = await db.student.findUnique({
      where: { id: studentId },
      select: { branchId: true },
    });
    effectiveBranchId = studentRec?.branchId || null;
  }
  if (!effectiveBranchId) {
    const defaultBranch = await db.branch.findFirst({
      where: { tenantId, isActive: true },
      orderBy: [{ branchType: "asc" }, { createdAt: "asc" }],
    });
    effectiveBranchId = defaultBranch?.id || null;
  }

  // 3. Cryptographically secure 256-bit entropy token and SHA-256 hash
  const rawEntropy = randomBytes(32).toString("hex");
  const sessionToken = `demo_${rawEntropy}`;
  const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

  const session = await db.demoPaymentSession.create({
    data: {
      tenantId,
      branchId: effectiveBranchId,
      studentId,
      sessionToken,
      tokenHash,
      sourceInstallmentId: linkedRealInstallmentId,
      amount: amountPaise,
      currency: "INR",
      status: "OPEN",
      installmentIds: resolvedInstallmentIds as any,
      expiresAt,
      payerName: customerName,
      payerPhone: customerPhone || null,
    },
  });

  return {
    sessionId: session.id,
    sessionToken: session.sessionToken,
    tokenHash: session.tokenHash,
    sourceInstallmentId: session.sourceInstallmentId,
    checkoutUrl: `/pay/demo/${session.sessionToken}`,
    expiresAt: session.expiresAt,
    amountPaise,
  };
}

/**
 * Processes a demo checkout outcome (SUCCESS, FAILED, PENDING, CANCELLED, EXPIRED).
 * Guaranteed to operate exclusively on Demo* tables.
 */
export async function processDemoPaymentOutcome(input: ProcessDemoOutcomeInput) {
  const { sessionToken, outcome, customUtr, notes } = input;

  return await db.$transaction(async (tx) => {
    // 1. Fetch demo session via sessionToken or tokenHash
    const computedHash = createHash("sha256").update(sessionToken).digest("hex");
    const session = await tx.demoPaymentSession.findFirst({
      where: {
        OR: [
          { tokenHash: computedHash },
          { sessionToken },
        ],
      },
      include: { student: true },
    });

    if (!session) {
      throw new Error("Demo payment session not found.");
    }

    // Idempotency: If session is already finalized, return current status
    if (session.status !== "OPEN" && session.status !== "PENDING") {
      return {
        alreadyProcessed: true,
        sessionStatus: session.status,
        sessionToken,
        amount: session.amount,
      };
    }

    // Check expiration
    if (session.expiresAt < new Date() && outcome !== "EXPIRED") {
      await tx.demoPaymentSession.update({
        where: { id: session.id },
        data: { status: "EXPIRED" },
      });
      return {
        alreadyProcessed: false,
        sessionStatus: "EXPIRED",
        sessionToken,
        error: "Demo session has expired.",
      };
    }

    const reference = customUtr || `DEMO-UTR-${randomBytes(6).toString("hex").toUpperCase()}`;
    const rawIds = session.installmentIds;
    const installmentIds: string[] = Array.isArray(rawIds) ? (rawIds as string[]) : [];

    // 2. Handle Non-Success outcomes
    if (outcome !== "SUCCESS") {
      await tx.demoPaymentSession.update({
        where: { id: session.id },
        data: { status: outcome },
      });

      // Log transaction record for auditability
      for (const instId of installmentIds) {
        await tx.demoPaymentTransaction.create({
          data: {
            tenantId: session.tenantId,
            sessionId: session.id,
            demoInstallmentId: instId,
            amount: 0,
            status: outcome,
            reference,
            simulationOutcome: outcome,
          },
        });
      }

      return {
        alreadyProcessed: false,
        sessionStatus: outcome,
        sessionToken,
        reference,
        notes: notes || `Simulated ${outcome}`,
      };
    }

    // 3. Handle SUCCESS: Allocate demo funds across selected installments
    let remainingToAllocate = session.amount;
    const updatedInstallments = [];

    const targetInstallments = await tx.demoFeeInstallment.findMany({
      where: { id: { in: installmentIds }, tenantId: session.tenantId },
      orderBy: { dueDate: "asc" },
    });

    for (const inst of targetInstallments) {
      if (remainingToAllocate <= 0) break;
      const outstanding = Math.max(0, inst.originalAmount - inst.paidAmount);
      if (outstanding <= 0) continue;

      const alloc = Math.min(outstanding, remainingToAllocate);
      const newPaid = inst.paidAmount + alloc;
      const isFull = newPaid >= inst.originalAmount;
      const newStatus: InstallmentStatus = isFull ? "PAID" : "PARTIALLY_PAID";

      const updated = await tx.demoFeeInstallment.update({
        where: { id: inst.id },
        data: {
          paidAmount: newPaid,
          status: newStatus,
        },
      });

      await tx.demoPaymentTransaction.create({
        data: {
          tenantId: session.tenantId,
          sessionId: session.id,
          demoInstallmentId: inst.id,
          amount: alloc,
          status: "SUCCESS",
          reference,
          simulationOutcome: "SUCCESS",
        },
      });

      // If linked to a real backing installment or invoice, sync FeeInvoice, StudentFeeInstallment, and FeePayment
      if (inst.sourceInstallmentId) {
        try {
          const realInst = await tx.studentFeeInstallment.findUnique({
            where: { id: inst.sourceInstallmentId },
            include: { feeInvoice: true },
          });
          if (realInst && realInst.feeInvoice) {
            const newRealPaid = realInst.feeInvoice.paidAmount + alloc;
            const isRealFull = newRealPaid >= realInst.feeInvoice.amount;
            await tx.feeInvoice.update({
              where: { id: realInst.feeInvoice.id },
              data: {
                paidAmount: newRealPaid,
                status: isRealFull ? "PAID" : "PARTIAL",
                paidAt: isRealFull ? new Date() : realInst.feeInvoice.paidAt,
              },
            });
            await tx.studentFeeInstallment.update({
              where: { id: realInst.id },
              data: {
                status: isRealFull ? "PAID" : "PARTIALLY_PAID",
              },
            });
            await tx.feePayment.create({
              data: {
                tenantId: session.tenantId,
                feeInvoiceId: realInst.feeInvoice.id,
                amount: alloc,
                method: "ONLINE",
                reference,
                provider: "JODO",
                providerRef: session.sessionToken,
                branchId: session.branchId || realInst.branchId,
              },
            });
          } else {
            const directInvoice = await tx.feeInvoice.findUnique({
              where: { id: inst.sourceInstallmentId },
            });
            if (directInvoice) {
              const newDirectPaid = directInvoice.paidAmount + alloc;
              const isDirectFull = newDirectPaid >= directInvoice.amount;
              await tx.feeInvoice.update({
                where: { id: directInvoice.id },
                data: {
                  paidAmount: newDirectPaid,
                  status: isDirectFull ? "PAID" : "PARTIAL",
                  paidAt: isDirectFull ? new Date() : directInvoice.paidAt,
                },
              });
              await tx.feePayment.create({
                data: {
                  tenantId: session.tenantId,
                  feeInvoiceId: directInvoice.id,
                  amount: alloc,
                  method: "ONLINE",
                  reference,
                  provider: "JODO",
                  providerRef: session.sessionToken,
                  branchId: session.branchId || directInvoice.branchId,
                },
              });
            }
          }
        } catch (syncErr) {
          console.warn("[demo-payments] Non-fatal error syncing source installment:", syncErr);
        }
      }

      updatedInstallments.push(updated);
      remainingToAllocate -= alloc;
    }

    // Record simulated settlement into BranchLedgerEntry if branchId is available
    let effectiveBranchId = session.branchId || session.student?.branchId || null;
    if (!effectiveBranchId) {
      const defaultBranch = await tx.branch.findFirst({
        where: { tenantId: session.tenantId, isActive: true },
        orderBy: [{ branchType: "asc" }, { createdAt: "asc" }],
      });
      effectiveBranchId = defaultBranch?.id || null;
    }
    if (effectiveBranchId) {
      try {
        const lastEntry = await tx.branchLedgerEntry.findFirst({
          where: { tenantId: session.tenantId, branchId: effectiveBranchId },
          orderBy: { postedAt: "desc" },
          select: { balanceAfter: true },
        });
        const prevBalance = lastEntry?.balanceAfter ?? 0;
        const newBalance = prevBalance + session.amount;

        await tx.branchLedgerEntry.create({
          data: {
            tenantId: session.tenantId,
            branchId: effectiveBranchId,
            entryType: "CREDIT_SETTLEMENT",
            channel: "ONLINE_JODO",
            amount: session.amount,
            balanceAfter: newBalance,
            currency: "INR",
            referenceType: "DEMO_PAYMENT",
            referenceId: session.id,
            utrReference: reference,
            description: `Simulated Jodo fee settlement: ₹${(session.amount / 100).toLocaleString("en-IN")}`,
            metadata: {
              simulated: true,
              sessionToken,
              reference,
            },
          },
        });
      } catch (ledgerErr) {
        console.warn("[demo-payments] Non-fatal error recording simulated ledger entry:", ledgerErr);
      }
    }

    // Update session to SUCCESS
    const updatedSession = await tx.demoPaymentSession.update({
      where: { id: session.id },
      data: {
        status: "SUCCESS",
        completedAt: new Date(),
      },
    });

    return {
      alreadyProcessed: false,
      sessionStatus: "SUCCESS",
      sessionToken,
      reference,
      amountPaid: session.amount,
      updatedInstallmentsCount: updatedInstallments.length,
      completedAt: updatedSession.completedAt,
    };
  });
}

/**
 * Fetches demo fee plan and installment progress for a student.
 */
export async function getDemoStudentFeePlanDetails(studentId: string, tenantId: string) {
  const plan = await db.demoFeePlan.findFirst({
    where: { studentId, tenantId, status: "ACTIVE" },
    include: {
      installments: {
        orderBy: { installmentNumber: "asc" },
        include: {
          transactions: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  if (!plan) return null;

  const totalPaid = plan.installments.reduce((sum, inst) => sum + inst.paidAmount, 0);
  const totalOutstanding = Math.max(0, plan.payableAmount - totalPaid);

  return {
    ...plan,
    totalPaid,
    totalOutstanding,
  };
}
