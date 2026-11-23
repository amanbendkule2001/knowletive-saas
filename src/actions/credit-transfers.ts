"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { authorizeTenantWrite } from "@/lib/rbac";
import { type FormState } from "@/lib/validation";
import {
  requestCreditTransferService,
  approveCreditTransferService,
  rejectCreditTransferService,
  cancelCreditTransferService,
  executeCreditTransferService,
  createGuardianConsentService,
  verifyGuardianConsentService,
  revokeGuardianConsentService,
  allocateTransferredCreditService,
  allocateStudentCreditToInvoiceService,
  reverseStudentCreditAllocationService,
  CreditTransferError,
  type ActorContext,
} from "@/lib/credit-transfers";

/**
 * Server action to initiate a sibling credit transfer request.
 */
export async function requestCreditTransferAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { requestId?: string; requestNumber?: string }> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const sourceStudentId = String(formData.get("sourceStudentId") || "").trim();
  const targetStudentId = String(formData.get("targetStudentId") || "").trim();
  let authorizedGuardianId = String(formData.get("authorizedGuardianId") || "").trim();
  const rawAmount = String(formData.get("amount") || "").trim();
  const rawAmountInPaise = String(formData.get("amountInPaise") || "").trim();
  const reason = String(formData.get("reason") || "").trim();
  const guardianConsentRef = String(formData.get("guardianConsentRef") || "").trim();
  const guardianConsentId = String(formData.get("guardianConsentId") || "").trim() || undefined;
  const idempotencyKey = String(formData.get("idempotencyKey") || "").trim() || undefined;

  if (!sourceStudentId) return { error: "Source student is required." };
  if (!targetStudentId) return { error: "Destination student is required." };
  if (!rawAmount && !rawAmountInPaise) return { error: "Transfer amount is required." };
  if (!reason) return { error: "Transfer reason is required." };
  if (!guardianConsentRef && !guardianConsentId) return { error: "Guardian consent reference or ID is required." };

  let amountInPaise: number;
  if (rawAmountInPaise) {
    amountInPaise = parseInt(rawAmountInPaise, 10);
  } else {
    const num = parseFloat(rawAmount);
    if (isNaN(num) || num <= 0) {
      return { error: "Transfer amount must be a positive number." };
    }
    // If it contains a decimal point, convert rupees to paise; otherwise treat as paise/units
    amountInPaise = rawAmount.includes(".") ? Math.round(num * 100) : Math.round(num);
  }

  if (amountInPaise <= 0) {
    return { error: "Transfer amount must be strictly positive." };
  }

  // If authorizedGuardianId not explicitly passed, find the common guardian from StudentGuardian
  if (!authorizedGuardianId) {
    const common = await db.$queryRaw<{ guardianId: string }[]>`
      SELECT sg1."guardianId"
      FROM "StudentGuardian" sg1
      JOIN "StudentGuardian" sg2 ON sg1."guardianId" = sg2."guardianId"
      JOIN "Guardian" g ON g.id = sg1."guardianId"
      WHERE sg1."studentId" = ${sourceStudentId}
        AND sg2."studentId" = ${targetStudentId}
        AND g."tenantId" = ${ctx.tenant.id}
      LIMIT 1
    `;
    if (common.length > 0) {
      authorizedGuardianId = common[0].guardianId;
    } else {
      return { error: "Could not find a common authorized guardian for both students." };
    }
  }

  const actor: ActorContext = {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    userName: ctx.user.name ?? "User",
    roleKey: ctx.membership?.roleKey ?? (ctx.isOwnerView ? "OWNER" : "STAFF"),
    ip: null,
  };

  try {
    const result = await requestCreditTransferService(
      {
        sourceStudentId,
        targetStudentId,
        amount: amountInPaise,
        reason,
        authorizedGuardianId,
        guardianConsentRef: guardianConsentRef || (guardianConsentId ?? ""),
        guardianConsentId,
        idempotencyKey,
      },
      actor
    );

    revalidatePath("/app/fees");
    return {
      success: `Credit transfer request ${result.request.requestNumber} created successfully.`,
      requestId: result.request.id,
      requestNumber: result.request.requestNumber,
    };
  } catch (err: unknown) {
    if (err instanceof CreditTransferError) {
      return { error: err.message };
    }
    if (err instanceof Error) {
      return { error: err.message };
    }
    return { error: "An unexpected error occurred while requesting credit transfer." };
  }
}

