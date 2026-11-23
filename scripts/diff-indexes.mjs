import { PrismaClient } from "@prisma/client";

const origDb = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive?schema=public" } } });
const cloneDb = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public" } } });

async function main() {
  const origIdx = await origDb.$queryRawUnsafe(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;`);
  const cloneIdx = await cloneDb.$queryRawUnsafe(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;`);

  console.log(`Original total indexes: ${origIdx.length}`);
  console.log(`Clone total indexes:    ${cloneIdx.length}`);

  const origNames = new Set(origIdx.map(i => `${i.tablename}.${i.indexname}`));
  const cloneNames = new Set(cloneIdx.map(i => `${i.tablename}.${i.indexname}`));

  const added = cloneIdx.filter(i => !origNames.has(`${i.tablename}.${i.indexname}`));
  const removed = origIdx.filter(i => !cloneNames.has(`${i.tablename}.${i.indexname}`));

  console.log(`\nAdded indexes in clone (+${added.length}):`);
  added.forEach(i => console.log(`  + ${i.tablename}.${i.indexname}: ${i.indexdef}`));

  console.log(`\nRemoved indexes in clone (-${removed.length}):`);
  removed.forEach(i => console.log(`  - ${i.tablename}.${i.indexname}: ${i.indexdef}`));

  await origDb.$disconnect();
  await cloneDb.$disconnect();
}

main().catch(console.error);
