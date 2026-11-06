import { redirect } from "next/navigation";
import { ArrowRight, LogOut, School } from "lucide-react";
import { getSession, setActiveTenant } from "@/lib/auth";
import { logoutAction, switchTenantAction } from "@/actions/auth";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/primitives";
import { STAFF_ROLE_KEYS } from "@/lib/catalog";

export const metadata = { title: "Select Institute" };

export default async function SelectInstitutePage() {
  const user = await getSession();
  if (!user) redirect("/login");

  if (user.isPlatformOwner || user.platformPermissions.length > 0) {
    redirect("/platform");
  }

  // If only 1 membership exists, activate it immediately
  if (user.memberships.length === 1) {
    await setActiveTenant(user.memberships[0].tenantId);
    const isStaff = STAFF_ROLE_KEYS.has(user.memberships[0].roleKey);
    redirect(isStaff ? "/app" : "/portal");
  }

  if (user.memberships.length === 0) {
    redirect("/app");
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--surface-sunken)] px-4 py-12">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <Logo href={null} className="justify-center" subtitle="Multi-Institute Access" />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
            Select an institute
          </h1>
          <p className="mt-1 text-sm text-muted">
            Your account is linked to multiple institutes. Choose a workspace to proceed:
          </p>
        </div>

        <div className="space-y-3">
          {user.memberships.map((m) => {
            const isStaff = STAFF_ROLE_KEYS.has(m.roleKey);
            return (
              <form key={m.tenantId} action={switchTenantAction}>
                <input type="hidden" name="tenantId" value={m.tenantId} />
                <button
                  type="submit"
                  className="card card-hover flex w-full items-center justify-between p-4 text-left transition hover:border-[var(--brand)]"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="grid size-10 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                      <School className="size-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{m.tenantName}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge tone="neutral">{m.roleName}</Badge>
                        <span className="text-[11px] text-muted">
                          {isStaff ? "Staff Console (/app)" : "Parent & Student Portal (/portal)"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-medium text-[var(--brand)]">
                    <span>Enter</span>
                    <ArrowRight className="size-3.5" />
                  </div>
                </button>
              </form>
            );
          })}
        </div>

        <div className="pt-2 text-center">
          <form action={logoutAction}>
            <button
              type="submit"
              className="btn btn-ghost btn-sm text-muted hover:text-foreground"
            >
              <LogOut className="size-3.5" /> Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