/**
 * Server action for an authorized reviewer to approve a credit transfer request.
 */
export async function approveCreditTransferAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { requestId?: string; status?: string }> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const requestId = String(formData.get("requestId") || "").trim();
  const notes = String(formData.get("notes") || "").trim() || undefined;

  if (!requestId) return { error: "Request ID is required." };

  // Role check: Only INSTITUTE_ADMIN or PRINCIPAL (or Platform Owner)
  const roleKey = ctx.membership?.roleKey;
  const isAuthorizedRole = ctx.isOwnerView || roleKey === "INSTITUTE_ADMIN" || roleKey === "PRINCIPAL";
  if (!isAuthorizedRole) {
    return { error: "Only an Institute Admin or Principal can approve credit transfers." };
  }

  const actor: ActorContext = {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    userName: ctx.user.name ?? "User",
    roleKey: roleKey ?? (ctx.isOwnerView ? "OWNER" : "STAFF"),
    ip: null,
  };

  try {
    const result = await approveCreditTransferService(
      {
        requestId,
        notes,
      },
      actor
    );

    revalidatePath("/app/fees");
    return {
      success: `Credit transfer request approved successfully.`,
      requestId: result.request.id,
      status: result.request.status,
    };
  } catch (err: unknown) {
    if (err instanceof CreditTransferError) {
      return { error: err.message };
    }
    if (err instanceof Error) {
      return { error: err.message };
    }
    return { error: "An unexpected error occurred while approving credit transfer." };
  }
}

/**
 * Server action for an authorized reviewer to reject a credit transfer request.
 */
export async function rejectCreditTransferAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { requestId?: string; status?: string }> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const requestId = String(formData.get("requestId") || "").trim();
  const reason = String(formData.get("reason") || "").trim();
  const notes = String(formData.get("notes") || "").trim() || undefined;

  if (!requestId) return { error: "Request ID is required." };
  if (!reason) return { error: "A non-empty rejection reason is required." };

  // Role check: Only INSTITUTE_ADMIN or PRINCIPAL (or Platform Owner)
  const roleKey = ctx.membership?.roleKey;
  const isAuthorizedRole = ctx.isOwnerView || roleKey === "INSTITUTE_ADMIN" || roleKey === "PRINCIPAL";
  if (!isAuthorizedRole) {
    return { error: "Only an Institute Admin or Principal can reject credit transfers." };
  }

  const actor: ActorContext = {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    userName: ctx.user.name ?? "User",
    roleKey: roleKey ?? (ctx.isOwnerView ? "OWNER" : "STAFF"),
    ip: null,
  };

  try {
    const result = await rejectCreditTransferService(
      {
        requestId,
        reason,
        notes,
      },
      actor
    );

    revalidatePath("/app/fees");
    return {
      success: `Credit transfer request rejected.`,
      requestId: result.request.id,
      status: result.request.status,
    };
  } catch (err: unknown) {
    if (err instanceof CreditTransferError) {
      return { error: err.message };
    }
    if (err instanceof Error) {
      return { error: err.message };
    }
    return { error: "An unexpected error occurred while rejecting credit transfer." };
  }
}

/**
 * Server action to execute an approved credit transfer request atomically.
 */
export async function executeCreditTransferAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { requestId?: string; journalId?: string; status?: string }> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const requestId = String(formData.get("requestId") || "").trim();

  if (!requestId) return { error: "Request ID is required." };

  const actor: ActorContext = {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    userName: ctx.user.name ?? "User",
    roleKey: ctx.membership?.roleKey ?? (ctx.isOwnerView ? "OWNER" : "STAFF"),
    ip: null,
  };

  try {
    const result = await executeCreditTransferService(
      {
        requestId,
      },
      actor
    );

    revalidatePath("/app/fees");
    return {
      success: `Credit transfer executed successfully. Journal: ${result.journal?.id ?? ""}`,
      requestId: result.request.id,
      journalId: result.journal?.id,
      status: result.request.status,
    };
  } catch (err: unknown) {
    if (err instanceof CreditTransferError) {
      return { error: err.message };
    }
    if (err instanceof Error) {
      return { error: err.message };
    }
    return { error: "An unexpected error occurred while executing credit transfer." };
  }
}

