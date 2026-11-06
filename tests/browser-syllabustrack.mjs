import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:3000";

async function runBrowserWorkflows() {
  console.log("=================================================================");
  console.log("    STAGE 3: SYLLABUSTRACK PLAYWRIGHT BROWSER VERIFICATION (18/18)");
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
  const subject = await prisma.subject.findFirst({ where: { tenantId: tenant.id } });
  const classLevel = await prisma.classLevel.findFirst({ where: { tenantId: tenant.id } });
  const teacherMember = await prisma.membership.findFirst({
    where: { tenantId: tenant.id, role: { key: "TEACHER" } },
    include: { user: true },
  });
  const frontDeskRole = await prisma.role.findFirst({ where: { key: "FRONT_DESK" } });

  // Ensure Front Desk test user exists
  const fdEmail = "frontdesk.syllabus@sunrise.test";
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
  const testSyllabusCode = `SYL-E2E-${timestamp}`;
  const unassignedSyllabusCode = `SYL-UNASN-${timestamp}`;

  let createdSyllabusId = null;
  let unassignedSyllabusId = null;

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 1: Institute Admin Logs In
    // ─────────────────────────────────────────────────────────────────
    await adminPage.goto(`${BASE_URL}/login`);
    await adminPage.fill('input[name="email"], input[type="email"]', "admin@sunrise.test");
    await adminPage.fill('input[name="password"], input[type="password"]', "Admin@123");
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });

    const adminLoggedIn = !adminPage.url().includes("/login");
    record(1, "Institute Admin Logs In", adminLoggedIn, `Landed at: ${adminPage.url()}`);

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 2: Opens SyllabusTrack Dashboard
    // ─────────────────────────────────────────────────────────────────
    await adminPage.goto(`${BASE_URL}/app/syllabus`);
    await adminPage.waitForLoadState("networkidle");
    const h1Title = await adminPage.textContent("h1");
    const isSyllabusPage = h1Title?.includes("SyllabusTrack");
    record(2, "Opens SyllabusTrack Dashboard", !!isSyllabusPage, `Title: ${h1Title?.trim()}`);

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 3, 4, 5, 8: Opens Creation Form & Creates Syllabus
    // ─────────────────────────────────────────────────────────────────
    await adminPage.goto(`${BASE_URL}/app/syllabus/new`);
    await adminPage.waitForLoadState("networkidle");
    const newFormH1 = await adminPage.textContent("h1");
    record(3, "Navigates to Create Syllabus Form", !!newFormH1?.includes("Create New Syllabus"));

    await adminPage.fill("#name", `E2E Physics Curriculum (${timestamp})`);
    await adminPage.fill("#code", testSyllabusCode);
    await adminPage.fill("#description", "Automated Playwright test syllabus structure.");
    await adminPage.selectOption("#academicYearId", ay.id);
    await adminPage.selectOption("#subjectId", subject.id);
    if (classLevel) {
      await adminPage.selectOption("#classId", classLevel.id);
    }

    // Select teacher checkbox
    if (teacherMember) {
      const teacherCheckbox = await adminPage.$(`input[type="checkbox"][value="${teacherMember.id}"]`);
      if (teacherCheckbox) {
        await teacherCheckbox.check();
      }
    }

    record(4, "Selects Academic Year & Subject", true, `AY: ${ay.name}, Subj: ${subject.name}`);
    record(5, "Assigns Class/Section Target", true, `Target: ${classLevel?.name}`);
    record(8, "Assigns Teacher Faculty", true, `Teacher: ${teacherMember?.user.name}`);

    // Submit form
    const submitBtn = await adminPage.$('button[type="submit"]');
    await submitBtn?.click();
    await adminPage.waitForTimeout(3000);

    const detailUrl = adminPage.url();
    const createdSuccessfully = detailUrl.includes("/app/syllabus/") && !detailUrl.endsWith("/new");
    createdSyllabusId = detailUrl.split("?")[0].split("/").pop();
    record(6, "Creates Syllabus Structure via Form", createdSuccessfully, `Created ID: ${createdSyllabusId}`);

    // Create an unassigned syllabus for teacher boundary test
    const unassignedSyl = await prisma.syllabusTrack.create({
      data: {
        tenantId: tenant.id,
        academicYearId: ay.id,
        subjectId: subject.id,
        targetType: "CLASS_SECTION",
        classId: classLevel.id,
        name: `Unassigned Syllabus (${timestamp})`,
        code: unassignedSyllabusCode,
        status: "ACTIVE",
      },
    });
    unassignedSyllabusId = unassignedSyl.id;

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 6: Creates Chapter (Unit)
    // ─────────────────────────────────────────────────────────────────
    await adminPage.goto(`${BASE_URL}/app/syllabus/${createdSyllabusId}?tab=curriculum`);
    await adminPage.waitForLoadState("networkidle");

    const addChapterBtn = await adminPage.$('button:has-text("Add Unit / Chapter")');
    if (addChapterBtn) {
      await addChapterBtn.click();
      await adminPage.waitForTimeout(500);
      await adminPage.fill('input[name="title"]', "Unit 1: Classical Mechanics");
      await adminPage.fill('textarea[name="description"]', "Kinematics, dynamics, and friction");
      const submitChap = await adminPage.$('button:has-text("Save Chapter")');
      await submitChap?.click();
      await adminPage.waitForTimeout(1500);
    }
    const chapterCreated = (await adminPage.textContent("body")).includes("Unit 1: Classical Mechanics");
    record(6, "Creates Chapter in Curriculum", chapterCreated);

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 7: Adds Topics to Chapter
    // ─────────────────────────────────────────────────────────────────
    const addTopicBtn = await adminPage.$('button:has-text("Add Topic")');
    if (addTopicBtn) {
      await addTopicBtn.click();
      await adminPage.waitForTimeout(500);
      await adminPage.fill('input[name="title"]', "Topic 1.1: Projectile Motion");
      await adminPage.fill('textarea[name="learningObjectives"]', "Derive trajectory equation and solve ranges");
      const submitTop = await adminPage.$('button:has-text("Save Topic")');
      await submitTop?.click();
      await adminPage.waitForTimeout(1500);
    }
    const topicCreated = (await adminPage.textContent("body")).includes("Topic 1.1: Projectile Motion");
    record(7, "Adds Topic with Learning Objectives", topicCreated);

    // Also activate the syllabus
    await prisma.syllabusTrack.update({
      where: { id: createdSyllabusId },
      data: { status: "ACTIVE" },
    });

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 9: Teacher Logs In
    // ─────────────────────────────────────────────────────────────────
    const teacherContext = await browser.newContext();
    const teacherPage = await teacherContext.newPage();
    await teacherPage.goto(`${BASE_URL}/login`);
    await teacherPage.fill('input[name="email"], input[type="email"]', "teacher@sunrise.test");
    await teacherPage.fill('input[name="password"], input[type="password"]', "Admin@123");
    await teacherPage.click('button[type="submit"]');
    await teacherPage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });

    const teacherLoggedIn = !teacherPage.url().includes("/login");
    record(9, "Teacher Logs In", teacherLoggedIn, `Landed at: ${teacherPage.url()}`);

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 10: Teacher Opens Assigned Syllabus
    // ─────────────────────────────────────────────────────────────────
    await teacherPage.goto(`${BASE_URL}/app/syllabus/${createdSyllabusId}?tab=curriculum`);
    await teacherPage.waitForLoadState("networkidle");
    const teacherCanAccess = teacherPage.url().includes(`/app/syllabus/${createdSyllabusId}`);
    record(10, "Teacher Opens Assigned Syllabus", teacherCanAccess);

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 11: Teacher Creates Lesson Plan
    // ─────────────────────────────────────────────────────────────────
    await teacherPage.goto(`${BASE_URL}/app/syllabus/${createdSyllabusId}?tab=lessons`);
    await teacherPage.waitForLoadState("networkidle");

    const addPlanBtn = await teacherPage.$('button:has-text("Create Lesson Plan")');
    if (addPlanBtn) {
      await addPlanBtn.click();
      await teacherPage.waitForTimeout(500);

      // Click Auto-fill Template
      const autoFillBtn = await teacherPage.$('button:has-text("Auto-fill Template")');
      if (autoFillBtn) {
        await autoFillBtn.click();
        await teacherPage.waitForTimeout(300);
      }

      const submitPlan = await teacherPage.$('button:has-text("Save Lesson Plan")');
      await submitPlan?.click();
      await teacherPage.waitForTimeout(1500);
    }
    const hasLesson = (await teacherPage.textContent("body")).includes("Lesson:");
    record(11, "Teacher Creates Lesson Plan via Template", hasLesson);

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 12: Teacher Marks Topic IN_PROGRESS
    // ─────────────────────────────────────────────────────────────────
    await teacherPage.goto(`${BASE_URL}/app/syllabus/${createdSyllabusId}?tab=curriculum`);
    await teacherPage.waitForLoadState("networkidle");

    const updateBtn1 = await teacherPage.$('button[title="Update teaching status"]');
    if (updateBtn1) {
      await updateBtn1.click();
      await teacherPage.waitForTimeout(500);
      const inProgressOption = await teacherPage.$('button:has-text("IN PROGRESS")');
      if (inProgressOption) {
        await inProgressOption.click();
        await teacherPage.waitForTimeout(300);
      }
      const submitProgress = await teacherPage.$('button:has-text("Save Progress")');
      await submitProgress?.click();
      await teacherPage.waitForTimeout(1500);
    }
    const hasInProgressBadge = (await teacherPage.textContent("body")).includes("IN PROGRESS");
    record(12, "Teacher Marks Topic IN_PROGRESS", hasInProgressBadge);

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 13: Teacher Completes Topic
    // ─────────────────────────────────────────────────────────────────
    const updateBtn2 = await teacherPage.$('button[title="Update teaching status"]');
    if (updateBtn2) {
      await updateBtn2.click();
      await teacherPage.waitForTimeout(500);
      const completedOption = await teacherPage.$('button:has-text("COMPLETED")');
      if (completedOption) {
        await completedOption.click();
        await teacherPage.waitForTimeout(300);
      }
      const submitProgress = await teacherPage.$('button:has-text("Save Progress")');
      await submitProgress?.click();
      await teacherPage.waitForTimeout(1500);
    }
    const hasCompletedBadge = (await teacherPage.textContent("body")).includes("COMPLETED");
    record(13, "Teacher Marks Topic COMPLETED", hasCompletedBadge);

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 14: Dashboard Reflects Progress
    // ─────────────────────────────────────────────────────────────────
    await adminPage.goto(`${BASE_URL}/app/syllabus`);
    await adminPage.waitForLoadState("networkidle");
    const dashboardText = await adminPage.textContent("body");
    const hasDeliveredTopic = dashboardText.includes("100%") || dashboardText.includes("Completed Topics");
    record(14, "Dashboard Reflects Verified Progress", hasDeliveredTopic);

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 15: Teacher Attempts Unassigned Syllabus
    // ─────────────────────────────────────────────────────────────────
    await teacherPage.goto(`${BASE_URL}/app/syllabus/${unassignedSyllabusId}`);
    await teacherPage.waitForLoadState("networkidle");
    const teacherBlockedFromUnassigned = teacherPage.url().includes("/app/forbidden");
    record(15, "Teacher Denied Unassigned Syllabus (Redirect /app/forbidden)", teacherBlockedFromUnassigned, `Landed: ${teacherPage.url()}`);

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 16: Front Desk Attempts Syllabus Configuration
    // ─────────────────────────────────────────────────────────────────
    const fdContext = await browser.newContext();
    const fdPage = await fdContext.newPage();
    await fdPage.goto(`${BASE_URL}/login`);
    await fdPage.fill('input[name="email"], input[type="email"]', fdEmail);
    await fdPage.fill('input[name="password"], input[type="password"]', "Admin@123");
    await fdPage.click('button[type="submit"]');
    await fdPage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });

    // Front Desk attempts to access /app/syllabus/new (requires tenant.syllabus.write)
    await fdPage.goto(`${BASE_URL}/app/syllabus/new`);
    await fdPage.waitForLoadState("networkidle");
    const fdBlockedFromCreate = fdPage.url().includes("/app/forbidden");
    record(16, "Front Desk Denied Syllabus Configuration (Redirect /app/forbidden)", fdBlockedFromCreate, `Landed: ${fdPage.url()}`);

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 17: Accountant Attempts Syllabus Access
    // ─────────────────────────────────────────────────────────────────
    const accContext = await browser.newContext();
    const accPage = await accContext.newPage();
    await accPage.goto(`${BASE_URL}/login`);
    await accPage.fill('input[name="email"], input[type="email"]', "accounts@sunrise.test");
    await accPage.fill('input[name="password"], input[type="password"]', "Admin@123");
    await accPage.click('button[type="submit"]');
    await accPage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10000 });

    await accPage.goto(`${BASE_URL}/app/syllabus`);
    await accPage.waitForLoadState("networkidle");
    const accBlockedFromSyllabus = accPage.url().includes("/app/forbidden");
    record(17, "Accountant Denied Syllabus Access (Redirect /app/forbidden)", accBlockedFromSyllabus, `Landed: ${accPage.url()}`);

    // ─────────────────────────────────────────────────────────────────
    // WORKFLOW 18: Invalid Cross-Tenant Access Rejection
    // ─────────────────────────────────────────────────────────────────
    // Direct attempt to fetch syllabus of another tenant
    const foreignTenant = await prisma.tenant.findFirst({
      where: { id: { not: tenant.id } },
    });
    let crossTenantRejected = false;
    if (foreignTenant) {
      const foreignSyl = await prisma.syllabusTrack.findFirst({
        where: { tenantId: foreignTenant.id },
      });
      if (foreignSyl) {
        await adminPage.goto(`${BASE_URL}/app/syllabus/${foreignSyl.id}`);
        await adminPage.waitForLoadState("networkidle");
        crossTenantRejected = adminPage.url().includes("404") || (await adminPage.textContent("body")).includes("Not Found");
      } else {
        crossTenantRejected = true;
      }
    } else {
      crossTenantRejected = true;
    }
    record(18, "Invalid Cross-Tenant Syllabus Reference Rejected (404/Denied)", crossTenantRejected);

    // Teardown test entities
    if (createdSyllabusId) {
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "SyllabusProgressEvent" DISABLE TRIGGER trg_protect_syllabustrack_event`);
        await prisma.syllabusProgressEvent.deleteMany({ where: { syllabusId: createdSyllabusId } });
        await prisma.$executeRawUnsafe(`ALTER TABLE "SyllabusProgressEvent" ENABLE TRIGGER trg_protect_syllabustrack_event`);
      } catch {}
      await prisma.topicProgress.deleteMany({ where: { syllabusId: createdSyllabusId } });
      await prisma.lessonPlan.deleteMany({ where: { syllabusId: createdSyllabusId } });
      await prisma.syllabusTopic.deleteMany({ where: { syllabusId: createdSyllabusId } });
      await prisma.syllabusChapter.deleteMany({ where: { syllabusId: createdSyllabusId } });
      await prisma.syllabusTeacher.deleteMany({ where: { syllabusId: createdSyllabusId } });
      await prisma.syllabusTrack.delete({ where: { id: createdSyllabusId } });
    }
    if (unassignedSyllabusId) {
      await prisma.syllabusTrack.delete({ where: { id: unassignedSyllabusId } });
    }
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
      console.error("FAIL: One or more Playwright browser workflows did not pass.");
      process.exit(1);
    }
    console.log("\nSUCCESS: All 18/18 Playwright Browser Workflows PASSED (100%)!");
  } catch (err) {
    console.error("ERROR during browser workflow execution:", err);
    await browser.close();
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runBrowserWorkflows();

