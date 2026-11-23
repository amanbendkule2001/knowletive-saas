import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
try {
  const rows = await prisma.$queryRawUnsafe('SELECT id, migration_name, finished_at FROM _prisma_migrations ORDER BY started_at;');
  console.log('Migrations in knowletive database:', rows);
} catch (e) {
  console.error('Error querying _prisma_migrations:', e.message);
} finally {
  await prisma.$disconnect();
}
