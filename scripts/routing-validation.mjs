import { createRequire } from "module";
const require = createRequire("d:/IT/Saas/package.json");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const BASE_URL = "http://127.0.0.1:3000";

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  setFromHeaders(headers) {
    const raw = headers.getSetCookie ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for (const cookieStr of raw) {
      if (!cookieStr) continue;
      const parts = cookieStr.split(";");
      const [nameVal] = parts;
      const idx = nameVal.indexOf("=");
      if (idx !== -1) {
        const name = nameVal.slice(0, idx).trim();
        const value = nameVal.slice(idx + 1).trim();
        if (value === "" || parts.some((p) => p.trim().toLowerCase().startsWith("max-age=0"))) {
          this.cookies.delete(name);
        } else {
          this.cookies.set(name, value);
        }
      }
    }
  }

  getCookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  set(name, value) {
    this.cookies.set(name, value);
  }

  get(name) {
    return this.cookies.get(name);
  }
}

async function request(urlPath, options = {}, jar = new CookieJar()) {
  const url = urlPath.startsWith("http") ? urlPath : `${BASE_URL}${urlPath}`;
  const headers = { ...(options.headers || {}) };
  const cookieHeader = jar.getCookieHeader();
  if (cookieHeader) headers["cookie"] = cookieHeader;

  const res = await fetch(url, {
    ...options,
    headers,
    redirect: "manual",
  });

  jar.setFromHeaders(res.headers);
  const location = res.headers.get("location");
  const text = await res.text();

  return {
    status: res.status,
    location,
    text,
    headers: res.headers,
    jar,
  };
}

async function followRedirects(urlPath, options = {}, jar = new CookieJar(), maxRedirects = 6) {
  let curPath = urlPath;
  let response;
  let redirects = [];

  for (let i = 0; i < maxRedirects; i++) {
    response = await request(curPath, options, jar);
    options = { method: "GET" };

    if (response.status >= 300 && response.status < 400 && response.location) {
      redirects.push({ from: curPath, to: response.location, status: response.status });
      curPath = response.location;
    } else {
      break;
    }
  }

  return { finalUrl: curPath, response, redirects, jar };
}

async function login(email, password, jar = new CookieJar()) {
  const getRes = await request("/login", { method: "GET" }, jar);
  const html = getRes.text;

  const hiddenInputs = {};
  const regex = /<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const val = (match[2] || "").replace(/&quot;/g, '"');
    hiddenInputs[match[1]] = val;
  }

  const fd = new FormData();
  for (const [k, v] of Object.entries(hiddenInputs)) {
    fd.append(k, v);
  }
  fd.append("email", email);
  fd.append("password", password);

  const postRes = await request("/login", {
    method: "POST",
    body: fd,
  }, jar);

  return postRes;
}

const testResults = [];
function record(testName, passed, details = "") {
  testResults.push({ testName, passed, details });
  console.log(`${passed ? " PASS " : " FAIL "} | ${testName}${details ? " — " + details : ""}`);
}

