import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, ArrowLeft } from "lucide-react";
import { getSession, getTenantContext, isStaffMember } from "@/lib/auth";
import { logoutAction } from "@/actions/auth";
import { Logo } from "@/components/ui/logo";
import { Avatar, Badge } from "@/components/ui/primitives";
import { NotificationCenter } from "@/components/notifications/notification-center";

export const metadata = { title: "Portal" };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  if (!user) redirect("/login");

  const ctx = await getTenantContext();
  if (!ctx) {
    if (user.isPlatformOwner || user.platformPermissions.length > 0) redirect("/platform");
    if (user.memberships.length > 1) redirect("/select-institute");
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="card w-full max-w-md p-7 text-center">
          <Logo href={null} className="justify-center" subtitle="Parent & Student Portal" />
          <h1 className="mt-6 text-lg font-semibold">No institute assigned</h1>
          <p className="mt-1 text-sm text-muted">
            Your account is active but isn&apos;t linked to a school. Please contact your school administrator.
          </p>
          <div className="mt-5 flex justify-center gap-2">
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

  const isStaff = isStaffMember(ctx);

  return (
    <div className="min-h-dvh bg-[var(--surface-sunken)] flex flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo href="/portal" subtitle="Portal" />
            <div className="hidden sm:block h-5 w-px bg-[var(--border)]" />
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-xs font-medium text-foreground">{ctx.tenant.name}</span>
              <Badge tone="neutral">{ctx.membership?.roleName ?? "Portal Member"}</Badge>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isStaff && (
              <Link href="/app" className="btn btn-secondary btn-sm">
                <ArrowLeft className="size-3.5" /> Staff Console
              </Link>
            )}
            <NotificationCenter />
            <div className="flex items-center gap-2">
              <Avatar name={user.name} color={user.avatarColor} size={28} />
              <div className="hidden md:block text-left">
                <p className="text-xs font-medium leading-none">{user.name}</p>
                <p className="text-[10px] text-muted mt-0.5">{user.email}</p>
              </div>
            </div>
            <form action={logoutAction}>
              <button className="btn btn-ghost btn-sm text-muted hover:text-foreground" type="submit" title="Sign out">
                <LogOut className="size-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>

      <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-muted">
        <p>&copy; {new Date().getFullYear()} {ctx.tenant.name} &bull; Powered by Knowletive</p>
      </footer>
    </div>
  );
}

