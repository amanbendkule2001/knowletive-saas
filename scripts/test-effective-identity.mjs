import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("===============================================================================");
  console.log("  PHASE 2.3.5.3 — ITEM 1: APPLICATION DATABASE IDENTITY & EFFECTIVE ROLE");
  console.log("===============================================================================");

  // 1. Test Default Application Environment Connection (from .env via src/lib/db)
  console.log("\n1. Testing Default Next.js Application Database Connection (as configured in .env):");
  const defaultDb = new PrismaClient(); // Uses process.env.DATABASE_URL from .env
  try {
    const [idRes] = await defaultDb.$queryRawUnsafe(`
      SELECT current_user, session_user, current_database(), inet_server_addr()::text as server_addr, inet_server_port() as server_port;
    `);
    console.log("  Effective Identity of Default .env Connection:");
    console.log(`    current_user:     ${idRes.current_user}`);
    console.log(`    session_user:     ${idRes.session_user}`);
    console.log(`    current_database: ${idRes.current_database}`);
    console.log(`    server_addr:      ${idRes.server_addr}:${idRes.server_port}`);

    // Check if this role is a superuser
    const [roleRes] = await defaultDb.$queryRawUnsafe(`
      SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
      FROM pg_roles
      WHERE rolname = current_user;
    `);
    console.log(`    rolsuper:         ${roleRes.rolsuper} ${roleRes.rolsuper ? "⚠️ (CRITICAL: SUPERUSER IN USE)" : "✓"}`);
    console.log(`    rolbypassrls:     ${roleRes.rolbypassrls}`);
  } catch (err) {
    console.error("  ❌ Default connection failed:", err.message);
  } finally {
    await defaultDb.$disconnect();
  }

  // 2. Test Restricted Runtime Role (knowletive_app) Connection on Rehearsal DB
  console.log("\n2. Testing Restricted Runtime Role (knowletive_app) on Rehearsal Database:");
  const REHEARSAL_APP_URL = "postgresql://knowletive_app:knowletive_app@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public";
  const appDb = new PrismaClient({ datasources: { db: { url: REHEARSAL_APP_URL } } });

  try {
    const [appIdRes] = await appDb.$queryRawUnsafe(`
      SELECT current_user, session_user, current_database(), inet_server_addr()::text as server_addr, inet_server_port() as server_port;
    `);
    console.log("  Effective Identity of knowletive_app Connection:");
    console.log(`    current_user:     ${appIdRes.current_user}`);
    console.log(`    session_user:     ${appIdRes.session_user}`);
    console.log(`    current_database: ${appIdRes.current_database}`);
    console.log(`    server_addr:      ${appIdRes.server_addr}:${appIdRes.server_port}`);

    const [appRoleRes] = await appDb.$queryRawUnsafe(`
      SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
      FROM pg_roles
      WHERE rolname = current_user;
    `);
    console.log(`    rolsuper:         ${appRoleRes.rolsuper} ${!appRoleRes.rolsuper ? "✓ (NON-SUPERUSER)" : "❌"}`);
    console.log(`    rolbypassrls:     ${appRoleRes.rolbypassrls} ${!appRoleRes.rolbypassrls ? "✓ (NO BYPASS RLS)" : "❌"}`);

    // Test standard application queries under knowletive_app
    console.log("\n3. Testing Standard Application Operations under knowletive_app:");
    const studentCount = await appDb.student.count();
    console.log(`  ✓ SELECT count on Student: ${studentCount} students read successfully.`);
    const branchCount = await appDb.branch.count();
    console.log(`  ✓ SELECT count on Branch: ${branchCount} branches read successfully.`);
    const invoiceCount = await appDb.feeInvoice.count();
    console.log(`  ✓ SELECT count on FeeInvoice: ${invoiceCount} fee invoices read successfully.`);

  } catch (err) {
    console.error("  ❌ knowletive_app connection test failed:", err.message);
  } finally {
    await appDb.$disconnect();
  }
}

main().catch(console.error);
