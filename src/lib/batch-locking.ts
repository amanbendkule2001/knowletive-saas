import { Prisma, type BatchStatus } from "@prisma/client";

export type LockedBatch = {
  id: string;
  name: string;
  code: string;
  capacity: number;
  status: BatchStatus;
  endDate: Date | null;
};

/**
 * Acquires authoritative pessimistic row-level lock(s) on one or more Batch records in a deterministic order.
 * Batch IDs are deduplicated and sorted ascendingly to prevent deadlocks across concurrent multi-batch operations.
 *
 * Global Lock Hierarchy:
 * When an operation requires locks on both Examination and Batch aggregates, the Examination row lock
 * must ALWAYS be acquired first, followed by the Batch row lock(s) in ascending alphanumeric order:
 *   Examination -> Batch (sorted by ID ASC)
 *
 * Batch-only transactions only acquire Batch row lock(s) (sorted by ID ASC) and never request Examination locks,
 * maintaining a strictly acyclic lock dependency graph.
 */
export async function lockBatchRows(
  tx: Prisma.TransactionClient,
  batchIds: string[],
  tenantId: string
): Promise<LockedBatch[]> {
  if (!batchIds || batchIds.length === 0) {
    return [];
  }

  const sortedIds = Array.from(new Set(batchIds.filter(Boolean))).sort();
  if (sortedIds.length === 0) {
    return [];
  }

  const locked = await tx.$queryRaw<LockedBatch[]>`
    SELECT id, name, code, capacity, status, "endDate"
    FROM "Batch"
    WHERE id IN (${Prisma.join(sortedIds)}) AND "tenantId" = ${tenantId}
    ORDER BY id ASC
    FOR UPDATE
  `;

  return locked;
}

/**
 * Acquires an authoritative pessimistic row-level lock on a single Batch record within a transaction.
 */
export async function lockBatchRow(
  tx: Prisma.TransactionClient,
  batchId: string,
  tenantId: string
): Promise<LockedBatch | null> {
  const locked = await lockBatchRows(tx, [batchId], tenantId);
  return locked[0] ?? null;
}
