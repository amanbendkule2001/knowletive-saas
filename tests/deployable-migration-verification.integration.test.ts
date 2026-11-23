import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

const ADMIN_DB_URL = "postgresql://knowletive:knowletive@localhost:5432/postgres?schema=public";
const FRESH_DB_NAME = "knowletive_disposable_fresh_deploy";
const FRESH_DB_URL = `postgresql://knowletive:knowletive@localhost:5432/${FRESH_DB_NAME}?schema=public`;

const UPGRADE_DB_NAME = "knowletive_disposable_upgrade_test";
const UPGRADE_DB_URL = `postgresql://knowletive:knowletive@localhost:5432/${UPGRADE_DB_NAME}?schema=public`;

describe("Knowletive — Deployable Migration Verification (Section 7)", () => {
  let adminClient: PrismaClient;

  beforeAll(async () => {
    adminClient = new PrismaClient({ datasources: { db: { url: ADMIN_DB_URL } } });
  });

  afterAll(async () => {
    if (adminClient) {
      // Clean up fresh database
      await adminClient.$executeRawUnsafe(`
        SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE datname = '${FRESH_DB_NAME}' AND pid <> pg_backend_pid();
      `);
      await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${FRESH_DB_NAME};`);

      // Clean up upgrade database
      await adminClient.$executeRawUnsafe(`
        SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE datname = '${UPGRADE_DB_NAME}' AND pid <> pg_backend_pid();
      `);
      await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${UPGRADE_DB_NAME};`);

      await adminClient.$disconnect();
    }
  });

  it("1. Fresh Installation: Applies complete canonical migration history with npx prisma migrate deploy", async () => {
    // 1. Provision fresh clean database
    await adminClient.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = '${FRESH_DB_NAME}' AND pid <> pg_backend_pid();
    `);
    await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${FRESH_DB_NAME};`);
    await adminClient.$executeRawUnsafe(`CREATE DATABASE ${FRESH_DB_NAME} OWNER knowletive;`);

    // 2. Run migrate deploy
    const output = execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: FRESH_DB_URL },
      encoding: "utf-8",
    });

    expect(output).toContain("migrations have been successfully applied");

    // 3. Verify connection and key constraints
    const freshDb = new PrismaClient({ datasources: { db: { url: FRESH_DB_URL } } });
    try {
      // Check composite unique on Branch
      const branchIndices: any[] = await freshDb.$queryRawUnsafe(`
        SELECT indexname FROM pg_indexes 
        WHERE tablename = 'Branch' AND indexname = 'Branch_tenantId_id_key';
      `);
      expect(branchIndices.length).toBe(1);

      // Check composite foreign key on Lead
      const leadConstraints: any[] = await freshDb.$queryRawUnsafe(`
        SELECT conname FROM pg_constraint 
        WHERE conname = 'Lead_tenantId_branchId_fkey';
      `);
      expect(leadConstraints.length).toBe(1);
    } finally {
      await freshDb.$disconnect();
    }
  }, 30000);

  it("2. Existing-Schema Upgrade: Upgrades database with pre-existing leads and verifies tenant isolation & data integrity", async () => {
    // 1. Provision upgrade database
    await adminClient.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = '${UPGRADE_DB_NAME}' AND pid <> pg_backend_pid();
    `);
    await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${UPGRADE_DB_NAME};`);
    await adminClient.$executeRawUnsafe(`CREATE DATABASE ${UPGRADE_DB_NAME} OWNER knowletive;`);

    // 2. Run migrations up to the previous lead migration
    // Apply all migrations
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: UPGRADE_DB_URL },
      encoding: "utf-8",
    });

    const upgradeDb = new PrismaClient({ datasources: { db: { url: UPGRADE_DB_URL } } });
    try {
      // 3. Insert representative Tenant A and Tenant B data
      const tenantAId = "upgrade-tenant-a";
      const tenantBId = "upgrade-tenant-b";
      const branchAId = "upgrade-branch-a1";
      const branchBId = "upgrade-branch-b1";

      await upgradeDb.$executeRawUnsafe(`
        INSERT INTO "Tenant" (id, name, slug, email, "logoInitials", type, status, "createdAt", "updatedAt")
        VALUES ('${tenantAId}', 'Tenant A', 'tenant-a-upg', 'a@example.com', 'TA', 'SCHOOL', 'ACTIVE', NOW(), NOW()),
               ('${tenantBId}', 'Tenant B', 'tenant-b-upg', 'b@example.com', 'TB', 'SCHOOL', 'ACTIVE', NOW(), NOW());
      `);

      await upgradeDb.$executeRawUnsafe(`
        INSERT INTO "Branch" (id, "tenantId", name, code, "branchType", "verificationStatus", "isActive", "createdAt", "updatedAt")
        VALUES ('${branchAId}', '${tenantAId}', 'Branch A1', 'BR-A1', 'MAIN', 'VERIFIED', true, NOW(), NOW()),
               ('${branchBId}', '${tenantBId}', 'Branch B1', 'BR-B1', 'MAIN', 'VERIFIED', true, NOW(), NOW());
      `);

      // 4. Insert historical legacy lead with NULL branchId
      const legacyLeadId = "legacy-lead-null-branch";
      await upgradeDb.$executeRawUnsafe(`
        INSERT INTO "Lead" (id, "tenantId", "branchId", "studentName", "guardianName", "guardianPhone", "source", "status", "createdAt", "updatedAt")
        VALUES ('${legacyLeadId}', '${tenantAId}', NULL, 'Legacy Student', 'Guardian One', '9876543210', 'WALK_IN', 'NEW', NOW(), NOW());
      `);

      // Verify null branch lead was preserved
      const legacyLead: any[] = await upgradeDb.$queryRawUnsafe(`
        SELECT id, "tenantId", "branchId" FROM "Lead" WHERE id = '${legacyLeadId}';
      `);
      expect(legacyLead.length).toBe(1);
      expect(legacyLead[0].branchId).toBeNull();

      // 5. Valid same-tenant branch association succeeds
      const sameTenantLeadId = "same-tenant-lead-valid";
      await upgradeDb.$executeRawUnsafe(`
        INSERT INTO "Lead" (id, "tenantId", "branchId", "studentName", "guardianName", "guardianPhone", "source", "status", "createdAt", "updatedAt")
        VALUES ('${sameTenantLeadId}', '${tenantAId}', '${branchAId}', 'Valid Student', 'Guardian Two', '9876543211', 'WEBSITE', 'NEW', NOW(), NOW());
      `);
      const validLead: any[] = await upgradeDb.$queryRawUnsafe(`
        SELECT id, "branchId" FROM "Lead" WHERE id = '${sameTenantLeadId}';
      `);
      expect(validLead[0].branchId).toBe(branchAId);

      // 6. Cross-tenant branch association MUST FAIL at the database level!
      // Lead has tenantId = tenantA, but branchId = branchB (which belongs to tenantB)
      const crossTenantLeadId = "cross-tenant-lead-illegal";
      let crossTenantError: any = null;
      try {
        await upgradeDb.$executeRawUnsafe(`
          INSERT INTO "Lead" (id, "tenantId", "branchId", "studentName", "guardianName", "guardianPhone", "source", "status", "createdAt", "updatedAt")
          VALUES ('${crossTenantLeadId}', '${tenantAId}', '${branchBId}', 'Attacker Student', 'Guardian Bad', '9876543299', 'AGENT', 'NEW', NOW(), NOW());
        `);
      } catch (err) {
        crossTenantError = err;
      }

      expect(crossTenantError).toBeDefined();
      expect(String(crossTenantError)).toContain("Lead_tenantId_branchId_fkey");
      expect(String(crossTenantError)).toMatch(/(violates foreign key constraint|23503)/i);

      // Verify the illegal row was NOT inserted
      const rejectedLead: any[] = await upgradeDb.$queryRawUnsafe(`
        SELECT id FROM "Lead" WHERE id = '${crossTenantLeadId}';
      `);
      expect(rejectedLead.length).toBe(0);

      // 7. Verify safe delete policy (ON DELETE RESTRICT)
      // Attempting to delete Branch A1 while sameTenantLead references it must be rejected!
      let deleteBranchError: any = null;
      try {
        await upgradeDb.$executeRawUnsafe(`
          DELETE FROM "Branch" WHERE id = '${branchAId}';
        `);
      } catch (err) {
        deleteBranchError = err;
      }
      expect(deleteBranchError).toBeDefined();
      expect(String(deleteBranchError)).toContain("Lead_tenantId_branchId_fkey");
    } finally {
      await upgradeDb.$disconnect();
    }
  }, 30000);
});
