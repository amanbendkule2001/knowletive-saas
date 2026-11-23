import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive?schema=public" } } });

async function main() {
  const res = await db.$queryRawUnsafe(`
    SELECT conrelid::regclass::text as tablename, conname, pg_get_constraintdef(oid) as def 
    FROM pg_constraint 
    WHERE conrelid IN (
      '"PaymentReceipt"'::regclass, 
      '"FeePayment"'::regclass, 
      '"PaymentCollectorRoute"'::regclass, 
      '"Branch"'::regclass, 
      '"MembershipBranch"'::regclass,
      '"Student"'::regclass,
      '"Lead"'::regclass
    ) 
    ORDER BY 1, 2;
  `);
  console.log(JSON.stringify(res, null, 2));
}

main().catch(console.error).finally(() => db.$disconnect());
