import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public'
    }
  }
});

async function main() {
  const dbMigrations = await prisma.$queryRawUnsafe('SELECT id, migration_name, checksum, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name ASC');
  console.log('Total records in _prisma_migrations:', dbMigrations.length);
  
  const migrationsDir = path.resolve('./prisma/migrations');
  const diskDirs = fs.readdirSync(migrationsDir)
    .filter(f => fs.statSync(path.join(migrationsDir, f)).isDirectory())
    .sort();
  
  console.log('Total migration directories on disk:', diskDirs.length);
  console.log('\n=== MIGRATION COMPARISON ===\n');
  const report = [];
  
  for (let i = 0; i < diskDirs.length; i++) {
    const dir = diskDirs[i];
    const sqlPath = path.join(migrationsDir, dir, 'migration.sql');
    const sqlExists = fs.existsSync(sqlPath);
    let diskChecksum = null;
    if (sqlExists) {
      const sqlContent = fs.readFileSync(sqlPath, 'utf8');
      diskChecksum = crypto.createHash('sha256').update(sqlContent).digest('hex');
    }
    
    const dbRecord = dbMigrations.find(m => m.migration_name === dir);
    
    report.push({
      step: i + 1,
      dir,
      sqlExists,
      diskChecksum,
      inDb: !!dbRecord,
      dbChecksum: dbRecord ? dbRecord.checksum : null,
      checksumMatch: dbRecord ? (dbRecord.checksum === diskChecksum) : false,
      finishedAt: dbRecord ? dbRecord.finished_at : null
    });
  }
  
  console.table(report.map(r => ({
    Step: r.step,
    Directory: r.dir,
    InDB: r.inDb,
    SQL: r.sqlExists,
    MatchesChecksum: r.checksumMatch,
    Finished: r.finishedAt ? 'YES' : 'NO'
  })));
  
  console.log('\nDetailed Checksums:');
  report.forEach(r => {
    console.log(`[${r.step}] ${r.dir}`);
    console.log(`   Disk SHA256: ${r.diskChecksum}`);
    console.log(`   DB   SHA256: ${r.dbChecksum}`);
    console.log(`   Match: ${r.checksumMatch ? 'PASS' : 'FAIL'}`);
  });
  
  // Also check if there are migrations in DB that are not on disk
  const notOnDisk = dbMigrations.filter(m => !diskDirs.includes(m.migration_name));
  if (notOnDisk.length > 0) {
    console.log('\nMIGRATIONS IN DB NOT FOUND ON DISK:');
    console.log(notOnDisk);
  } else {
    console.log('\nAll DB migrations are present on disk.');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
