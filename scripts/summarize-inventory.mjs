import fs from "fs";

const data = JSON.parse(fs.readFileSync("scratch/original-db-inventory.json", "utf8"));

console.log("=== 1. Non-Empty Tables ===");
const nonEmpty = data.tableCounts.filter(t => t.count > 0).sort((a, b) => b.count - a.count);
for (const t of nonEmpty) {
  console.log(`  ${t.table}: ${t.count} rows (Owner: ${t.owner})`);
}

console.log("\n=== 2. Empty Tables (Count: " + data.tableCounts.filter(t => t.count === 0).length + ") ===");
const empty = data.tableCounts.filter(t => t.count === 0).map(t => t.table);
console.log(empty.join(", "));

console.log("\n=== 3. Critical Tables Column & FK Inspection ===");
const criticalTables = [
  "Branch", "Membership", "MembershipBranch", "PaymentReceipt", "FeePayment", 
  "PaymentAllocation", "CreditTransferJournal", "PaymentCollectorRoute", 
  "CopilotThread", "CopilotMessage", "WebhookEvent", "Student", "Lead"
];

for (const tableName of criticalTables) {
  const exists = data.tableCounts.some(t => t.table === tableName);
  if (!exists) {
    console.log(`\nTable ${tableName}: NOT FOUND IN DATABASE!`);
    continue;
  }
  const cols = data.columns.filter(c => c.table_name === tableName).map(c => `${c.column_name} (${c.udt_name}${c.is_nullable === 'YES' ? ', null' : ''})`);
  const fks = data.foreignKeys.filter(f => f.table_name === tableName).map(f => `${f.constraint_name}: ${f.column_name} -> ${f.foreign_table_name}(${f.foreign_column_name}) [ON DEL: ${f.delete_rule}, ON UPD: ${f.update_rule}]`);
  const uqs = data.uniqueConstraints.filter(u => u.table_name === tableName).map(u => `${u.constraint_name}: ${u.column_name}`);
  const chks = data.checkConstraints.filter(c => c.table_name === tableName).map(c => `${c.constraint_name}: ${c.check_clause}`);
  const idxs = data.indexes.filter(i => i.tablename === tableName).map(i => i.indexname);

  console.log(`\n--- Table: ${tableName} (Rows: ${data.tableCounts.find(t => t.table === tableName)?.count}) ---`);
  console.log(`  Columns (${cols.length}): ${cols.join(", ")}`);
  console.log(`  Foreign Keys (${fks.length}): \n    ${fks.join("\n    ")}`);
  console.log(`  Unique Constraints (${uqs.length}): ${uqs.join("; ")}`);
  console.log(`  Check Constraints (${chks.length}): ${chks.join("; ")}`);
  console.log(`  Indexes (${idxs.length}): ${idxs.join(", ")}`);
}

console.log("\n=== 4. Functions Inspection ===");
console.log("Functions present:", data.functions.map(f => f.proname).join(", "));

console.log("\n=== 5. Views Inspection ===");
console.log("Views present:", data.views.map(v => v.viewname).join(", "));
