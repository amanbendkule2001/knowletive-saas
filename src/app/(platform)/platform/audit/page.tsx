import type { Prisma } from "@prisma/client";
import { ScrollText, Search } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import { date, timeAgo } from "@/lib/format";
import { safeInt } from "@/lib/utils";
import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
  Pagination,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";

export const metadata = { title: "Audit log" };

const PAGE_SIZE = 25;
const ACTOR_TYPES = ["PLATFORM", "TENANT", "SYSTEM"] as const;

type AuditRow = Prisma.AuditLogGetPayload<{ include: { tenant: true } }>;

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; actor?: string; tenant?: string; page?: string }>;
}) {
  await requirePlatformPermission("platform.audit.read");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const actor = ACTOR_TYPES.includes(sp.actor as (typeof ACTOR_TYPES)[number])
    ? sp.actor
    : undefined;
  const tenant = sp.tenant && sp.tenant !== "all" ? sp.tenant : undefined;
  const page = safeInt(sp.page, 1, 100_000);

  const where: Prisma.AuditLogWhereInput = {
    ...(tenant ? { tenantId: tenant } : {}),
    ...(actor ? { actorType: actor as Prisma.AuditLogWhereInput["actorType"] } : {}),
    ...(q
      ? {
          OR: [
            { action: { contains: q, mode: "insensitive" } },
            { actorName: { contains: q, mode: "insensitive" } },
            { entity: { contains: q, mode: "insensitive" } },
            { tenant: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [total, logs, tenants, actions] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      include: { tenant: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, take: 200 }),
  ]);

  const columns: Column<AuditRow>[] = [
    {
      key: "time",
      header: "When",
      mobile: "subtitle",
      render: (log) => (
        <div>
          <p className="font-medium">{timeAgo(log.createdAt)}</p>
          <p className="text-[10px] text-muted">{date(log.createdAt)}</p>
        </div>
      ),
    },
    {
      key: "action",
      header: "Event",
      mobile: "title",
      render: (log) => (
        <div className="min-w-0">
          <p className="font-mono text-[12px] font-medium">{log.action}</p>
          <p className="truncate text-[10px] text-muted">
            {log.entity ?? "—"}
            {log.entityId ? ` · ${log.entityId.slice(0, 10)}…` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      mobile: "detail",
      render: (log) => (
        <div className="min-w-0">
          <p className="truncate">{log.actorName}</p>
          <Badge tone={log.actorType === "PLATFORM" ? "brand" : log.actorType === "SYSTEM" ? "neutral" : "info"}>
            {log.actorType.toLowerCase()}
          </Badge>
        </div>
      ),
    },
    {
      key: "tenant",
      header: "Institute",
      mobile: "detail",
      render: (log) =>
        log.tenant ? (
          <span className="text-muted">{log.tenant.name}</span>
        ) : (
          <span className="text-[var(--muted-2)]">Platform</span>
        ),
    },
    {
      key: "ip",
      header: "IP",
      mobile: "hidden",
      render: (log) => <span className="font-mono text-[10px] text-muted">{log.ip ?? "—"}</span>,
    },
    {
      key: "meta",
      header: "Detail",
      mobile: "hidden",
      render: (log) =>
        log.meta ? (
          <details className="max-w-[18rem]">
            <summary className="cursor-pointer text-[11px] text-[var(--brand)]">View</summary>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--surface-2)] p-2 text-[10px] text-muted">
              {JSON.stringify(log.meta, null, 2)}
            </pre>
          </details>
        ) : (
          <span className="text-[10px] text-[var(--muted-2)]">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Governance"
        title="Audit log"
        description="Immutable, append-only record of sensitive platform and institute actions. Failures never block the user's action."
        actions={<Badge tone="neutral"><ScrollText className="size-3" /> {total.toLocaleString("en-IN")} events</Badge>}
      />

      <form method="GET" className="card grid gap-2 p-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-2)]" />
          <input
            name="q"
            defaultValue={q}
            list="audit-actions"
            placeholder="Search event, actor, entity or institute…"
            className="input pl-8"
            aria-label="Search audit log"
          />
          <datalist id="audit-actions">
            {actions.map((a) => (
              <option key={a.action} value={a.action} />
            ))}
          </datalist>
        </div>
        <select name="actor" defaultValue={actor ?? ""} className="select sm:w-36" aria-label="Actor type">
          <option value="">All actors</option>
          {ACTOR_TYPES.map((a) => (
            <option key={a} value={a}>
              {a.toLowerCase()}
            </option>
          ))}
        </select>
        <select name="tenant" defaultValue={tenant ?? "all"} className="select sm:w-48" aria-label="Institute">
          <option value="all">All institutes</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary" type="submit">
          Filter
        </button>
      </form>

      <DataTable
        columns={columns}
        rows={logs}
        emptyTitle={q || actor || tenant ? "No events match those filters" : "No audit events yet"}
        emptyDescription="Activity appears here as soon as someone changes data."
        footer={
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            basePath="/platform/audit"
            query={{ q, actor, tenant }}
          />
        }
      />

      <Card>
        <CardHeader title="How to read this log" description="Operational guidance for the platform team" />
        <div className="grid gap-3 p-4 text-xs text-muted sm:grid-cols-3">
          <p>
            <span className="font-semibold text-[var(--text)]">actorType</span> distinguishes platform
            staff from institute users and automated jobs.
          </p>
          <p>
            <span className="font-semibold text-[var(--text)]">Support access</span> is recorded under
            the platform identity that opened the workspace, not the institute admin.
          </p>
          <p>
            <span className="font-semibold text-[var(--text)]">Retention</span> is currently indefinite.
            Move to a write-once store or export to cold storage before high volume.
          </p>
        </div>
      </Card>
    </div>
  );
}
