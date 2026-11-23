import { PrismaClient } from "@prisma/client";

const CLONE_URL = "postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_restore_verify_20261121_172317?schema=public";
const db = new PrismaClient({ datasources: { db: { url: CLONE_URL } } });

async function main() {
  console.log("===============================================================================");
  console.log("  PHASE 2.3.5.1 — ITEM 2: PAYMENT COLLECTOR ROUTING VERIFICATION");
  console.log("===============================================================================");

  // 1. Fetch all routes
  const routes = await db.paymentCollectorRoute.findMany({
    orderBy: [{ tenantId: "asc" }, { collectorCode: "asc" }, { branchId: "asc" }],
    include: {
      branch: {
        select: {
          id: true,
          name: true,
          code: true,
          branchType: true,
          collectorCode: true,
          isActive: true
        }
      }
    }
  });

  console.log(`Total PaymentCollectorRoute records: ${routes.length}`);

  // 2. Fetch all PaymentProviderConfig records to cross-reference
  const configs = await db.paymentProviderConfig.findMany();
  console.log(`Total PaymentProviderConfig records: ${configs.length}`);

  const activeRoutes = routes.filter(r => r.isActive);
  const inactiveRoutes = routes.filter(r => !r.isActive);
  const quarantinedRoutes = routes.filter(r => r.provider === "UNVERIFIED" || (r.metadata && r.metadata.status === "AMBIGUOUS_MULTIPLE_CONFIGS"));

  console.log(`- Active routes:      ${activeRoutes.length}`);
  console.log(`- Inactive routes:    ${inactiveRoutes.length}`);
  console.log(`- Quarantined routes: ${quarantinedRoutes.length}`);

  // Group by collectorCode to see shared codes
  const byCode = new Map();
  for (const r of routes) {
    const key = `${r.tenantId}::${r.collectorCode}`;
    if (!byCode.has(key)) byCode.set(key, []);
    byCode.get(key).push(r);
  }

  const sharedCodes = Array.from(byCode.entries()).filter(([k, list]) => list.length > 1);
  console.log(`- Shared collector code clusters (more than 1 branch sharing same code): ${sharedCodes.length}`);

  for (const [key, list] of sharedCodes) {
    console.log(`\nShared Code Cluster: [${key}] (${list.length} routes)`);
    for (const r of list) {
      console.log(`   Route ID: ${r.id} | Branch: ${r.branch.name} (${r.branchId}) | Active: ${r.isActive} | Provider: ${r.provider} | Env: ${r.environment} | Disc: ${r.routingDiscriminator} | Meta: ${JSON.stringify(r.metadata)}`);
    }
  }

  console.log("\nFull Route Inventory Summary:");
  const routeTable = routes.map(r => ({
    id: r.id,
    tenantId: r.tenantId,
    branchName: r.branch?.name || "N/A",
    collectorCode: r.collectorCode,
    provider: r.provider,
    environment: r.environment,
    merchantId: r.merchantId,
    discriminator: r.routingDiscriminator,
    isActive: r.isActive,
    quarantined: r.provider === "UNVERIFIED"
  }));
  console.table(routeTable.slice(0, 40));

  // Cross reference with PaymentProviderConfig
  console.log("\nCross-referencing PaymentCollectorRoute with PaymentProviderConfig:");
  for (const r of routes) {
    const matchingConfigs = configs.filter(c => 
      c.tenantId === r.tenantId && 
      (c.branchId === r.branchId || (c.branchId === null && c.collectorCode === r.collectorCode))
    );
    if (matchingConfigs.length > 1) {
      console.log(`  ⚠️ Route ${r.id} (Branch: ${r.branchId}) matches ${matchingConfigs.length} configs -> Should be quarantined! (isActive: ${r.isActive}, provider: ${r.provider})`);
    } else if (matchingConfigs.length === 1) {
      const cfg = matchingConfigs[0];
      // Check if route matches config
      // Note: In migration 15, seeded routes default to 'DEMO' / 'DEMO'
    } else {
      // 0 matching configs
    }
  }

  // 3. Webhook routing simulation for ambiguous/shared codes
  console.log("\n--- SIMULATING WEBHOOK ROUTING FOR AMBIGUOUS / SHARED CODES ---");
  // Let's inspect src/lib/payment-routing.ts or where webhook routing is implemented
  await db.$disconnect();
}

main().catch(console.error);
