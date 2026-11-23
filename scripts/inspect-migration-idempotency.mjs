import fs from "fs";
import path from "path";

const migrationsDir = path.resolve("prisma/migrations");
const entries = fs.readdirSync(migrationsDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort();

console.log("=== MIGRATION IDEMPOTENCY & PREREQUISITE ANALYSIS ===\n");

for (const dirName of entries) {
  const filePath = path.join(migrationsDir, dirName, "migration.sql");
  const sql = fs.readFileSync(filePath, "utf8");

  const bareCreateTables = [];
  const bareCreateTypes = [];
  const bareAddColumns = [];
  const bareAddConstraints = [];

  const lines = sql.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith("--")) continue;

    if (l.match(/^CREATE\s+TABLE\s+["']?\w+["']?/i) && !l.includes("IF NOT EXISTS")) {
      bareCreateTables.push(l.split("(")[0]);
    }
    if (l.match(/^CREATE\s+TYPE\s+["']?\w+["']?\s+AS\s+ENUM/i)) {
      // check if wrapped in DO $$ BEGIN ... EXCEPTION
      const preceding = lines.slice(Math.max(0, i - 4), i).join(" ");
      if (!preceding.includes("EXCEPTION") && !preceding.includes("DO $$")) {
        bareCreateTypes.push(l);
      }
    }
    if (l.match(/^ALTER\s+TABLE\s+["']?\w+["']?\s+ADD\s+COLUMN\s+["']?\w+["']?/i) && !l.includes("IF NOT EXISTS")) {
      bareAddColumns.push(l);
    }
  }

  console.log(`Migration: ${dirName}`);
  console.log(`  Bare CREATE TABLE (fails if table exists): ${bareCreateTables.length}`);
  if (bareCreateTables.length > 0) console.log(`    ${bareCreateTables.slice(0, 3).join(", ")}${bareCreateTables.length > 3 ? "..." : ""}`);
  console.log(`  Bare CREATE TYPE (fails if enum exists): ${bareCreateTypes.length}`);
  if (bareCreateTypes.length > 0) console.log(`    ${bareCreateTypes.join(", ")}`);
  console.log(`  Bare ADD COLUMN (fails if col exists): ${bareAddColumns.length}`);
}
