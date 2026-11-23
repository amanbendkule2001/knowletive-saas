import { PrismaClient } from "@prisma/client";

const origDb = new PrismaClient({
  datasources: { db: { url: "postgresql://knowletive:postgres@127.0.0.1:5432/knowletive?schema=public" } }
});
const restoredDb = new PrismaClient({
  datasources: { db: { url: "postgresql://knowletive:postgres@127.0.0.1:5432/knowletive_adoption_rehearsal_20261123?schema=public" } }
});

async function main() {
  console.log("=== COMPARING ORIGINAL (knowletive) VS RESTORED REHEARSAL (knowletive_adoption_rehearsal_20261123) ===");

  // 1. Database version & identity
  const [origVer] = await origDb.$queryRawUnsafe("SELECT version();");
  const [restoredVer] = await restoredDb.$queryRawUnsafe("SELECT version();");
  console.log("PostgreSQL Version:", origVer.version);
  console.log("Original Database: knowletive");
  console.log("Restored Database: knowletive_adoption_rehearsal_20261123");

  // 2. Prisma migrations table
  const [origMig] = await origDb.$queryRawUnsafe("SELECT to_regclass('public._prisma_migrations')::text as reg;");
  const [restoredMig] = await restoredDb.$queryRawUnsafe("SELECT to_regclass('public._prisma_migrations')::text as reg;");
  console.log(`Prisma migrations table in original: ${origMig.reg || "ABSENT (NULL)"}`);
  console.log(`Prisma migrations table in restored: ${restoredMig.reg || "ABSENT (NULL)"}`);

  // 3. Base tables
  const origTables = await origDb.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;");
  const restoredTables = await restoredDb.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;");
  console.log(`Base tables count: Original=${origTables.length}, Restored=${restoredTables.length}`);

  let mismatches = 0;
  for (const t of origTables) {
    const [oC] = await origDb.$queryRawUnsafe(`SELECT count(*)::text as c FROM "${t.tablename}";`);
    const [rC] = await restoredDb.$queryRawUnsafe(`SELECT count(*)::text as c FROM "${t.tablename}";`);
    if (oC.c !== rC.c) {
      console.error(`Row count mismatch in table ${t.tablename}: Orig=${oC.c}, Restored=${rC.c}`);
      mismatches++;
    }
  }
  if (mismatches === 0) {
    console.log(`✓ All ${origTables.length} tables have IDENTICAL row counts.`);
  }

  // 4. Views
  const origViews = await origDb.$queryRawUnsafe("SELECT viewname FROM pg_views WHERE schemaname = 'public' ORDER BY viewname;");
  const restoredViews = await restoredDb.$queryRawUnsafe("SELECT viewname FROM pg_views WHERE schemaname = 'public' ORDER BY viewname;");
  console.log(`Views count: Original=${origViews.length}, Restored=${restoredViews.length}`);

  // 5. Constraints
  const origCons = await origDb.$queryRawUnsafe("SELECT conname, contype FROM pg_constraint c JOIN pg_namespace n ON c.connamespace = n.oid WHERE n.nspname = 'public' ORDER BY conname;");
  const restoredCons = await restoredDb.$queryRawUnsafe("SELECT conname, contype FROM pg_constraint c JOIN pg_namespace n ON c.connamespace = n.oid WHERE n.nspname = 'public' ORDER BY conname;");
  console.log(`Constraints count: Original=${origCons.length}, Restored=${restoredCons.length}`);

  // 6. Indexes
  const origIdx = await origDb.$queryRawUnsafe("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;");
  const restoredIdx = await restoredDb.$queryRawUnsafe("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;");
  console.log(`Indexes count: Original=${origIdx.length}, Restored=${restoredIdx.length}`);

  // 7. Enums
  const origEnums = await origDb.$queryRawUnsafe("SELECT typname FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'public' AND t.typtype = 'e' ORDER BY typname;");
  const restoredEnums = await restoredDb.$queryRawUnsafe("SELECT typname FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'public' AND t.typtype = 'e' ORDER BY typname;");
  console.log(`Enums count: Original=${origEnums.length}, Restored=${restoredEnums.length}`);

  // 8. Functions
  const origFuncs = await origDb.$queryRawUnsafe("SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND prokind = 'f' ORDER BY proname;");
  const restoredFuncs = await restoredDb.$queryRawUnsafe("SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND prokind = 'f' ORDER BY proname;");
  console.log(`Functions count: Original=${origFuncs.length}, Restored=${restoredFuncs.length}`);

  // 9. Triggers
  const origTrigs = await origDb.$queryRawUnsafe("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname;");
  const restoredTrigs = await restoredDb.$queryRawUnsafe("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname;");
  console.log(`Triggers count: Original=${origTrigs.length}, Restored=${restoredTrigs.length}`);

  // Key Financial & Core Tables
  const keyTables = ['Branch', 'Student', 'PaymentReceipt', 'FeePayment', 'CopilotThread', 'CopilotMessage', 'WebhookEvent', 'PaymentAllocation', 'FeeInvoice'];
  console.log("\n--- Key Table Row Counts ---");
  for (const kt of keyTables) {
    const [c] = await restoredDb.$queryRawUnsafe(`SELECT count(*)::text as c FROM "${kt}";`);
    console.log(`  ${kt}: ${c.c} rows`);
  }
}

main().catch(console.error).finally(async () => {
  await origDb.$disconnect();
  await restoredDb.$disconnect();
});
