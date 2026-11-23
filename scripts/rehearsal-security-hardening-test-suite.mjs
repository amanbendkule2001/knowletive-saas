/**
 * =============================================================================
 * Knowletive PostgreSQL 18 Security Hardening Test Suite
 * Target Database: knowletive_final_rehearsal_20261121_184300 (PostgreSQL 18.3)
 *
 * Test Modules:
 * - Test A: Temporary-Table Shadowing Proof-of-Concept & Hardened Resolution
 * - Test B: Normal Trigger Behavior (Positive & Negative Lifecycle Tests)
 * - Test C: Financial Integrity Regressions (All 13 Immutability Invariants)
 * - Test D: Permission Regressions (Least-Privilege Enforcement for knowletive_app)
 * =============================================================================
 */

import { PrismaClient } from "@prisma/client";

const DB_NAME = "knowletive_final_rehearsal_20261121_184300";
const ADMIN_URL = `postgresql://knowletive:knowletive@127.0.0.1:5432/${DB_NAME}?schema=public`;
const APP_URL = `postgresql://knowletive_app:knowletive_app@127.0.0.1:5432/${DB_NAME}?schema=public`;

const adminDb = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
const appDb = new PrismaClient({ datasources: { db: { url: APP_URL } } });

// Formatting Helpers
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function pass(msg) {
  console.log(`  ${ANSI.green}✓ PASS:${ANSI.reset} ${msg}`);
}

function fail(msg, err) {
  console.error(`  ${ANSI.red}✗ FAIL:${ANSI.reset} ${msg}`);
  if (err) console.error(`    ${ANSI.dim}${err.message || err}${ANSI.reset}`);
  throw new Error(`Test failed: ${msg}`);
}

