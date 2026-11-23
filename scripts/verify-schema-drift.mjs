import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

const DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://knowletive:knowletive@localhost:5432/knowletive_restore_verify_20261121_172317?schema=public";

console.log("==================================================");
console.log("  Knowletive Schema Drift & Invariants Verifier   ");
console.log("==================================================");
console.log(`Connecting to: ${DB_URL}`);

const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });

async function verifyCatalogInvariants() {
  console.log("\n1. Verifying PostgreSQL-Native Catalog Invariants...");

  // 1.1 Verify PaymentCollectorRoute indexes
  const pcrIndexes = await db.$queryRaw`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'PaymentCollectorRoute'
  `;

  const indexNames = pcrIndexes.map((i) => i.indexname);
  console.log(`- Found ${indexNames.length} indexes on PaymentCollectorRoute: ${indexNames.join(", ")}`);

  const identityIndex = pcrIndexes.find((i) => i.indexname === "uq_pcr_branch_route_identity");
  if (!identityIndex) {
    throw new Error("Missing required unique index: uq_pcr_branch_route_identity");
  }
  if (!identityIndex.indexdef.includes("NULLS NOT DISTINCT")) {
    throw new Error("uq_pcr_branch_route_identity does not enforce NULLS NOT DISTINCT semantics");
  }
  console.log("  ✓ uq_pcr_branch_route_identity verified (NULLS NOT DISTINCT)");

  const discIndex = pcrIndexes.find((i) => i.indexname === "uq_pcr_explicit_discriminator");
  if (!discIndex) {
    throw new Error("Missing required unique index: uq_pcr_explicit_discriminator");
  }
  if (!discIndex.indexdef.includes("routingDiscriminator") || !discIndex.indexdef.includes("IS NOT NULL")) {
    throw new Error("uq_pcr_explicit_discriminator does not have expected partial WHERE clause");
  }
  console.log("  ✓ uq_pcr_explicit_discriminator verified (Partial unique WHERE routingDiscriminator IS NOT NULL)");

  // 1.2 Verify effective views security_invoker = true
  const views = await db.$queryRaw`
    SELECT c.relname, c.reloptions
    FROM pg_class c
    WHERE c.relname IN ('v_effective_fee_payment', 'v_effective_payment_receipt', 'v_effective_payment_allocation')
  `;

  for (const v of views) {
    const opts = v.reloptions || [];
    if (!opts.includes("security_invoker=true")) {
      throw new Error(`View ${v.relname} does not have security_invoker=true`);
    }
    console.log(`  ✓ View ${v.relname} verified (security_invoker=true)`);
  }

  // 1.3 Verify fn_get_effective_branch_id security
  const funcs = await db.$queryRaw`
    SELECT p.proname, p.prosecdef, p.proconfig
    FROM pg_proc p
    WHERE p.proname = 'fn_get_effective_branch_id'
  `;
  if (funcs.length === 0) {
    throw new Error("Function fn_get_effective_branch_id does not exist");
  }
  const f = funcs[0];
  if (f.prosecdef !== false) {
    throw new Error("fn_get_effective_branch_id should be SECURITY INVOKER (prosecdef=false)");
  }
  const cfg = f.proconfig || [];
  if (!cfg.some((c) => c.includes("search_path=public, pg_temp"))) {
    throw new Error("fn_get_effective_branch_id does not have safe search_path configuration");
  }
  console.log("  ✓ Function fn_get_effective_branch_id verified (SECURITY INVOKER, fixed safe search_path)");

  // 1.4 Verify composite foreign keys ON UPDATE RESTRICT
  const fkConstraints = await db.$queryRaw`
    SELECT tc.table_name, tc.constraint_name, rc.update_rule, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc 
      ON tc.constraint_name = rc.constraint_name
    WHERE tc.constraint_name IN (
      'PaymentAllocation_tenantId_branchId_fkey',
      'CreditTransferJournal_tenantId_sourceBranchId_fkey',
      'CreditTransferJournal_tenantId_targetBranchId_fkey',
      'BranchReconciliationAudit_tenantId_previousBranchId_fkey',
      'BranchReconciliationAudit_tenantId_newBranchId_fkey',
      'Branch_tenantId_parentBranchId_fkey',
      'PaymentReceipt_tenantId_branchId_fkey',
      'FeePayment_tenantId_branchId_fkey',
      'PaymentCollectorRoute_tenantId_branchId_fkey'
    )
  `;

  for (const fk of fkConstraints) {
    if (fk.update_rule !== "RESTRICT" || fk.delete_rule !== "RESTRICT") {
      throw new Error(
        `Constraint ${fk.constraint_name} has invalid rules (update: ${fk.update_rule}, delete: ${fk.delete_rule}). Expected RESTRICT/RESTRICT.`
      );
    }
  }
  console.log(`  ✓ All ${fkConstraints.length} critical financial/branch foreign keys verified (RESTRICT / RESTRICT)`);
}

