import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: 'postgresql://knowletive:knowletive@localhost:5432/knowletive_staging_clean?schema=public' } } });

async function checkTables() {
  const tables = ['BatchEnrollmentEvent', 'ExamResultSnapshot', 'ExamMarksRevisionEvent', 'SyllabusProgressEvent'];
  for (const t of tables) {
    const res = await prisma.$queryRawUnsafe(`SELECT to_regclass('public."${t}"')::text as tbl;`);
    console.log(t, 'exists?:', res[0].tbl);
  }
  await prisma.$disconnect();
}
checkTables();
