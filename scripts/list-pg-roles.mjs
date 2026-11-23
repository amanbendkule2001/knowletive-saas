import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public'
    }
  }
});

async function main() {
  const roles = await prisma.$queryRawUnsafe(`
    SELECT 
      rolname, 
      rolsuper, 
      rolinherit, 
      rolcreaterole, 
      rolcreatedb, 
      rolcanlogin, 
      rolreplication, 
      rolconnlimit, 
      rolbypassrls
    FROM pg_roles
    WHERE rolname NOT LIKE 'pg_%'
    ORDER BY rolname;
  `);
  console.log('Existing Non-System PostgreSQL Roles:');
  console.table(roles);

  const memberships = await prisma.$queryRawUnsafe(`
    SELECT 
      r.rolname as role,
      m.rolname as member,
      am.admin_option
    FROM pg_auth_members am
    JOIN pg_roles r ON r.oid = am.roleid
    JOIN pg_roles m ON m.oid = am.member
    WHERE r.rolname NOT LIKE 'pg_%' AND m.rolname NOT LIKE 'pg_%';
  `);
  console.log('\nRole Memberships:');
  console.table(memberships);
}

main().catch(console.error).finally(() => prisma.$disconnect());
