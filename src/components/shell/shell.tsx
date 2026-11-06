"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarCheck2,
  Check,
  ChevronDown,
  CreditCard,
  GraduationCap,
  HeartHandshake,
  LayoutDashboard,
  Layers,
  LogOut,
  Megaphone,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { NavIcon, NavItem } from "@/components/shell/nav";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { Logo, LogoMark } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/primitives";
import { logoutAction, switchTenantAction } from "@/actions/auth";
import { cn } from "@/lib/utils";

const icons: Record<NavIcon, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  building: Building2,
  layers: Layers,
  card: CreditCard,
  sparkles: Sparkles,
  shield: ShieldCheck,
  users: Users,
  scroll: ScrollText,
  settings: Settings,
  graduation: GraduationCap,
  parents: HeartHandshake,
  briefcase: BriefcaseBusiness,
  book: BookOpen,
  calendar: CalendarCheck2,
  wallet: Wallet,
  megaphone: Megaphone,
};

export type ShellUser = {
  name: string;
  email: string;
  avatarColor: string;
  isPlatformOwner: boolean;
};

export type ShellTenant = {
  id: string;
  name: string;
  initials: string;
  accent: string;
  roleName: string;
  status: string;
  logoFileId?: string | null;
};

export type ShellPlan = {
  name: string;
  status: string;
  trialDaysLeft: number | null;
  creditsUsed: number;
  creditsLimit: number;
};

export type ShellMembership = {
  tenantId: string;
  tenantName: string;
  roleName: string;
};

