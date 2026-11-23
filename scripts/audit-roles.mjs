import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive?schema=public" } } });

async function main() {
  console.log("=== RUNTIME ROLE SEPARATION AUDIT ON ORIGINAL KNOWLETIVE DB ===");

  // 1. Roles attributes
  const roles = await db.$queryRawUnsafe(`
    SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolconnlimit, rolbypassrls
    FROM pg_roles
    WHERE rolname IN ('knowletive', 'knowletive_app', 'postgres');
  `);
  console.log("Roles attributes:");
  console.log(JSON.stringify(roles, null, 2));

  // 2. Schema permissions
  const schemaAcl = await db.$queryRawUnsafe(`
    SELECT nspname, nspacl::text
    FROM pg_namespace
    WHERE nspname = 'public';
  `);
  console.log("\nSchema public ACL:");
  console.log(JSON.stringify(schemaAcl, null, 2));

  // 3. knowletive_app table privileges
  const appTablePrivs = await db.$queryRawUnsafe(`
    SELECT table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE grantee = 'knowletive_app' AND table_schema = 'public'
    ORDER BY table_name, privilege_type;
  `);
  console.log(`\nknowletive_app has explicit table privileges on ${new Set(appTablePrivs.map(p => p.table_name)).size} tables:`);
  console.log(Array.from(new Set(appTablePrivs.map(p => p.table_name))).sort().join(", ") || "(NONE)");

  // 4. Default privileges
  const defaultPrivs = await db.$queryRawUnsafe(`
    SELECT defaclrole::regrole::text as grantor, defaclobjtype, defaclacl::text
    FROM pg_default_acl;
  `);
  console.log("\nDefault ACLs:");
  console.log(JSON.stringify(defaultPrivs, null, 2));
}

main().catch(console.error).finally(() => db.$disconnect());