async function verifyPrismaDriftAllowlist() {
  console.log("\n2. Running Prisma Migrate Diff against strict allowlist...");

  let diffOutput = "";
  try {
    diffOutput = execSync(
      `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url "${DB_URL}" --exit-code`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (err) {
    // Exit code 2 indicates differences found
    diffOutput = (err.stdout || "") + (err.stderr || "");
  }

  // Parse lines from diff output
  const lines = diffOutput
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  console.log(`Diff output contains ${lines.length} lines.`);

  // Explicit, tightly scoped allowlist of verified intentional differences:
  // ONLY lines matching exact documented architectural patterns are permitted.
  // NO catch-all wildcards ([+] Added, [-] Removed, etc.) are allowed.
  const STRICT_ALLOWLIST_PATTERNS = [
    // 1. Table header markers
    /^\s*\[\*\] Changed the `(Branch|BranchReconciliationAudit|MembershipBranch|PaymentCollectorRoute)` table\s*$/,
    // 2. Branch: PostgreSQL composite index for shared collector code acceleration (Migration 15)
    /^\s*\[\+\] Added index on columns \(tenantId, collectorCode\)\s*$/,
    // 3. BranchReconciliationAudit: PostgreSQL tenant-scoped indexes for audit trail lookup (Migration 14)
    /^\s*\[\+\] Added index on columns \(tenantId\)\s*$/,
    /^\s*\[\+\] Added index on columns \(tenantId, newBranchId\)\s*$/,
    /^\s*\[\+\] Added index on columns \(tenantId, reconciledById\)\s*$/,
    // 4. MembershipBranch: PostgreSQL tenant-scoped indexes for RBAC scope resolution (Migration 14)
    /^\s*\[\+\] Added index on columns \(tenantId, scopeMode\)\s*$/,
    // 5. PaymentCollectorRoute: PostgreSQL 15+ NULLS NOT DISTINCT composite identity index (Migration 16)
    /^\s*\[\+\] Added unique index on columns \(tenantId, branchId, provider, environment, collectorCode, merchantId, routingDiscriminator\)\s*$/,
  ];

  const unexpectedLines = [];
  for (const line of lines) {
    const isAllowed = STRICT_ALLOWLIST_PATTERNS.some((pattern) => pattern.test(line));
    if (!isAllowed) {
      unexpectedLines.push(line);
    }
  }

  if (unexpectedLines.length > 0) {
    console.error("❌ UNEXPECTED SCHEMA DRIFT DETECTED:");
    for (const u of unexpectedLines) {
      console.error(`   ${u}`);
    }
    throw new Error(`Verification failed: ${unexpectedLines.length} unexpected schema drift items found.`);
  }

  console.log("  ✓ All migration diff items match the strict, pruned justification allowlist.");
}

async function main() {
  try {
    await verifyCatalogInvariants();
    await verifyPrismaDriftAllowlist();
    console.log("\n==================================================");
    console.log("  ✅ ALL SCHEMA DRIFT & INVARIANTS VERIFIED CLEAN  ");
    console.log("==================================================");
    await db.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Verification Failed:", err.message);
    await db.$disconnect();
    process.exit(1);
  }
}

main();
