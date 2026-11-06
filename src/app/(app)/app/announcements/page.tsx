import Link from "next/link";
import {
  Megaphone,
  Pin,
  PinOff,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission } from "@/lib/auth";
import { hasFeature } from "@/lib/entitlements";
import {
  createAnnouncementAction,
  deleteAnnouncementAction,
  toggleAnnouncementPinAction,
} from "@/actions/operations";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmButton } from "@/components/ui/client-bits";
import { FeatureLocked } from "@/components/ui/feature-gate";
import { Field } from "@/components/ui/form-field";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatCard,
  statusLabel,
} from "@/components/ui/primitives";
import { num, timeAgo } from "@/lib/format";

export const metadata = { title: "Announcements" };

const AUDIENCES = [
  { value: "ALL", label: "Everyone" },
  { value: "STAFF", label: "Staff" },
  { value: "PARENTS", label: "Parents" },
  { value: "STUDENTS", label: "Students" },
] as const;

const audienceTone: Record<string, "brand" | "info" | "warning" | "success"> = {
  ALL: "brand",
  STAFF: "info",
  PARENTS: "warning",
  STUDENTS: "success",
};

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string }>;
}) {
  const ctx = await requireTenantPermission("tenant.announcements.read");
  const plan = ctx.tenant.subscription?.plan;
  if (!hasFeature(plan, "announcements")) {
    return <FeatureLocked feature="announcements" title="Announcements" />;
  }

  const sp = await searchParams;
  const audience = AUDIENCES.some((a) => a.value === sp.audience) ? sp.audience : undefined;
  const canWrite = hasTenantPermission(ctx, "tenant.announcements.write");

  const [announcements, counts] = await Promise.all([
    db.announcement.findMany({
      where: {
        tenantId: ctx.tenant.id,
        ...(audience ? { audience } : {}),
      },
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      take: 60,
    }),
    db.announcement.groupBy({
      by: ["audience"],
      where: { tenantId: ctx.tenant.id },
      _count: { _all: true },
    }),
  ]);

  const total = counts.reduce((sum, row) => sum + row._count._all, 0);
  const pinned = announcements.filter((a) => a.pinned).length;
  const countFor = (value: string) =>
    counts.find((row) => row.audience === value)?._count._all ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Announcements"
        description="Publish notices to the whole institute or a specific audience. Pinned notices stay at the top."
        actions={
          <Badge tone="brand">
            <Megaphone className="size-3" /> {num(total)} published
          </Badge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Total notices"
          value={num(total)}
          sub="all audiences"
          icon={<Megaphone className="size-4" />}
        />
        <StatCard
          label="Pinned"
          value={num(pinned)}
          sub="shown first in the list"
          icon={<Pin className="size-4" />}
          tone="warning"
        />
        <StatCard
          label="Parent notices"
          value={num(countFor("PARENTS"))}
          sub="visible to guardians"
          icon={<Users className="size-4" />}
          tone="info"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Published notices"
              description="Newest first, pinned notices on top"
              action={<Badge tone="neutral">{announcements.length} shown</Badge>}
            />

            <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] px-3 py-2.5">
              <Link
                href="/app/announcements"
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
                  !audience
                    ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                    : "text-muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                }`}
              >
                All <span className="tabular-nums opacity-70">{num(total)}</span>
              </Link>
              {AUDIENCES.map((item) => {
                const active = audience === item.value;
                return (
                  <Link
                    key={item.value}
                    href={`/app/announcements?audience=${item.value}`}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
                      active
                        ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                        : "text-muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                    }`}
                  >
                    {item.label}
                    <span className="tabular-nums opacity-70">{num(countFor(item.value))}</span>
                  </Link>
                );
              })}
            </div>

            <div className="divide-y divide-[var(--border)]">
              {announcements.map((announcement) => (
                <article key={announcement.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[13px] font-semibold">{announcement.title}</h3>
                        {announcement.pinned && (
                          <Badge tone="warning">
                            <Pin className="size-3" /> Pinned
                          </Badge>
                        )}
                        <Badge tone={audienceTone[announcement.audience] ?? "neutral"}>
                          {statusLabel(announcement.audience)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[10px] text-[var(--muted-2)]">
                        Published {timeAgo(announcement.publishedAt)}
                      </p>
                    </div>
                    {canWrite && (
                      <div className="flex shrink-0 items-center gap-1">
                        <form action={toggleAnnouncementPinAction}>
                          <input type="hidden" name="announcementId" value={announcement.id} />
                          <button
                            className="btn btn-ghost btn-sm"
                            type="submit"
                            title={announcement.pinned ? "Unpin notice" : "Pin notice"}
                          >
                            {announcement.pinned ? (
                              <PinOff className="size-3.5" />
                            ) : (
                              <Pin className="size-3.5" />
                            )}
                            {announcement.pinned ? "Unpin" : "Pin"}
                          </button>
                        </form>
                        <form action={deleteAnnouncementAction}>
                          <input type="hidden" name="announcementId" value={announcement.id} />
                          <ConfirmButton
                            className="btn btn-ghost btn-sm text-[var(--danger)]"
                            message={`Delete "${announcement.title}"? This removes it for everyone and is recorded in the audit trail.`}
                          >
                            <Trash2 className="size-3.5" />
                            <span className="sr-only">Delete</span>
                          </ConfirmButton>
                        </form>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-muted">
                    {announcement.body}
                  </p>
                </article>
              ))}

              {announcements.length === 0 && (
                <EmptyState
                  title={audience ? "No notices for this audience" : "No announcements yet"}
                  description={
                    audience
                      ? "Try another audience or publish the first notice for this group."
                      : "Publish a notice to keep staff, parents and students informed."
                  }
                  icon={<Megaphone className="size-5" />}
                />
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {canWrite ? (
            <Card>
              <CardHeader
                title="Publish a notice"
                description="Keep it short, specific and actionable."
                action={<Send className="size-4 text-[var(--muted)]" />}
              />
              <div className="p-4">
                <ActionForm
                  action={createAnnouncementAction}
                  submitLabel="Publish announcement"
                  pendingLabel="Publishing…"
                >
                  <Field label="Title" htmlFor="title" required>
                    <input
                      id="title"
                      name="title"
                      className="input"
                      placeholder="Parent-teacher meeting this Saturday"
                      maxLength={140}
                      required
                    />
                  </Field>
                  <Field label="Audience" htmlFor="audience" required>
                    <select id="audience" name="audience" className="select" defaultValue="ALL">
                      {AUDIENCES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Message"
                    htmlFor="body"
                    required
                    hint="Up to 4,000 characters. Line breaks are preserved."
                  >
                    <textarea
                      id="body"
                      name="body"
                      className="input min-h-32"
                      rows={7}
                      maxLength={4000}
                      placeholder="Share the date, time, venue and what parents or staff need to do next."
                      required
                    />
                  </Field>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border)] px-3 py-2.5 text-[12px]">
                    <input
                      type="checkbox"
                      name="pinned"
                      className="mt-0.5 size-3.5 accent-[var(--brand)]"
                    />
                    <span>
                      <span className="block font-medium">Pin this notice</span>
                      <span className="block text-[11px] text-muted">
                        Pinned notices stay at the top of the list until unpinned.
                      </span>
                    </span>
                  </label>
                </ActionForm>
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Read-only access" />
              <p className="p-4 text-[12px] leading-relaxed text-muted">
                You can read announcements but not publish them. Ask an institute admin for the
                Publish announcements permission if you need to post notices.
              </p>
            </Card>
          )}

          <Card>
            <CardHeader title="Who sees what" />
            <div className="space-y-2.5 p-4 text-[12px] text-muted">
              <p>
                <strong className="text-[var(--text)]">Everyone</strong> — staff, parents and
                students.
              </p>
              <p>
                <strong className="text-[var(--text)]">Parents</strong> — guardian portal and
                parent-facing notices.
              </p>
              <p>
                <strong className="text-[var(--text)]">Staff</strong> — internal operational
                updates.
              </p>
              <p>
                <strong className="text-[var(--text)]">Students</strong> — student portal notices.
              </p>
            </div>
          </Card>

          {!canWrite && (
            <Callout tone="info" title="Need to publish?">
              Only roles with the Publish announcements permission can post notices. Institute
              admins can grant it from Roles & permissions.
            </Callout>
          )}
        </div>
      </div>
    </div>
  );
}
