import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public" } } });

async function main() {
  const pr = await db.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name = 'PaymentReceipt' ORDER BY ordinal_position;`);
  console.log("PaymentReceipt columns:", pr.map(c => c.column_name).join(", "));
  const fp = await db.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name = 'FeePayment' ORDER BY ordinal_position;`);
  console.log("FeePayment columns:", fp.map(c => c.column_name).join(", "));
  await db.$disconnect();
}

main().catch(console.error);
