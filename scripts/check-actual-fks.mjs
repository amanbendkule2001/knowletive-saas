import fs from "fs";
const inv = JSON.parse(fs.readFileSync("scratch/original-db-inventory.json", "utf8"));

const tables = ["PaymentReceipt", "FeePayment", "PaymentCollectorRoute", "Lead", "PaymentAllocation", "CreditTransferJournal"];

for (const t of tables) {
  console.log(`\nTable ${t} FKs in knowletive:`);
  const fks = inv.foreignKeys.filter(f => f.table_name === t);
  for (const f of fks) {
    console.log(`  ${f.constraint_name}: ${f.column_name} -> ${f.foreign_table_name}(${f.foreign_column_name}) [del: ${f.delete_rule}, upd: ${f.update_rule}]`);
  }
}