function section(title) {
  console.log(`\n${ANSI.bold}${ANSI.cyan}===============================================================================`);
  console.log(`  ${title}`);
  console.log(`===============================================================================${ANSI.reset}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST A: Temporary-Table Shadowing Proof-of-Concept
// ─────────────────────────────────────────────────────────────────────────────
async function runTestA_TempTableShadowingPoC() {
  section("TEST A: Temporary-Table Shadowing Proof-of-Concept");

  const runId = Date.now();
  const tenantId = `tenant_poc_${runId}`;
  const student1Id = `stu_poc1_${runId}`;
  const student2Id = `stu_poc2_${runId}`;
  const invoiceId = `inv_poc_${runId}`;
  const receiptId = `rcpt_poc_${runId}`;
  const balanceId = `bal_poc_${runId}`;
  const allocId = `alloc_poc_${runId}`;

  console.log("1. Setting up clean public test fixtures...");
  await adminDb.$executeRawUnsafe(`
    INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt")
    VALUES ('${tenantId}', 'PoC Academy ${runId}', 'poc-academy-${runId}', 'ACTIVE', NOW());

    INSERT INTO "Student" ("id", "tenantId", "admissionNo", "firstName", "lastName", "updatedAt")
    VALUES ('${student1Id}', '${tenantId}', 'ADM-01-${runId}', 'Alice', 'Primary', NOW());

    INSERT INTO "Student" ("id", "tenantId", "admissionNo", "firstName", "lastName", "updatedAt")
    VALUES ('${student2Id}', '${tenantId}', 'ADM-02-${runId}', 'Bob', 'Counterparty', NOW());

    INSERT INTO "FeeInvoice" ("id", "tenantId", "studentId", "number", "title", "amount", "dueDate", "updatedAt")
    VALUES ('${invoiceId}', '${tenantId}', '${student1Id}', 'INV-${runId}', 'Tuition Fee', 100000, NOW() + INTERVAL '30 days', NOW());

    INSERT INTO "PaymentReceipt" ("id", "tenantId", "studentId", "receiptNumber", "amount", "method", "updatedAt")
    VALUES ('${receiptId}', '${tenantId}', '${student1Id}', 'RCPT-${runId}', 100000, 'CASH', NOW());

    INSERT INTO "PaymentReceiptBalance" ("id", "tenantId", "receiptId", "allocatedAmount", "unappliedAmount", "transferredOutAmount", "reservedRefundAmount", "refundedAmount", "updatedAt")
    VALUES ('${balanceId}', '${tenantId}', '${receiptId}', 100000, 0, 0, 0, 0, NOW());

    INSERT INTO "PaymentAllocation" ("id", "tenantId", "receiptId", "feeInvoiceId", "studentId", "amount", "createdAt")
    VALUES ('${allocId}', '${tenantId}', '${receiptId}', '${invoiceId}', '${student1Id}', 100000, NOW());
  `);
  pass("Public test rows seeded: FeeInvoice linked to PaymentAllocation for Student 1");

  console.log("\n2. Baseline check: Verify unshadowed trigger blocks invoice reassignment...");
  let baselineBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`
      UPDATE "FeeInvoice" SET "studentId" = '${student2Id}' WHERE "id" = '${invoiceId}';
    `);
  } catch (e) {
    if (e.message.includes("Cannot reassign FeeInvoice.studentId") || e.message.includes("P0001")) {
      baselineBlocked = true;
    }
  }
  if (!baselineBlocked) {
    fail("Baseline check failed: FeeInvoice student reassignment should have been blocked!");
  }
  pass("Baseline guard verified: Reassignment blocked because active PaymentAllocation exists");

  console.log("\n3. Executing Exploit: Creating temporary table to shadow 'PaymentAllocation'...");
  // In PostgreSQL, temporary tables (pg_temp) precede public in table lookup if unqualified
  await adminDb.$executeRawUnsafe(`
    CREATE TEMP TABLE "PaymentAllocation" (
      "feeInvoiceId" TEXT
    );
  `);
  pass("Temporary table pg_temp.\"PaymentAllocation\" created (empty)");

  console.log("\n4. Triggering vulnerable function while shadowed by empty temporary table...");
  let exploitSucceeded = false;
  try {
    await adminDb.$executeRawUnsafe(`
      UPDATE "FeeInvoice" SET "studentId" = '${student2Id}' WHERE "id" = '${invoiceId}';
    `);
    exploitSucceeded = true;
  } catch (e) {
    console.log(`    Caught error during exploit: ${e.message}`);
  }

  const [afterExploitInvoice] = await adminDb.$queryRawUnsafe(`
    SELECT "studentId" FROM "FeeInvoice" WHERE "id" = '${invoiceId}';
  `);

  if (afterExploitInvoice.studentId === student2Id) {
    console.log(`  ${ANSI.yellow}⚠ VULNERABILITY CONFIRMED:${ANSI.reset} Trigger queried pg_temp.\"PaymentAllocation\" instead of public.\"PaymentAllocation\"!`);
    console.log(`    Invoice student reassigned to ${student2Id} despite 100,000 paise active allocation in public table.`);
  } else {
    console.log("  Notice: Trigger was not bypassed. Checking function definition...");
  }

  console.log("\n5. Applying Hardened Function (Explicit public schema qualification & search_path)...");
  await adminDb.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION public.fn_protect_invoice_student_reassignment()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      IF NEW."studentId" IS DISTINCT FROM OLD."studentId" THEN
        IF EXISTS (
          SELECT 1 FROM public."PaymentAllocation"
          WHERE "feeInvoiceId" = OLD.id
        ) THEN
          RAISE EXCEPTION 'Cannot reassign FeeInvoice.studentId (from % to %) because active PaymentAllocation records exist on invoice %',
            OLD."studentId", NEW."studentId", OLD.id
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  pass("Hardened function installed: forced 'public.\"PaymentAllocation\"' and fixed search_path");

  // Reset invoice student back to student1
  await adminDb.$executeRawUnsafe(`
    UPDATE "FeeInvoice" SET "studentId" = '${student1Id}' WHERE "id" = '${invoiceId}';
  `);

  console.log("\n6. Verifying exploit is neutralized with temporary table still present...");
  let exploitBlockedByHardening = false;
  try {
    await adminDb.$executeRawUnsafe(`
      UPDATE "FeeInvoice" SET "studentId" = '${student2Id}' WHERE "id" = '${invoiceId}';
    `);
  } catch (e) {
    if (e.message.includes("Cannot reassign FeeInvoice.studentId") || e.message.includes("P0001")) {
      exploitBlockedByHardening = true;
    }
  }

  if (!exploitBlockedByHardening) {
    fail("Hardening failed: Exploit was still able to bypass reassignment guard!");
  }
  pass("Exploit blocked: Hardened function resolved public.\"PaymentAllocation\" and rejected update with P0001");

  console.log("\n7. Cleaning up temporary table and test fixtures...");
  await adminDb.$executeRawUnsafe(`DROP TABLE IF EXISTS pg_temp."PaymentAllocation";`);
  await adminDb.$executeRawUnsafe(`
    DELETE FROM "PaymentAllocation" WHERE "id" = '${allocId}';
    DELETE FROM "PaymentReceiptBalance" WHERE "id" = '${balanceId}';
    DELETE FROM "PaymentReceipt" WHERE "id" = '${receiptId}';
    DELETE FROM "FeeInvoice" WHERE "id" = '${invoiceId}';
    DELETE FROM "Student" WHERE "id" IN ('${student1Id}', '${student2Id}');
    DELETE FROM "Tenant" WHERE "id" = '${tenantId}';
  `);
  pass("Test A cleanup complete.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST B: Normal Trigger Behavior
// ─────────────────────────────────────────────────────────────────────────────
async function runTestB_NormalTriggerBehavior() {
  section("TEST B: Normal Trigger Behavior (Positive & Negative Operations)");

  const runId = Date.now();
  const tenantId = `tenant_tb_${runId}`;
  const studentId = `stu_tb_${runId}`;
  const student2Id = `stu_tb2_${runId}`;
  const invoiceId = `inv_tb_${runId}`;
  const receiptId = `rcpt_tb_${runId}`;
  const balanceId = `bal_tb_${runId}`;
  const allocId = `alloc_tb_${runId}`;

  await adminDb.$executeRawUnsafe(`
    INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt")
    VALUES ('${tenantId}', 'Test B Academy', 'test-b-${runId}', 'ACTIVE', NOW());

    INSERT INTO "Student" ("id", "tenantId", "admissionNo", "firstName", "lastName", "updatedAt")
    VALUES ('${studentId}', '${tenantId}', 'ADM-B1-${runId}', 'Carol', 'Student', NOW()),
           ('${student2Id}', '${tenantId}', 'ADM-B2-${runId}', 'Dave', 'Student', NOW());

    INSERT INTO "FeeInvoice" ("id", "tenantId", "studentId", "number", "title", "amount", "dueDate", "updatedAt")
    VALUES ('${invoiceId}', '${tenantId}', '${studentId}', 'INV-B-${runId}', 'Fee', 50000, NOW() + INTERVAL '30 days', NOW());

    INSERT INTO "PaymentReceipt" ("id", "tenantId", "studentId", "receiptNumber", "amount", "method", "updatedAt")
    VALUES ('${receiptId}', '${tenantId}', '${studentId}', 'RCPT-B-${runId}', 50000, 'CASH', NOW());

    INSERT INTO "PaymentReceiptBalance" ("id", "tenantId", "receiptId", "allocatedAmount", "unappliedAmount", "transferredOutAmount", "reservedRefundAmount", "refundedAmount", "updatedAt")
    VALUES ('${balanceId}', '${tenantId}', '${receiptId}', 50000, 0, 0, 0, 0, NOW());

    INSERT INTO "PaymentAllocation" ("id", "tenantId", "receiptId", "feeInvoiceId", "studentId", "amount", "createdAt")
    VALUES ('${allocId}', '${tenantId}', '${receiptId}', '${invoiceId}', '${studentId}', 50000, NOW());
  `);

  // B.1 Invoice reassignment without allocations (Positive)
  console.log("\nB.1 Testing invoice reassignment on unallocated invoice (Positive)...");
  const cleanInvoiceId = `inv_clean_${runId}`;
  await adminDb.$executeRawUnsafe(`
    INSERT INTO "FeeInvoice" ("id", "tenantId", "studentId", "number", "title", "amount", "dueDate", "updatedAt")
    VALUES ('${cleanInvoiceId}', '${tenantId}', '${studentId}', 'INV-CLEAN-${runId}', 'Unallocated Fee', 20000, NOW(), NOW());
  `);
  await adminDb.$executeRawUnsafe(`
    UPDATE "FeeInvoice" SET "studentId" = '${student2Id}' WHERE "id" = '${cleanInvoiceId}';
  `);
  const [cleanInv] = await adminDb.$queryRawUnsafe(`SELECT "studentId" FROM "FeeInvoice" WHERE "id" = '${cleanInvoiceId}';`);
  if (cleanInv.studentId !== student2Id) fail("Unallocated invoice reassignment should succeed!");
  pass("Positive: Unallocated FeeInvoice successfully reassigned to another student");

  // B.2 Allocation Reversals: Valid reversal amount (Positive)
  console.log("\nB.2 Testing valid partial allocation reversal (Positive)...");
  const reversal1Id = `rev1_${runId}`;
  await adminDb.$executeRawUnsafe(`
    INSERT INTO "PaymentAllocationReversal" ("id", "tenantId", "originalAllocationId", "amount", "reason", "reversedBy", "createdAt")
    VALUES ('${reversal1Id}', '${tenantId}', '${allocId}', 20000, 'Partial refund', 'Admin', NOW());
  `);
  pass("Positive: Valid partial reversal of 20,000 paise on 50,000 paise allocation succeeded");

  // B.3 Allocation Reversals: Cumulative exceeds allocation (Negative - 23514)
  console.log("\nB.3 Testing cumulative reversal exceeding allocation (Negative)...");
  let exceedBlocked = false;
  try {
    // Current reversed = 20,000. Allocation = 50,000. Attempting 40,000 (total = 60,000 > 50,000)
    await adminDb.$executeRawUnsafe(`
      INSERT INTO "PaymentAllocationReversal" ("id", "tenantId", "originalAllocationId", "amount", "reason", "reversedBy", "createdAt")
      VALUES ('rev_exceed_${runId}', '${tenantId}', '${allocId}', 40000, 'Excess refund', 'Admin', NOW());
    `);
  } catch (e) {
    if (e.message.includes("23514") || e.message.includes("exceeds original allocation amount")) {
      exceedBlocked = true;
    }
  }
  if (!exceedBlocked) fail("Cumulative reversal exceeding allocation amount should have failed with 23514!");
  pass("Negative: Reversal exceeding allocation rejected with SQLSTATE 23514 (check_violation)");

  // B.4 Allocation Reversals: Zero or negative amount (Negative - 23514)
  console.log("\nB.4 Testing non-positive reversal amount (Negative)...");
  let nonPositiveBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`
      INSERT INTO "PaymentAllocationReversal" ("id", "tenantId", "originalAllocationId", "amount", "reason", "reversedBy", "createdAt")
      VALUES ('rev_neg_${runId}', '${tenantId}', '${allocId}', -100, 'Negative refund', 'Admin', NOW());
    `);
  } catch (e) {
    if (e.message.includes("23514") || e.message.includes("Reversal amount must be positive")) {
      nonPositiveBlocked = true;
    }
  }
  if (!nonPositiveBlocked) fail("Negative reversal amount should have failed with 23514!");
  pass("Negative: Negative reversal amount rejected with SQLSTATE 23514");

  // B.5 Credit Transfer Request Lifecycle (Positive & Negative)
  console.log("\nB.5 Testing CreditTransferRequest lifecycle transitions...");
  const reqId = `req_${runId}`;
  await adminDb.$executeRawUnsafe(`
    INSERT INTO "CreditTransferRequest" ("id", "tenantId", "sourceStudentId", "targetStudentId", "amount", "requestNumber", "status", "updatedAt")
    VALUES ('${reqId}', '${tenantId}', '${studentId}', '${student2Id}', 10000, 'REQ-${runId}', 'PENDING_APPROVAL', NOW());
  `);
  // Transition PENDING_APPROVAL -> APPROVED
  await adminDb.$executeRawUnsafe(`UPDATE "CreditTransferRequest" SET "status" = 'APPROVED' WHERE "id" = '${reqId}';`);
  // Transition APPROVED -> EXECUTED
  await adminDb.$executeRawUnsafe(`UPDATE "CreditTransferRequest" SET "status" = 'EXECUTED' WHERE "id" = '${reqId}';`);
  pass("Positive: Valid lifecycle transitions PENDING_APPROVAL -> APPROVED -> EXECUTED succeeded");

  // Attempt transition from terminal state EXECUTED -> PENDING_APPROVAL (Negative - P0001)
  let terminalBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`UPDATE "CreditTransferRequest" SET "status" = 'PENDING_APPROVAL' WHERE "id" = '${reqId}';`);
  } catch (e) {
    if (e.message.includes("terminal state") || e.message.includes("P0001")) {
      terminalBlocked = true;
    }
  }
  if (!terminalBlocked) fail("Terminal status transition should have failed with P0001!");
  pass("Negative: Transition from terminal state EXECUTED rejected with SQLSTATE P0001");

  // Attempt mutation of immutable core fields on request (Negative - P0001)
  let immutableFieldBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`UPDATE "CreditTransferRequest" SET "amount" = 99999 WHERE "id" = '${reqId}';`);
  } catch (e) {
    if (e.message.includes("Core request parameters") || e.message.includes("P0001")) {
      immutableFieldBlocked = true;
    }
  }
  if (!immutableFieldBlocked) fail("Mutating core amount on CreditTransferRequest should have failed with P0001!");
  pass("Negative: Mutating immutable amount rejected with SQLSTATE P0001");

  // Cleanup Test B
  await adminDb.$executeRawUnsafe(`
    DELETE FROM "CreditTransferRequest" WHERE "id" = '${reqId}';
    DELETE FROM "PaymentAllocationReversal" WHERE "id" = '${reversal1Id}';
    DELETE FROM "PaymentAllocation" WHERE "id" = '${allocId}';
    DELETE FROM "PaymentReceiptBalance" WHERE "id" = '${balanceId}';
    DELETE FROM "PaymentReceipt" WHERE "id" = '${receiptId}';
    DELETE FROM "FeeInvoice" WHERE "id" IN ('${invoiceId}', '${cleanInvoiceId}');
    DELETE FROM "Student" WHERE "id" IN ('${studentId}', '${student2Id}');
    DELETE FROM "Tenant" WHERE "id" = '${tenantId}';
  `);
  pass("Test B cleanup complete.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST C: Financial Integrity Regressions (All 13 Invariants)
// ─────────────────────────────────────────────────────────────────────────────
async function runTestC_FinancialIntegrityRegressions() {
  section("TEST C: Financial Integrity Regressions (13 Core Invariants)");

  const runId = Date.now();
  const tenantId = `tenant_tc_${runId}`;
  const student1Id = `stu_c1_${runId}`;
  const student2Id = `stu_c2_${runId}`;
  const receiptId = `rcpt_c_${runId}`;
  const balanceId = `bal_c_${runId}`;
  const invoiceId = `inv_c_${runId}`;
  const allocId = `alloc_c_${runId}`;

  // Seed base records
  await adminDb.$executeRawUnsafe(`
    INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt")
    VALUES ('${tenantId}', 'Test C Academy', 'test-c-${runId}', 'ACTIVE', NOW());

    INSERT INTO "Student" ("id", "tenantId", "admissionNo", "firstName", "lastName", "updatedAt")
    VALUES ('${student1Id}', '${tenantId}', 'ADM-C1-${runId}', 'Eve', 'Alpha', NOW()),
           ('${student2Id}', '${tenantId}', 'ADM-C2-${runId}', 'Frank', 'Beta', NOW());

    INSERT INTO "FeeInvoice" ("id", "tenantId", "studentId", "number", "title", "amount", "dueDate", "updatedAt")
    VALUES ('${invoiceId}', '${tenantId}', '${student1Id}', 'INV-C-${runId}', 'Term Fee', 100000, NOW(), NOW());

    INSERT INTO "PaymentReceipt" ("id", "tenantId", "studentId", "receiptNumber", "amount", "method", "updatedAt")
    VALUES ('${receiptId}', '${tenantId}', '${student1Id}', 'RCPT-C-${runId}', 100000, 'UPI', NOW());

    INSERT INTO "PaymentReceiptBalance" ("id", "tenantId", "receiptId", "allocatedAmount", "unappliedAmount", "transferredOutAmount", "reservedRefundAmount", "refundedAmount", "updatedAt")
    VALUES ('${balanceId}', '${tenantId}', '${receiptId}', 100000, 0, 0, 0, 0, NOW());

    INSERT INTO "PaymentAllocation" ("id", "tenantId", "receiptId", "feeInvoiceId", "studentId", "amount", "createdAt")
    VALUES ('${allocId}', '${tenantId}', '${receiptId}', '${invoiceId}', '${student1Id}', 100000, NOW());
  `);

  // 1. Immutable Payment Receipts
  console.log("\n1. Testing Invariant 1: Immutable PaymentReceipt...");
  let rcptUpdateBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`UPDATE "PaymentReceipt" SET "amount" = 200000 WHERE "id" = '${receiptId}';`);
  } catch (e) {
    if (e.message.includes("immutable financial events") || e.message.includes("P0001")) rcptUpdateBlocked = true;
  }
  if (!rcptUpdateBlocked) fail("PaymentReceipt UPDATE should be blocked by trigger!");
  pass("Invariant 1a: PaymentReceipt UPDATE blocked with SQLSTATE P0001");

  let rcptDeleteBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`DELETE FROM "PaymentReceipt" WHERE "id" = '${receiptId}';`);
  } catch (e) {
    if (e.message.includes("immutable financial events") || e.message.includes("P0001")) rcptDeleteBlocked = true;
  }
  if (!rcptDeleteBlocked) fail("PaymentReceipt DELETE should be blocked by trigger!");
  pass("Invariant 1b: PaymentReceipt DELETE blocked with SQLSTATE P0001");

  // 2. Immutable Payment Allocations
  console.log("\n2. Testing Invariant 2: Immutable PaymentAllocation...");
  let allocUpdateBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`UPDATE "PaymentAllocation" SET "amount" = 50000 WHERE "id" = '${allocId}';`);
  } catch (e) {
    if (e.message.includes("immutable financial events") || e.message.includes("P0001")) allocUpdateBlocked = true;
  }
  if (!allocUpdateBlocked) fail("PaymentAllocation UPDATE should be blocked by trigger!");
  pass("Invariant 2a: PaymentAllocation UPDATE blocked with SQLSTATE P0001");

  let allocDeleteBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`DELETE FROM "PaymentAllocation" WHERE "id" = '${allocId}';`);
  } catch (e) {
    if (e.message.includes("immutable financial events") || e.message.includes("P0001")) allocDeleteBlocked = true;
  }
  if (!allocDeleteBlocked) fail("PaymentAllocation DELETE should be blocked by trigger!");
  pass("Invariant 2b: PaymentAllocation DELETE blocked with SQLSTATE P0001");

  // 3. Allocation Reversal Bounds
  console.log("\n3. Testing Invariant 3: Allocation Reversal Bounds...");
  let revExceedBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`
      INSERT INTO "PaymentAllocationReversal" ("id", "tenantId", "originalAllocationId", "amount", "reason", "reversedBy", "createdAt")
      VALUES ('rev_c_excess_${runId}', '${tenantId}', '${allocId}', 100001, 'Exceeds by 1 paise', 'Admin', NOW());
    `);
  } catch (e) {
    if (e.message.includes("23514") || e.message.includes("exceeds original allocation amount")) revExceedBlocked = true;
  }
  if (!revExceedBlocked) fail("Reversal exceeding allocation must fail with 23514!");
  pass("Invariant 3: Allocation reversal bounds enforced (SQLSTATE 23514)");

  // 4. Receipt Balance Conservation
  console.log("\n4. Testing Invariant 4: Receipt Balance Conservation...");
  let conservationBlocked = false;
  try {
    // Attempt to corrupt balance sum in deferred transaction: allocated(100,000) + unapplied(50,000) != gross(100,000)
    await adminDb.$executeRawUnsafe(`
      UPDATE "PaymentReceiptBalance" SET "unappliedAmount" = 50000 WHERE "id" = '${balanceId}';
    `);
  } catch (e) {
    if (e.message.includes("Conservation violation") || e.message.includes("P0001")) conservationBlocked = true;
  }
  if (!conservationBlocked) fail("Balance conservation violation must fail with P0001!");
  pass("Invariant 4: Balance conservation enforced (gross == sum of components, SQLSTATE P0001)");

  // 5. Credit Transfer Balancing
  console.log("\n5. Testing Invariant 5: Credit Transfer Balancing (Debits == Credits == Amount)...");
  const journalId = `ctj_${runId}`;
  await adminDb.$executeRawUnsafe(`
    INSERT INTO "CreditTransferJournal" ("id", "tenantId", "transferNumber", "sourceStudentId", "targetStudentId", "amount", "status", "sourceReceiptId", "createdAt")
    VALUES ('${journalId}', '${tenantId}', 'TR-${runId}', '${student1Id}', '${student2Id}', 10000, 'PENDING', '${receiptId}', NOW());
  `);

  let unbalanceBlocked = false;
  try {
    // Mark COMPLETED without balanced postings
    await adminDb.$executeRawUnsafe(`
      UPDATE "CreditTransferJournal" SET "status" = 'COMPLETED' WHERE "id" = '${journalId}';
    `);
  } catch (e) {
    if (e.message.includes("Double-entry balance violation") || e.message.includes("P0001")) unbalanceBlocked = true;
  }
  if (!unbalanceBlocked) fail("Unbalanced completed transfer journal must fail with P0001!");
  pass("Invariant 5: Double-entry credit transfer balance enforced (SQLSTATE P0001)");

  // 6. Transfer Provenance and Credit Account Integrity
  console.log("\n6. Testing Invariant 6: Transfer Posting Provenance...");
  let provenanceBlocked = false;
  try {
    // Attempt posting with rogue receipt that doesn't match journal source receipt
    await adminDb.$executeRawUnsafe(`
      INSERT INTO "CreditTransferPosting" ("id", "tenantId", "journalId", "receiptId", "studentId", "counterpartyStudentId", "entryType", "amount", "createdAt")
      VALUES ('post_bad_${runId}', '${tenantId}', '${journalId}', 'rogue_receipt_id_999', '${student1Id}', '${student2Id}', 'DEBIT', 10000, NOW());
    `);
  } catch (e) {
    if (e.message.includes("Provenance violation") || e.message.includes("P0001")) provenanceBlocked = true;
  }
  if (!provenanceBlocked) fail("Posting with rogue receipt must fail provenance check!");
  pass("Invariant 6: Transfer posting receipt provenance enforced (SQLSTATE P0001)");

  // 7. Guardian Consent Immutability
  console.log("\n7. Testing Invariant 7: Guardian Consent Event Immutability...");
  const consentId = `gc_${runId}`;
  const consentEvtId = `gce_${runId}`;
  await adminDb.$executeRawUnsafe(`
    INSERT INTO "Guardian" ("id", "tenantId", "name", "phone", "updatedAt")
    VALUES ('g_${runId}', '${tenantId}', 'Parent G', '9876543210', NOW());

    INSERT INTO "GuardianConsent" ("id", "tenantId", "guardianId", "studentId", "status", "consentType", "updatedAt")
    VALUES ('${consentId}', '${tenantId}', 'g_${runId}', '${student1Id}', 'GRANTED', 'FINANCIAL_CREDIT_TRANSFER', NOW());

    INSERT INTO "GuardianConsentEvent" ("id", "tenantId", "consentId", "eventType", "actorType", "actorId", "createdAt")
    VALUES ('${consentEvtId}', '${tenantId}', '${consentId}', 'CONSENT_GRANTED', 'GUARDIAN', 'g_${runId}', NOW());
  `);

  let gceUpdateBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`UPDATE "GuardianConsentEvent" SET "eventType" = 'MODIFIED' WHERE "id" = '${consentEvtId}';`);
  } catch (e) {
    if (e.message.includes("immutable audit logs") || e.message.includes("P0001")) gceUpdateBlocked = true;
  }
  if (!gceUpdateBlocked) fail("GuardianConsentEvent UPDATE must be blocked!");
  pass("Invariant 7: GuardianConsentEvent immutability enforced (SQLSTATE P0001)");

  // 8. Branch Ledger Immutability
  console.log("\n8. Testing Invariant 8: Branch Ledger Immutability...");
  const branchId = `br_${runId}`;
  const ledgerId = `ble_${runId}`;
  await adminDb.$executeRawUnsafe(`
    INSERT INTO "Branch" ("id", "tenantId", "name", "code", "branchType", "updatedAt")
    VALUES ('${branchId}', '${tenantId}', 'Campus ${runId}', 'BR-${runId}', 'MAIN', NOW());

    INSERT INTO "BranchLedgerEntry" ("id", "tenantId", "branchId", "entryType", "amount", "runningBalance", "entryNumber", "createdAt")
    VALUES ('${ledgerId}', '${tenantId}', '${branchId}', 'CREDIT_SETTLEMENT', 50000, 50000, 1, NOW());
  `);

  let bleUpdateBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`UPDATE "BranchLedgerEntry" SET "amount" = 99999 WHERE "id" = '${ledgerId}';`);
  } catch (e) {
    if (e.message.includes("immutable financial ledger entries") || e.message.includes("P0001")) bleUpdateBlocked = true;
  }
  if (!bleUpdateBlocked) fail("BranchLedgerEntry UPDATE must be blocked!");
  pass("Invariant 8: BranchLedgerEntry immutability enforced (SQLSTATE P0001)");

  // 9. Student Credit Account Identity & Deletion Guard
  console.log("\n9. Testing Invariant 9: Student Credit Account Identity...");
  const scaId = `sca_${runId}`;
  await adminDb.$executeRawUnsafe(`
    INSERT INTO "StudentCreditAccount" ("id", "tenantId", "studentId", "balance", "transferredIn", "transferredOut", "allocatedIn", "updatedAt")
    VALUES ('${scaId}', '${tenantId}', '${student1Id}', 50000, 50000, 0, 0, NOW());
  `);

  let scaIdentityBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`UPDATE "StudentCreditAccount" SET "studentId" = '${student2Id}' WHERE "id" = '${scaId}';`);
  } catch (e) {
    if (e.message.includes("Identity mutation prohibited") || e.message.includes("P0001")) scaIdentityBlocked = true;
  }
  if (!scaIdentityBlocked) fail("StudentCreditAccount studentId alteration must be blocked!");

  let scaDeleteBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`DELETE FROM "StudentCreditAccount" WHERE "id" = '${scaId}';`);
  } catch (e) {
    if (e.message.includes("Cannot delete StudentCreditAccount") || e.message.includes("P0001")) scaDeleteBlocked = true;
  }
  if (!scaDeleteBlocked) fail("StudentCreditAccount DELETE with active balance must be blocked!");
  pass("Invariant 9: StudentCreditAccount identity mutation & deletion guards enforced (SQLSTATE P0001)");

  // 10. Invoice Student Reassignment
  console.log("\n10. Testing Invariant 10: Invoice Reassignment Guard...");
  let invReassignBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`UPDATE "FeeInvoice" SET "studentId" = '${student2Id}' WHERE "id" = '${invoiceId}';`);
  } catch (e) {
    if (e.message.includes("Cannot reassign FeeInvoice.studentId") || e.message.includes("P0001")) invReassignBlocked = true;
  }
  if (!invReassignBlocked) fail("FeeInvoice reassignment with active allocations must be blocked!");
  pass("Invariant 10: FeeInvoice reassignment restricted while allocations exist (SQLSTATE P0001)");

  // 11. Exam Snapshot & Revision Immutability
  console.log("\n11. Testing Invariant 11: Exam Snapshot & Revision Immutability...");
  const examId = `exam_${runId}`;
  const examRevId = `emr_${runId}`;
  await adminDb.$executeRawUnsafe(`
    INSERT INTO "Examination" ("id", "tenantId", "title", "code", "term", "academicYear", "startDate", "endDate", "updatedAt")
    VALUES ('${examId}', '${tenantId}', 'Finals', 'EX-${runId}', 'Term 1', '2026', NOW(), NOW(), NOW());

    INSERT INTO "ExamMarksRevisionEvent" ("id", "tenantId", "examId", "studentId", "subjectId", "previousMarks", "revisedMarks", "reason", "revisedByUserId", "createdAt")
    VALUES ('${examRevId}', '${tenantId}', '${examId}', '${student1Id}', 'sub_dummy', 80, 85, 'Recount', 'u_admin', NOW());
  `);

  let emrUpdateBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`UPDATE "ExamMarksRevisionEvent" SET "revisedMarks" = 100 WHERE "id" = '${examRevId}';`);
  } catch (e) {
    if (e.message.includes("immutable audit logs") || e.message.includes("P0001")) emrUpdateBlocked = true;
  }
  if (!emrUpdateBlocked) fail("ExamMarksRevisionEvent UPDATE must be blocked!");
  pass("Invariant 11: ExamMarksRevisionEvent immutability enforced (SQLSTATE P0001)");

  // 12. Batch Enrollment Event Immutability
  console.log("\n12. Testing Invariant 12: Batch Enrollment Event Immutability...");
  const batchId = `batch_${runId}`;
  const batchEvtId = `bee_${runId}`;
  await adminDb.$executeRawUnsafe(`
    INSERT INTO "Batch" ("id", "tenantId", "name", "capacity", "startDate", "updatedAt")
    VALUES ('${batchId}', '${tenantId}', 'Batch Alpha', 30, NOW(), NOW());

    INSERT INTO "BatchEnrollmentEvent" ("id", "tenantId", "batchId", "studentId", "eventType", "reason", "actorId", "createdAt")
    VALUES ('${batchEvtId}', '${tenantId}', '${batchId}', '${student1Id}', 'ENROLLED', 'Initial admission', 'u_admin', NOW());
  `);

  let beeUpdateBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`UPDATE "BatchEnrollmentEvent" SET "eventType" = 'UNENROLLED' WHERE "id" = '${batchEvtId}';`);
  } catch (e) {
    if (e.message.includes("immutable and cannot be updated") || e.message.includes("P0001")) beeUpdateBlocked = true;
  }
  if (!beeUpdateBlocked) fail("BatchEnrollmentEvent UPDATE must be blocked!");
  pass("Invariant 12: BatchEnrollmentEvent immutability enforced");

  // 13. Syllabus Progress Event Immutability
  console.log("\n13. Testing Invariant 13: Syllabus Progress Event Immutability...");
  const trackId = `track_${runId}`;
  const sylEvtId = `spe_${runId}`;
  await adminDb.$executeRawUnsafe(`
    INSERT INTO "SyllabusTrack" ("id", "tenantId", "title", "subjectName", "updatedAt")
    VALUES ('${trackId}', '${tenantId}', 'Math Track', 'Mathematics', NOW());

    INSERT INTO "SyllabusProgressEvent" ("id", "tenantId", "trackId", "eventType", "actorId", "createdAt")
    VALUES ('${sylEvtId}', '${tenantId}', '${trackId}', 'TOPIC_COMPLETED', 'u_teacher', NOW());
  `);

  let speUpdateBlocked = false;
  try {
    await adminDb.$executeRawUnsafe(`UPDATE "SyllabusProgressEvent" SET "eventType" = 'REOPENED' WHERE "id" = '${sylEvtId}';`);
  } catch (e) {
    if (e.message.includes("immutable and cannot be updated") || e.message.includes("P0001")) speUpdateBlocked = true;
  }
  if (!speUpdateBlocked) fail("SyllabusProgressEvent UPDATE must be blocked!");
  pass("Invariant 13: SyllabusProgressEvent immutability enforced (SQLSTATE P0001)");

  // Cleanup Test C
  await adminDb.$executeRawUnsafe(`
    DELETE FROM "SyllabusProgressEvent" WHERE "id" = '${sylEvtId}';
    DELETE FROM "SyllabusTrack" WHERE "id" = '${trackId}';
    DELETE FROM "BatchEnrollmentEvent" WHERE "id" = '${batchEvtId}';
    DELETE FROM "Batch" WHERE "id" = '${batchId}';
    DELETE FROM "ExamMarksRevisionEvent" WHERE "id" = '${examRevId}';
    DELETE FROM "Examination" WHERE "id" = '${examId}';
    DELETE FROM "StudentCreditAccount" WHERE "id" = '${scaId}';
    DELETE FROM "BranchLedgerEntry" WHERE "id" = '${ledgerId}';
    DELETE FROM "Branch" WHERE "id" = '${branchId}';
    DELETE FROM "GuardianConsentEvent" WHERE "id" = '${consentEvtId}';
    DELETE FROM "GuardianConsent" WHERE "id" = '${consentId}';
    DELETE FROM "Guardian" WHERE "id" = 'g_${runId}';
    DELETE FROM "CreditTransferJournal" WHERE "id" = '${journalId}';
    DELETE FROM "PaymentAllocation" WHERE "id" = '${allocId}';
    DELETE FROM "PaymentReceiptBalance" WHERE "id" = '${balanceId}';
    DELETE FROM "PaymentReceipt" WHERE "id" = '${receiptId}';
    DELETE FROM "FeeInvoice" WHERE "id" = '${invoiceId}';
    DELETE FROM "Student" WHERE "id" IN ('${student1Id}', '${student2Id}');
    DELETE FROM "Tenant" WHERE "id" = '${tenantId}';
  `);
  pass("Test C cleanup complete.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST D: Permission Regressions (Least-Privilege Role Hardening)
// ─────────────────────────────────────────────────────────────────────────────
async function runTestD_PermissionRegressions() {
  section("TEST D: Permission Regressions (Least-Privilege for knowletive_app)");

  console.log("1. Checking knowletive_app Role Attributes in pg_roles...");
  const [role] = await adminDb.$queryRawUnsafe(`
    SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls
    FROM pg_roles
    WHERE rolname = 'knowletive_app';
  `);
  if (!role) fail("Role 'knowletive_app' does not exist in database!");
  if (role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolbypassrls) {
    fail("Role 'knowletive_app' has administrative privileges! (Must be strictly unprivileged)");
  }
  pass("Role attributes verified: rolsuper=false, rolcreatedb=false, rolcreaterole=false, rolbypassrls=false");

  console.log("\n2. Checking runtime role cannot CREATE TABLE in schema public...");
  let tableCreateBlocked = false;
  try {
    await appDb.$executeRawUnsafe(`CREATE TABLE public.evil_table_test (id text);`);
  } catch (e) {
    if (e.message.includes("permission denied") || e.message.includes("42501")) tableCreateBlocked = true;
  }
  if (!tableCreateBlocked) fail("knowletive_app was able to CREATE TABLE in schema public!");
  pass("Blocked: CREATE TABLE rejected with SQLSTATE 42501 (insufficient_privilege)");

  console.log("\n3. Checking runtime role cannot CREATE SCHEMA...");
  let schemaCreateBlocked = false;
  try {
    await appDb.$executeRawUnsafe(`CREATE SCHEMA evil_schema_test;`);
  } catch (e) {
    if (e.message.includes("permission denied") || e.message.includes("42501")) schemaCreateBlocked = true;
  }
  if (!schemaCreateBlocked) fail("knowletive_app was able to CREATE SCHEMA!");
  pass("Blocked: CREATE SCHEMA rejected with SQLSTATE 42501");

  console.log("\n4. Checking runtime role cannot CREATE TRIGGER...");
  let triggerCreateBlocked = false;
  try {
    await appDb.$executeRawUnsafe(`
      CREATE TRIGGER evil_trg BEFORE INSERT ON "Student" FOR EACH ROW EXECUTE FUNCTION fn_protect_payment_receipt_immutability();
    `);
  } catch (e) {
    if (e.message.includes("must be owner") || e.message.includes("permission denied") || e.message.includes("42501")) {
      triggerCreateBlocked = true;
    }
  }
  if (!triggerCreateBlocked) fail("knowletive_app was able to CREATE TRIGGER!");
  pass("Blocked: CREATE TRIGGER rejected with SQLSTATE 42501 (must be table owner)");

  console.log("\n5. Checking runtime role cannot ALTER or DROP FUNCTIONS...");
  let alterFunctionBlocked = false;
  try {
    await appDb.$executeRawUnsafe(`
      ALTER FUNCTION public.fn_get_effective_branch_id(text, text, text, text) OWNER TO knowletive_app;
    `);
  } catch (e) {
    if (e.message.includes("must be owner") || e.message.includes("permission denied") || e.message.includes("42501")) {
      alterFunctionBlocked = true;
    }
  }
  if (!alterFunctionBlocked) fail("knowletive_app was able to ALTER FUNCTION!");
  pass("Blocked: ALTER FUNCTION rejected with SQLSTATE 42501 (must be function owner)");

  console.log("\n6. Checking runtime role cannot TRUNCATE tables...");
  let truncateBlocked = false;
  try {
    await appDb.$executeRawUnsafe(`TRUNCATE TABLE "Student";`);
  } catch (e) {
    if (e.message.includes("permission denied") || e.message.includes("42501")) truncateBlocked = true;
  }
  if (!truncateBlocked) fail("knowletive_app was able to TRUNCATE TABLE!");
  pass("Blocked: TRUNCATE TABLE rejected with SQLSTATE 42501");

  console.log("\n7. Checking runtime role cannot UPDATE or DELETE on immutable tables...");
  const immutableTestTables = [
    "PaymentReceipt",
    "FeePayment",
    "PaymentAllocation",
    "PaymentAllocationReversal",
    "CreditTransferJournal",
    "CreditTransferPosting",
    "BranchLedgerEntry",
    "AuditLog"
  ];

  for (const tbl of immutableTestTables) {
    let updateDenied = false;
    let deleteDenied = false;
    try {
      await appDb.$executeRawUnsafe(`UPDATE "${tbl}" SET id = id WHERE false;`);
    } catch (e) {
      if (e.message.includes("42501") || e.message.includes("permission denied")) updateDenied = true;
    }

    try {
      await appDb.$executeRawUnsafe(`DELETE FROM "${tbl}" WHERE false;`);
    } catch (e) {
      if (e.message.includes("42501") || e.message.includes("permission denied")) deleteDenied = true;
    }

    if (!updateDenied || !deleteDenied) {
      fail(`knowletive_app was permitted UPDATE or DELETE on immutable table '${tbl}'!`);
    }
    pass(`Table ${tbl}: UPDATE and DELETE strictly DENIED (SQLSTATE 42501)`);
  }

  pass("Test D completed successfully.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Test Runner
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${ANSI.bold}===============================================================================`);
  console.log(`  KNOWLETIVE POSTGRESQL 18 SECURITY HARDENING REPRODUCIBLE TEST SUITE`);
  console.log(`  Target: ${DB_NAME}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`===============================================================================${ANSI.reset}`);

  try {
    await runTestA_TempTableShadowingPoC();
    await runTestB_NormalTriggerBehavior();
    await runTestC_FinancialIntegrityRegressions();
    await runTestD_PermissionRegressions();

    console.log(`\n${ANSI.bold}${ANSI.green}===============================================================================`);
    console.log(`  ALL TEST MODULES (A, B, C, D) PASSED CLEANLY WITH ZERO REGRESSIONS!`);
    console.log(`===============================================================================${ANSI.reset}\n`);
  } catch (err) {
    console.error(`\n${ANSI.bold}${ANSI.red}===============================================================================`);
    console.error(`  TEST RUN TERMINATED ON FAILURE: ${err.message}`);
    console.error(`===============================================================================${ANSI.reset}\n`);
    process.exit(1);
  } finally {
    await adminDb.$disconnect();
    await appDb.$disconnect();
  }
}

main();
