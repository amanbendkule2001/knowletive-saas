import { getTenantContext, hasTenantPermission, isStaffMember } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  buildLeadsWhereClause,
  leadsExportSelect,
  serializeLeadsCsv,
  generateLeadsFilename,
  MAX_LEADS_EXPORT_LIMIT,
  type LeadExportRecord,
} from "@/lib/leads-export";

export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isStaffMember(ctx) || !hasTenantPermission(ctx, "tenant.leads.read")) {
    return Response.json(
      { error: "Access denied. You do not have permission to export leads." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? undefined;
  const status = searchParams.get("status") ?? undefined;

  const where = buildLeadsWhereClause(ctx.tenant.id, { q, status });

  // Scalability check: Enforce bounded export limit before querying data
  const totalMatching = await db.lead.count({ where });
  if (totalMatching > MAX_LEADS_EXPORT_LIMIT) {
    return Response.json(
      {
        error: `Export limit exceeded. Your query matches ${totalMatching} leads, which exceeds the maximum limit of ${MAX_LEADS_EXPORT_LIMIT} records per export. Please narrow your query using search or status filters.`,
      },
      { status: 400 },
    );
  }

  // Chunked batch retrieval for memory-bounded execution
  const CHUNK_SIZE = 1000;
  const leads: LeadExportRecord[] = [];
  for (let offset = 0; offset < totalMatching; offset += CHUNK_SIZE) {
    const chunk = (await db.lead.findMany({
      where,
      select: leadsExportSelect,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: offset,
      take: CHUNK_SIZE,
    })) as unknown as LeadExportRecord[];
    leads.push(...chunk);
  }

  const csv = serializeLeadsCsv(leads);
  const filename = generateLeadsFilename(ctx.tenant.slug);

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "X-Total-Count": String(totalMatching),
    },
  });
}
