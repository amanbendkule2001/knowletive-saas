import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('=== Testing Prisma 6.19.3 behavior with directUrl ===\n');

// 1. Create a minimal test schema with directUrl
const testSchemaDir = path.resolve('./prisma/scratch_test');
fs.mkdirSync(testSchemaDir, { recursive: true });

const schemaWithDirectUrl = `
generator client {
  provider = "prisma-client-js"
  output   = "./generated-client"
}

datasource db {
  provider  = "postgresql"
  url       = env("TEST_DATABASE_URL")
  directUrl = env("TEST_DIRECT_URL")
}

model TestItem {
  id String @id @default(uuid())
}
`;

const testSchemaPath = path.join(testSchemaDir, 'schema.prisma');
fs.writeFileSync(testSchemaPath, schemaWithDirectUrl, 'utf8');

// Test A: prisma validate with both env vars present
console.log('Test A: prisma validate with both TEST_DATABASE_URL and TEST_DIRECT_URL defined:');
try {
  const outA = execSync(`npx prisma validate --schema="${testSchemaPath}"`, {
    env: {
      ...process.env,
      TEST_DATABASE_URL: 'postgresql://knowletive:knowletive@127.0.0.1:5432/test?schema=public',
      TEST_DIRECT_URL: 'postgresql://knowletive:knowletive@127.0.0.1:5432/test?schema=public'
    },
    encoding: 'utf8'
  });
  console.log('Result A (Both defined): SUCCESS\n' + outA.trim());
} catch (err) {
  console.log('Result A FAILED:', err.message);
}

// Test B: prisma validate when TEST_DIRECT_URL is MISSING
console.log('\nTest B: prisma validate when TEST_DIRECT_URL is NOT defined in environment:');
try {
  const envCopy = { ...process.env };
  delete envCopy.TEST_DIRECT_URL;
  envCopy.TEST_DATABASE_URL = 'postgresql://knowletive:knowletive@127.0.0.1:5432/test?schema=public';
  
  const outB = execSync(`npx prisma validate --schema="${testSchemaPath}"`, {
    env: envCopy,
    encoding: 'utf8'
  });
  console.log('Result B: SUCCESS\n' + outB.trim());
} catch (err) {
  console.log('Result B (Missing TEST_DIRECT_URL): CAUGHT ERROR (As expected!):');
  console.log(err.stdout ? err.stdout.trim() : err.message);
}

// Clean up scratch test files
fs.rmSync(testSchemaDir, { recursive: true, force: true });
console.log('\nCleaned up scratch test directory.');
