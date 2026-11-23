import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== CHECKING POSTGRESQL SCHEMA FOR PHASE 3B ===");

  // 1. Check Tables
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema='public' AND table_name IN ('CopilotThread', 'CopilotMessage');
  `);
  console.log("Tables found:", tables);

  // 2. Check Enums
  const enums = await prisma.$queryRawUnsafe(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t 
    JOIN pg_enum e ON t.oid = e.enumtypid  
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname IN ('CopilotMessageRole', 'CopilotMessageStatus')
    ORDER BY t.typname, e.enumsortorder;
  `);
  console.log("Enums found:", enums);

  // 3. Check Foreign Keys
  const fks = await prisma.$queryRawUnsafe(`
    SELECT 
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      rc.delete_rule
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu 
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu 
      ON ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints AS rc 
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' 
      AND tc.table_name IN ('CopilotThread', 'CopilotMessage');
  `);
  console.log("Foreign Keys found:", fks);

  // 4. Check Indexes
  const indexes = await prisma.$queryRawUnsafe(`
    SELECT tablename, indexname, indexdef 
    FROM pg_indexes 
    WHERE schemaname = 'public' AND tablename IN ('CopilotThread', 'CopilotMessage');
  `);
  console.log("Indexes found:", indexes);

  // 5. Existing record counts
  const counts = {
    tenants: await prisma.tenant.count(),
    users: await prisma.user.count(),
    students: await prisma.student.count(),
    feeInvoices: await prisma.feeInvoice.count(),
    attendanceRecords: await prisma.attendance.count(),
    copilotThreads: await prisma.copilotThread.count(),
    copilotMessages: await prisma.copilotMessage.count(),
  };
  console.log("Database Record Counts:", counts);
}

main()
  .catch((err) => {
    console.error("Database check failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
