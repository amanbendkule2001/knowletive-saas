import fs from 'fs';

const inventory = JSON.parse(fs.readFileSync('scripts/rehearsal_functions_inventory.json', 'utf8'));

const targetNames = [
  'fn_assert_allocation_reversal_invariant',
  'fn_enforce_allocation_reversal_limit',
  'fn_enforce_allocation_same_student',
  'fn_enforce_credit_transfer_balanced',
  'fn_enforce_receipt_balance_conservation',
  'fn_enforce_transfer_posting_provenance',
  'fn_protect_invoice_student_reassignment'
];

targetNames.forEach((name, i) => {
  console.log(`\n================================================================`);
  console.log(`[${i + 1}] FUNCTION: ${name}`);
  console.log(`================================================================`);
  console.log(inventory[name]?.definition);
});
