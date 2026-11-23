import { PrismaClient } from "@prisma/client";

const DB_NAME = "knowletive_final_rehearsal_20261121_184300";
const ADMIN_URL = `postgresql://knowletive:knowletive@127.0.0.1:5432/${DB_NAME}?schema=public`;
const APP_URL = `postgresql://knowletive_app:knowletive_app@127.0.0.1:5432/${DB_NAME}?schema=public`;

const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
const appDb = new PrismaClient({ datasources: { db: { url: APP_URL } } });

function getCleanError(err) {
  const lines = err.message.split("\n").map(l => l.trim()).filter(Boolean);
  const rawMsg = lines.find(l => l.includes("Message:") || l.includes("violates") || l.includes("denied") || l.includes("Code:")) || lines[0] || "Unknown error";
  return rawMsg;
}

async function runNegativeTests() {
  console.log("===============================================================================");
  console.log(`  WORKSTREAM 4: NEGATIVE SECURITY & INTEGRITY TESTS ON ${DB_NAME}`);
  console.log("===============================================================================");

  const results = [];

  // Fetch two distinct tenants with branches
  const tenants = await adminDb.tenant.findMany({
    where: { branches: { some: {} } },
    take: 2,
    include: { branches: true, students: { take: 1 }, feeInvoices: { take: 1 } }
  });

  const tenantA = tenants[0];
  const tenantB = tenants[1];
  const branchA = tenantA.branches[0];
  const branchB = tenantB.branches[0];
  const studentA = tenantA.students[0];
  const invoiceA = tenantA.feeInvoices[0];

  console.log(`Tenant A: ${tenantA.name} (${tenantA.id}) - Branch: ${branchA.name} (${branchA.id})`);
  console.log(`Tenant B: ${tenantB.name} (${tenantB.id}) - Branch: ${branchB.name} (${branchB.id})`);

  // 1. Negative Test: Cross-Tenant Foreign Key Insertion (PaymentReceipt)
  console.log("\n1. Negative Test: Cross-Tenant Foreign Key Insertion...");
  try {
    await adminDb.$executeRawUnsafe(`
      INSERT INTO "PaymentReceipt" (
        id, "tenantId", "branchId", "studentId", "receiptNumber", amount, currency, method, "payerName", "receivedAt", "createdAt"
      ) VALUES (
        'rcpt_test_cross_tenant_fail', '${tenantA.id}', '${branchB.id}', '${studentA.id}', 'RCPT-CROSS-FAIL-01', 100.00, 'INR', 'CASH', 'Test Payer', NOW(), NOW()
      );
    `);
    results.push({ test: "Cross-tenant FK insertion (PaymentReceipt)", outcome: "FAIL (Allowed cross-tenant insert!)", code: "UNEXPECTED" });
  } catch (err) {
    const msg = getCleanError(err);
    if (msg.includes("23503") || msg.includes("PaymentReceipt_tenantId_branchId_fkey") || msg.includes("violates foreign key constraint")) {
      console.log(`  ✓ Blocked by composite FK: ${msg}`);
      results.push({ test: "Cross-tenant FK insertion (PaymentReceipt)", outcome: "PASS (Blocked by composite FK)", code: "23503" });
    } else {
      results.push({ test: "Cross-tenant FK insertion (PaymentReceipt)", outcome: `FAIL (${msg})`, code: "ERROR" });
    }
  }

  // 2. Negative Test: Cross-Branch Financial Reference (FeePayment)
  console.log("\n2. Negative Test: Cross-Branch Financial Reference (FeePayment)...");
  try {
    await adminDb.$executeRawUnsafe(`
      INSERT INTO "FeePayment" (
        id, "tenantId", "branchId", "feeInvoiceId", amount, method, "paidAt"
      ) VALUES (
        'pay_test_cross_branch_fail', '${tenantA.id}', '${branchB.id}', '${invoiceA.id}', 500.00, 'CASH', NOW()
      );
    `);
    results.push({ test: "Cross-branch financial reference (FeePayment)", outcome: "FAIL (Allowed cross-branch insert!)", code: "UNEXPECTED" });
  } catch (err) {
    const msg = getCleanError(err);
    if (msg.includes("23503") || msg.includes("FeePayment_tenantId_branchId_fkey") || msg.includes("violates foreign key constraint")) {
      console.log(`  ✓ Blocked by composite FK: ${msg}`);
      results.push({ test: "Cross-branch financial reference (FeePayment)", outcome: "PASS (Blocked by composite FK)", code: "23503" });
    } else {
      results.push({ test: "Cross-branch financial reference (FeePayment)", outcome: `FAIL (${msg})`, code: "ERROR" });
    }
  }

  // 3. Negative Test: Unauthorized Immutable Record UPDATE/DELETE
  console.log("\n3. Negative Test: Unauthorized Immutable Record UPDATE/DELETE...");
  try {
    await appDb.$executeRawUnsafe(`UPDATE "PaymentReceipt" SET amount = 99999 WHERE false;`);
    results.push({ test: "Unauthorized immutable UPDATE", outcome: "FAIL (Allowed UPDATE!)", code: "UNEXPECTED" });
  } catch (err) {
    const msg = getCleanError(err);
    if (msg.includes("42501") || msg.includes("permission denied")) {
      console.log(`  ✓ Blocked by role privilege: ${msg}`);
      results.push({ test: "Unauthorized immutable UPDATE", outcome: "PASS (Blocked by 42501)", code: "42501" });
    } else {
      results.push({ test: "Unauthorized immutable UPDATE", outcome: `FAIL (${msg})`, code: "ERROR" });
    }
  }

  try {
    await appDb.$executeRawUnsafe(`DELETE FROM "FeePayment" WHERE false;`);
    results.push({ test: "Unauthorized immutable DELETE", outcome: "FAIL (Allowed DELETE!)", code: "UNEXPECTED" });
  } catch (err) {
    const msg = getCleanError(err);
    if (msg.includes("42501") || msg.includes("permission denied")) {
      console.log(`  ✓ Blocked by role privilege: ${msg}`);
      results.push({ test: "Unauthorized immutable DELETE", outcome: "PASS (Blocked by 42501)", code: "42501" });
    } else {
      results.push({ test: "Unauthorized immutable DELETE", outcome: `FAIL (${msg})`, code: "ERROR" });
    }
  }

  // 4. Negative Test: Unauthorized Schema Creation
  console.log("\n4. Negative Test: Unauthorized Schema Creation...");
  try {
    await appDb.$executeRawUnsafe(`CREATE SCHEMA evil_schema_exploit;`);
    results.push({ test: "Unauthorized schema creation", outcome: "FAIL (Allowed CREATE SCHEMA!)", code: "UNEXPECTED" });
  } catch (err) {
    const msg = getCleanError(err);
    if (msg.includes("42501") || msg.includes("permission denied")) {
      console.log(`  ✓ Blocked by schema privilege: ${msg}`);
      results.push({ test: "Unauthorized schema creation", outcome: "PASS (Blocked by 42501)", code: "42501" });
    } else {
      results.push({ test: "Unauthorized schema creation", outcome: `FAIL (${msg})`, code: "ERROR" });
    }
  }

  // 5. Negative Test: Duplicate Collector Route (NULLS NOT DISTINCT collision)
  console.log("\n5. Negative Test: Duplicate Collector Route (NULLS NOT DISTINCT)...");
  try {
    const pcr = await adminDb.paymentCollectorRoute.findFirst();
    if (pcr) {
      await adminDb.$executeRawUnsafe(`
        INSERT INTO "PaymentCollectorRoute" (
          id, "tenantId", "branchId", provider, environment, "collectorCode", "merchantId", "routingDiscriminator", "isActive", "createdAt", "updatedAt"
        ) VALUES (
          'pcr_dup_test_fail', '${pcr.tenantId}', '${pcr.branchId}', '${pcr.provider}', '${pcr.environment}', '${pcr.collectorCode}', NULL, NULL, false, NOW(), NOW()
        );
      `);
      results.push({ test: "Duplicate collector route", outcome: "FAIL (Allowed duplicate route with NULLs!)", code: "UNEXPECTED" });
    }
  } catch (err) {
    const msg = getCleanError(err);
    if (msg.includes("23505") || msg.includes("uq_pcr_branch_route_identity")) {
      console.log(`  ✓ Blocked by NULLS NOT DISTINCT unique index: ${msg}`);
      results.push({ test: "Duplicate collector route", outcome: "PASS (Blocked by uq_pcr_branch_route_identity)", code: "23505" });
    } else {
      results.push({ test: "Duplicate collector route", outcome: `FAIL (${msg})`, code: "ERROR" });
    }
  }

  // 6. Negative Test: Lead Branch Reassignment Violating Relationship
  console.log("\n6. Negative Test: Lead Branch Reassignment Violating Relationship...");
  try {
    await adminDb.$executeRawUnsafe(`
      INSERT INTO "Lead" (
        id, "tenantId", "branchId", "studentName", "guardianName", "guardianPhone", "status", "createdAt", "updatedAt"
      ) VALUES (
        'lead_cross_tenant_fail', '${tenantA.id}', '${branchB.id}', 'Fail Student', 'Fail Guardian', '0000000000', 'NEW', NOW(), NOW()
      );
    `);
    results.push({ test: "Lead cross-tenant branch reassignment", outcome: "FAIL (Allowed cross-tenant lead!)", code: "UNEXPECTED" });
  } catch (err) {
    const msg = getCleanError(err);
    if (msg.includes("23503") || msg.includes("Lead_tenantId_branchId_fkey") || msg.includes("violates foreign key constraint")) {
      console.log(`  ✓ Blocked by composite FK Lead_tenantId_branchId_fkey: ${msg}`);
      results.push({ test: "Lead cross-tenant branch reassignment", outcome: "PASS (Blocked by composite FK)", code: "23503" });
    } else {
      results.push({ test: "Lead cross-tenant branch reassignment", outcome: `FAIL (${msg})`, code: "ERROR" });
    }
  }

  // 7. Negative Test: Caller-Controlled Session Setting Injection
  console.log("\n7. Negative Test: Caller-Controlled Session Setting Injection...");
  try {
    await appDb.$executeRawUnsafe(`SET LOCAL knowletive.is_platform_admin = 'true';`);
    const res = await appDb.$queryRawUnsafe(`SELECT current_setting('knowletive.is_platform_admin', true) as val;`);
    console.log(`  ⚠️ Caller was able to set session GUC: ${res[0].val}`);
    console.log("  -> CONFIRMING FINDING: Caller-controlled GUC is NOT safe for authorization until cryptographic session derivation is bound.");
    results.push({ test: "Session GUC tampering resilience", outcome: "BLOCKED (Security Blocker: GUC is caller-settable)", code: "SEC-BLOCKER" });
  } catch (err) {
    results.push({ test: "Session GUC tampering resilience", outcome: `PASS (${err.message.split("\n")[0]})`, code: "DENIED" });
  }

  console.log("\n===============================================================================");
  console.log("  NEGATIVE SECURITY TEST SUMMARY");
  console.log("===============================================================================");
  console.table(results);

  await adminDb.$disconnect();
  await appDb.$disconnect();
}

runNegativeTests().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
