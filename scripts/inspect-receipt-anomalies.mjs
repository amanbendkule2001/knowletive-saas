import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public" } } });

async function main() {
  console.log("=== INSPECTING RECEIPT ANOMALIES ===");

  // 1. Check branchId nullability on PaymentReceipt
  const [nullBranchCount] = await db.$queryRawUnsafe(`SELECT count(*)::int as c FROM "PaymentReceipt" WHERE "branchId" IS NULL;`);
  const [nonNullBranchCount] = await db.$queryRawUnsafe(`SELECT count(*)::int as c FROM "PaymentReceipt" WHERE "branchId" IS NOT NULL;`);
  const [actualOrphans] = await db.$queryRawUnsafe(`
    SELECT count(*)::int as c 
    FROM "PaymentReceipt" r 
    LEFT JOIN "Branch" b ON b."tenantId" = r."tenantId" AND b.id = r."branchId" 
    WHERE r."branchId" IS NOT NULL AND b.id IS NULL;
  `);

  console.log(`PaymentReceipts with branchId IS NULL:     ${nullBranchCount.c}`);
  console.log(`PaymentReceipts with branchId IS NOT NULL: ${nonNullBranchCount.c}`);
  console.log(`PaymentReceipts with true orphaned branch: ${actualOrphans.c}`);

  // 2. Check the 3 receipt balance violations
  const violations = await db.$queryRawUnsafe(`
    SELECT 
      r.id, r.amount as receipt_amount,
      b."allocatedAmount", b."transferredOutAmount", b."unappliedAmount",
      b."reservedRefundAmount", b."refundedAmount",
      (b."allocatedAmount" + b."transferredOutAmount" + b."unappliedAmount" + b."reservedRefundAmount" + b."refundedAmount") as balance_sum,
      r.amount - (b."allocatedAmount" + b."transferredOutAmount" + b."unappliedAmount" + b."reservedRefundAmount" + b."refundedAmount") as diff
    FROM "PaymentReceipt" r
    JOIN "PaymentReceiptBalance" b ON b."receiptId" = r.id
    WHERE r.amount <> (b."allocatedAmount" + b."transferredOutAmount" + b."unappliedAmount" + b."reservedRefundAmount" + b."refundedAmount");
  `);

  console.log(`\nFound ${violations.length} receipts where amount != sum(balances):`);
  console.table(violations);

  // Check if those 3 violations also exist in the original database!
  const origDb = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive?schema=public" } } });
  const origViolations = await origDb.$queryRawUnsafe(`
    SELECT 
      r.id, r.amount as receipt_amount,
      b."allocatedAmount", b."transferredOutAmount", b."unappliedAmount",
      b."reservedRefundAmount", b."refundedAmount",
      (b."allocatedAmount" + b."transferredOutAmount" + b."unappliedAmount" + b."reservedRefundAmount" + b."refundedAmount") as balance_sum,
      r.amount - (b."allocatedAmount" + b."transferredOutAmount" + b."unappliedAmount" + b."reservedRefundAmount" + b."refundedAmount") as diff
    FROM "PaymentReceipt" r
    JOIN "PaymentReceiptBalance" b ON b."receiptId" = r.id
    WHERE r.amount <> (b."allocatedAmount" + b."transferredOutAmount" + b."unappliedAmount" + b."reservedRefundAmount" + b."refundedAmount");
  `);
  console.log(`Original database has the exact same ${origViolations.length} violations:`);
  console.table(origViolations);

  await origDb.$disconnect();
  await db.$disconnect();
}

main().catch(console.error);
