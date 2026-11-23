import { PrismaClient } from "@prisma/client";

const DB_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public";
const APP_DB_URL = "postgresql://knowletive_app:knowletive_app@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public";

const adminDb = new PrismaClient({ datasources: { db: { url: DB_URL } } });
const appDb = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });

async function main() {
  console.log("=============================================================");
  console.log("  PHASE 2.3.5 — POST-MIGRATION ARCHITECTURE & PRIVILEGES (PART 5)");
  console.log("=============================================================");

  // 1. Verify Composite Foreign Keys
  console.log("\n1. Verifying Composite Foreign Keys:");
  const expectedFks = [
    { table: "PaymentReceipt", name: "PaymentReceipt_tenantId_branchId_fkey", refTable: "Branch" },
    { table: "FeePayment", name: "FeePayment_tenantId_branchId_fkey", refTable: "Branch" },
    { table: "Lead", name: "Lead_tenantId_branchId_fkey", refTable: "Branch" },
    { table: "PaymentCollectorRoute", name: "PaymentCollectorRoute_tenantId_branchId_fkey", refTable: "Branch" },
    { table: "PaymentAllocation", name: "PaymentAllocation_tenantId_branchId_fkey", refTable: "Branch" },
    { table: "CreditTransferJournal", name: "CreditTransferJournal_tenantId_sourceBranchId_fkey", refTable: "Branch" },
    { table: "CreditTransferJournal", name: "CreditTransferJournal_tenantId_targetBranchId_fkey", refTable: "Branch" },
    { table: "Branch", name: "Branch_tenantId_parentBranchId_fkey", refTable: "Branch" }
  ];

  for (const efk of expectedFks) {
    const fks = await adminDb.$queryRawUnsafe(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = '"${efk.table}"'::regclass AND conname = '${efk.name}';
    `);
    if (fks.length === 0) {
      throw new Error(`Missing expected FK: ${efk.name} on ${efk.table}!`);
    }
    const fk = fks[0];
    console.log(`  ✓ ${efk.table}.${efk.name}: ${fk.def}`);
  }

  // 2. Verify Reporting Views & Security Invoker
  console.log("\n2. Verifying Reporting Views:");
  const views = ["v_effective_fee_payment", "v_effective_payment_receipt", "v_effective_payment_allocation"];
  for (const vn of views) {
    const vRes = await adminDb.$queryRawUnsafe(`
      SELECT c.relname, c.reloptions
      FROM pg_class c
      WHERE c.relname = '${vn}' AND c.relkind = 'v';
    `);
    if (vRes.length === 0) throw new Error(`Missing expected view: ${vn}!`);
    const opts = vRes[0].reloptions || [];
    const hasSecInvoker = opts.includes("security_invoker=true");
    console.log(`  ✓ View ${vn}: present (security_invoker=${hasSecInvoker})`);
    if (!hasSecInvoker) throw new Error(`View ${vn} missing security_invoker=true!`);
  }

  // 3. Verify Function fn_get_effective_branch_id
  console.log("\n3. Verifying fn_get_effective_branch_id:");
  const fnRes = await adminDb.$queryRawUnsafe(`
    SELECT p.proname, p.prosecdef, p.proconfig
    FROM pg_proc p WHERE p.proname = 'fn_get_effective_branch_id';
  `);
  if (fnRes.length === 0) throw new Error("Missing function fn_get_effective_branch_id!");
  const fn = fnRes[0];
  console.log(`  ✓ fn_get_effective_branch_id: present (SECURITY INVOKER=${!fn.prosecdef}, search_path=${fn.proconfig})`);

  // 4. Verify Collector Route Indexes
  console.log("\n4. Verifying PaymentCollectorRoute Indexes:");
  const pcrIdxs = await adminDb.$queryRawUnsafe(`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'PaymentCollectorRoute';
  `);
  const idIdx = pcrIdxs.find(i => i.indexname === "uq_pcr_branch_route_identity");
  const discIdx = pcrIdxs.find(i => i.indexname === "uq_pcr_explicit_discriminator");
  if (!idIdx || !idIdx.indexdef.includes("NULLS NOT DISTINCT")) {
    throw new Error("Missing or invalid uq_pcr_branch_route_identity!");
  }
  if (!discIdx || !discIdx.indexdef.includes("WHERE")) {
    throw new Error("Missing or invalid uq_pcr_explicit_discriminator!");
  }
  console.log("  ✓ uq_pcr_branch_route_identity verified (NULLS NOT DISTINCT)");
  console.log("  ✓ uq_pcr_explicit_discriminator verified (Partial unique WHERE routingDiscriminator IS NOT NULL)");

  // 5. Positive & Negative Privilege Tests for knowletive_app
  console.log("\n5. Running Privilege Tests for role 'knowletive_app':");

  // Positive: SELECT operational tables
  const testStudent = await appDb.student.findFirst({ select: { id: true } });
  console.log(`  ✓ knowletive_app SELECT on Student succeeded (Found ID: ${testStudent ? "YES" : "NO"})`);

  const testInvoice = await appDb.feeInvoice.findFirst({ select: { id: true } });
  console.log(`  ✓ knowletive_app SELECT on FeeInvoice succeeded (Found ID: ${testInvoice ? "YES" : "NO"})`);

  const testReceipt = await appDb.paymentReceipt.findFirst({ select: { id: true } });
  console.log(`  ✓ knowletive_app SELECT on PaymentReceipt succeeded (Found ID: ${testReceipt ? "YES" : "NO"})`);

  // Positive: Query reporting views via knowletive_app
  const viewRows = await appDb.$queryRawUnsafe(`SELECT count(*)::int as c FROM v_effective_fee_payment;`);
  console.log(`  ✓ knowletive_app SELECT on view v_effective_fee_payment succeeded (Row count: ${viewRows[0].c})`);

  // Negative: UPDATE on immutable PaymentReceipt
  let updateReceiptFailedAsExpected = false;
  try {
    await appDb.$executeRawUnsafe(`UPDATE "PaymentReceipt" SET amount = 99999 WHERE id = '${testReceipt.id}';`);
  } catch (err) {
    if (err.message.includes("permission denied") || err.message.includes("42501")) {
      updateReceiptFailedAsExpected = true;
    } else {
      console.error("Unexpected error on UPDATE PaymentReceipt:", err.message);
    }
  }
  if (!updateReceiptFailedAsExpected) {
    throw new Error("SECURITY FAILURE: knowletive_app was able to UPDATE PaymentReceipt!");
  }
  console.log("  ✓ Negative test: UPDATE on PaymentReceipt rejected with 42501 permission denied (EXPECTED)");

  // Negative: DELETE on immutable FeePayment
  const testPayment = await appDb.feePayment.findFirst({ select: { id: true } });
  let deletePaymentFailedAsExpected = false;
  try {
    await appDb.$executeRawUnsafe(`DELETE FROM "FeePayment" WHERE id = '${testPayment.id}';`);
  } catch (err) {
    if (err.message.includes("permission denied") || err.message.includes("42501")) {
      deletePaymentFailedAsExpected = true;
    } else {
      console.error("Unexpected error on DELETE FeePayment:", err.message);
    }
  }
  if (!deletePaymentFailedAsExpected) {
    throw new Error("SECURITY FAILURE: knowletive_app was able to DELETE FeePayment!");
  }
  console.log("  ✓ Negative test: DELETE on FeePayment rejected with 42501 permission denied (EXPECTED)");

  // Negative: DDL CREATE TABLE rejected for knowletive_app
  let ddlFailedAsExpected = false;
  try {
    await appDb.$executeRawUnsafe(`CREATE TABLE evil_table (id text);`);
  } catch (err) {
    if (err.message.includes("permission denied") || err.message.includes("42501")) {
      ddlFailedAsExpected = true;
    }
  }
  if (!ddlFailedAsExpected) {
    throw new Error("SECURITY FAILURE: knowletive_app was able to CREATE TABLE!");
  }
  console.log("  ✓ Negative test: CREATE TABLE rejected with 42501 permission denied (EXPECTED)");

  // Negative: TRUNCATE rejected for knowletive_app
  let truncateFailedAsExpected = false;
  try {
    await appDb.$executeRawUnsafe(`TRUNCATE TABLE "AuditLog";`);
  } catch (err) {
    if (err.message.includes("permission denied") || err.message.includes("42501")) {
      truncateFailedAsExpected = true;
    }
  }
  if (!truncateFailedAsExpected) {
    throw new Error("SECURITY FAILURE: knowletive_app was able to TRUNCATE AuditLog!");
  }
  console.log("  ✓ Negative test: TRUNCATE rejected with 42501 permission denied (EXPECTED)");

  console.log("\n=============================================================");
  console.log("  ✅ PART 5 POST-MIGRATION ARCHITECTURE & PRIVILEGES VERIFIED");
  console.log("=============================================================");
}

main().catch(console.error).finally(async () => {
  await adminDb.$disconnect();
  await appDb.$disconnect();
});