/**
 * Server action for a creator or admin to cancel a pending credit transfer request.
 */
export async function cancelCreditTransferAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { requestId?: string; status?: string }> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const requestId = String(formData.get("requestId") || "").trim();
  const reason = String(formData.get("reason") || "").trim() || undefined;

  if (!requestId) return { error: "Request ID is required." };

  const actor: ActorContext = {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    userName: ctx.user.name ?? "User",
    roleKey: ctx.membership?.roleKey ?? (ctx.isOwnerView ? "OWNER" : "STAFF"),
    ip: null,
  };

  try {
    const result = await cancelCreditTransferService(
      {
        requestId,
        reason,
      },
      actor
    );

    revalidatePath("/app/fees");
    return {
      success: `Credit transfer request cancelled.`,
      requestId: result.request.id,
      status: result.request.status,
    };
  } catch (err: unknown) {
    if (err instanceof CreditTransferError) {
      return { error: err.message };
    }
    if (err instanceof Error) {
      return { error: err.message };
    }
    return { error: "An unexpected error occurred while cancelling credit transfer." };
  }
}

/**
 * Server action to record a new guardian consent for sibling credit transfer.
 */
export async function createGuardianConsentAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { consentId?: string }> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "create");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const guardianId = String(formData.get("guardianId") || "").trim();
  const sourceStudentId = String(formData.get("sourceStudentId") || "").trim();
  const destinationStudentId = String(formData.get("destinationStudentId") || "").trim();
  const fileAssetId = String(formData.get("fileAssetId") || "").trim() || undefined;
  const rawExpiresAt = String(formData.get("expiresAt") || "").trim();

  if (!guardianId) return { error: "Guardian is required." };
  if (!sourceStudentId) return { error: "Source student is required." };
  if (!destinationStudentId) return { error: "Destination student is required." };

  const actor: ActorContext = {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    userName: ctx.user.name ?? "User",
    roleKey: ctx.membership?.roleKey ?? (ctx.isOwnerView ? "OWNER" : "STAFF"),
    ip: null,
  };

  try {
    const consent = await createGuardianConsentService(
      {
        guardianId,
        sourceStudentId,
        destinationStudentId,
        fileAssetId,
        expiresAt: rawExpiresAt ? new Date(rawExpiresAt) : undefined,
      },
      actor
    );

    revalidatePath("/app/fees");
    return {
      success: "Guardian consent created successfully (pending verification).",
      consentId: consent.id,
    };
  } catch (err: unknown) {
    if (err instanceof CreditTransferError) {
      return { error: err.message };
    }
    if (err instanceof Error) {
      return { error: err.message };
    }
    return { error: "An unexpected error occurred while creating guardian consent." };
  }
}

/**
 * Server action to verify (approve or reject) a guardian consent record.
 */
export async function verifyGuardianConsentAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { consentId?: string; status?: string }> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const consentId = String(formData.get("consentId") || "").trim();
  const decision = String(formData.get("decision") || "").trim().toUpperCase();
  const rejectionReason = String(formData.get("rejectionReason") || "").trim();
  const rawExpiresAt = String(formData.get("expiresAt") || "").trim();

  if (!consentId) return { error: "Consent ID is required." };
  if (decision !== "APPROVE" && decision !== "REJECT") {
    return { error: "Decision must be APPROVE or REJECT." };
  }

  const actor: ActorContext = {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    userName: ctx.user.name ?? "User",
    roleKey: ctx.membership?.roleKey ?? (ctx.isOwnerView ? "OWNER" : "STAFF"),
    ip: null,
  };

  try {
    const consent = await verifyGuardianConsentService(
      {
        consentId,
        decision: decision as "APPROVE" | "REJECT",
        rejectionReason: rejectionReason || undefined,
        expiresAt: rawExpiresAt ? new Date(rawExpiresAt) : undefined,
      },
      actor
    );

    revalidatePath("/app/fees");
    return {
      success: `Guardian consent ${decision === "APPROVE" ? "verified" : "rejected"} successfully.`,
      consentId: consent.id,
      status: consent.status,
    };
  } catch (err: unknown) {
    if (err instanceof CreditTransferError) {
      return { error: err.message };
    }
    if (err instanceof Error) {
      return { error: err.message };
    }
    return { error: "An unexpected error occurred while verifying guardian consent." };
  }
}

