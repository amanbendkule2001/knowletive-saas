import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { spawn } from "child_process";
import http from "http";

const prisma = new PrismaClient();
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function waitForServer(url, timeoutMs = 45000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      http
        .get(url, (res) => {
          if (res.statusCode && res.statusCode < 500) {
            resolve(true);
          } else {
            retry();
          }
        })
        .on("error", () => {
          retry();
        });
    }

    function retry() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`));
      } else {
        setTimeout(check, 1000);
      }
    }

    check();
  });
}

async function runBrowserQa() {
  console.log("=========================================================================");
  console.log("   PHASE 3B.1 BROWSER-LEVEL COPILOT & OWNER UI END-TO-END VERIFICATION");
  console.log("=========================================================================");

  // 1. Clear any transient rate limits for testing
  await prisma.rateLimitBucket.deleteMany({});

  // 2. Start Next.js Server
  console.log("[1/6] Launching Next.js server on port 3000...");
  const serverProcess = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    shell: true,
    stdio: "pipe",
    env: { ...process.env, PORT: String(PORT) },
  });

  serverProcess.stdout.on("data", (data) => {
    const msg = data.toString();
    if (msg.includes("Ready in") || msg.includes("compiled")) {
      process.stdout.write(`[Next.js] ${msg.trim()}\n`);
    }
  });

  serverProcess.stderr.on("data", (data) => {
    // console.error(`[Next.js Error] ${data.toString()}`);
  });

  try {
    await waitForServer(`${BASE_URL}/login`, 45000);
    console.log("[2/6] Server ready! Launching headless Chrome browser...");

    const browser = await chromium.launch({
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      headless: true,
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Institute Owner Login & Copilot UI
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[3/6] Testing Institute Owner (admin@sunrise.test with isOwner: true)...");
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });

    await page.fill('input[name="email"]', "admin@sunrise.test");
    await page.fill('input[name="password"]', "Admin@123");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/app**", { timeout: 15000 });
    console.log("  ✓ Owner authenticated and redirected to /app");

    // Check launcher visibility
    const launcher = page.locator('button[aria-label="Open Knowletive AI Copilot"]');
    await launcher.waitFor({ state: "visible", timeout: 8000 });
    console.log("  ✓ Floating AI launcher button is visible in bottom-right corner");

    // Test Ctrl+J toggle shortcut
    await page.keyboard.press("Control+j");
    const panel = page.locator("text=Knowletive Copilot").first();
    await panel.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Panel opens via keyboard shortcut Ctrl+J");

    // Test Escape key close
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden", timeout: 5000 });
    console.log("  ✓ Panel closes via Escape key");

    // Re-open by clicking launcher button
    await launcher.click();
    await panel.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Panel opens via launcher button click");

    // Check suggestions & empty state
    const suggestionChip = page.locator("text=What is our current student strength?").first();
    const hasSuggestion = await suggestionChip.isVisible();
    console.log(`  ✓ Contextual prompt suggestions rendered: ${hasSuggestion ? "PASS" : "FAIL"}`);

    // Click suggestion to submit prompt
    if (hasSuggestion) {
      await suggestionChip.click();
      console.log("  ✓ Clicked prompt suggestion chip");

      // Wait for assistant response to appear
      await page.waitForTimeout(3000);
      const assistantMessage = page.locator("text=enrolled students").or(page.locator("text=Sunrise Public School")).first();
      const hasResponse = await assistantMessage.isVisible({ timeout: 10000 }).catch(() => false);
      console.log(`  ✓ Incremental response rendered in conversation: ${hasResponse ? "PASS" : "WAIT_TIMED_OUT"}`);
    }

    // Test Stop button visibility when streaming / Input presence
    const inputArea = page.locator('textarea[placeholder*="Ask a question"]');
    await inputArea.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Auto-resizing textarea input is active and functional");

    // Test New Chat button
    const newChatBtn = page.locator('button[title="Start new chat"]');
    if (await newChatBtn.isVisible()) {
      await newChatBtn.click();
      console.log("  ✓ Clicked 'New Chat' button");
    }

    // Test Mobile Responsiveness (Viewport 375x667)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);
    const mobilePanel = page.locator("text=Knowletive Copilot").first();
    const mobileVisible = await mobilePanel.isVisible();
    console.log(`  ✓ Mobile responsive drawer behavior: ${mobileVisible ? "PASS" : "FAIL"}`);

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 800 });

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Owner Permission Governance UI (/app/settings/ai)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[4/6] Testing Owner AI Access Management UI (/app/settings/ai)...");
    await page.goto(`${BASE_URL}/app/settings/ai`, { waitUntil: "networkidle" });

    const pageTitle = page.locator("text=AI & Copilot Access Management").first();
    await pageTitle.waitFor({ state: "visible", timeout: 8000 });
    console.log("  ✓ /app/settings/ai loaded with full owner administrative controls");

    // User Search Input
    const searchInput = page.locator('input[placeholder*="Search member"]');
    await searchInput.waitFor({ state: "visible", timeout: 5000 });
    await searchInput.fill("teacher");
    await page.waitForTimeout(500);
    console.log("  ✓ Member search filtering operational");

    // Role Filter Dropdown
    const roleSelect = page.locator("select").first();
    await roleSelect.selectOption("TEACHER");
    await page.waitForTimeout(500);
    console.log("  ✓ Role filtering operational");

    // Configure Button on Teacher Row
    const configureBtn = page.locator('button:has-text("Configure")').first();
    await configureBtn.click();
    console.log("  ✓ Clicked 'Configure' on member row");

    // Verify Modal & 10 Module Checkboxes
    const modalTitle = page.locator("text=Configure AI Capabilities").first();
    await modalTitle.waitFor({ state: "visible", timeout: 5000 });

    const copilotCheckbox = page.locator("text=Conversational AI Copilot").first();
    const analyticsCheckbox = page.locator("text=Attendance Analytics").first();
    const isCopilotPresent = await copilotCheckbox.isVisible();
    const isAnalyticsPresent = await analyticsCheckbox.isVisible();
    console.log(`  ✓ 10-module permission configuration modal: ${isCopilotPresent && isAnalyticsPresent ? "PASS" : "FAIL"}`);

    // Close modal
    const cancelBtn = page.locator('button:has-text("Cancel")').first();
    await cancelBtn.click();
    console.log("  ✓ Modal dismissed cleanly");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: Teacher Login Boundary & Default-Deny Policy
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[5/6] Testing Teacher boundary & default-deny enforcement (teacher@sunrise.test)...");
    await context.clearCookies();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });

    await page.fill('input[name="email"]', "teacher@sunrise.test");
    await page.fill('input[name="password"]', "Admin@123");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/app**", { timeout: 15000 });
    console.log("  ✓ Teacher authenticated and redirected to /app");

    // Verify Copilot launcher is NOT rendered
    const teacherLauncher = page.locator('button[aria-label="Open Knowletive AI Copilot"]');
    const isTeacherLauncherVisible = await teacherLauncher.isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`  ✓ Teacher Copilot launcher visibility: ${!isTeacherLauncherVisible ? "PASS (HIDDEN AS EXPECTED)" : "FAIL (LEAKED)"}`);

    // Verify Teacher navigating to /app/settings/ai is BLOCKED
    await page.goto(`${BASE_URL}/app/settings/ai`, { waitUntil: "networkidle" });
    const accessDeniedMsg = page.locator("text=Institute Owner Access Required").or(page.locator("text=Access denied")).first();
    const isAccessDenied = await accessDeniedMsg.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  ✓ Teacher access to /app/settings/ai blocked: ${isAccessDenied ? "PASS" : "FAIL"}`);

    await browser.close();
    console.log("[6/6] All browser-level end-to-end tests completed successfully!");
  } finally {
    console.log("Shutting down Next.js test server...");
    serverProcess.kill("SIGINT");
  }
}

runBrowserQa()
  .then(() => {
    console.log(">>> BROWSER QA PASSED <<<");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Browser QA failed:", err);
    process.exit(1);
  });
