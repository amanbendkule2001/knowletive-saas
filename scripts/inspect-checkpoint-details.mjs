import { PrismaClient } from "@prisma/client";

const DB_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public";
const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });

async function main() {
  console.log("=== INSPECTING CHECKPOINT DETAILS ===");

  // 1. Constraints on PaymentReceiptBalance
  const prbConstraints = await db.$queryRawUnsafe(`
    SELECT conname, pg_get_constraintdef(oid) as def 
    FROM pg_constraint 
    WHERE conrelid = '"PaymentReceiptBalance"'::regclass;
  `);
  console.log("\nConstraints on PaymentReceiptBalance:");
  console.log(JSON.stringify(prbConstraints, null, 2));

  // 2. All Triggers
  const allTriggers = await db.$queryRawUnsafe(`
    SELECT tgname, relname, pg_get_triggerdef(t.oid) as def
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
    ORDER BY relname, tgname;
  `);
  console.log("\nAll User Triggers in Database:");
  for (const tr of allTriggers) {
    console.log(`  ${tr.relname}: ${tr.tgname}`);
  }

  // 3. Columns of FeeInvoice and FeePayment
  const invoiceCols = await db.$queryRawUnsafe(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'FeeInvoice' AND table_schema = 'public';
  `);
  console.log("\nFeeInvoice columns:", invoiceCols.map(c => c.column_name).join(", "));

  const paymentCols = await db.$queryRawUnsafe(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'FeePayment' AND table_schema = 'public';
  `);
  console.log("FeePayment columns:", paymentCols.map(c => c.column_name).join(", "));
}

main().catch(console.error).finally(() => db.$disconnect());