export function Shell({
  area,
  nav,
  user,
  tenant,
  plan,
  memberships,
  canViewPlatform,
  children,
}: {
  area: "platform" | "app";
  nav: NavItem[];
  user: ShellUser;
  tenant?: ShellTenant;
  plan?: ShellPlan;
  memberships?: ShellMembership[];
  canViewPlatform?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [mobileOpen]);

  const current =
    nav.find((item) => (item.exact ? pathname === item.href : pathname.startsWith(item.href))) ?? nav[0];

  const renderNav = (onNavigate?: () => void) =>
    nav.map((item, index) => (
      <div key={item.href}>
        {(index === 0 || nav[index - 1].section !== item.section) && (
          <p className="mb-1.5 mt-5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-2)]">
            {item.section}
          </p>
        )}
        <NavLink item={item} pathname={pathname} onNavigate={onNavigate} />
      </div>
    ));
  const navTree = renderNav();

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17rem] flex-col border-r border-[var(--border)] bg-[var(--surface)] lg:flex">
        <SidebarBody
          area={area}
          user={user}
          tenant={tenant}
          plan={plan}
          navTree={navTree}
        />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="animate-in absolute inset-y-0 left-0 flex w-[17.5rem] max-w-[86vw] flex-col border-r border-[var(--border)] bg-[var(--surface)] shadow-2xl">
            <button
              className="btn btn-ghost btn-icon absolute right-2 top-3 z-10"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
            <SidebarBody
              area={area}
              user={user}
              tenant={tenant}
              plan={plan}
              navTree={renderNav(() => setMobileOpen(false))}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}

      <div className="lg:pl-[17rem]">
        <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-md">
          <div className="flex h-14 items-center justify-between gap-2 px-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <button
                className="btn btn-ghost btn-icon lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="size-4.5" />
              </button>
              <div className="min-w-0 lg:hidden">
                <LogoMark size={26} />
              </div>

              {area === "app" && tenant ? (
                <TenantMenu
                  tenant={tenant}
                  memberships={memberships ?? []}
                  canViewPlatform={!!canViewPlatform}
                />
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="hidden text-xs font-semibold uppercase tracking-[0.12em] text-muted sm:inline">
                    Platform console
                  </span>
                  <span className="hidden text-[var(--border-strong)] sm:inline">/</span>
                  <span className="truncate text-sm font-medium">{current?.label ?? "Overview"}</span>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {plan && (
                <div className="mr-1 hidden items-center gap-2 md:flex">
                  {plan.status === "TRIALING" && plan.trialDaysLeft !== null ? (
                    <span className="badge badge-warning">
                      Trial · {Math.max(0, plan.trialDaysLeft)}d left
                    </span>
                  ) : (
                    <span className="badge badge-brand">{plan.name}</span>
                  )}
                  <span
                    className="hidden items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-muted sm:flex"
                    title="AI credits used this month"
                  >
                    <Sparkles className="size-3 text-[var(--brand)]" />
                    {Math.max(0, plan.creditsLimit - plan.creditsUsed)} credits
                  </span>
                </div>
              )}
              <NotificationCenter />
              <ThemeToggle />
              <UserMenu user={user} area={area} />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-3 py-5 sm:px-5 sm:py-6 lg:px-7">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const Icon = icons[item.icon];
  const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link href={item.href} className="nav-item" data-active={active} onClick={onNavigate}>
      <Icon className="size-4 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SidebarBody({
  area,
  user,
  tenant,
  plan,
  navTree,
  onNavigate,
}: {
  area: "platform" | "app";
  user: ShellUser;
  tenant?: ShellTenant;
  plan?: ShellPlan;
  navTree: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-14 items-center border-b border-[var(--border)] px-4" onClick={onNavigate}>
        <Logo href={area === "platform" ? "/platform" : "/app"} subtitle={area === "platform" ? "Platform" : "Institute"} />
      </div>

      <nav className="no-scrollbar flex-1 overflow-y-auto px-3 pb-4">
        {navTree}
      </nav>

      <div className="border-t border-[var(--border)] p-3">
        {plan ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold">{plan.name} plan</p>
              <span className={cn("badge", plan.status === "TRIALING" ? "badge-warning" : "badge-success")}>
                {plan.status === "TRIALING" ? "Trial" : "Active"}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted">
              <span>AI credits</span>
              <span className="tabular-nums">
                {plan.creditsUsed}/{plan.creditsLimit}
              </span>
            </div>
            <div className="meter mt-1">
              <span
                style={{
                  width: `${plan.creditsLimit ? Math.min(100, (plan.creditsUsed / plan.creditsLimit) * 100) : 0}%`,
                }}
              />
            </div>
            <Link href="/app/billing" className="link mt-2.5 inline-flex items-center gap-1 text-[11px]" onClick={onNavigate}>
              Manage subscription <ArrowUpRight className="size-3" />
            </Link>
          </div>
        ) : (
          <div className="rounded-xl bg-[var(--surface-2)] p-3">
            <p className="text-[11px] font-semibold">Knowletive Platform</p>
            <p className="mt-0.5 text-[10px] text-muted">Multi-tenant SaaS · v0.1</p>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2.5 rounded-xl px-1 py-1">
          <Avatar name={user.name} color={user.avatarColor} size={30} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{user.name}</p>
            <p className="truncate text-[10px] text-muted">
              {tenant ? tenant.roleName : user.isPlatformOwner ? "Platform owner" : "Platform team"}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function TenantMenu({
  tenant,
  memberships,
  canViewPlatform,
}: {
  tenant: ShellTenant;
  memberships: ShellMembership[];
  canViewPlatform: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="-ml-1 flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-[var(--surface-2)]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {tenant.logoFileId ? (
          <img
            src={`/api/files/${tenant.logoFileId}`}
            alt={tenant.name}
            className="size-7 shrink-0 rounded-md object-contain border border-[var(--border)] bg-[var(--surface-2)]"
          />
        ) : (
          <span
            className="grid size-7 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white"
            style={{ background: tenant.accent }}
          >
            {tenant.initials}
          </span>
        )}
        <span className="min-w-0">
          <span className="block max-w-[10rem] truncate text-[13px] font-semibold leading-tight sm:max-w-[16rem]">
            {tenant.name}
          </span>
          <span className="block truncate text-[10px] leading-tight text-muted">{tenant.roleName}</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted" />
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-30 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className="animate-in absolute left-0 top-full z-40 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xl">
            <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-2)]">
              Switch institute
            </p>
            {memberships.map((m) => {
              const active = m.tenantId === tenant.id;
              return (
                <form key={m.tenantId} action={switchTenantAction}>
                  <input type="hidden" name="tenantId" value={m.tenantId} />
                  <button
                    type="submit"
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-[var(--surface-2)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.tenantName}</span>
                      <span className="block truncate text-[10px] text-muted">{m.roleName}</span>
                    </span>
                    {active && <Check className="size-3.5 shrink-0 text-[var(--brand)]" />}
                  </button>
                </form>
              );
            })}
            {canViewPlatform && (
              <>
                <div className="my-1 h-px bg-[var(--border)]" />
                <Link
                  href="/platform"
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium hover:bg-[var(--surface-2)]"
                  onClick={() => setOpen(false)}
                >
                  <Building2 className="size-3.5" /> Platform console
                </Link>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function UserMenu({ user, area }: { user: ShellUser; area: "platform" | "app" }) {
  const [open, setOpen] = useState(false);
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full ring-offset-2 ring-offset-[var(--bg)] transition hover:ring-2 hover:ring-[var(--border-strong)]"
        aria-label={`Account menu (${initials})`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Avatar name={user.name} color={user.avatarColor} size={30} />
      </button>
      {open && (
        <>
          <button
            className="fixed inset-0 z-30 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className="animate-in absolute right-0 top-full z-40 mt-2 w-60 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-xl">
            <div className="px-2.5 py-2">
              <p className="truncate text-[13px] font-semibold">{user.name}</p>
              <p className="truncate text-[11px] text-muted">{user.email}</p>
              <span className="badge badge-brand mt-1.5">
                {user.isPlatformOwner ? "Platform owner" : area === "platform" ? "Platform team" : "Institute"}
              </span>
            </div>
            <div className="my-1 h-px bg-[var(--border)]" />
            <Link
              href={area === "platform" ? "/platform/settings" : "/app/settings"}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-[var(--surface-2)]"
              onClick={() => setOpen(false)}
            >
              <Settings className="size-3.5" /> Settings
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--danger)] hover:bg-[var(--danger-soft)]"
              >
                <LogOut className="size-3.5" /> Sign out
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

/** Shared mobile-friendly filter bar. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}
