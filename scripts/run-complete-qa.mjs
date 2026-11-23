import { spawn } from "node:child_process";

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // wait 1s before retry
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function main() {
  console.log("Starting Next.js server for Browser QA Verification on port 3000...");
  const devServer = spawn("npm.cmd", ["run", "dev"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: true,
  });

  try {
    await waitForServer("http://localhost:3000/login");
    console.log("Next.js server is responsive! Spawning Playwright QA test suite...");

    const testRunner = spawn("node", ["tests/browser-complete-qa.mjs"], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: true,
    });

    const exitCode = await new Promise((resolve) => {
      testRunner.on("close", resolve);
    });

    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    console.log("Shutting down Next.js server...");
    if (devServer.pid) {
      spawn("taskkill", ["/pid", devServer.pid.toString(), "/f", "/t"]);
    }
  }
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});

