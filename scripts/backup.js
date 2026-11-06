const fs = require('fs');
const { execSync } = require('child_process');
const { URL } = require('url');

// Read .env directly
let dbUrl = process.env.DATABASE_URL;
if (!dbUrl && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
  if (match) dbUrl = match[1];
}

if (!dbUrl) {
  console.error('DATABASE_URL not found');
  process.exit(1);
}

const parsed = new URL(dbUrl);
if (!fs.existsSync('backups')) fs.mkdirSync('backups');
const dumpPath = 'backups/pre_stage1_backup.dump';

const env = { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) };
const cmd = `"C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe" -h ${parsed.hostname} -p ${parsed.port || '5432'} -U ${decodeURIComponent(parsed.username)} -F c -b -v -f "${dumpPath}" ${parsed.pathname.replace(/^\//, '')}`;

console.log('Running dump to:', dumpPath);
try {
  execSync(cmd, { env, stdio: 'inherit' });
  console.log('Dump completed successfully! Size:', fs.statSync(dumpPath).size, 'bytes');
} catch (err) {
  console.error('Backup failed:', err.message);
  process.exit(1);
}
