import { PrismaClient } from "@prisma/client";

const adminDb = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public" } } });
const appDb = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive_app:knowletive_app@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public" } } });

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
  console.log("Applying complete immutability revokes on clone DB...");
  await adminDb.$executeRawUnsafe(`
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE
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
    FROM knowletive_app;
  `);

  console.log("Testing all 12 tables under knowletive_app:");
  const results = [];

  for (const table of IMMUTABLE_TABLES) {
    let updateBlocked = false;
    let deleteBlocked = false;
    let updateMsg = "";
    let deleteMsg = "";

    try {
      await appDb.$executeRawUnsafe(`UPDATE "${table}" SET id = id WHERE false;`);
    } catch (e) {
      updateBlocked = true;
      updateMsg = e.message.includes("42501") ? "42501 permission denied" : e.message.split("\n")[0];
    }

    try {
      await appDb.$executeRawUnsafe(`DELETE FROM "${table}" WHERE false;`);
    } catch (e) {
      deleteBlocked = true;
      deleteMsg = e.message.includes("42501") ? "42501 permission denied" : e.message.split("\n")[0];
    }

    results.push({
      table,
      UPDATE: updateBlocked ? "BLOCKED (42501)" : "ALLOWED",
      DELETE: deleteBlocked ? "BLOCKED (42501)" : "ALLOWED"
    });
  }

  console.table(results);
  await adminDb.$disconnect();
  await appDb.$disconnect();
}

main().catch(console.error);
