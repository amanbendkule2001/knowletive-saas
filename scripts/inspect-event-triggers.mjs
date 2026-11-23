import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({
  datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public" } }
});

async function main() {
  const res = await db.$queryRawUnsafe(`
    SELECT c.relname, trg.tgname, pg_get_triggerdef(trg.oid) as def
    FROM pg_trigger trg
    JOIN pg_class c ON c.oid = trg.tgrelid
    WHERE c.relname IN ('GuardianConsentEvent', 'LeadActivity', 'NotificationLog', 'AuditLog')
      AND NOT trg.tgisinternal
    ORDER BY c.relname, trg.tgname;
  `);
  console.log("Found user triggers on event tables:");
  console.log(res);

  await db.$disconnect();
}

main().catch(console.error);
