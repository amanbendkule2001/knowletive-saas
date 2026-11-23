import { PrismaClient } from '@prisma/client';

const prismaDev = new PrismaClient({ datasources: { db: { url: 'postgresql://knowletive:knowletive@localhost:5432/knowletive?schema=public' } } });
const prismaClean = new PrismaClient({ datasources: { db: { url: 'postgresql://knowletive:knowletive@localhost:5432/knowletive_staging_clean?schema=public' } } });

async function compare() {
  const devTrigs = await prismaDev.$queryRawUnsafe("SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY trigger_name;");
  const cleanTrigs = await prismaClean.$queryRawUnsafe("SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY trigger_name;");
  console.log('Dev triggers count:', devTrigs.length);
  console.log('Clean triggers count:', cleanTrigs.length);

  const cleanNames = new Set(cleanTrigs.map(t => t.trigger_name + ' ON ' + t.event_object_table));
  const missing = devTrigs.filter(t => !cleanNames.has(t.trigger_name + ' ON ' + t.event_object_table));
  console.log('Missing triggers in clean DB (' + missing.length + '):');
  for (const m of missing) {
    console.log(`- ${m.trigger_name} ON ${m.event_object_table}`);
  }

  await prismaDev.$disconnect();
  await prismaClean.$disconnect();
}
compare();
