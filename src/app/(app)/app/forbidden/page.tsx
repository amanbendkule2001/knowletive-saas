import Link from "next/link";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { requireTenant } from "@/lib/rbac";
import { PERMISSION_MAP } from "@/lib/catalog";
import {
  Badge,
  Callout,
  Card,
  PageHeader,
} from "@/components/ui/primitives";

export const metadata = { title: "Access denied" };

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const ctx = await requireTenant();
  const sp = await searchParams;
  const key = sp.p ?? "";
  const definition = PERMISSION_MAP.get(key);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Access control"
        title="You do not have access to this page"
        description="Knowletive checks permissions on every page and every server action, so this block applies even if the URL is typed manually."
      />

      <Card className="mx-auto max-w-xl">
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger)]">
            <LockKeyhole className="size-5" />
          </span>
          <h2 className="mt-4 text-base font-semibold">
            {definition ? definition.label : "This action is restricted"}
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted">
            Your role <strong>{ctx.membership?.roleName ?? "Member"}</strong> is missing the
            permission required for this area. Nothing is broken — ask an institute admin if you need
            it.
          </p>

          {key && (
            <div className="mt-4 rounded-xl bg-[var(--surface-2)] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[var(--muted-2)]">
                Required permission
              </p>
              <code className="font-mono text-[11px]">{key}</code>
            </div>
          )}

          {definition && (
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              <Badge tone="neutral">{definition.group}</Badge>
              <Badge tone="brand">{definition.scope.toLowerCase()} scope</Badge>
            </div>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link href="/app" className="btn btn-primary">
              <ArrowLeft className="size-4" /> Back to overview
            </Link>
            <Link href="/app/settings" className="btn btn-secondary">
              <ShieldCheck className="size-4" /> Your access
            </Link>
          </div>
        </div>
      </Card>

      <div className="mx-auto max-w-xl">
        <Callout tone="info" title="How permissions work">
          Roles are managed by institute admins from Roles &amp; permissions. Permission changes take
          effect on your next request, and sensitive actions are recorded in the audit trail with your
          name.
        </Callout>
      </div>
    </div>
  );
}
