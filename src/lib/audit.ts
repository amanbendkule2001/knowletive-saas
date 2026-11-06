import "server-only";

import { db } from "@/lib/db";
import type { AuditActorType, Prisma } from "@prisma/client";

type AuditInput = {
  tenantId?: string | null;
  actorId?: string | null;
  actorType?: AuditActorType;
  actorName: string;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: Prisma.InputJsonValue;
  ip?: string | null;
};

/**
 * Audit trail. When `tx` is provided, the audit log joins the active transaction
 * atomically and throws if persistence fails. When `tx` is omitted, it operates
 * as a best-effort background log on the global db client.
 */
export async function writeAudit(input: AuditInput, tx?: Prisma.TransactionClient) {
  const client = tx ?? db;
  try {
    await client.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        actorId: input.actorId ?? null,
        actorType: input.actorType ?? "TENANT",
        actorName: input.actorName,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        meta: input.meta,
        ip: input.ip ?? null,
      },
    });
  } catch (error) {
    if (tx) {
      throw error;
    }
    console.error("[audit] failed to persist", input.action, error);
  }
}