/**
 * Server action to revoke an active guardian consent record.
 */
export async function revokeGuardianConsentAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { consentId?: string; status?: string }> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const consentId = String(formData.get("consentId") || "").trim();
  const reason = String(formData.get("reason") || "").trim();

  if (!consentId) return { error: "Consent ID is required." };
  if (!reason) return { error: "Revocation reason is required." };

  const actor: ActorContext = {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    userName: ctx.user.name ?? "User",
    roleKey: ctx.membership?.roleKey ?? (ctx.isOwnerView ? "OWNER" : "STAFF"),
    ip: null,
  };

  try {
    const consent = await revokeGuardianConsentService(
      {
        consentId,
        reason,
      },
      actor
    );

    revalidatePath("/app/fees");
    return {
      success: "Guardian consent revoked successfully.",
      consentId: consent.id,
      status: consent.status,
    };
  } catch (err: unknown) {
    if (err instanceof CreditTransferError) {
      return { error: err.message };
    }
    if (err instanceof Error) {
      return { error: err.message };
    }
    return { error: "An unexpected error occurred while revoking guardian consent." };
  }
}

/**
 * Server action to allocate transferred-in sibling credit towards a student's invoice.
 */
export async function allocateTransferredCreditAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { feeInvoiceId?: string; allocatedAmount?: number }> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const studentId = String(formData.get("studentId") || "").trim();
  const feeInvoiceId = String(formData.get("feeInvoiceId") || "").trim();
  const rawAmount = String(formData.get("amount") || "").trim();
  const rawAmountInPaise = String(formData.get("amountInPaise") || "").trim();

  if (!studentId) return { error: "Student ID is required." };
  if (!feeInvoiceId) return { error: "Fee Invoice ID is required." };
  if (!rawAmount && !rawAmountInPaise) return { error: "Allocation amount is required." };

  let amountInPaise: number;
  if (rawAmountInPaise) {
    amountInPaise = parseInt(rawAmountInPaise, 10);
  } else {
    const num = parseFloat(rawAmount);
    if (isNaN(num) || num <= 0) return { error: "Amount must be a positive number." };
    amountInPaise = rawAmount.includes(".") ? Math.round(num * 100) : Math.round(num);
  }

  const actor: ActorContext = {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    userName: ctx.user.name ?? "User",
    roleKey: ctx.membership?.roleKey ?? (ctx.isOwnerView ? "OWNER" : "STAFF"),
    ip: null,
  };

  try {
    const res = await allocateTransferredCreditService(
      {
        studentId,
        feeInvoiceId,
        amount: amountInPaise,
      },
      actor
    );
    revalidatePath("/app/fees");
    revalidatePath(`/app/fees/${feeInvoiceId}`);
    return {
      success: `Successfully allocated ₹${(amountInPaise / 100).toFixed(2)} to invoice.`,
      feeInvoiceId: res.feeInvoiceId,
      allocatedAmount: res.allocatedAmount,
    };
  } catch (err: unknown) {
    if (err instanceof CreditTransferError) return { error: err.message };
    if (err instanceof Error) return { error: err.message };
    return { error: "An unexpected error occurred while allocating transferred credit." };
  }
}

/**
 * Server action to allocate student credit (direct receipt and/or transferred sibling credit)
 * towards an outstanding FeeInvoice.
 */
export async function allocateStudentCreditToInvoiceAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { feeInvoiceId?: string; allocatedAmount?: number }> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const studentId = String(formData.get("studentId") || "").trim();
  const feeInvoiceId = String(formData.get("feeInvoiceId") || "").trim();
  const rawAmount = String(formData.get("amount") || "").trim();
  const rawAmountInPaise = String(formData.get("amountInPaise") || "").trim();
  const idempotencyKey = String(formData.get("idempotencyKey") || "").trim() || undefined;
  const sourcePreference = (String(formData.get("sourcePreference") || "").trim() || "AUTO_FIFO") as
    | "AUTO_FIFO"
    | "DIRECT_FIRST"
    | "TRANSFERRED_FIRST";
  const notes = String(formData.get("notes") || "").trim() || undefined;

  if (!studentId) return { error: "Student ID is required." };
  if (!feeInvoiceId) return { error: "Fee Invoice ID is required." };
  if (!rawAmount && !rawAmountInPaise) return { error: "Allocation amount is required." };

  let amountInPaise: number;
  if (rawAmountInPaise) {
    amountInPaise = parseInt(rawAmountInPaise, 10);
  } else {
    const num = parseFloat(rawAmount);
    if (isNaN(num) || num <= 0) return { error: "Amount must be a positive number." };
    amountInPaise = rawAmount.includes(".") ? Math.round(num * 100) : Math.round(num);
  }

  const actor: ActorContext = {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    userName: ctx.user.name ?? "User",
    roleKey: ctx.membership?.roleKey ?? (ctx.isOwnerView ? "OWNER" : "STAFF"),
    ip: null,
  };

  try {
    const res = await allocateStudentCreditToInvoiceService(
      {
        studentId,
        feeInvoiceId,
        amount: amountInPaise,
        idempotencyKey,
        sourcePreference,
        notes,
      },
      actor
    );
    revalidatePath("/app/fees");
    revalidatePath(`/app/fees/${feeInvoiceId}`);
    return {
      success: `Successfully allocated ₹${(amountInPaise / 100).toFixed(2)} to invoice.`,
      feeInvoiceId: res.feeInvoiceId,
      allocatedAmount: res.allocatedAmount,
    };
  } catch (err: unknown) {
    if (err instanceof CreditTransferError) return { error: err.message };
    if (err instanceof Error) return { error: err.message };
    return { error: "An unexpected error occurred while allocating student credit." };
  }
}

/**
 * Server action to reverse an existing credit allocation.
 */
export async function reverseCreditAllocationAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState & { reversalId?: string; reversedAmount?: number }> {
  const auth = await authorizeTenantWrite("tenant.fees.write", "update");
  if (!auth.ok) return { error: auth.error };
  const ctx = auth.ctx;

  const allocationId = String(formData.get("allocationId") || "").trim();
  const feeInvoiceId = String(formData.get("feeInvoiceId") || "").trim();
  const rawAmount = String(formData.get("amount") || "").trim();
  const rawAmountInPaise = String(formData.get("amountInPaise") || "").trim();
  const reason = String(formData.get("reason") || "").trim();

  if (!allocationId) return { error: "Allocation ID is required." };
  if (!rawAmount && !rawAmountInPaise) return { error: "Reversal amount is required." };
  if (!reason) return { error: "Reversal reason is required." };

  let amountInPaise: number;
  if (rawAmountInPaise) {
    amountInPaise = parseInt(rawAmountInPaise, 10);
  } else {
    const num = parseFloat(rawAmount);
    if (isNaN(num) || num <= 0) return { error: "Amount must be a positive number." };
    amountInPaise = rawAmount.includes(".") ? Math.round(num * 100) : Math.round(num);
  }

  const actor: ActorContext = {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    userName: ctx.user.name ?? "User",
    roleKey: ctx.membership?.roleKey ?? (ctx.isOwnerView ? "OWNER" : "STAFF"),
    ip: null,
  };

  try {
    const res = await reverseStudentCreditAllocationService(
      {
        allocationId,
        amount: amountInPaise,
        reason,
      },
      actor
    );
    revalidatePath("/app/fees");
    if (feeInvoiceId) {
      revalidatePath(`/app/fees/${feeInvoiceId}`);
    }
    return {
      success: `Successfully reversed ₹${(amountInPaise / 100).toFixed(2)} of allocation.`,
      reversalId: res.reversalId,
      reversedAmount: res.reversedAmount,
    };
  } catch (err: unknown) {
    if (err instanceof CreditTransferError) return { error: err.message };
    if (err instanceof Error) return { error: err.message };
    return { error: "An unexpected error occurred while reversing credit allocation." };
  }
}
