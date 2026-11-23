"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import type { FormState } from "@/lib/validation";

/**
 * Records a manual institution payout in the platform finance dashboard.
 * Decrements the branch's online payable balance atomically and records a BranchPayout + BranchLedgerEntry.
 */
export async function recordManualPlatformPayoutAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requirePlatformPermission("platform.overview.read");

  let tenantId = formData.get("tenantId") as string;
  const branchId = formData.get("branchId") as string;
  const amountRupeesStr = formData.get("amount") as string;
  const payoutUtr = (formData.get("payoutUtr") as string)?.trim();
  const notes = (formData.get("notes") as string)?.trim() || undefined;

  if (!branchId || !amountRupeesStr || !payoutUtr) {
    return { error: "Branch, positive payout amount, and bank UTR are required." };
  }

  const amountRupees = parseFloat(amountRupeesStr);
  if (isNaN(amountRupees) || amountRupees <= 0) {
    return { error: "Please enter a valid positive payout amount." };
  }

  const amountPaise = Math.round(amountRupees * 100);

  try {
    const result = await db.$transaction(async (tx) => {
      // 1. Verify branch exists and fetch bank details
      const branch = await tx.branch.findUnique({
        where: { id: branchId },
        include: { tenant: { select: { name: true } } },
      });

      if (!branch) {
        throw new Error("Target branch not found.");
      }
      tenantId = branch.tenantId;

      // 2. Fetch latest balanceAfter
      const lastEntry = await tx.branchLedgerEntry.findFirst({
        where: { tenantId, branchId },
        orderBy: { postedAt: "desc" },
        select: { balanceAfter: true },
      });

      const currentBalance = lastEntry?.balanceAfter ?? 0;
      if (amountPaise > currentBalance) {
        throw new Error(
          `Requested payout (₹${(amountPaise / 100).toLocaleString(
            "en-IN"
          )}) exceeds available settled balance (₹${(currentBalance / 100).toLocaleString("en-IN")}).`
        );
      }

      const newBalance = currentBalance - amountPaise;

      // 3. Create BranchPayout record
      const count = await tx.branchPayout.count({ where: { tenantId } });
      const payoutNumber = `PO-${new Date().getFullYear()}-${(count + 1).toString().padStart(4, "0")}`;

      const payout = await tx.branchPayout.create({
        data: {
          tenantId,
          branchId,
          payoutNumber,
          amount: amountPaise,
          currency: "INR",
          status: "PAID",
          bankAccountName: branch.bankAccountName || `${branch.tenant.name} - ${branch.name}`,
          bankAccountNumber: branch.bankAccountNumber || "918273645012",
          bankIfsc: branch.bankIfsc || "HDFC0001234",
          bankBankName: branch.bankBankName || "HDFC Bank",
          utrReference: payoutUtr,
          requestedById: user.id,
          requestedAt: new Date(),
          processedById: user.id,
          processedAt: new Date(),
          metadata: {
            simulated: true,
            notes,
            authorizedBy: user.name,
          },
        },
      });

      // 4. Create DEBIT_PAYOUT BranchLedgerEntry
      await tx.branchLedgerEntry.create({
        data: {
          tenantId,
          branchId,
          entryType: "DEBIT_PAYOUT",
          channel: "ONLINE_JODO",
          amount: amountPaise,
          balanceAfter: newBalance,
          currency: "INR",
          referenceType: "BRANCH_PAYOUT",
          referenceId: payout.id,
          utrReference: payoutUtr,
          description: `Disbursed institution payout: ₹${(amountPaise / 100).toLocaleString(
            "en-IN"
          )} (UTR: ${payoutUtr})`,
          metadata: {
            simulated: true,
            payoutNumber,
            disbursedBy: user.name,
          },
          createdById: user.id,
        },
      });

      return { payoutNumber, amountPaise, newBalance, branchName: branch.name };
    });

    revalidatePath("/platform/finance");
    revalidatePath("/app/fees");

    return {
      success: `Payout ${result.payoutNumber} of ₹${(
        result.amountPaise / 100
      ).toLocaleString("en-IN")} recorded successfully for ${result.branchName}.`,
    };
  } catch (err: any) {
    return { error: err.message || "Failed to record institution payout." };
  }
}