async function runAudit() {
  console.log("==================================================================");
  console.log("KNOWLETIVE ROLE-BASED DASHBOARD ROUTING & AUTHORIZATION E2E AUDIT");
  console.log("==================================================================\n");

  // Clean test rate limits
  await prisma.$executeRawUnsafe(`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'login:%'`);

  // 1. Account Classification & Landing Routes
  console.log("--- 1. Account Classification & Login Landing Routes ---");

  // 1.1 Platform Owner
  {
    const jar = new CookieJar();
    const res = await login("owner@knowletive.com", "Admin@123", jar);
    record("Platform Owner: Login Redirect", res.location === "/platform", `Redirects to ${res.location}`);

    const visit = await followRedirects("/platform", {}, jar);
    const hasConsole = visit.response.text.includes("Platform") && visit.response.text.includes("Institutes");
    record("Platform Owner: Direct /platform Access", visit.finalUrl === "/platform" && hasConsole, `Status ${visit.response.status}`);
  }

  // 1.2 Platform Support
  {
    const jar = new CookieJar();
    const res = await login("support@knowletive.com", "Admin@123", jar);
    record("Platform Support: Login Redirect", res.location === "/platform", `Redirects to ${res.location}`);

    const visit = await followRedirects("/platform", {}, jar);
    const hasConsole = visit.response.text.includes("Platform") && visit.response.text.includes("Institutes");
    record("Platform Support: Direct /platform Access", visit.finalUrl === "/platform" && hasConsole, `Status ${visit.response.status}`);
  }

  // 1.3 Institute Admin
  {
    const jar = new CookieJar();
    const res = await login("admin@delhi-public.knowletive.com", "Admin@123", jar);
    record("Institute Admin: Login Redirect", res.location === "/app", `Redirects to ${res.location}`);

    const visit = await followRedirects("/app", {}, jar);
    const hasWorkspace = visit.response.text.includes("Delhi Public School") && !visit.response.text.includes("No institute assigned");
    record("Institute Admin: /app Workspace Access", visit.finalUrl === "/app" && hasWorkspace, `Institute name visible`);
  }

  // 1.4 Teacher
  {
    const jar = new CookieJar();
    const res = await login("teacher@delhi-public.knowletive.com", "Admin@123", jar);
    record("Teacher: Login Redirect", res.location === "/app", `Redirects to ${res.location}`);

    const visit = await followRedirects("/app", {}, jar);
    record("Teacher: /app Workspace Access", visit.finalUrl === "/app" && visit.response.text.includes("Delhi Public School"), `Workspace loaded`);
  }

  // 1.5 Parent
  {
    const jar = new CookieJar();
    const res = await login("parent@delhi-public.knowletive.com", "Admin@123", jar);
    record("Parent: Login Redirect", res.location === "/portal", `Redirects to ${res.location}`);

    const visit = await followRedirects("/portal", {}, jar);
    const hasChild = visit.response.text.includes("Aarav Sharma") && visit.response.text.includes("Delhi Public School");
    record("Parent: /portal Access & Child Profile", visit.finalUrl === "/portal" && hasChild, `Child Aarav Sharma rendered`);
  }

  // 1.6 Student
  {
    const jar = new CookieJar();
    const res = await login("student@delhi-public.knowletive.com", "Admin@123", jar);
    record("Student: Login Redirect", res.location === "/portal", `Redirects to ${res.location}`);

    const visit = await followRedirects("/portal", {}, jar);
    const hasStudentProfile = visit.response.text.includes("Aarav Sharma") && visit.response.text.includes("Student");
    record("Student: /portal Access & Own Profile", visit.finalUrl === "/portal" && hasStudentProfile, `Self profile rendered`);
  }

  // 2. Direct Route Protection (Server-Side Layout Authorization)
  console.log("\n--- 2. Direct Route Protection & Access Control ---");

  // 2.1 Platform Support accessing /portal
  {
    const jar = new CookieJar();
    await login("support@knowletive.com", "Admin@123", jar);
    const directPortal = await followRedirects("/portal", {}, jar);
    record("Platform Support -> /portal", directPortal.finalUrl === "/platform", `Redirected away from portal to ${directPortal.finalUrl}`);
  }

  // 2.2 Parent accessing /app
  {
    const jar = new CookieJar();
    await login("parent@delhi-public.knowletive.com", "Admin@123", jar);
    const directApp = await followRedirects("/app", {}, jar);
    record("Parent -> /app (Restricted to Staff)", directApp.finalUrl === "/portal", `Redirected away from /app to ${directApp.finalUrl}`);
  }

  // 2.3 Teacher accessing /platform
  {
    const jar = new CookieJar();
    await login("teacher@delhi-public.knowletive.com", "Admin@123", jar);
    const directPlatform = await followRedirects("/platform", {}, jar);
    const blocked = directPlatform.finalUrl.includes("/app") && directPlatform.finalUrl.includes("denied=page");
    record("Teacher -> /platform (Restricted to Platform)", blocked, `Redirected to ${directPlatform.finalUrl}`);
  }

  // 2.4 Parent accessing /platform
  {
    const jar = new CookieJar();
    await login("parent@delhi-public.knowletive.com", "Admin@123", jar);
    const directPlatform = await followRedirects("/platform", {}, jar);
    const blocked = directPlatform.finalUrl.includes("/portal") && directPlatform.finalUrl.includes("denied=page");
    record("Parent -> /platform (Restricted to Platform)", blocked, `Redirected to ${directPlatform.finalUrl}`);
  }

  // 2.5 Student attempting to access Staff routes (/app/students)
  {
    const jar = new CookieJar();
    await login("student@delhi-public.knowletive.com", "Admin@123", jar);
    const directStudents = await followRedirects("/app/students", {}, jar);
    record("Student -> /app/students (Staff Only)", directStudents.finalUrl === "/portal", `Redirected to ${directStudents.finalUrl}`);
  }

  // 2.6 Platform Owner accessing /app with no tenant selected
  {
    const jar = new CookieJar();
    await login("owner@knowletive.com", "Admin@123", jar);
    // Explicitly delete kl_tenant cookie to test unselected state
    jar.cookies.delete("kl_tenant");
    const directApp = await followRedirects("/app", {}, jar);
    record("Platform Owner -> /app (No Tenant Selected)", directApp.finalUrl === "/platform/institutes", `Redirected to ${directApp.finalUrl} to choose institute`);
  }

  // 2.7 Platform Owner accessing /app with tenant selected (Support View)
  {
    const jar = new CookieJar();
    await login("owner@knowletive.com", "Admin@123", jar);
    const dps = await prisma.tenant.findUnique({ where: { slug: "delhi-public" } });
    jar.set("kl_tenant", dps.id);

    const directApp = await followRedirects("/app", {}, jar);
    const hasSupportView = directApp.response.text.includes("Platform Owner") || directApp.response.text.includes("Delhi Public School");
    record("Platform Owner -> /app (Tenant Selected)", directApp.finalUrl === "/app" && hasSupportView, `Support view active for ${dps.name}`);
  }

  // 3. Multi-Institute Account Testing & Selection Gate
  console.log("\n--- 3. Multi-Institute Selection & Context Switching ---");

  const multiEmail = "multi-staff@knowletive.test";
  const unassignedEmail = "unassigned@knowletive.test";
  const dps = await prisma.tenant.findUnique({ where: { slug: "delhi-public" } });
  const sunrise = await prisma.tenant.findUnique({ where: { slug: "sunrise" } });
  const teacherRoleDps = await prisma.role.findFirst({ where: { tenantId: dps.id, key: "TEACHER" } });
  const teacherRoleSunrise = await prisma.role.findFirst({ where: { tenantId: sunrise.id, key: "TEACHER" } });

  const bcrypt = require("bcryptjs");
  const passwordHash = bcrypt.hashSync("Admin@123", 10);

  let multiUser = await prisma.user.findUnique({ where: { email: multiEmail } });

  if (!multiUser) {
    multiUser = await prisma.user.create({
      data: {
        email: multiEmail,
        name: "Multi-School Teacher",
        passwordHash,
        status: "ACTIVE",
        memberships: {
          create: [
            { tenantId: dps.id, roleId: teacherRoleDps.id, status: "ACTIVE" },
            { tenantId: sunrise.id, roleId: teacherRoleSunrise.id, status: "ACTIVE" },
          ],
        },
      },
    });
  } else {
    await prisma.user.update({
      where: { id: multiUser.id },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  let unassignedUser = await prisma.user.findUnique({ where: { email: unassignedEmail } });
  if (!unassignedUser) {
    unassignedUser = await prisma.user.create({
      data: {
        email: unassignedEmail,
        name: "Unassigned Test User",
        passwordHash,
        status: "ACTIVE",
      },
    });
  } else {
    await prisma.user.update({
      where: { id: unassignedUser.id },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  // 3.1 Multi-Institute Login with no prior cookie -> Redirects to /select-institute
  const multiJar = new CookieJar();
  {
    const res = await login(multiEmail, "Admin@123", multiJar);
    record("Multi-Institute User: Login Redirect", res.location === "/select-institute", `Redirects to ${res.location}`);

    const visit = await followRedirects("/select-institute", {}, multiJar);
    const hasBothSchools = visit.response.text.includes("Delhi Public School") && visit.response.text.includes("Sunrise Public School");
    record("Multi-Institute User: Selection Screen Shows Both Institutes", hasBothSchools, `Both workspaces rendered`);
  }

  // 3.2 Direct /app access without active tenant selection -> Redirects to /select-institute
  {
    multiJar.cookies.delete("kl_tenant");
    const res = await followRedirects("/app", {}, multiJar);
    record("Multi-Institute User: Direct /app without selection", res.finalUrl === "/select-institute", `Safely redirected to ${res.finalUrl}`);
  }

  // 3.3 Selecting Tenant A activates Tenant A workspace
  {
    multiJar.set("kl_tenant", dps.id);
    const res = await followRedirects("/app", {}, multiJar);
    const isDps = res.response.text.includes("Delhi Public School");
    record("Multi-Institute User: Tenant A Activated", res.finalUrl === "/app" && isDps, `Active workspace: Delhi Public School`);
  }

  // 3.4 Switching to Tenant B
  {
    multiJar.set("kl_tenant", sunrise.id);
    const res = await followRedirects("/app", {}, multiJar);
    const isSunrise = res.response.text.includes("Sunrise Public School");
    record("Multi-Institute User: Tenant B Switched", res.finalUrl === "/app" && isSunrise, `Active workspace switched to Sunrise Public School`);
  }

  // 3.5 Tampered / Stale Tenant Cookie -> Handled Safely
  {
    multiJar.set("kl_tenant", "fake_foreign_tenant_999999");
    const res = await followRedirects("/app", {}, multiJar);
    record("Multi-Institute User: Stale/Tampered Cookie", res.finalUrl === "/select-institute", `Stale cookie rejected, sent to ${res.finalUrl}`);
  }

  // 3.6 Single-Institute User with Stale Cookie -> Safely falls back to their 1 legitimate institute
  {
    const jar = new CookieJar();
    await login("teacher@delhi-public.knowletive.com", "Admin@123", jar);
    jar.set("kl_tenant", "stale_other_tenant_123");

    const res = await followRedirects("/app", {}, jar);
    const isDps = res.response.text.includes("Delhi Public School");
    record("Single-Institute User: Stale Cookie Fallback", res.finalUrl === "/app" && isDps, `Safely resolved single legitimate workspace`);
  }

  // 4. Parent & Student Data Scoping Verification
  console.log("\n--- 4. Parent & Student Scoping & Isolation ---");

  // 4.1 Parent cannot see children from other schools
  {
    const jar = new CookieJar();
    await login("parent@delhi-public.knowletive.com", "Admin@123", jar);
    const visit = await followRedirects("/portal", {}, jar);
    const hasDpsChild = visit.response.text.includes("Aarav Sharma");
    const hasOtherSchool = visit.response.text.includes("Sunrise Public School");
    record("Parent: Strict Tenant Scoping", hasDpsChild && !hasOtherSchool, `Only own school and child visible`);
  }

  // 4.2 Cross-Tenant Student Profile Access Attempt
  {
    const jar = new CookieJar();
    await login("student@delhi-public.knowletive.com", "Admin@123", jar);
    const sunriseStudent = await prisma.student.findFirst({ where: { tenantId: sunrise.id } });
    if (sunriseStudent) {
      const crossRes = await followRedirects(`/app/students/${sunriseStudent.id}`, {}, jar);
      record("Student: Cross-Tenant Student Profile Read Attempt", crossRes.finalUrl === "/portal", `Blocked and redirected to portal`);
    }
  }

  // 4.3 Unassigned User Access Attempt
  {
    const jar = new CookieJar();
    await login(unassignedEmail, "Admin@123", jar);
    const appVisit = await followRedirects("/app", {}, jar);
    const hasNoInstApp = appVisit.response.text.includes("No institute assigned yet");
    record("Unassigned User: Accessing /app", hasNoInstApp, `Renders 'No institute assigned yet' with Support link`);

    const portalVisit = await followRedirects("/portal", {}, jar);
    const hasNoInstPortal = portalVisit.response.text.includes("No institute assigned");
    record("Unassigned User: Accessing /portal", hasNoInstPortal, `Renders 'No institute assigned' with Sign out`);
  }

  console.log("\n==================================================================");
  const total = testResults.length;
  const passedCount = testResults.filter((r) => r.passed).length;
  const failedCount = total - passedCount;
  console.log(`TOTAL AUDIT CHECKS: ${total} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log("==================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAudit()
  .catch((e) => {
    console.error("FATAL AUDIT ERROR:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
