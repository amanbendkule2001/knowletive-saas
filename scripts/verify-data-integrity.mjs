import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasources: { db: { url: "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive?schema=public" } } });

async function main() {
  console.log("=== CHECKING DATA INTEGRITY & FOREIGN KEY READINESS ON KNOWLETIVE ===");

  // 1. Lead branch integrity
  const invalidLeads = await db.$queryRawUnsafe(`
    SELECT count(*)::text as c 
    FROM "Lead" l 
    WHERE l."branchId" IS NOT NULL 
      AND NOT EXISTS (
        SELECT 1 FROM "Branch" b 
        WHERE b."tenantId" = l."tenantId" AND b.id = l."branchId"
      );
  `);
  console.log(`Invalid (cross-tenant or orphan) Lead.branchId: ${invalidLeads[0].c}`);

  // 2. PaymentReceipt branch integrity
  const invalidReceipts = await db.$queryRawUnsafe(`
    SELECT count(*)::text as c 
    FROM "PaymentReceipt" r 
    WHERE r."branchId" IS NOT NULL 
      AND NOT EXISTS (
        SELECT 1 FROM "Branch" b 
        WHERE b."tenantId" = r."tenantId" AND b.id = r."branchId"
      );
  `);
  console.log(`Invalid (cross-tenant or orphan) PaymentReceipt.branchId: ${invalidReceipts[0].c}`);

  // 3. FeePayment branch integrity
  const invalidFeePayments = await db.$queryRawUnsafe(`
    SELECT count(*)::text as c 
    FROM "FeePayment" p 
    WHERE p."branchId" IS NOT NULL 
      AND NOT EXISTS (
        SELECT 1 FROM "Branch" b 
        WHERE b."tenantId" = p."tenantId" AND b.id = p."branchId"
      );
  `);
  console.log(`Invalid (cross-tenant or orphan) FeePayment.branchId: ${invalidFeePayments[0].c}`);

  // 4. PaymentAllocation branch integrity
  const invalidAllocations = await db.$queryRawUnsafe(`
    SELECT count(*)::text as c 
    FROM "PaymentAllocation" a 
    WHERE a."branchId" IS NOT NULL 
      AND NOT EXISTS (
        SELECT 1 FROM "Branch" b 
        WHERE b."tenantId" = a."tenantId" AND b.id = a."branchId"
      );
  `);
  console.log(`Invalid (cross-tenant or orphan) PaymentAllocation.branchId: ${invalidAllocations[0].c}`);

  // 5. CreditTransferJournal source/target branch integrity
  const invalidJournals = await db.$queryRawUnsafe(`
    SELECT count(*)::text as c 
    FROM "CreditTransferJournal" j 
    WHERE (j."sourceBranchId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Branch" b WHERE b."tenantId" = j."tenantId" AND b.id = j."sourceBranchId"
    )) OR (j."targetBranchId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Branch" b WHERE b."tenantId" = j."tenantId" AND b.id = j."targetBranchId"
    ));
  `);
  console.log(`Invalid (cross-tenant or orphan) CreditTransferJournal branch references: ${invalidJournals[0].c}`);

  // 6. PaymentCollectorRoute branch integrity & duplicate checks
  const invalidRoutes = await db.$queryRawUnsafe(`
    SELECT count(*)::text as c 
    FROM "PaymentCollectorRoute" r 
    WHERE r."branchId" IS NOT NULL 
      AND NOT EXISTS (
        SELECT 1 FROM "Branch" b 
        WHERE b."tenantId" = r."tenantId" AND b.id = r."branchId"
      );
  `);
  console.log(`Invalid (cross-tenant or orphan) PaymentCollectorRoute.branchId: ${invalidRoutes[0].c}`);

  const duplicateRoutes = await db.$queryRawUnsafe(`
    SELECT "tenantId", "branchId", provider, environment, "routingDiscriminator", count(*)::text as c
    FROM "PaymentCollectorRoute"
    GROUP BY "tenantId", "branchId", provider, environment, "routingDiscriminator"
    HAVING count(*) > 1;
  `);
  console.log(`Duplicate routes violating uq_pcr_branch_route_identity: ${duplicateRoutes.length}`);

  // 7. Branch hierarchy self-references
  const invalidParentBranches = await db.$queryRawUnsafe(`
    SELECT count(*)::text as c 
    FROM "Branch" b 
    WHERE b."parentBranchId" IS NOT NULL 
      AND NOT EXISTS (
        SELECT 1 FROM "Branch" p 
        WHERE p."tenantId" = b."tenantId" AND p.id = b."parentBranchId"
      );
  `);
  console.log(`Invalid (cross-tenant or orphan) Branch.parentBranchId: ${invalidParentBranches[0].c}`);

  console.log("\nData integrity check complete.");
}

main().catch(console.error).finally(() => db.$disconnect());
