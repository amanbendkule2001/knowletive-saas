import { PrismaClient } from "@prisma/client";

const origDb = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive?schema=public" } } });
const cloneDb = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public" } } });

async function main() {
  const q = `
    SELECT 
      conname,
      conrelid::regclass::text as table_name,
      confrelid::regclass::text as ref_table,
      pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND contype = 'f'
    ORDER BY table_name, conname;
  `;

  const origFks = await origDb.$queryRawUnsafe(q);
  const cloneFks = await cloneDb.$queryRawUnsafe(q);

  console.log(`Original FK count: ${origFks.length}`);
  console.log(`Clone FK count:    ${cloneFks.length}`);

  const origMap = new Map(origFks.map(f => [`${f.table_name}.${f.conname}`, f]));
  const cloneMap = new Map(cloneFks.map(f => [`${f.table_name}.${f.conname}`, f]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [k, f] of cloneMap.entries()) {
    if (!origMap.has(k)) {
      added.push(f);
    } else {
      const origF = origMap.get(k);
      if (origF.def !== f.def) {
        changed.push({ key: k, origDef: origF.def, cloneDef: f.def });
      }
    }
  }

  for (const [k, f] of origMap.entries()) {
    if (!cloneMap.has(k)) {
      removed.push(f);
    }
  }

  console.log(`\nAdded FKs in clone (${added.length}):`);
  added.forEach(f => console.log(`  + ${f.table_name}.${f.conname}: ${f.def}`));

  console.log(`\nRemoved FKs in clone (${removed.length}):`);
  removed.forEach(f => console.log(`  - ${f.table_name}.${f.conname}: ${f.def}`));

  console.log(`\nChanged FKs in clone (${changed.length}):`);
  changed.forEach(c => console.log(`  * ${c.key}:\n      Orig:  ${c.origDef}\n      Clone: ${c.cloneDef}`));

  await origDb.$disconnect();
  await cloneDb.$disconnect();
}

main().catch(console.error);
