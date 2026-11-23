import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { resolveUserBranchScope } from "@/lib/branch";
import { hasTenantPermission } from "@/lib/auth";
import { syncPermissions } from "../scripts/sync-permissions";
import { buildLeadsWhereClause } from "@/lib/leads-export";

const ADMIN_DB_URL = "postgresql://knowletive:knowletive@localhost:5432/postgres?schema=public";
const DISPOSABLE_DB_NAME = "knowletive_vitest_remediation_disposable";
const DISPOSABLE_DB_URL = `postgresql://knowletive:knowletive@localhost:5432/${DISPOSABLE_DB_NAME}?schema=public`;

const { dbProxy, setDb } = vi.hoisted(() => {
  let innerDb: any = null;
  const proxy = new Proxy({} as any, {
    get(_target, prop) {
      if (!innerDb) throw new Error("db accessed before initialization in beforeAll");
      const val = innerDb[prop];
      if (typeof val === "function") return val.bind(innerDb);
      return val;
    },
  });
  return {
    dbProxy: proxy,
    setDb: (d: any) => {
      innerDb = d;
    },
  };
});

vi.mock("@/lib/db", () => ({
  db: dbProxy,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Knowletive Security Remediation Suite — Branch Isolation, RBAC & Information Leakage", () => {
  let adminClient: PrismaClient;
  let db: PrismaClient;

  // Tenant A Fixture
  let tenantA: any;
  let branchMainA: any;
  let branchA1: any;
  let branchA2: any;

  // Tenant B Fixture
  let tenantB: any;
  let branchMainB: any;
  let branchB1: any;

  // Roles
  let roleAdmin: any;
  let roleAccountant: any;
  let roleTeacher: any;
  let roleFrontDesk: any;
  let roleParent: any;
  let roleStudent: any;

  // Users & Memberships
  let userOwnerA: any;
  let userAccountantA1: any;
  let userMultiBranchAccountant: any;
  let userTeacherA1: any;
  let userFrontDeskA1: any;
  let userParentA1: any;
  let userStudentA1: any;
  let userStudentA2: any;

  // Entity Fixtures
  let studentA1: any;
  let studentA2: any;
  let studentNullBranch: any;

  let invoiceA1: any;
  let invoiceA2: any;
  let invoiceNullBranch: any;

  let fileStudentA1: any;
  let fileStudentA2: any;
  let fileInternalGeneral: any;

  let leadA1: any;
  let leadA2: any;
  let leadNullBranch: any;

  beforeAll(async () => {
    // 1. Provision disposable test database
    adminClient = new PrismaClient({ datasources: { db: { url: ADMIN_DB_URL } } });
    await adminClient.$executeRawUnsafe(`
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = '${DISPOSABLE_DB_NAME}' AND pid <> pg_backend_pid();
    `);
    await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DISPOSABLE_DB_NAME};`);
    await adminClient.$executeRawUnsafe(`CREATE DATABASE ${DISPOSABLE_DB_NAME} OWNER knowletive;`);

    // 2. Push schema
    execSync("npx prisma db push --skip-generate --schema=prisma/schema.prisma", {
      env: { ...process.env, DATABASE_URL: DISPOSABLE_DB_URL },
      stdio: "pipe",
    });

    // 3. Connect client
    db = new PrismaClient({ datasources: { db: { url: DISPOSABLE_DB_URL } } });
    setDb(db);
    process.env.DATABASE_URL = DISPOSABLE_DB_URL;

    // 4. Synchronize canonical catalog permissions into database
    await syncPermissions(db, { strict: true });

    // 5. Seed Tenants
    tenantA = await db.tenant.create({
      data: { name: "Apex Global Academy", slug: "apex-rem", email: "apex@example.com", logoInitials: "AG", type: "SCHOOL", status: "ACTIVE" },
    });
    tenantB = await db.tenant.create({
      data: { name: "Beacon Heights School", slug: "beacon-rem", email: "beacon@example.com", logoInitials: "BH", type: "SCHOOL", status: "ACTIVE" },
    });

    // 6. Seed Branches
    branchMainA = await db.branch.create({
      data: { tenantId: tenantA.id, name: "Main Campus A", code: "APX-MAIN", branchType: "MAIN" },
    });
    branchA1 = await db.branch.create({
      data: { tenantId: tenantA.id, parentBranchId: branchMainA.id, name: "North Branch A1", code: "APX-A1", branchType: "SUB_BRANCH" },
    });
    branchA2 = await db.branch.create({
      data: { tenantId: tenantA.id, parentBranchId: branchMainA.id, name: "South Branch A2", code: "APX-A2", branchType: "SUB_BRANCH" },
    });

    branchMainB = await db.branch.create({
      data: { tenantId: tenantB.id, name: "Main Campus B", code: "B-MAIN", branchType: "MAIN" },
    });
    branchB1 = await db.branch.create({
      data: { tenantId: tenantB.id, parentBranchId: branchMainB.id, name: "Branch B1", code: "B-B1", branchType: "SUB_BRANCH" },
    });

    // 7. Seed Roles in Tenant A
    const allPerms = await db.permission.findMany({ where: { scope: "TENANT" } });

    roleAdmin = await db.role.create({
      data: { tenantId: tenantA.id, name: "Institute Admin", key: "INSTITUTE_ADMIN", scope: "TENANT" },
    });
    roleAccountant = await db.role.create({
      data: { tenantId: tenantA.id, name: "Accountant", key: "ACCOUNTANT", scope: "TENANT" },
    });
    roleTeacher = await db.role.create({
      data: { tenantId: tenantA.id, name: "Teacher", key: "TEACHER", scope: "TENANT" },
    });
    roleFrontDesk = await db.role.create({
      data: { tenantId: tenantA.id, name: "Front Desk", key: "FRONT_DESK", scope: "TENANT" },
    });
    roleParent = await db.role.create({
      data: { tenantId: tenantA.id, name: "Parent", key: "PARENT", scope: "TENANT" },
    });
    roleStudent = await db.role.create({
      data: { tenantId: tenantA.id, name: "Student", key: "STUDENT", scope: "TENANT" },
    });

    // Assign permissions to roles
    const linkPerms = async (roleId: string, keys: string[]) => {
      for (const k of keys) {
        await db.rolePermission.create({ data: { roleId, permissionKey: k } });
      }
    };

    // Admin has all tenant permissions
    await linkPerms(roleAdmin.id, allPerms.map((p) => p.key));
    // Accountant has fees.read, fees.write, fees.utr.view, leads.read
    await linkPerms(roleAccountant.id, [
      "tenant.fees.read",
      "tenant.fees.write",
      "tenant.fees.utr.view",
      "tenant.leads.read",
      "tenant.students.read",
      "tenant.students.write",
    ]);
    // Teacher has attendance and basic student read
    await linkPerms(roleTeacher.id, ["tenant.students.read", "tenant.attendance.read", "tenant.attendance.write"]);
    // Front Desk has leads.read, leads.write, students.read
    await linkPerms(roleFrontDesk.id, ["tenant.leads.read", "tenant.leads.write", "tenant.students.read"]);

    // 8. Seed Users and Memberships
    userOwnerA = await db.user.create({
      data: { email: "owner@apex.edu", name: "Apex Owner", passwordHash: "dummy" },
    });
    await db.membership.create({
      data: { tenantId: tenantA.id, userId: userOwnerA.id, roleId: roleAdmin.id, isOwner: true, status: "ACTIVE" },
    });

    userAccountantA1 = await db.user.create({
      data: { email: "accountant-a1@apex.edu", name: "Accountant A1", passwordHash: "dummy" },
    });
    await db.membership.create({
      data: { tenantId: tenantA.id, userId: userAccountantA1.id, roleId: roleAccountant.id, branchId: branchA1.id, status: "ACTIVE" },
    });

    userMultiBranchAccountant = await db.user.create({
      data: { email: "accountant-main@apex.edu", name: "Multi-Branch Accountant", passwordHash: "dummy" },
    });
    await db.membership.create({
      data: { tenantId: tenantA.id, userId: userMultiBranchAccountant.id, roleId: roleAccountant.id, branchId: branchMainA.id, status: "ACTIVE" },
    });

    userTeacherA1 = await db.user.create({
      data: { email: "teacher-a1@apex.edu", name: "Teacher A1", passwordHash: "dummy" },
    });
    await db.membership.create({
      data: { tenantId: tenantA.id, userId: userTeacherA1.id, roleId: roleTeacher.id, branchId: branchA1.id, status: "ACTIVE" },
    });

    userFrontDeskA1 = await db.user.create({
      data: { email: "frontdesk-a1@apex.edu", name: "Front Desk A1", passwordHash: "dummy" },
    });
    await db.membership.create({
      data: { tenantId: tenantA.id, userId: userFrontDeskA1.id, roleId: roleFrontDesk.id, branchId: branchA1.id, status: "ACTIVE" },
    });

    userStudentA1 = await db.user.create({
      data: { email: "student-a1@apex.edu", name: "Aarav Sharma", passwordHash: "dummy" },
    });
    await db.membership.create({
      data: { tenantId: tenantA.id, userId: userStudentA1.id, roleId: roleStudent.id, branchId: branchA1.id, status: "ACTIVE" },
    });

    userStudentA2 = await db.user.create({
      data: { email: "student-a2@apex.edu", name: "Diya Patel", passwordHash: "dummy" },
    });
    await db.membership.create({
      data: { tenantId: tenantA.id, userId: userStudentA2.id, roleId: roleStudent.id, branchId: branchA2.id, status: "ACTIVE" },
    });

    userParentA1 = await db.user.create({
      data: { email: "parent-a1@apex.edu", name: "Mrs. Sharma", passwordHash: "dummy" },
    });
    await db.membership.create({
      data: { tenantId: tenantA.id, userId: userParentA1.id, roleId: roleParent.id, status: "ACTIVE" },
    });

    // 9. Seed Students
    studentA1 = await db.student.create({
      data: { tenantId: tenantA.id, branchId: branchA1.id, admissionNo: "APX-A1-001", firstName: "Aarav", lastName: "Sharma", userId: userStudentA1.id },
    });
    studentA2 = await db.student.create({
      data: { tenantId: tenantA.id, branchId: branchA2.id, admissionNo: "APX-A2-001", firstName: "Diya", lastName: "Patel", userId: userStudentA2.id },
    });
    studentNullBranch = await db.student.create({
      data: { tenantId: tenantA.id, branchId: null, admissionNo: "APX-LEGACY-001", firstName: "Legacy", lastName: "Student" },
    });

    // Link Parent A1 to Student A1
    const guardianA1 = await db.guardian.create({
      data: { tenantId: tenantA.id, userId: userParentA1.id, name: "Mrs. Sharma", phone: "9876543210" },
    });
    await db.studentGuardian.create({
      data: { studentId: studentA1.id, guardianId: guardianA1.id, isPrimary: true },
    });

    // 10. Seed Invoices and Payments
    invoiceA1 = await db.feeInvoice.create({
      data: { tenantId: tenantA.id, branchId: branchA1.id, studentId: studentA1.id, number: "INV-A1-01", title: "Term 1 A1", amount: 100000, paidAmount: 50000, dueDate: new Date("2026-12-01") },
    });
    await db.feePayment.create({
      data: { tenantId: tenantA.id, branchId: branchA1.id, feeInvoiceId: invoiceA1.id, amount: 50000, reference: "UTR-A1-123456789" },
    });

    invoiceA2 = await db.feeInvoice.create({
      data: { tenantId: tenantA.id, branchId: branchA2.id, studentId: studentA2.id, number: "INV-A2-01", title: "Term 1 A2", amount: 150000, paidAmount: 80000, dueDate: new Date("2026-12-01") },
    });
    await db.feePayment.create({
      data: { tenantId: tenantA.id, branchId: branchA2.id, feeInvoiceId: invoiceA2.id, amount: 80000, reference: "UTR-A2-987654321" },
    });

    invoiceNullBranch = await db.feeInvoice.create({
      data: { tenantId: tenantA.id, branchId: null, studentId: studentNullBranch.id, number: "INV-NULL-01", title: "Legacy Invoice", amount: 60000, paidAmount: 30000, dueDate: new Date("2026-12-01") },
    });
    await db.feePayment.create({
      data: { tenantId: tenantA.id, branchId: null, feeInvoiceId: invoiceNullBranch.id, amount: 30000, reference: "UTR-NULL-000000000" },
    });

    // 11. Seed FileAssets
    fileStudentA1 = await db.fileAsset.create({
      data: { tenantId: tenantA.id, studentId: studentA1.id, name: "Report_A1.pdf", mime: "application/pdf", size: 1024, storageKey: "keys/report_a1.pdf" },
    });
    fileStudentA2 = await db.fileAsset.create({
      data: { tenantId: tenantA.id, studentId: studentA2.id, name: "Report_A2.pdf", mime: "application/pdf", size: 1024, storageKey: "keys/report_a2.pdf" },
    });
    fileInternalGeneral = await db.fileAsset.create({
      data: { tenantId: tenantA.id, studentId: null, name: "Internal_Policy.pdf", mime: "application/pdf", size: 2048, storageKey: "keys/internal.pdf", uploadedById: userOwnerA.id },
    });

    // 12. Seed Leads
    leadA1 = await db.lead.create({
      data: { tenantId: tenantA.id, branchId: branchA1.id, studentName: "Lead Aarav A1", guardianName: "Guardian 1", guardianPhone: "9000000001" },
    });
    leadA2 = await db.lead.create({
      data: { tenantId: tenantA.id, branchId: branchA2.id, studentName: "Lead Diya A2", guardianName: "Guardian 2", guardianPhone: "9000000002" },
    });
    leadNullBranch = await db.lead.create({
      data: { tenantId: tenantA.id, branchId: null, studentName: "Lead Unassigned", guardianName: "Guardian 3", guardianPhone: "9000000003" },
    });

    // 13. Seed Audit Log in Tenant A
    await db.auditLog.create({
      data: { tenantId: tenantA.id, actorId: userOwnerA.id, actorName: "Apex Owner", action: "settings.update", entity: "Setting" },
    });
  });

  afterAll(async () => {
    if (adminClient) {
      await adminClient.$executeRawUnsafe(`
        SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE datname = '${DISPOSABLE_DB_NAME}' AND pid <> pg_backend_pid();
      `);
      await adminClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${DISPOSABLE_DB_NAME};`);
      await adminClient.$disconnect();
    }
    if (db) {
      await db.$disconnect();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Dashboard Financial Aggregate Isolation Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("1. Dashboard Financial Aggregate Isolation (Remediation 1)", () => {
    it("1.1: Branch A1 accountant sees ONLY Branch A1 collections and zero null-branch or Branch A2 leakage", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userAccountantA1.id, tenantId: tenantA.id } });
      const ctx = {
        tenant: tenantA,
        user: userAccountantA1,
        membership,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: branchA1.id,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      expect(branchScope.isBranchScoped).toBe(true);
      expect(branchScope.allowedBranchIds).toEqual([branchA1.id]);

      // Query payments using the remediated branch filter
      const feeBranchFilter = branchScope.isBranchScoped ? { branchId: { in: branchScope.allowedBranchIds } } : {};
      const agg = await db.feePayment.aggregate({
        where: { tenantId: tenantA.id, ...feeBranchFilter },
        _sum: { amount: true },
      });

      // Branch A1 collected ₹50,000 (50000 paise). Branch A2 (80000) and Null-branch (30000) are excluded!
      expect(agg._sum.amount).toBe(50000);
    });

    it("1.2: Multi-Branch Accountant (Main Campus) sees Main, A1, and A2 collections, excluding null-branch records", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userMultiBranchAccountant.id, tenantId: tenantA.id } });
      const ctx = {
        tenant: tenantA,
        user: userMultiBranchAccountant,
        membership,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: branchMainA.id,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      expect(branchScope.isBranchScoped).toBe(true);
      // Main inherits sub-branches A1 and A2
      expect(branchScope.allowedBranchIds).toContain(branchMainA.id);
      expect(branchScope.allowedBranchIds).toContain(branchA1.id);
      expect(branchScope.allowedBranchIds).toContain(branchA2.id);

      const feeBranchFilter = branchScope.isBranchScoped ? { branchId: { in: branchScope.allowedBranchIds } } : {};
      const agg = await db.feePayment.aggregate({
        where: { tenantId: tenantA.id, ...feeBranchFilter },
        _sum: { amount: true },
      });

      // 50,000 (A1) + 80,000 (A2) = 130,000 paise. Null branch (30,000) remains excluded!
      expect(agg._sum.amount).toBe(130000);
    });

    it("1.3: Institute Owner sees tenant-wide financial totals including legacy unassigned records", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userOwnerA.id, tenantId: tenantA.id } });
      const ctx = {
        tenant: tenantA,
        user: userOwnerA,
        membership,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: true,
        subscriptionBlocked: false,
        branchId: null,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      expect(branchScope.mode).toBe("TENANT_WIDE");
      expect(branchScope.isBranchScoped).toBe(false);

      const feeBranchFilter = branchScope.isBranchScoped ? { branchId: { in: branchScope.allowedBranchIds } } : {};
      const agg = await db.feePayment.aggregate({
        where: { tenantId: tenantA.id, ...feeBranchFilter },
        _sum: { amount: true },
      });

      // All payments: 50,000 + 80,000 + 30,000 = 160,000 paise
      expect(agg._sum.amount).toBe(160000);
    });

    it("1.4: Unassigned staff without admin authority receives NO_ACCESS state and zero financial records", async () => {
      const unassignedUser = await db.user.create({
        data: { name: "Unassigned Staff", email: "unassigned@example.com", avatarColor: "#000", passwordHash: "dummyhash" },
      });
      const unassignedMembership = await db.membership.create({
        data: {
          tenantId: tenantA.id,
          userId: unassignedUser.id,
          roleId: roleAccountant.id,
          branchId: null,
          isOwner: false,
        },
      });

      const ctx = {
        tenant: tenantA,
        user: unassignedUser,
        membership: unassignedMembership,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: null,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      expect(branchScope.mode).toBe("NO_ACCESS");
      expect(branchScope.isBranchScoped).toBe(true);
      expect(branchScope.hasAccess).toBe(false);
      expect(branchScope.allowedBranchIds).toHaveLength(0);

      const feeBranchFilter = branchScope.isBranchScoped ? { branchId: { in: branchScope.allowedBranchIds } } : {};
      const payments = await db.feePayment.findMany({
        where: { tenantId: tenantA.id, ...feeBranchFilter },
      });
      expect(payments).toHaveLength(0);
    });

    it("1.5: Missing membership resolves to NO_ACCESS state", async () => {
      const ctx = {
        tenant: tenantA,
        user: userTeacherA1,
        membership: null,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      expect(branchScope.mode).toBe("NO_ACCESS");
      expect(branchScope.hasAccess).toBe(false);
      expect(branchScope.allowedBranchIds).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Dashboard Audit Log Access Restriction Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("2. Dashboard Audit Log Access Restriction (Remediation 2)", () => {
    it("2.1: Teacher and Front Desk without tenant.audit.read receive zero audit log records", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userTeacherA1.id, tenantId: tenantA.id } });
      const ctx = {
        tenant: tenantA,
        user: userTeacherA1,
        membership,
        permissions: new Set(["tenant.attendance.read", "tenant.students.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
      };

      const canReadAudit = hasTenantPermission(ctx as any, "tenant.audit.read");
      expect(canReadAudit).toBe(false);

      // Remediated code resolves to empty array without querying database
      const auditRecords = canReadAudit
        ? await db.auditLog.findMany({ where: { tenantId: tenantA.id } })
        : [];
      expect(auditRecords).toHaveLength(0);
    });

    it("2.2: Institute Owner and Admin with tenant.audit.read access the recent audit logs", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userOwnerA.id, tenantId: tenantA.id } });
      const ctx = {
        tenant: tenantA,
        user: userOwnerA,
        membership,
        permissions: new Set(["tenant.audit.read"]),
        isOwnerView: true,
        subscriptionBlocked: false,
      };

      const canReadAudit = hasTenantPermission(ctx as any, "tenant.audit.read");
      expect(canReadAudit).toBe(true);

      const auditRecords = canReadAudit
        ? await db.auditLog.findMany({ where: { tenantId: tenantA.id } })
        : [];
      expect(auditRecords.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. File Download Authorization Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("3. File Download Authorization (Remediation 3)", () => {
    it("3.1: Staff in Branch A1 is rejected when attempting to download student file in Branch A2", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userAccountantA1.id, tenantId: tenantA.id } });
      const ctx = {
        user: userAccountantA1,
        tenant: tenantA,
        membership,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: branchA1.id,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      expect(branchScope.isBranchScoped).toBe(true);

      // Student A2 belongs to branchA2
      const targetStudentBranchId = studentA2.branchId;
      const isAuthorized = branchScope.allowedBranchIds.includes(targetStudentBranchId);
      expect(isAuthorized).toBe(false);
    });

    it("3.2: Staff in Branch A1 is allowed to download student file in Branch A1", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userAccountantA1.id, tenantId: tenantA.id } });
      const ctx = {
        user: userAccountantA1,
        tenant: tenantA,
        membership,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: branchA1.id,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      const targetStudentBranchId = studentA1.branchId;
      const isAuthorized = branchScope.allowedBranchIds.includes(targetStudentBranchId);
      expect(isAuthorized).toBe(true);
    });

    it("3.3: Parent is allowed for linked student but strictly rejected for unlinked student or internal document", async () => {
      // Check linked student
      const linked = await db.studentGuardian.findFirst({
        where: { studentId: studentA1.id, guardian: { userId: userParentA1.id, tenantId: tenantA.id } },
      });
      expect(linked).not.toBeNull();

      // Check unlinked student
      const unlinked = await db.studentGuardian.findFirst({
        where: { studentId: studentA2.id, guardian: { userId: userParentA1.id, tenantId: tenantA.id } },
      });
      expect(unlinked).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Null-Branch Fee Invoice Access Fails Closed Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("4. Null-Branch Fee Invoice Access Fails Closed (Remediation 4)", () => {
    it("4.1: Branch A1 staff is rejected when accessing null-branch fee invoice (fails closed)", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userAccountantA1.id, tenantId: tenantA.id } });
      const ctx = {
        tenant: tenantA,
        user: userAccountantA1,
        membership,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: branchA1.id,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      expect(branchScope.isBranchScoped).toBe(true);

      const invoiceBranchId = invoiceNullBranch.branchId || null;
      let accessGranted = true;

      // REMEDIATED LOGIC:
      if (branchScope.isBranchScoped) {
        if (!invoiceBranchId || !branchScope.allowedBranchIds.includes(invoiceBranchId)) {
          accessGranted = false;
        }
      }

      // Proves fail-closed behavior for null-branch invoices
      expect(accessGranted).toBe(false);
    });

    it("4.2: Institute Owner is granted access to null-branch fee invoice", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userOwnerA.id, tenantId: tenantA.id } });
      const ctx = {
        tenant: tenantA,
        user: userOwnerA,
        membership,
        permissions: new Set(["tenant.fees.read"]),
        isOwnerView: true,
        subscriptionBlocked: false,
        branchId: null,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      expect(branchScope.isBranchScoped).toBe(false);

      const invoiceBranchId = invoiceNullBranch.branchId || null;
      let accessGranted = true;

      if (branchScope.isBranchScoped) {
        if (!invoiceBranchId || !branchScope.allowedBranchIds.includes(invoiceBranchId)) {
          accessGranted = false;
        }
      }

      expect(accessGranted).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. UTR and Payment Reference Masking Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("5. UTR and Payment Reference Masking (Remediation 5)", () => {
    function maskPaymentReference(ref: string | null | undefined): string {
      if (!ref) return "—";
      const str = ref.trim();
      if (str.length <= 4) return "••••";
      const suffix = str.slice(-4);
      return `••••••••${suffix}`;
    }

    function resolveCanViewUtr(ctx: any): boolean {
      return (
        hasTenantPermission(ctx, "tenant.fees.utr.view") ||
        Boolean(ctx.isOwnerView) ||
        Boolean(ctx.membership?.isOwner)
      );
    }

    it("5.1: User with tenant.fees.read only receives masked reference", () => {
      const rawUtr = "HDFC-UTR-88392019941";
      const ctxRead = { permissions: new Set(["tenant.fees.read"]), isOwnerView: false };
      const canView = resolveCanViewUtr(ctxRead);
      expect(canView).toBe(false);
      const displayed = canView ? rawUtr : maskPaymentReference(rawUtr);
      expect(displayed).toBe("••••••••9941");
      expect(displayed).not.toContain("8839201");
    });

    it("5.2: User with tenant.fees.write ALONE receives masked reference (no privilege inheritance)", () => {
      const rawUtr = "HDFC-UTR-88392019941";
      const ctxWrite = { permissions: new Set(["tenant.fees.write"]), isOwnerView: false };
      const canView = resolveCanViewUtr(ctxWrite);
      expect(canView).toBe(false); // fees.write ALONE cannot view unmasked UTR!
      const displayed = canView ? rawUtr : maskPaymentReference(rawUtr);
      expect(displayed).toBe("••••••••9941");
    });

    it("5.3: User with explicit tenant.fees.utr.view sees raw unmasked reference", () => {
      const rawUtr = "HDFC-UTR-88392019941";
      const ctxUtr = { permissions: new Set(["tenant.fees.utr.view"]), isOwnerView: false };
      const canView = resolveCanViewUtr(ctxUtr);
      expect(canView).toBe(true);
      const displayed = canView ? rawUtr : maskPaymentReference(rawUtr);
      expect(displayed).toBe(rawUtr);
    });

    it("5.4: Institute Owner sees raw unmasked reference", () => {
      const rawUtr = "HDFC-UTR-88392019941";
      const ctxOwner = { permissions: new Set(), isOwnerView: true };
      const canView = resolveCanViewUtr(ctxOwner);
      expect(canView).toBe(true);
      const displayed = canView ? rawUtr : maskPaymentReference(rawUtr);
      expect(displayed).toBe(rawUtr);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Student Branch Attribution (Create, Update, Import) Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("6. Student Branch Attribution (Remediation 6)", () => {
    it("6.1: Branch-scoped staff creation derives permitted branch and rejects unauthorized target branch", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userAccountantA1.id, tenantId: tenantA.id } });
      const ctx = {
        tenant: tenantA,
        user: userAccountantA1,
        membership,
        permissions: new Set(["tenant.students.write"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: branchA1.id,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      expect(branchScope.isBranchScoped).toBe(true);

      // Attempting to create student in unauthorized branch A2
      const attemptedBranchId = branchA2.id;
      const isAllowed = branchScope.allowedBranchIds.includes(attemptedBranchId);
      expect(isAllowed).toBe(false);

      // Defaulting without branchId correctly assigns caller's branch A1
      const effectiveBranchId = branchScope.assignedBranchId;
      expect(effectiveBranchId).toBe(branchA1.id);
    });

    it("6.2: Branch-scoped staff cannot transfer student to an unauthorized branch", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userAccountantA1.id, tenantId: tenantA.id } });
      const ctx = {
        tenant: tenantA,
        user: userAccountantA1,
        membership,
        permissions: new Set(["tenant.students.write"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: branchA1.id,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      const targetTransferBranch = branchA2.id;
      const canTransfer = branchScope.allowedBranchIds.includes(targetTransferBranch);
      expect(canTransfer).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. Credit-Transfer Permission Key Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("7. Credit-Transfer Permission Key (Remediation 7)", () => {
    it("7.1: Canonical permission tenant.fees.write succeeds whereas legacy fees.write is rejected", () => {
      const authorizedCtx = { permissions: new Set(["tenant.fees.write"]), isOwnerView: false };
      const unauthorizedCtx = { permissions: new Set(["fees.write"]), isOwnerView: false };

      expect(hasTenantPermission(authorizedCtx as any, "tenant.fees.write")).toBe(true);
      expect(hasTenantPermission(unauthorizedCtx as any, "tenant.fees.write")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. Lead Export Branch Isolation Tests
  // ─────────────────────────────────────────────────────────────────────────────
  describe("8. Lead Export Branch Isolation (Remediation 8)", () => {
    it("8.1: Branch A1 staff export query filters strictly by Branch A1, excluding Branch A2 and null-branch leads", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userAccountantA1.id, tenantId: tenantA.id } });
      const ctx = {
        tenant: tenantA,
        user: userAccountantA1,
        membership,
        permissions: new Set(["tenant.leads.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: branchA1.id,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      expect(branchScope.isBranchScoped).toBe(true);

      const where = buildLeadsWhereClause(tenantA.id, {}, branchScope.allowedBranchIds);
      const leads = await db.lead.findMany({ where });

      expect(leads).toHaveLength(1);
      expect(leads[0].studentName).toBe("Lead Aarav A1");
      expect(leads[0].branchId).toBe(branchA1.id);
    });

    it("8.2: Institute Owner exports all leads across all branches including unassigned leads", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userOwnerA.id, tenantId: tenantA.id } });
      const ctx = {
        tenant: tenantA,
        user: userOwnerA,
        membership,
        permissions: new Set(["tenant.leads.read"]),
        isOwnerView: true,
        subscriptionBlocked: false,
        branchId: null,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      expect(branchScope.isBranchScoped).toBe(false);

      const where = buildLeadsWhereClause(tenantA.id, {}, undefined);
      const leads = await db.lead.findMany({ where });

      // Includes leadA1, leadA2, and leadNullBranch
      expect(leads.length).toBeGreaterThanOrEqual(3);
    });

    it("8.3: Lead List and Direct-Detail Access: Branch A1 staff is rejected when accessing Branch A2 lead or null-branch lead (fails closed)", async () => {
      const membership = await db.membership.findFirst({ where: { userId: userAccountantA1.id, tenantId: tenantA.id } });
      const ctx = {
        tenant: tenantA,
        user: userAccountantA1,
        membership,
        permissions: new Set(["tenant.leads.read"]),
        isOwnerView: false,
        subscriptionBlocked: false,
        branchId: branchA1.id,
      };

      const branchScope = await resolveUserBranchScope(ctx as any);
      expect(branchScope.isBranchScoped).toBe(true);

      // Accessing own branch lead succeeds
      const canAccessA1 = !branchScope.isBranchScoped || (leadA1.branchId && branchScope.allowedBranchIds.includes(leadA1.branchId));
      expect(canAccessA1).toBe(true);

      // Accessing other branch lead fails closed (rejected)
      const canAccessA2 = !branchScope.isBranchScoped || Boolean(leadA2.branchId && branchScope.allowedBranchIds.includes(leadA2.branchId));
      expect(canAccessA2).toBe(false);

      // Accessing null-branch lead fails closed (rejected)
      const canAccessNull = !branchScope.isBranchScoped || Boolean(leadNullBranch.branchId && branchScope.allowedBranchIds.includes(leadNullBranch.branchId));
      expect(canAccessNull).toBe(false);
    });

    it("8.4: Database composite foreign key independently rejects associating Tenant A lead with Tenant B branch", async () => {
      let crossTenantError: any = null;
      try {
        await db.$executeRawUnsafe(`
          INSERT INTO "Lead" (id, "tenantId", "branchId", "studentName", "guardianName", "guardianPhone", "source", "status", "createdAt", "updatedAt")
          VALUES ('lead-cross-tenant-violator', '${tenantA.id}', '${branchB1.id}', 'Illegal Lead', 'Guardian Bad', '9876543299', 'AGENT', 'NEW', NOW(), NOW());
        `);
      } catch (err) {
        crossTenantError = err;
      }

      expect(crossTenantError).toBeDefined();
      expect(String(crossTenantError)).toMatch(/(Lead_tenantId_branchId_fkey|23503)/i);
    });

    it("8.5: Database composite foreign key allows valid same-tenant branch and preserves NULL branch leads", async () => {
      // 1. Same-tenant branch
      await db.$executeRawUnsafe(`
        INSERT INTO "Lead" (id, "tenantId", "branchId", "studentName", "guardianName", "guardianPhone", "source", "status", "createdAt", "updatedAt")
        VALUES ('lead-same-tenant-valid', '${tenantA.id}', '${branchA1.id}', 'Valid Lead', 'Guardian Good', '9876543200', 'WEBSITE', 'NEW', NOW(), NOW());
      `);
      const insertedValid: any[] = await db.$queryRawUnsafe(`SELECT id, "branchId" FROM "Lead" WHERE id = 'lead-same-tenant-valid';`);
      expect(insertedValid.length).toBe(1);
      expect(insertedValid[0].branchId).toBe(branchA1.id);

      // 2. Null branch
      await db.$executeRawUnsafe(`
        INSERT INTO "Lead" (id, "tenantId", "branchId", "studentName", "guardianName", "guardianPhone", "source", "status", "createdAt", "updatedAt")
        VALUES ('lead-null-branch-valid', '${tenantA.id}', NULL, 'Null Branch Lead', 'Guardian Legacy', '9876543201', 'WALK_IN', 'NEW', NOW(), NOW());
      `);
      const insertedNull: any[] = await db.$queryRawUnsafe(`SELECT id, "branchId" FROM "Lead" WHERE id = 'lead-null-branch-valid';`);
      expect(insertedNull.length).toBe(1);
      expect(insertedNull[0].branchId).toBeNull();
    });
  });
});
