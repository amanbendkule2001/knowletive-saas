import { spawn } from "node:child_process";

async function waitForServer(url, timeoutMs = 45000) {
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
  console.log("Starting Next.js dev server for Playwright verification...");
  const devServer = spawn("npm.cmd", ["run", "dev"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: true,
  });

  try {
    await waitForServer("http://localhost:3000/login");
    console.log("Next.js dev server ready! Running browser verification suite...");

    const testRunner = spawn("node", ["tests/browser-exams.mjs"], {
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
    console.log("Shutting down Next.js dev server...");
    // Kill dev server process tree
    if (devServer.pid) {
      spawn("taskkill", ["/pid", devServer.pid.toString(), "/f", "/t"]);
    }
  }
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});

