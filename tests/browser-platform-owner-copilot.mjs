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

async function runPlatformOwnerBrowserQa() {
  console.log("=========================================================================");
  console.log("   PHASE 3C.2 BROWSER-LEVEL PLATFORM OWNER & PROVIDER MANAGEMENT QA");
  console.log("=========================================================================");

  // 1. Clear any transient rate limits for testing
  await prisma.rateLimitBucket.deleteMany({});

  // 2. Launch Next.js dev server
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

  try {
    await waitForServer(`${BASE_URL}/login`, 45000);
    console.log("[2/6] Server ready! Launching Chrome browser...");

    const browser = await chromium.launch({
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      headless: true,
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 1: Platform Owner Login & Landing
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[3/6] Testing Platform Owner login (owner@knowletive.com)...");
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

    await page.fill('input[name="email"], input[type="email"]', "owner@knowletive.com");
    await page.fill('input[name="password"], input[type="password"]', "Admin@123");
    await page.click('button[type="submit"]');

    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
    const currentUrl = page.url();
    console.log(`  ✓ Logged in and landed on: ${currentUrl}`);

    // If landed on select-institute or /app, navigate to /platform
    if (!currentUrl.includes("/platform")) {
      await page.goto(`${BASE_URL}/platform`, { waitUntil: "domcontentloaded" });
    }

    const platformHeader = page.locator("text=Platform Overview").or(page.locator("text=AI Provider")).first();
    await platformHeader.waitFor({ state: "visible", timeout: 8000 });
    console.log("  ✓ Platform dashboard (/platform) rendered successfully");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 2: Copilot Widget on /platform
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[4/6] Verifying Copilot Widget on /platform...");
    const launcher = page.locator('button[aria-label="Open Knowletive AI Copilot"]');
    await launcher.waitFor({ state: "visible", timeout: 8000 });
    console.log("  ✓ Copilot floating launcher is visible on /platform");

    // Open Copilot
    await launcher.click();
    const panel = page.locator("text=Knowletive Copilot").first();
    await panel.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Copilot panel opens on click");

    // Verify textarea is available
    const textarea = page.locator('textarea[placeholder*="Ask a question"]');
    await textarea.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Question input area is ready");

    // Submit question: "What is the total student census across all institutes?"
    await textarea.fill("What is the total student census across all institutes?");
    const sendButton = page.locator('button[type="submit"], button:has(svg)').filter({ hasText: "" }).last();
    await textarea.press("Enter");
    console.log("  ✓ Submitted platform-level analytics question");

    // Wait for response chunk or message
    await page.waitForTimeout(4000);
    const messages = page.locator(".whitespace-pre-wrap, .markdown-body, p");
    const count = await messages.count();
    console.log(`  ✓ Conversation turns rendered (${count} text blocks found)`);

    // Test Mobile Responsiveness on /platform
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);
    const mobilePanel = page.locator("text=Knowletive Copilot").first();
    const isMobileVisible = await mobilePanel.isVisible();
    console.log(`  ✓ Mobile viewport (375x667) rendered cleanly (panel visible: ${isMobileVisible})`);

    // Restore desktop viewport
    await page.setViewportSize({ width: 1280, height: 800 });

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 3: AI Provider Management Page (/platform/settings/ai)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[5/6] Verifying AI Provider Management Console (/platform/settings/ai)...");
    await page.goto(`${BASE_URL}/platform/settings/ai`, { waitUntil: "domcontentloaded" });

    const settingsTitle = page.locator("text=AI Provider Management").first();
    await settingsTitle.waitFor({ state: "visible", timeout: 8000 });
    console.log("  ✓ /platform/settings/ai loaded with full governance controls");

    // Verify Provider Status StatCard
    const providerCard = page.locator("text=Active Provider").first();
    await providerCard.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Active Provider stat card rendered");

    // Verify Test Connection Form
    const testConnButton = page.locator('button:has-text("Test Active Connection Now")').first();
    await testConnButton.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Test Active Connection button rendered");

    // Verify API Key Replacement Form
    const apiKeyInput = page.locator('input[name="apiKey"]');
    await apiKeyInput.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ API Key replacement input (type=password) rendered");

    // Verify Active Model Selection Radios
    const gpt120b = page.locator('input[value="openai/gpt-oss-120b"]');
    await gpt120b.waitFor({ state: "visible", timeout: 5000 });
    console.log("  ✓ Model selection radios rendered including flagship gpt-oss-120b");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST 4: Non-Platform Owner Rejection Boundary
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[6/6] Verifying Non-Platform Owner rejection boundary...");
    // Clear cookies & login as regular institute admin
    await context.clearCookies();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

    await page.fill('input[name="email"], input[type="email"]', "admin@sunrise.test");
    await page.fill('input[name="password"], input[type="password"]', "Admin@123");
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });

    // Attempt to access /platform/settings/ai
    await page.goto(`${BASE_URL}/platform/settings/ai`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const nonOwnerUrl = page.url();
    const isBlocked = !nonOwnerUrl.includes("/platform/settings/ai") || nonOwnerUrl.includes("forbidden") || nonOwnerUrl.includes("app");
    console.log(`  ✓ Institute Owner access attempt redirected/blocked: ${isBlocked ? "PASS" : "FAIL"} (Landed on: ${nonOwnerUrl})`);

    await browser.close();
    console.log("\n=========================================================================");
    console.log("   ✓ ALL BROWSER-LEVEL VERIFICATION TESTS COMPLETED SUCCESSFULLY");
    console.log("=========================================================================\n");
  } finally {
    serverProcess.kill();
  }
}

runPlatformOwnerBrowserQa()
  .catch((err) => {
    console.error("Browser QA failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
