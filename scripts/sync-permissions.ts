import { PrismaClient } from "@prisma/client";
import { PERMISSIONS, PermissionDef } from "../src/lib/catalog";

export interface SyncPermissionsReport {
  totalCatalog: number;
  alreadyExisting: number;
  inserted: number;
  metadataUpdated: number;
  scopeDiscrepancies: string[];
  invalidCatalogEntries: string[];
  orphanedDbPermissions: string[];
}

export interface SyncPermissionsOptions {
  silent?: boolean;
  strict?: boolean;
  catalog?: PermissionDef[];
}

/**
 * Synchronizes the canonical application permissions catalog into the PostgreSQL database.
 *
 * Guarantees:
 * 1. Idempotent: repeated runs do not duplicate or corrupt permissions.
 * 2. Safe: existing permissions and RolePermission associations are NEVER deleted.
 * 3. Scope Protection: existing DB scopes are never silently altered.
 * 4. Fail-Closed Deployment: invalid metadata, duplicate keys, unknown catalog entries,
 *    and scope discrepancies throw and abort in strict mode (default true).
 * 5. Audit & Visibility: provides comprehensive reporting for inserted, existing, and discrepant entries.
 * 6. Zero Credential Leakage: connection details and credentials are never printed.
 */
export async function syncPermissions(
  client: PrismaClient,
  options: SyncPermissionsOptions = {},
): Promise<SyncPermissionsReport> {
  const catalogToSync = options.catalog ?? PERMISSIONS;
  const isStrict = options.strict !== false;

  const report: SyncPermissionsReport = {
    totalCatalog: catalogToSync.length,
    alreadyExisting: 0,
    inserted: 0,
    metadataUpdated: 0,
    scopeDiscrepancies: [],
    invalidCatalogEntries: [],
    orphanedDbPermissions: [],
  };

  // 1. Validate catalog integrity
  const validCatalogPerms: PermissionDef[] = [];
  const seenKeys = new Set<string>();

  for (const perm of catalogToSync) {
    if (!perm || typeof perm !== "object") {
      report.invalidCatalogEntries.push("NULL_OR_NON_OBJECT_ENTRY");
      continue;
    }
    if (!perm.key || typeof perm.key !== "string" || !perm.key.trim()) {
      report.invalidCatalogEntries.push("INVALID_OR_MISSING_KEY");
      continue;
    }
    const trimmedKey = perm.key.trim();
    if (!trimmedKey.startsWith("tenant.") && !trimmedKey.startsWith("platform.")) {
      report.invalidCatalogEntries.push(`${trimmedKey} (unknown prefix: must start with 'tenant.' or 'platform.')`);
      continue;
    }
    if (!perm.group || typeof perm.group !== "string" || !perm.group.trim()) {
      report.invalidCatalogEntries.push(`${trimmedKey} (missing group metadata)`);
      continue;
    }
    if (!perm.label || typeof perm.label !== "string" || !perm.label.trim()) {
      report.invalidCatalogEntries.push(`${trimmedKey} (missing label metadata)`);
      continue;
    }
    if (perm.scope !== "TENANT" && perm.scope !== "PLATFORM") {
      report.invalidCatalogEntries.push(`${trimmedKey} (invalid scope: ${perm.scope})`);
      continue;
    }
    if (perm.scope === "TENANT" && !trimmedKey.startsWith("tenant.")) {
      report.invalidCatalogEntries.push(`${trimmedKey} (scope TENANT but key does not start with 'tenant.')`);
      continue;
    }
    if (perm.scope === "PLATFORM" && !trimmedKey.startsWith("platform.")) {
      report.invalidCatalogEntries.push(`${trimmedKey} (scope PLATFORM but key does not start with 'platform.')`);
      continue;
    }
    if (seenKeys.has(trimmedKey)) {
      report.invalidCatalogEntries.push(`${trimmedKey} (duplicate definition)`);
      continue;
    }
    seenKeys.add(trimmedKey);
    validCatalogPerms.push({
      key: trimmedKey,
      group: perm.group.trim(),
      label: perm.label.trim(),
      scope: perm.scope,
    });
  }

  // If strict mode is enabled, abort immediately on catalog corruption
  if (isStrict && report.invalidCatalogEntries.length > 0) {
    throw new Error(
      `Permission catalog validation failed with ${report.invalidCatalogEntries.length} invalid entries: ${report.invalidCatalogEntries.join(", ")}`,
    );
  }

  // 2. Fetch existing database permissions
  const existing = await client.permission.findMany();
  const existingMap = new Map(existing.map((p) => [p.key, p]));

  // 3. Process each canonical entry
  for (const perm of validCatalogPerms) {
    const prev = existingMap.get(perm.key);
    if (!prev) {
      await client.permission.create({
        data: {
          key: perm.key,
          group: perm.group,
          label: perm.label,
          scope: perm.scope,
          description: null,
        },
      });
      report.inserted++;
    } else {
      // Guard against silent scope mutations
      if (prev.scope !== perm.scope) {
        report.scopeDiscrepancies.push(
          `${perm.key} (DB: ${prev.scope}, Catalog: ${perm.scope})`,
        );
      }

      // Sync metadata (label or group updates) without mutating scope or overwriting custom description
      if (prev.group !== perm.group || prev.label !== perm.label) {
        await client.permission.update({
          where: { key: perm.key },
          data: {
            group: perm.group,
            label: perm.label,
          },
        });
        report.metadataUpdated++;
      } else {
        report.alreadyExisting++;
      }
    }
  }

  // If strict mode is enabled and scope discrepancies are found, abort to prevent silent scope mismatch
  if (isStrict && report.scopeDiscrepancies.length > 0) {
    throw new Error(
      `Permission scope discrepancies detected with ${report.scopeDiscrepancies.length} entries: ${report.scopeDiscrepancies.join(", ")}`,
    );
  }

  // 4. Identify orphaned database permissions (preserve without deletion)
  for (const dbPerm of existing) {
    if (!seenKeys.has(dbPerm.key)) {
      report.orphanedDbPermissions.push(dbPerm.key);
    }
  }

  if (!options.silent) {
    console.log("==================================================");
    console.log("   Knowletive RBAC Permission Catalog Sync Report ");
    console.log("==================================================");
    console.log(`Canonical catalog entries:    ${report.totalCatalog}`);
    console.log(`Already matching in DB:       ${report.alreadyExisting}`);
    console.log(`Newly inserted into DB:       ${report.inserted}`);
    console.log(`Metadata updated (label/grp): ${report.metadataUpdated}`);
    console.log(`Scope discrepancies:          ${report.scopeDiscrepancies.length}`);
    if (report.scopeDiscrepancies.length > 0) {
      console.log(`  Discrepant keys: ${report.scopeDiscrepancies.join(", ")}`);
    }
    console.log(`Invalid catalog entries:      ${report.invalidCatalogEntries.length}`);
    if (report.invalidCatalogEntries.length > 0) {
      console.log(`  Invalid keys: ${report.invalidCatalogEntries.join(", ")}`);
    }
    console.log(`Orphaned DB permissions:      ${report.orphanedDbPermissions.length}`);
    if (report.orphanedDbPermissions.length > 0) {
      console.log(`  Orphaned keys (preserved): ${report.orphanedDbPermissions.join(", ")}`);
    }
    console.log("==================================================");
    console.log("Permissions sync completed successfully.");
  }

  return report;
}

async function main() {
  const db = new PrismaClient();
  try {
    const report = await syncPermissions(db, { strict: true });
    if (report.invalidCatalogEntries.length > 0 || report.scopeDiscrepancies.length > 0) {
      process.exit(1);
    }
  } catch (e) {
    console.error("Failed to sync permissions:", e);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("sync-permissions.ts")) {
  main().catch((e) => {
    console.error("Failed to sync permissions:", e);
    process.exit(1);
  });
}
