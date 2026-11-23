import fs from "fs";

function redactUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const user = url.username;
    const host = url.hostname;
    const port = url.port;
    const pathname = url.pathname;
    const search = url.search;
    return `${url.protocol}//${user}:[REDACTED]@${host}:${port}${pathname}${search}`;
  } catch (e) {
    return "[MALFORMED OR NON-URL STRING]";
  }
}

function inspectEnvFile(filename) {
  if (!fs.existsSync(filename)) {
    console.log(`File ${filename} does not exist.`);
    return;
  }
  console.log(`\n=== Inspecting ${filename} (Secrets Redacted) ===`);
  const lines = fs.readFileSync(filename, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key.includes("DATABASE_URL") || key.includes("DB_URL") || key.includes("POSTGRES")) {
      console.log(`${key} = ${redactUrl(val)}`);
    } else {
      console.log(`${key} = [CONFIGURED, ${val.length} chars]`);
    }
  }
}

inspectEnvFile(".env");
inspectEnvFile(".env.example");
