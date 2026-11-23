import { PrismaClient } from "@prisma/client";

const APP_DB_URL = "postgresql://knowletive_app:knowletive_app@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public";
const appDb = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });

async function main() {
  console.log("=============================================================");
  console.log("  PHASE 2.3.5 — RUNTIME SMOKE TEST VIA knowletive_app (PART 6)");
  console.log("=============================================================");
  console.log("Testing connection as runtime non-superuser role: knowletive_app\n");

  // 1. Prisma Connection
  console.log("1. Testing connection...");
  const [whoami] = await appDb.$queryRawUnsafe(`SELECT current_user, session_user, current_database();`);
  console.log(`  ✓ Connected as: ${whoami.current_user} (Session: ${whoami.session_user}) to ${whoami.current_database}`);
  if (whoami.current_user !== "knowletive_app") {
    throw new Error(`Connected as ${whoami.current_user}, expected knowletive_app!`);
  }

  // 2. Authentication-related reads
  console.log("\n2. Testing authentication-related reads...");
  const user = await appDb.user.findFirst({ select: { id: true, email: true, status: true } });
  console.log(`  ✓ Read User: found user with status ${user?.status}`);

  const session = await appDb.session.findFirst({ select: { id: true, userId: true } });
  console.log(`  ✓ Read Session: found session ${session ? "YES" : "NO (empty)"}`);

  const membership = await appDb.membership.findFirst({ select: { id: true, tenantId: true, roleId: true } });
  console.log(`  ✓ Read Membership: found membership for tenant ${membership?.tenantId ? "YES" : "NO"}`);

  const permissions = await appDb.permission.findMany({ take: 3 });
  console.log(`  ✓ Read Permission: found ${permissions.length} sample permissions`);

  // 3. Student reads
  console.log("\n3. Testing Student reads...");
  const student = await appDb.student.findFirst({
    select: { id: true, admissionNo: true, tenantId: true, status: true }
  });
  console.log(`  ✓ Read Student: admissionNo ${student?.admissionNo}, status ${student?.status}`);

  // 4. Fee Invoice reads
  console.log("\n4. Testing Fee Invoice reads...");
  const invoice = await appDb.feeInvoice.findFirst({
    select: { id: true, number: true, amount: true, status: true }
  });
  console.log(`  ✓ Read FeeInvoice: invoice ${invoice?.number}, amount ${invoice?.amount}`);

  // 5. Operational Writes (Disposable Test Data)
  console.log("\n5. Testing operational writes (AuditLog disposable test data)...");
  const testAudit = await appDb.auditLog.create({
    data: {
      tenant: { connect: { id: student.tenantId } },
      actorName: "System Smoke Test",
      action: "SMOKE_TEST_PROBE",
      entity: "SmokeTest",
      entityId: "smoke-123",
      meta: { test: true, timestamp: new Date().toISOString() }
    }
  });
  console.log(`  ✓ Operational write (INSERT AuditLog): created ID ${testAudit.id}`);

  // Test operational read of inserted record
  const verifyAudit = await appDb.auditLog.findUnique({ where: { id: testAudit.id } });
  console.log(`  ✓ Operational read of inserted record: verified action = ${verifyAudit?.action}`);

  // 6. Immutable Financial Records Prohibited UPDATE and DELETE
  console.log("\n6. Testing Immutable Financial Records Guards...");
  const receipt = await appDb.paymentReceipt.findFirst({ select: { id: true } });
  const payment = await appDb.feePayment.findFirst({ select: { id: true } });
  const allocation = await appDb.paymentAllocation.findFirst({ select: { id: true } });
  const journal = await appDb.creditTransferJournal.findFirst({ select: { id: true } });

  const immutabilityTests = [
    { name: "UPDATE PaymentReceipt", sql: `UPDATE "PaymentReceipt" SET amount = amount + 1 WHERE id = '${receipt?.id}'` },
    { name: "DELETE PaymentReceipt", sql: `DELETE FROM "PaymentReceipt" WHERE id = '${receipt?.id}'` },
    { name: "UPDATE FeePayment", sql: `UPDATE "FeePayment" SET amount = amount + 1 WHERE id = '${payment?.id}'` },
    { name: "DELETE FeePayment", sql: `DELETE FROM "FeePayment" WHERE id = '${payment?.id}'` },
    { name: "UPDATE PaymentAllocation", sql: `UPDATE "PaymentAllocation" SET amount = amount + 1 WHERE id = '${allocation?.id}'` },
    { name: "DELETE PaymentAllocation", sql: `DELETE FROM "PaymentAllocation" WHERE id = '${allocation?.id}'` },
    { name: "UPDATE CreditTransferJournal", sql: `UPDATE "CreditTransferJournal" SET amount = amount + 1 WHERE id = '${journal?.id}'` },
    { name: "DELETE CreditTransferJournal", sql: `DELETE FROM "CreditTransferJournal" WHERE id = '${journal?.id}'` }
  ];

  for (const test of immutabilityTests) {
    let failed = false;
    try {
      await appDb.$executeRawUnsafe(test.sql);
    } catch (err) {
      if (err.message.includes("42501") || err.message.includes("permission denied")) {
        failed = true;
      } else {
        console.error(`  ✗ Unexpected error on ${test.name}:`, err.message);
      }
    }
    if (!failed) {
      throw new Error(`SECURITY VULNERABILITY: ${test.name} was NOT rejected!`);
    }
    console.log(`  ✓ ${test.name} strictly rejected with 42501 permission denied`);
  }

  // 7. Reporting Views Access
  console.log("\n7. Testing Reporting Views Access via knowletive_app...");
  const view1 = await appDb.$queryRawUnsafe(`SELECT count(*)::int as c FROM v_effective_fee_payment;`);
  const view2 = await appDb.$queryRawUnsafe(`SELECT count(*)::int as c FROM v_effective_payment_receipt;`);
  const view3 = await appDb.$queryRawUnsafe(`SELECT count(*)::int as c FROM v_effective_payment_allocation;`);
  console.log(`  ✓ v_effective_fee_payment accessible (rows: ${view1[0].c})`);
  console.log(`  ✓ v_effective_payment_receipt accessible (rows: ${view2[0].c})`);
  console.log(`  ✓ v_effective_payment_allocation accessible (rows: ${view3[0].c})`);

  // 8. Functions
  console.log("\n8. Testing Functions Execution via knowletive_app...");
  const fnTest = await appDb.$queryRawUnsafe(`SELECT fn_get_effective_branch_id('tenant-1'::text, 'FeePayment'::text, 'rec-1'::text, 'branch-1'::text) as branch;`);
  console.log(`  ✓ fn_get_effective_branch_id executable (returned: ${fnTest[0].branch})`);

  console.log("\n=============================================================");
  console.log("  ✅ RUNTIME SMOKE TEST PASSED: ALL CAPABILITIES OPERATIONAL");
  console.log("=============================================================");
}

main().catch(console.error).finally(() => appDb.$disconnect());
