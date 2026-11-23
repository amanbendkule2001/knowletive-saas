import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public" } } });

async function main() {
  const tenants = await db.tenant.findMany({
    select: { id: true, name: true, branches: { select: { id: true, name: true } } }
  });
  console.log(`Found ${tenants.length} tenants:`);
  for (const t of tenants) {
    console.log(`- Tenant ${t.name} (${t.id}): ${t.branches.length} branches`);
  }
  await db.$disconnect();
}

main().catch(console.error);
