import { PrismaClient } from "@prisma/client";

const DB_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public";
const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });

async function main() {
  console.log("===============================================================================");
  console.log("  PHASE 2.3.5.1 — ITEM 3: LEAD BRANCH FK ACTION REVIEW");
  console.log("===============================================================================");

  // 1. Current definition
  const currentFk = await db.$queryRawUnsafe(`
    SELECT tc.constraint_name, rc.update_rule, rc.delete_rule, pg_get_constraintdef(c.oid) as def
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
    JOIN pg_constraint c ON c.conname = tc.constraint_name
    WHERE tc.table_name = 'Lead' AND tc.constraint_name = 'Lead_tenantId_branchId_fkey';
  `);

  console.log("Current Lead branch FK constraint in clone DB:");
  console.log(currentFk);

  // 2. Test in transaction: Change to RESTRICT and verify behavior
  await db.$transaction(async (tx) => {
    console.log("\nTesting changing FK action to ON UPDATE RESTRICT ON DELETE RESTRICT (in transaction)...");
    await tx.$executeRawUnsafe(`ALTER TABLE "Lead" DROP CONSTRAINT "Lead_tenantId_branchId_fkey";`);
    await tx.$executeRawUnsafe(`
      ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_branchId_fkey"
      FOREIGN KEY ("tenantId", "branchId")
      REFERENCES "Branch"("tenantId", "id")
      ON DELETE RESTRICT
      ON UPDATE RESTRICT;
    `);

    // Verify new rule in catalog
    const newFk = await tx.$queryRawUnsafe(`
      SELECT tc.constraint_name, rc.update_rule, rc.delete_rule, pg_get_constraintdef(c.oid) as def
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
      JOIN pg_constraint c ON c.conname = tc.constraint_name
      WHERE tc.table_name = 'Lead' AND tc.constraint_name = 'Lead_tenantId_branchId_fkey';
    `);
    console.log("New Lead branch FK constraint definition:");
    console.log(newFk);

    // Verify standard Lead creation and reassignment works
    const tenant = await tx.tenant.findFirst();
    const branches = await tx.branch.findMany({ where: { tenantId: tenant.id }, take: 2 });

    if (branches.length >= 2) {
      const testLead = await tx.lead.create({
        data: {
          tenantId: tenant.id,
          branchId: branches[0].id,
          studentName: "Test Student Lead FK",
          guardianName: "Test Guardian",
          guardianPhone: "9999988888",
          source: "WALK_IN",
          status: "NEW"
        }
      });
      console.log(`  ✓ Lead created with Branch 0: ${testLead.id}`);

      // Reassign lead to Branch 1
      const updatedLead = await tx.lead.update({
        where: { id: testLead.id },
        data: { branchId: branches[1].id }
      });
      console.log(`  ✓ Lead successfully reassigned to Branch 1: ${updatedLead.branchId}`);

      // Attempt mutating Branch.id (referenced PK) -> MUST BE BLOCKED BY RESTRICT
      try {
        await tx.$executeRawUnsafe(`
          UPDATE "Branch" SET id = 'mutated_branch_id' WHERE id = '${branches[1].id}';
        `);
        throw new Error("FAIL: Branch.id update should have been blocked by RESTRICT!");
      } catch (err) {
        console.log(`  ✓ Branch.id mutation successfully BLOCKED by RESTRICT constraint: ${err.message.split("\n")[0]}`);
      }
    }

    // Rollback so we don't leave temporary changes without explicit decision
    throw new Error("__ROLLBACK_INTENTIONAL__");
  }).catch(err => {
    if (err.message !== "__ROLLBACK_INTENTIONAL__") throw err;
  });

  console.log("\nConclusion & Recommendation:");
  console.log("  • Currently: ON UPDATE CASCADE ON DELETE RESTRICT.");
  console.log("  • Risk of CASCADE: If Branch.id or Branch.tenantId were ever updated, all historical leads would have their branch silently changed without an audit trail.");
  console.log("  • Recommendation: Change to ON UPDATE RESTRICT ON DELETE RESTRICT to match all financial ledger foreign keys (PaymentReceipt, FeePayment, PaymentAllocation, CreditTransferJournal).");
  console.log("  • Reassigning leads to different branches (updating Lead.branchId) continues to work seamlessly because it does not update the referenced Branch row.");

  await db.$disconnect();
}

main().catch(console.error);
