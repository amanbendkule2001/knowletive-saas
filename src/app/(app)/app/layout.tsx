import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Building2, LogOut } from "lucide-react";
import { getSession, getTenantContext, hasTenantPermission, isStaffMember } from "@/lib/auth";
import { getAiUsage } from "@/lib/billing";
import { daysBetween } from "@/lib/format";
import { appNav } from "@/components/shell/nav";
import { Shell } from "@/components/shell/shell";
import { Logo } from "@/components/ui/logo";
import { Callout } from "@/components/ui/primitives";
import { logoutAction } from "@/actions/auth";

export const metadata = { title: "Workspace" };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();

  if (!ctx) {
    const user = await getSession();
    if (!user) redirect("/login");
    if (user.isPlatformOwner || user.platformPermissions.length > 0) redirect("/platform/institutes");
    if (user.memberships.length > 1) redirect("/select-institute");

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="card w-full max-w-md p-7 text-center">
          <Logo href={null} className="justify-center" subtitle="Institute OS" />
          <h1 className="mt-6 text-lg font-semibold">No institute assigned yet</h1>
          <p className="mt-1 text-sm text-muted">
            Your account is active but isn&apos;t linked to an institute. Ask your platform
            administrator to send an invitation.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <a href="mailto:support@knowletive.com" className="btn btn-primary">
              Contact support
            </a>
            <form action={logoutAction}>
              <button className="btn btn-secondary" type="submit">
                <LogOut className="size-3.5" /> Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const { user, tenant, subscriptionBlocked, isOwnerView } = ctx;

  if (!isStaffMember(ctx)) {
    redirect("/portal");
  }
  const plan = tenant.subscription?.plan ?? null;
  const suspended = tenant.status === "SUSPENDED" && !isOwnerView;

  if (suspended) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="card w-full max-w-lg p-7">
          <Logo href="/" subtitle="Institute OS" />
          <div className="mt-6 flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger)]">
              <AlertTriangle className="size-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold">This institute is suspended</h1>
              <p className="mt-1 text-sm text-muted">
                Access to <strong>{tenant.name}</strong> has been paused by the platform team.
                Your data is safe. Contact support or the platform owner to restore access.
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <a href="mailto:support@knowletive.com" className="btn btn-primary">
              Contact support
            </a>
            <form action={logoutAction}>
              <button className="btn btn-secondary" type="submit">
                <LogOut className="size-3.5" /> Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const nav = appNav.filter((item) => !item.permission || hasTenantPermission(ctx, item.permission));

  const usage = plan ? await getAiUsage(tenant.id, plan.aiCreditsMonthly) : null;
  const trialDaysLeft =
    tenant.subscription?.status === "TRIALING" && tenant.subscription.trialEndsAt
      ? daysBetween(new Date(), tenant.subscription.trialEndsAt)
      : null;

  const memberships = user.memberships.map((m) => ({
    tenantId: m.tenantId,
    tenantName: m.tenantName,
    roleName: m.roleName,
  }));
  if (!memberships.some((m) => m.tenantId === tenant.id)) {
    memberships.unshift({
      tenantId: tenant.id,
      tenantName: tenant.name,
      roleName: "Platform owner access",
    });
  }

  const tenantSettings = (tenant.settings as Record<string, unknown> | null) ?? {};
  const logoFileId = typeof tenantSettings.logoFileId === "string" ? tenantSettings.logoFileId : null;

  return (
    <Shell
      area="app"
      nav={nav}
      user={{
        name: user.name,
        email: user.email,
        avatarColor: user.avatarColor,
        isPlatformOwner: user.isPlatformOwner,
      }}
      tenant={{
        id: tenant.id,
        name: tenant.name,
        initials: tenant.logoInitials,
        accent: tenant.accentColor,
        roleName: ctx.membership?.roleName ?? "Member",
        status: tenant.status,
        logoFileId,
      }}
      plan={
        plan
          ? {
              name: plan.name,
              status: tenant.subscription?.status ?? "ACTIVE",
              trialDaysLeft,
              creditsUsed: usage?.used ?? 0,
              creditsLimit: plan.aiCreditsMonthly,
            }
          : undefined
      }
      memberships={memberships}
      canViewPlatform={user.isPlatformOwner}
    >
      {subscriptionBlocked && (
        <div className="mb-4">
          <Callout
            tone="danger"
            title="Subscription inactive — writes are paused"
            icon={<AlertTriangle className="size-4" />}
          >
            Your subscription is <strong>{tenant.subscription?.status.replace(/_/g, " ").toLowerCase()}</strong>.
            Reading is still available.{" "}
            <Link href="/app/billing" className="underline">
              Open billing
            </Link>{" "}
            to restore access.
          </Callout>
        </div>
      )}
      {!subscriptionBlocked && trialDaysLeft !== null && trialDaysLeft <= 7 && (
        <div className="mb-4">
          <Callout
            tone="warning"
            title={`Trial ends in ${Math.max(0, trialDaysLeft)} day${trialDaysLeft === 1 ? "" : "s"}`}
            icon={<Building2 className="size-4" />}
          >
            Pick a plan to keep attendance, fees and AI running without interruption.{" "}
            <Link href="/app/billing" className="underline">
              View plans
            </Link>
          </Callout>
        </div>
      )}
      {children}
    </Shell>
  );
}
