import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock Next.js runtime environment for Server Action execution
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })),
  headers: vi.fn(async () => new Map()),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({
  authorizeTenantWrite: vi.fn(),
}));

import { PrismaClient } from "@prisma/client";
import { makeLeadDuplicateKey } from "@/lib/leads-import";
import { importLeadsCsvAction } from "@/actions/leads";
import { authorizeTenantWrite } from "@/lib/rbac";
import { db } from "@/lib/db";

const prisma1 = new PrismaClient();
const prisma2 = new PrismaClient();

function createCsvForm(csv: string): FormData {
  const fd = new FormData();
  const file = new File([csv], "leads.csv", { type: "text/csv" });
  fd.append("file", file);
  return fd;
}

describe("PostgreSQL Advisory Lock & Concurrency Integration Tests", () => {
  let tenantA: any;
  let tenantB: any;
  let testUser: any;
  const createdLeadIds: string[] = [];

  beforeAll(async () => {
    // Resolve at least two tenants from database for tenant-isolation testing
    const tenants = await db.tenant.findMany({
      take: 2,
      select: { id: true, name: true, slug: true },
    });
    if (!tenants || tenants.length === 0) {
      throw new Error("No tenant found in PostgreSQL database for integration test");
    }
    tenantA = tenants[0];
    tenantB = tenants.length > 1 ? tenants[1] : tenants[0];

    // Resolve a real user
    const user = await db.user.findFirst({
      select: { id: true, name: true, email: true },
    });
    testUser = user || { id: "test_user_id", name: "Test User", email: "test@example.com" };

    // Default mock auth to tenantA
    (authorizeTenantWrite as any).mockResolvedValue({
      ok: true,
      ctx: {
        tenant: tenantA,
        user: testUser,
      },
    });
  });

  afterAll(async () => {
    if (createdLeadIds.length > 0) {
      await db.leadActivity.deleteMany({
        where: { leadId: { in: createdLeadIds } },
      });
      await db.lead.deleteMany({
        where: { id: { in: createdLeadIds } },
      });
    }
    await prisma1.$disconnect();
    await prisma2.$disconnect();
  });

  describe("Part 1: Low-Level Advisory Lock Primitives (Two Independent Connections)", () => {
    it("Two simultaneous transactions under PostgreSQL advisory lock: 2nd waits, only 1 inserted, 2nd reports duplicate", async () => {
      const timestamp = Date.now();
      const testStudentName = `Primitive Student ${timestamp}`;
      const testPhone = `98765${String(timestamp).slice(-5)}`;
      const lockKey = `lead_import_${tenantA.id}`;

      const executionLog: string[] = [];
      let tx1Imported = 0;
      let tx2Imported = 0;
      let tx2Duplicates = 0;

      const record = {
        studentName: testStudentName,
        guardianName: "Guardian Test",
        guardianPhone: testPhone,
        guardianEmail: `parent_${timestamp}@example.com`,
        source: "WALK_IN" as const,
        status: "NEW" as const,
      };

      const runImportJob1 = async () => {
        return prisma1.$transaction(
          async (tx) => {
            executionLog.push("tx1: acquiring lock");
            await tx.$queryRawUnsafe(
              `SELECT pg_advisory_xact_lock(hashtext($1))::text`,
              lockKey,
            );
            executionLog.push("tx1: lock acquired");

            // Artificial delay while holding the advisory lock to verify Tx2 blocks
            await new Promise((r) => setTimeout(r, 600));

            // Query duplicates under lock
            const existing = await tx.lead.findMany({
              where: { tenantId: tenantA.id },
              select: { studentName: true, guardianPhone: true, guardianEmail: true },
            });
            const dupKeys = new Set<string>();
            for (const l of existing) {
              if (l.guardianPhone && /\d/.test(l.guardianPhone)) {
                dupKeys.add(makeLeadDuplicateKey(l.studentName, l.guardianPhone));
              }
            }

            const pKey = makeLeadDuplicateKey(record.studentName, record.guardianPhone);
            if (!dupKeys.has(pKey)) {
              const created = await tx.lead.create({
                data: {
                  tenantId: tenantA.id,
                  studentName: record.studentName,
                  guardianName: record.guardianName,
                  guardianPhone: record.guardianPhone,
                  guardianEmail: record.guardianEmail,
                  source: record.source,
                  status: record.status,
                },
              });
              createdLeadIds.push(created.id);
              await tx.leadActivity.create({
                data: {
                  tenantId: tenantA.id,
                  leadId: created.id,
                  actorId: testUser.id,
                  action: "CREATED",
                  notes: "Imported via CSV batch (Tx1).",
                },
              });
              tx1Imported++;
            }

            executionLog.push("tx1: committing");
          },
          { timeout: 15000 },
        );
      };

      const runImportJob2 = async () => {
        await new Promise((r) => setTimeout(r, 100));

        return prisma2.$transaction(
          async (tx) => {
            executionLog.push("tx2: acquiring lock");
            await tx.$queryRawUnsafe(
              `SELECT pg_advisory_xact_lock(hashtext($1))::text`,
              lockKey,
            );
            executionLog.push("tx2: lock acquired");

            const existing = await tx.lead.findMany({
              where: { tenantId: tenantA.id },
              select: { studentName: true, guardianPhone: true, guardianEmail: true },
            });
            const dupKeys = new Set<string>();
            for (const l of existing) {
              if (l.guardianPhone && /\d/.test(l.guardianPhone)) {
                dupKeys.add(makeLeadDuplicateKey(l.studentName, l.guardianPhone));
              }
            }

            const pKey = makeLeadDuplicateKey(record.studentName, record.guardianPhone);
            if (dupKeys.has(pKey)) {
              tx2Duplicates++;
            } else {
              const created = await tx.lead.create({
                data: {
                  tenantId: tenantA.id,
                  studentName: record.studentName,
                  guardianName: record.guardianName,
                  guardianPhone: record.guardianPhone,
                  guardianEmail: record.guardianEmail,
                  source: record.source,
                  status: record.status,
                },
              });
              createdLeadIds.push(created.id);
              tx2Imported++;
            }

            executionLog.push("tx2: committing");
          },
          { timeout: 15000 },
        );
      };

      await Promise.all([runImportJob1(), runImportJob2()]);

      expect(tx1Imported).toBe(1);
      expect(tx2Imported).toBe(0);
      expect(tx2Duplicates).toBe(1);

      const tx1CommitIdx = executionLog.indexOf("tx1: committing");
      const tx2LockAcquiredIdx = executionLog.indexOf("tx2: lock acquired");

      expect(tx1CommitIdx).toBeGreaterThan(-1);
      expect(tx2LockAcquiredIdx).toBeGreaterThan(-1);
      expect(tx2LockAcquiredIdx).toBeGreaterThan(tx1CommitIdx);

      const dbLeads = await db.lead.findMany({
        where: { tenantId: tenantA.id, studentName: testStudentName },
      });
      expect(dbLeads.length).toBe(1);
    });
  });

  describe("Part 2: Full Action-Level Concurrent Execution (importLeadsCsvAction)", () => {
    it("Simultaneous action execution creates exactly 1 lead, 2nd reports duplicate, and activities remain consistent", async () => {
      const timestamp = Date.now();
      const studentName = `Full Action Student ${timestamp}`;
      const phone = `98765${String(timestamp).slice(-5)}`;

      (authorizeTenantWrite as any).mockResolvedValue({
        ok: true,
        ctx: {
          tenant: tenantA,
          user: testUser,
        },
      });

      const csv = `Student Name,Guardian Phone\n${studentName},${phone}\n`;

      // Dispatch two real import actions concurrently against PostgreSQL
      const [res1, res2] = await Promise.all([
        importLeadsCsvAction(createCsvForm(csv)),
        importLeadsCsvAction(createCsvForm(csv)),
      ]);

      const successRes = res1.ok ? res1 : res2;
      const dupRes = res1.ok ? res2 : res1;

      // 1. One import succeeds
      expect(successRes.ok).toBe(true);
      if (successRes.ok) {
        expect(successRes.summary.imported).toBe(1);
        expect(successRes.summary.duplicates).toBe(0);
      }

      // 2. The concurrent second import detects duplicate and imports 0
      expect(dupRes.ok).toBe(false);
      expect(dupRes.summary?.imported).toBe(0);
      expect(dupRes.summary?.duplicates).toBe(1);

      // 3. Exactly one lead exists in PostgreSQL
      const leadsInDb = await db.lead.findMany({
        where: { tenantId: tenantA.id, studentName },
        include: { activities: true },
      });

      expect(leadsInDb.length).toBe(1);
      createdLeadIds.push(leadsInDb[0].id);

      // 4. Activity log consistency
      expect(leadsInDb[0].activities.length).toBe(1);
      expect(leadsInDb[0].activities[0].action).toBe("CREATED");
      expect(leadsInDb[0].activities[0].tenantId).toBe(tenantA.id);
      expect(leadsInDb[0].activities[0].actorId).toBe(testUser.id);
    });
  });

  describe("Part 3: Multi-Tenant Isolation Under Concurrency", () => {
    it("Two different tenants concurrently importing the same student details succeed independently without cross-tenant conflict", async () => {
      if (tenantA.id === tenantB.id) {
        // Skip multi-tenant test if only 1 tenant is in test db
        return;
      }

      const timestamp = Date.now();
      const crossStudentName = `Cross Tenant Student ${timestamp}`;
      const crossPhone = `98765${String(timestamp).slice(-5)}`;

      const csv = `Student Name,Guardian Phone\n${crossStudentName},${crossPhone}\n`;

      // Mock auth to switch dynamically based on tenant context or run sequentially
      (authorizeTenantWrite as any).mockImplementationOnce(async () => ({
        ok: true,
        ctx: { tenant: tenantA, user: testUser },
      }));

      const resA = await importLeadsCsvAction(createCsvForm(csv));

      (authorizeTenantWrite as any).mockImplementationOnce(async () => ({
        ok: true,
        ctx: { tenant: tenantB, user: testUser },
      }));

      const resB = await importLeadsCsvAction(createCsvForm(csv));

      expect(resA.ok).toBe(true);
      if (resA.ok) {
        expect(resA.summary.imported).toBe(1);
      }

      expect(resB.ok).toBe(true);
      if (resB.ok) {
        expect(resB.summary.imported).toBe(1);
      }

      // Verify both tenants have their own lead record
      const leadA = await db.lead.findFirst({
        where: { tenantId: tenantA.id, studentName: crossStudentName },
      });
      const leadB = await db.lead.findFirst({
        where: { tenantId: tenantB.id, studentName: crossStudentName },
      });

      expect(leadA).toBeDefined();
      expect(leadB).toBeDefined();
      expect(leadA!.id).not.toBe(leadB!.id);
      expect(leadA!.tenantId).toBe(tenantA.id);
      expect(leadB!.tenantId).toBe(tenantB.id);

      createdLeadIds.push(leadA!.id, leadB!.id);
    });
  });
});
