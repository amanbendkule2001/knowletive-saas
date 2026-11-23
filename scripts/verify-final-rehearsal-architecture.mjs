import { PrismaClient } from "@prisma/client";

const DB_NAME = "knowletive_final_rehearsal_20261121_184300";
const ADMIN_URL = `postgresql://knowletive:knowletive@127.0.0.1:5432/${DB_NAME}?schema=public`;
const APP_URL = `postgresql://knowletive_app:knowletive_app@127.0.0.1:5432/${DB_NAME}?schema=public`;

const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
const appDb = new PrismaClient({ datasources: { db: { url: APP_URL } } });

async function main() {
  console.log("===============================================================================");
  console.log(`  WORKSTREAM 2 & 3: ARCHITECTURE & CATALOG VERIFICATION ON ${DB_NAME}`);
  console.log("===============================================================================");

  // 1. Data Preservation Check
  console.log("\n1. Verifying Post-Adoption Data Preservation:");
  const counts = await adminDb.$queryRawUnsafe(`
    SELECT 
      (SELECT count(*)::int FROM "Student") AS students,
      (SELECT count(*)::int FROM "PaymentReceipt") AS receipts,
      (SELECT count(*)::int FROM "FeePayment") AS fee_payments,
      (SELECT count(*)::int FROM "PaymentAllocation") AS allocations,
      (SELECT count(*)::int FROM "PaymentAllocationReversal") AS reversals,
      (SELECT count(*)::int FROM "CreditTransferJournal") AS ct_journals,
      (SELECT count(*)::int FROM "CreditTransferPosting") AS ct_postings,
      (SELECT count(*)::int FROM "Branch") AS branches,
      (SELECT count(*)::int FROM "AuditLog") AS audit_logs,
      (SELECT count(*)::int FROM "CopilotThread") AS copilot_threads,
      (SELECT count(*)::int FROM "CopilotMessage") AS copilot_messages,
      (SELECT count(*)::int FROM "WebhookEvent") AS webhook_events,
      (SELECT count(*)::int FROM "PaymentCollectorRoute") AS collector_routes,
      (SELECT count(*)::int FROM "_prisma_migrations") AS applied_migrations;
  `);
  console.table(counts);

  // 2. Composite Foreign Keys Verification
  console.log("\n2. Verifying Composite Foreign Keys & Referential Actions:");
  const expectedFks = [
    { table: "PaymentReceipt", name: "PaymentReceipt_tenantId_branchId_fkey", update: "RESTRICT", delete: "RESTRICT" },
    { table: "FeePayment", name: "FeePayment_tenantId_branchId_fkey", update: "RESTRICT", delete: "RESTRICT" },
    { table: "Lead", name: "Lead_tenantId_branchId_fkey", update: "RESTRICT", delete: "RESTRICT" },
    { table: "PaymentCollectorRoute", name: "PaymentCollectorRoute_tenantId_branchId_fkey", update: "RESTRICT", delete: "RESTRICT" },
    { table: "PaymentAllocation", name: "PaymentAllocation_tenantId_branchId_fkey", update: "RESTRICT", delete: "RESTRICT" },
    { table: "CreditTransferJournal", name: "CreditTransferJournal_tenantId_sourceBranchId_fkey", update: "RESTRICT", delete: "RESTRICT" },
    { table: "CreditTransferJournal", name: "CreditTransferJournal_tenantId_targetBranchId_fkey", update: "RESTRICT", delete: "RESTRICT" },
    { table: "Branch", name: "Branch_tenantId_parentBranchId_fkey", update: "RESTRICT", delete: "RESTRICT" }
  ];

  for (const efk of expectedFks) {
    const res = await adminDb.$queryRawUnsafe(`
      SELECT tc.constraint_name, rc.update_rule, rc.delete_rule, pg_get_constraintdef(c.oid) as def
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
      JOIN pg_constraint c ON c.conname = tc.constraint_name
      WHERE tc.table_name = '${efk.table}' AND tc.constraint_name = '${efk.name}';
    `);

    if (res.length === 0) {
      throw new Error(`FAIL: Missing expected FK ${efk.name} on ${efk.table}!`);
    }
    const fk = res[0];
    if (fk.update_rule !== efk.update || fk.delete_rule !== efk.delete) {
      throw new Error(`FAIL: FK ${efk.name} has unexpected rules: update=${fk.update_rule}, delete=${fk.delete_rule}. Expected: ${efk.update}/${efk.delete}!`);
    }
    console.log(`  ✓ ${efk.table}.${efk.name}: [UPDATE: ${fk.update_rule}, DELETE: ${fk.delete_rule}] ${fk.def}`);
  }

  // 3. Collector Routing Indexes
  console.log("\n3. Verifying PaymentCollectorRoute Indexes & Constraints:");
  const pcrIdx = await adminDb.$queryRawUnsafe(`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'PaymentCollectorRoute';
  `);
  const identityIdx = pcrIdx.find(i => i.indexname === "uq_pcr_branch_route_identity");
  const discIdx = pcrIdx.find(i => i.indexname === "uq_pcr_explicit_discriminator");

  if (!identityIdx || !identityIdx.indexdef.includes("NULLS NOT DISTINCT")) {
    throw new Error("FAIL: Missing or invalid uq_pcr_branch_route_identity (NULLS NOT DISTINCT)!");
  }
  console.log(`  ✓ uq_pcr_branch_route_identity: ${identityIdx.indexdef}`);

  if (!discIdx || !discIdx.indexdef.includes("WHERE (\"routingDiscriminator\" IS NOT NULL)")) {
    throw new Error("FAIL: Missing or invalid uq_pcr_explicit_discriminator!");
  }
  console.log(`  ✓ uq_pcr_explicit_discriminator: ${discIdx.indexdef}`);

  // 4. Copilot & Webhook Canonical Schema
  console.log("\n4. Verifying Canonical Copilot & Webhook Schema:");
  const copilotCols = await adminDb.$queryRawUnsafe(`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'CopilotMessage' ORDER BY ordinal_position;
  `);
  console.log(`  ✓ CopilotMessage columns: ${copilotCols.map(c => c.column_name).join(", ")}`);

  const webhookCols = await adminDb.$queryRawUnsafe(`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'WebhookEvent' ORDER BY ordinal_position;
  `);
  console.log(`  ✓ WebhookEvent columns: ${webhookCols.map(c => c.column_name).join(", ")}`);

  // 5. Reporting Views security_invoker = true
  console.log("\n5. Verifying Reporting Views (security_invoker = true):");
  const views = ["v_effective_fee_payment", "v_effective_payment_receipt", "v_effective_payment_allocation"];
  for (const vn of views) {
    const vRes = await adminDb.$queryRawUnsafe(`
      SELECT c.relname, c.reloptions FROM pg_class c WHERE c.relname = '${vn}' AND c.relkind = 'v';
    `);
    const opts = vRes[0]?.reloptions || [];
    if (!opts.includes("security_invoker=true")) {
      throw new Error(`FAIL: View ${vn} missing security_invoker=true!`);
    }
    console.log(`  ✓ View ${vn}: security_invoker=true`);
  }

  // 6. Security Invoker Function fn_get_effective_branch_id
  console.log("\n6. Verifying fn_get_effective_branch_id Configuration:");
  const funcs = await adminDb.$queryRawUnsafe(`
    SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname = 'fn_get_effective_branch_id';
  `);
  const fn = funcs[0];
  if (fn.prosecdef !== false) throw new Error("FAIL: Function should be SECURITY INVOKER!");
  console.log(`  ✓ fn_get_effective_branch_id: SECURITY INVOKER, config: ${JSON.stringify(fn.proconfig)}`);

  await adminDb.$disconnect();
  await appDb.$disconnect();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
