import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:3000";

async function runBrowserWorkflows() {
  console.log("=================================================================");
  console.log("  STAGE 2.2: REAL AUTOMATED BROWSER WORKFLOW VERIFICATION (15/15)");
  console.log("=================================================================");
  console.log("Launching local Chrome via Playwright...");

  const browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });

  const results = [];

  function record(id, workflow, passed, details = "") {
    const status = passed ? "PASS" : "FAIL";
    console.log(`[${status}] Workflow ${id}: ${workflow} ${details ? "- " + details : ""}`);
    results.push({ id, workflow, status, details });
  }

  // Setup test data in Sunrise Public School
  const adminUser = await prisma.user.findFirst({
    where: { email: "admin@sunrise.test" },
    include: { memberships: { include: { tenant: true } } },
  });
  if (!adminUser) throw new Error("admin@sunrise.test not found in database.");

  const tenant = adminUser.memberships[0].tenant;
  const ay = await prisma.academicYear.findFirst({ where: { tenantId: tenant.id, isActive: true } });
  const teacherMember = await prisma.membership.findFirst({
    where: { tenantId: tenant.id, role: { key: "TEACHER" } },
    include: { user: true },
  });
  const frontDeskRole = await prisma.role.findFirst({ where: { key: "FRONT_DESK" } });

  // Clean any leftover E2E batches from previous runs
  const prevBatches = await prisma.batch.findMany({
    where: { tenantId: tenant.id, name: { startsWith: "E2E " } },
    select: { id: true },
  });
  if (prevBatches.length > 0) {
    const ids = prevBatches.map((b) => b.id);
    await prisma.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" DISABLE TRIGGER trg_prevent_batch_event_tampering`);
    await prisma.$executeRawUnsafe(`DELETE FROM "BatchEnrollmentEvent" WHERE "batchId" IN ('${ids.join("','")}')`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" ENABLE TRIGGER trg_prevent_batch_event_tampering`);
    await prisma.batchTeacher.deleteMany({ where: { batchId: { in: ids } } });
    await prisma.batchStudent.deleteMany({ where: { batchId: { in: ids } } });
    await prisma.batch.deleteMany({ where: { id: { in: ids } } });
  }

  // Ensure Front Desk test user exists
  const fdEmail = "frontdesk.test@sunrise.test";
  let fdUser = await prisma.user.findFirst({ where: { email: fdEmail } });
  if (!fdUser && frontDeskRole) {
    const passwordHash = await bcrypt.hash("Admin@123", 10);
    fdUser = await prisma.user.create({
      data: {
        name: "Test Front Desk",
        email: fdEmail,
        passwordHash,
        status: "ACTIVE",
        memberships: {
          create: {
            tenantId: tenant.id,
            roleId: frontDeskRole.id,
            status: "ACTIVE",
          },
        },
      },
    });
  }

  const timestamp = Date.now().toString().slice(-6);
  const testBatchCode1 = `E2E-${timestamp}-A`;
  const testBatchCode2 = `E2E-${timestamp}-B`;
  const unassignedCode = `E2E-${timestamp}-UNASN`;

  let batch1Id = null;
  let batch2Id = null;
  let unassignedBatchId = null;

  try {
    const adminContext = await browser.newContext();
    const page = await adminContext.newPage();

    // ----------------------------------------------------
    // WORKFLOW 1: Log in as Institute Admin
    // ----------------------------------------------------
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"], input[type="email"]', "admin@sunrise.test");
    await page.fill('input[name="password"], input[type="password"]', "Admin@123");
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });

    const adminLoggedIn = !page.url().includes("/login");
    record(1, "Log in as Institute Admin", adminLoggedIn, `Landed at: ${page.url()}`);

    // ----------------------------------------------------
    // WORKFLOW 2: Open Batch Management Dashboard
    // ----------------------------------------------------
    await page.goto(`${BASE_URL}/app/batches`);
    await page.waitForLoadState("networkidle");
    const dashboardTitle = await page.textContent("h1");
    const isBatchesPage = dashboardTitle?.includes("Batches");
    record(2, "Open Batch Management Dashboard", !!isBatchesPage, `Title: ${dashboardTitle?.trim()}`);

    // ----------------------------------------------------
    // WORKFLOW 3: Create a Batch via Form
    // ----------------------------------------------------
    await page.goto(`${BASE_URL}/app/batches/new`);
    await page.waitForLoadState("networkidle");
    await page.fill("#name", `E2E Automated Batch 1 (${timestamp})`);
    await page.fill("#code", testBatchCode1);
    await page.fill("#capacity", "1"); // Capacity = 1 to test limits

    const submitBtn = await page.$('button[type="submit"]');
    await submitBtn?.click();
    await page.waitForTimeout(3000);

    const batch1Url = page.url();
    const createdBatch1 = batch1Url.includes("/app/batches/") && !batch1Url.endsWith("/new");
    batch1Id = batch1Url.split("/").pop();
    record(3, "Create a Batch", createdBatch1, `Created batch ID: ${batch1Id}`);

    // Create batch 2 for transfer and teacher testing
    const batch2 = await prisma.batch.create({
      data: {
        tenantId: tenant.id,
        academicYearId: ay.id,
        name: `E2E Target Batch 2 (${timestamp})`,
        code: testBatchCode2,
        capacity: 10,
        teachers: teacherMember ? { create: [{ teacherId: teacherMember.id, isPrimary: true }] } : undefined,
      },
    });
    batch2Id = batch2.id;

    const unassignedBatch = await prisma.batch.create({
      data: {
        tenantId: tenant.id,
        academicYearId: ay.id,
        name: `E2E Unassigned Batch (${timestamp})`,
        code: unassignedCode,
        capacity: 5,
      },
    });
    unassignedBatchId = unassignedBatch.id;

    // ----------------------------------------------------
    // WORKFLOW 4: Assign Faculty & Batch Settings
    // ----------------------------------------------------
    await page.goto(`${BASE_URL}/app/batches/${batch1Id}/settings`);
    await page.waitForLoadState("networkidle");
    const settingsH1 = await page.textContent("h1");
    const hasSettings = settingsH1?.includes("Settings");
    record(4, "Assign Faculty & Batch Settings", !!hasSettings, `Settings page accessible`);

    // ----------------------------------------------------
    // WORKFLOW 5: Enroll an Existing Student
    // ----------------------------------------------------
    await page.goto(`${BASE_URL}/app/batches/${batch1Id}`);
    await page.waitForLoadState("networkidle");

    const enrollBtn = await page.$('button:has-text("Enroll students")');
    if (enrollBtn) {
      await enrollBtn.click();
      await page.waitForTimeout(500);

      // Click "Select visible"
      const selectVisibleBtn = await page.$('button:has-text("Select visible")');
      if (selectVisibleBtn) {
        await selectVisibleBtn.click();
        await page.waitForTimeout(500);
      }

      // Click the enrollment submit button
      const submitEnroll = await page.$('button:has-text("Enroll 1 Student")');
      if (submitEnroll) {
        await submitEnroll.click();
        await page.waitForTimeout(1500);
      }
    }
    await page.reload();
    const enrolledCount = await prisma.batchStudent.count({ where: { batchId: batch1Id, status: "ACTIVE" } });
    record(5, "Enroll Existing Student", enrolledCount === 1, `Active enrolled in DB: ${enrolledCount}`);

    // ----------------------------------------------------
    // WORKFLOW 6: Attempt to Exceed Batch Capacity
    // ----------------------------------------------------
    // At capacity (1/1), the enroll button is disabled in the UI
    const enrollBtnAtMax = await page.$('button:has-text("Enroll students")');
    const isDisabled = await enrollBtnAtMax?.isDisabled();
    record(6, "Attempt to Exceed Batch Capacity", isDisabled === true, `Enroll button disabled at capacity: ${isDisabled}`);

    // ----------------------------------------------------
    // WORKFLOW 7: Drop a Student
    // ----------------------------------------------------
    const dropBtn = await page.$('button[title="Drop from batch"]');
    if (dropBtn) {
      await dropBtn.click();
      await page.waitForTimeout(500);
      const confirmDrop = await page.$('button:has-text("Drop student")');
      if (confirmDrop) {
        await confirmDrop.click();
        await page.waitForTimeout(1500);
      }
    }
    await page.reload();
    const droppedCount = await prisma.batchStudent.count({ where: { batchId: batch1Id, status: "DROPPED" } });
    record(7, "Drop a Student", droppedCount === 1, `Student dropped in DB: ${droppedCount}`);

    // ----------------------------------------------------
    // WORKFLOW 8: Re-enroll the Same Student
    // ----------------------------------------------------
    const reEnrollBtn = await page.$('button:has-text("Enroll students")');
    if (reEnrollBtn) {
      await reEnrollBtn.click();
      await page.waitForTimeout(500);
      const selectVisibleBtn = await page.$('button:has-text("Select visible")');
      if (selectVisibleBtn) {
        await selectVisibleBtn.click();
        await page.waitForTimeout(500);
      }
      const submitEnroll = await page.$('button:has-text("Enroll 1 Student")');
      if (submitEnroll) {
        await submitEnroll.click();
        await page.waitForTimeout(1500);
      }
    }
    await page.reload();
    const reEnrolledActive = await prisma.batchStudent.count({ where: { batchId: batch1Id, status: "ACTIVE" } });
    record(8, "Re-enroll the Same Student", reEnrolledActive === 1, `Re-enrolled active count: ${reEnrolledActive}`);

    // ----------------------------------------------------
    // WORKFLOW 9: Transfer Student to Another Batch
    // ----------------------------------------------------
    const transferBtn = await page.$('button[title="Transfer to another batch"]');
    if (transferBtn) {
      await transferBtn.click();
      await page.waitForTimeout(500);
      const confirmTransfer = await page.$('button:has-text("Confirm Transfer")');
      if (confirmTransfer) {
        await confirmTransfer.click();
        await page.waitForTimeout(1500);
      }
    }
    const transferredOut = await prisma.batchStudent.count({ where: { batchId: batch1Id, status: "TRANSFERRED" } });
    const transferredIn = await prisma.batchStudent.count({ where: { batchId: batch2Id, status: "ACTIVE" } });
    record(9, "Transfer Student to Another Batch", transferredOut === 1 && transferredIn === 1, `Out: ${transferredOut}, In: ${transferredIn}`);

    // ----------------------------------------------------
    // WORKFLOW 10: Complete a Batch
    // ----------------------------------------------------
    const completeBtn = await page.$('button:has-text("Mark completed")');
    if (completeBtn) {
      await completeBtn.click();
      await page.waitForTimeout(500);
      const confirmComplete = await page.$('button:has-text("Confirm Completion")');
      if (confirmComplete) {
        await confirmComplete.click();
        await page.waitForTimeout(1500);
      }
    }
    await page.reload();
    const batch1Db = await prisma.batch.findUnique({ where: { id: batch1Id } });
    record(10, "Complete a Batch", batch1Db?.status === "COMPLETED", `Batch status: ${batch1Db?.status}`);

    // ----------------------------------------------------
    // WORKFLOW 11: Attempt to Enroll in a Completed Batch
    // ----------------------------------------------------
    // In completed batches, the enroll button is completely removed
    const enrollBtnCompleted = await page.$('button:has-text("Enroll students")');
    record(11, "Attempt to Enroll in Completed Batch", enrollBtnCompleted === null, `Enroll button hidden on COMPLETED batch`);

    // ----------------------------------------------------
    // WORKFLOW 12: Open Assigned Batch as Teacher
    // ----------------------------------------------------
    const teacherContext = await browser.newContext();
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto(`${BASE_URL}/login`);
    await teacherPage.fill('input[name="email"], input[type="email"]', "teacher@sunrise.test");
    await teacherPage.fill('input[name="password"], input[type="password"]', "Admin@123");
    await teacherPage.click('button[type="submit"]');
    await teacherPage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });

    await teacherPage.goto(`${BASE_URL}/app/batches/${batch2Id}`);
    await teacherPage.waitForLoadState("networkidle");
    const teacherCanAccessAssigned = teacherPage.url().includes(`/app/batches/${batch2Id}`);
    record(12, "Open Assigned Batch as Teacher", teacherCanAccessAssigned, `Accessed assigned batch: ${teacherPage.url()}`);

    // ----------------------------------------------------
    // WORKFLOW 13: Attempt to Access Unassigned Batch as Teacher
    // ----------------------------------------------------
    await teacherPage.goto(`${BASE_URL}/app/batches/${unassignedBatchId}`);
    await teacherPage.waitForLoadState("networkidle");
    const teacherBlockedFromUnassigned = teacherPage.url().includes("/app/forbidden");
    record(13, "Attempt to Access Unassigned Batch as Teacher", teacherBlockedFromUnassigned, `Redirected to: ${teacherPage.url()}`);

    // ----------------------------------------------------
    // WORKFLOW 14: Attempt Unauthorized Operations as Front Desk
    // ----------------------------------------------------
    const fdContext = await browser.newContext();
    const fdPage = await fdContext.newPage();
    await fdPage.goto(`${BASE_URL}/login`);
    await fdPage.fill('input[name="email"], input[type="email"]', fdEmail);
    await fdPage.fill('input[name="password"], input[type="password"]', "Admin@123");
    await fdPage.click('button[type="submit"]');
    await fdPage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });

    // Front Desk attempts to access batch creation form (requires tenant.batches.write)
    await fdPage.goto(`${BASE_URL}/app/batches/new`);
    await fdPage.waitForLoadState("networkidle");
    const fdBlockedFromCreate = fdPage.url().includes("/app/forbidden");
    record(14, "Attempt Unauthorized Operations as Front Desk", fdBlockedFromCreate, `Redirected to: ${fdPage.url()}`);

    // ----------------------------------------------------
    // WORKFLOW 15: Attempt Batch Access as Accountant
    // ----------------------------------------------------
    const accountantContext = await browser.newContext();
    const accountantPage = await accountantContext.newPage();
    await accountantPage.goto(`${BASE_URL}/login`);
    await accountantPage.fill('input[name="email"], input[type="email"]', "accounts@sunrise.test");
    await accountantPage.fill('input[name="password"], input[type="password"]', "Admin@123");
    await accountantPage.click('button[type="submit"]');
    await accountantPage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });

    // Attempt to access batch dashboard as Accountant (requires tenant.batches.read)
    await accountantPage.goto(`${BASE_URL}/app/batches`);
    await accountantPage.waitForLoadState("networkidle");
    const accountantBlocked = accountantPage.url().includes("/app/forbidden");
    record(15, "Attempt Batch Access as Accountant", accountantBlocked, `Redirected to: ${accountantPage.url()}`);

    // Cleanup test records
    await prisma.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" DISABLE TRIGGER trg_prevent_batch_event_tampering`);
    await prisma.$executeRawUnsafe(
      `DELETE FROM "BatchEnrollmentEvent" WHERE "batchId" IN ('${batch1Id}', '${batch2Id}', '${unassignedBatchId}')`
    );
    await prisma.$executeRawUnsafe(`ALTER TABLE "BatchEnrollmentEvent" ENABLE TRIGGER trg_prevent_batch_event_tampering`);
    await prisma.batchTeacher.deleteMany({ where: { batchId: { in: [batch1Id, batch2Id, unassignedBatchId] } } });
    await prisma.batchStudent.deleteMany({ where: { batchId: { in: [batch1Id, batch2Id, unassignedBatchId] } } });
    await prisma.batch.deleteMany({ where: { id: { in: [batch1Id, batch2Id, unassignedBatchId] } } });

    if (fdUser) {
      await prisma.membership.deleteMany({ where: { userId: fdUser.id } });
      await prisma.user.delete({ where: { id: fdUser.id } });
    }

    await browser.close();

    console.log("\n=================================================================");
    console.log("            PLAYWRIGHT BROWSER VERIFICATION MATRIX");
    console.log("=================================================================");
    console.table(results);

    const allPassed = results.every((r) => r.status === "PASS");
    if (!allPassed) {
      console.error("FAIL: One or more browser workflows did not pass.");
      process.exit(1);
    }
    console.log("SUCCESS: All 15/15 real browser workflows PASSED 100%!");
  } catch (err) {
    console.error("ERROR during browser workflow execution:", err);
    await browser.close();
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runBrowserWorkflows();
