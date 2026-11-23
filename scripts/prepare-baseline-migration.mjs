import fs from 'fs';

let content = fs.readFileSync('backups/baseline_schema.sql', 'utf8');
let lines = content.split('\n');
lines = lines.filter(line => !line.trim().startsWith('\\'));
content = lines.join('\n');
content = content.replace(
  "SELECT pg_catalog.set_config('search_path', '', false);",
  "SET search_path TO public;"
);

const dir = 'prisma/migrations/20261101000000_baseline_schema';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(dir + '/migration.sql', content);
console.log('Successfully wrote sanitized baseline migration to', dir + '/migration.sql');
