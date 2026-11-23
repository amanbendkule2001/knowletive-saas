import { PrismaClient } from "@prisma/client";

const DB_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public";
const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });

async function main() {
  const fks = await db.$queryRawUnsafe(`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = '"PaymentReceipt"'::regclass;
  `);
  console.log(JSON.stringify(fks, null, 2));
}

main().finally(() => db.$disconnect());
