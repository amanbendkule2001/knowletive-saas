import { PrismaClient } from "@prisma/client";

const APP_DB_URL = "postgresql://knowletive_app:knowletive_app@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public";
const appDb = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });

const ADMIN_DB_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public";
const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_DB_URL } } });

const IMMUTABLE_TABLES = [
  "PaymentReceipt",
  "FeePayment",
  "PaymentAllocation",
  "PaymentAllocationReversal",
  "CreditTransferJournal",
  "CreditTransferPosting",
  "BranchLedgerEntry",
  "BranchReconciliationAudit",
  "AuditLog",
  "LeadActivity",
  "NotificationLog",
  "GuardianConsentEvent"
];

async function main() {
  console.log("===============================================================================");
  console.log("  PHASE 2.3.5.1 — ITEM 4: IMMUTABLE LEDGER PRIVILEGE & TRIGGER VERIFICATION");
  console.log("===============================================================================");
  console.log(`Connecting as knowletive_app: ${APP_DB_URL}`);

  const results = [];

  for (const table of IMMUTABLE_TABLES) {
    // 1. Fetch an existing row or find first
    let sampleRow = null;
    try {
      const rows = await adminDb.$queryRawUnsafe(`SELECT id FROM "${table}" LIMIT 1;`);
      if (rows.length > 0) sampleRow = rows[0];
    } catch (e) {
      // Table might have different PK
    }

    let updateStatus = "NOT_TESTED";
    let updateReason = "";
    let deleteStatus = "NOT_TESTED";
    let deleteReason = "";

    // Test UPDATE via knowletive_app
    try {
      if (sampleRow) {
        await appDb.$executeRawUnsafe(`UPDATE "${table}" SET id = id WHERE id = '${sampleRow.id}';`);
      } else {
        await appDb.$executeRawUnsafe(`UPDATE "${table}" SET id = id WHERE false;`);
      }
      updateStatus = "ALLOWED (UNSAFE)";
      updateReason = "Execution succeeded without error";
    } catch (err) {
      if (err.message.includes("permission denied") || err.message.includes("42501")) {
        updateStatus = "BLOCKED (GRANT)";
        updateReason = "42501 permission denied";
      } else if (err.message.includes("P0001") || err.message.toLowerCase().includes("immutable") || err.message.toLowerCase().includes("trigger")) {
        updateStatus = "BLOCKED (TRIGGER)";
        updateReason = err.message.split("\n")[0];
      } else {
        updateStatus = "BLOCKED (OTHER)";
        updateReason = err.message.split("\n")[0];
      }
    }

    // Test DELETE via knowletive_app
    try {
      if (sampleRow) {
        // Run in transaction so if it succeeds we roll back immediately
        await appDb.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE id = '${sampleRow.id}';`);
          throw new Error("__ROLLBACK_INTENTIONAL__");
        });
      } else {
        await appDb.$executeRawUnsafe(`DELETE FROM "${table}" WHERE false;`);
      }
      deleteStatus = "ALLOWED (UNSAFE)";
      deleteReason = "Execution succeeded without error";
    } catch (err) {
      if (err.message === "__ROLLBACK_INTENTIONAL__") {
        deleteStatus = "ALLOWED (UNSAFE)";
        deleteReason = "Row deletion succeeded before rollback";
      } else if (err.message.includes("permission denied") || err.message.includes("42501")) {
        deleteStatus = "BLOCKED (GRANT)";
        deleteReason = "42501 permission denied";
      } else if (err.message.includes("P0001") || err.message.toLowerCase().includes("immutable") || err.message.toLowerCase().includes("trigger")) {
        deleteStatus = "BLOCKED (TRIGGER)";
        deleteReason = err.message.split("\n")[0];
      } else {
        deleteStatus = "BLOCKED (OTHER)";
        deleteReason = err.message.split("\n")[0];
      }
    }

    results.push({
      table,
      hasSampleRow: Boolean(sampleRow),
      updateStatus,
      deleteStatus,
      details: `UPDATE: ${updateReason} | DELETE: ${deleteReason}`
    });
  }

  console.table(results.map(r => ({
    table: r.table,
    sample: r.hasSampleRow ? "YES" : "NO",
    UPDATE: r.updateStatus,
    DELETE: r.deleteStatus
  })));

  console.log("\nDetails of blocks:");
  for (const r of results) {
    console.log(`- ${r.table}: ${r.details}`);
  }

  // 2. Test mutable projections
  console.log("\n--- TESTING MUTABLE PROJECTIONS (PaymentReceiptBalance, StudentCreditAccount) ---");
  
  // Test PaymentReceiptBalance
  const samplePrb = await adminDb.paymentReceiptBalance.findFirst();
  if (samplePrb) {
    try {
      await appDb.paymentReceiptBalance.update({
        where: { id: samplePrb.id },
        data: { updatedAt: new Date() }
      });
      console.log(`  ✓ PaymentReceiptBalance: UPDATE allowed for knowletive_app (ID: ${samplePrb.id})`);
    } catch (e) {
      console.error(`  ❌ PaymentReceiptBalance UPDATE failed: ${e.message}`);
    }
  }

  // Test StudentCreditAccount
  const sampleSca = await adminDb.studentCreditAccount.findFirst();
  if (sampleSca) {
    try {
      await appDb.studentCreditAccount.update({
        where: { id: sampleSca.id },
        data: { updatedAt: new Date() }
      });
      console.log(`  ✓ StudentCreditAccount: UPDATE allowed for knowletive_app (ID: ${sampleSca.id})`);
    } catch (e) {
      console.error(`  ❌ StudentCreditAccount UPDATE failed: ${e.message}`);
    }
  }

  await appDb.$disconnect();
  await adminDb.$disconnect();
}

main().catch(console.error);
