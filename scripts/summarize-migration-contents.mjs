import fs from 'fs';
import path from 'path';

const migrationsDir = path.resolve('./prisma/migrations');
const dirs = fs.readdirSync(migrationsDir)
  .filter(f => fs.statSync(path.join(migrationsDir, f)).isDirectory())
  .sort();

const summary = [];

dirs.forEach((dir, idx) => {
  const sqlPath = path.join(migrationsDir, dir, 'migration.sql');
  const content = fs.readFileSync(sqlPath, 'utf8');
  
  // Extract key operations
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('--'));
  
  const creates = lines.filter(l => l.toUpperCase().startsWith('CREATE TABLE')).map(l => l.replace(/CREATE TABLE (IF NOT EXISTS )?/i, '').replace(/[(;].*/, '').trim());
  const alters = lines.filter(l => l.toUpperCase().startsWith('ALTER TABLE')).map(l => l.replace(/ALTER TABLE (ONLY )?/i, '').replace(/ .*/, '').trim());
  const uniqueAlters = [...new Set(alters)];
  const indexes = lines.filter(l => l.toUpperCase().includes('CREATE UNIQUE INDEX') || l.toUpperCase().includes('CREATE INDEX')).length;
  const fks = lines.filter(l => l.toUpperCase().includes('ADD CONSTRAINT') && l.toUpperCase().includes('FOREIGN KEY')).length;
  const updates = lines.filter(l => l.toUpperCase().startsWith('UPDATE ') || l.toUpperCase().startsWith('INSERT INTO ')).length;
  
  summary.push({
    index: idx + 1,
    name: dir,
    linesCount: lines.length,
    creates,
    alteredTables: uniqueAlters,
    indexesCount: indexes,
    fksCount: fks,
    dmlCount: updates
  });
});

console.log(JSON.stringify(summary, null, 2));
