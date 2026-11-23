import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ShieldCheck, Sparkles } from "lucide-react";
import { getSession } from "@/lib/auth";
import { STAFF_ROLE_KEYS } from "@/lib/catalog";
import { Logo, LogoMark } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LoginFormClient } from "./login-form-client";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const session = await getSession();
  if (session) {
    if (session.isPlatformOwner || session.platformPermissions.length > 0) {
      redirect("/platform");
    }
    if (session.memberships.length > 1) {
      redirect("/select-institute");
    }
    if (session.memberships.length === 1) {
      const isStaff = STAFF_ROLE_KEYS.has(session.memberships[0].roleKey);
      redirect(isStaff ? "/app" : "/portal");
    }
    redirect("/app");
  }

  const { email } = await searchParams;
  const preset =
    DEMO_ACCOUNTS.find((a) => a.email.toLowerCase() === email?.toLowerCase())?.email ??
    (email ?? "owner@coachgenie.in");

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_0.95fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden brand-gradient p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 grid-bg opacity-20 mix-blend-overlay" />
        <div className="relative">
          <Link href="/" className="inline-flex items-center gap-2.5 text-white">
            <LogoMark size={34} />
            <span className="text-[15px] font-semibold">Coachgenie</span>
          </Link>
        </div>
        <div className="relative max-w-md">
          <span className="badge border-white/25 bg-white/10 text-white">
            <Sparkles className="size-3" /> Institute operating system
          </span>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight">
            One console for every institute you run.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/75">
            Roles, students, parents, attendance, fee collection, subscriptions and metered AI —
            all behind one clean, tenant-aware permission model.
          </p>
          <ul className="mt-7 space-y-2.5 text-[13px] text-white/85">
            {[
              "Role-based access with per-institute isolation",
              "Plans, trials, entitlements and GST invoices",
              "AI modules metered against each subscription",
              "Audit trail on every sensitive action",
            ].map((line) => (
              <li key={line} className="flex items-center gap-2.5">
                <span className="grid size-4 place-items-center rounded-full bg-white/20">
                  <Check className="size-2.5" />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex items-center gap-2 text-[11px] text-white/60">
          <ShieldCheck className="size-3.5" /> Tenant-scoped queries · httpOnly sessions · rate-limited auth
        </div>
      </div>

      {/* Form */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="lg:hidden">
            <Logo href="/" subtitle="Institute OS" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/" className="btn btn-ghost btn-sm">Back to site</Link>
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-[28rem] sm:max-w-xl xl:max-w-2xl transition-all duration-200">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
              <p className="mt-1 text-sm text-muted">
                Sign in to the platform console or your institute workspace.
              </p>
            </div>

            <LoginFormClient initialEmail={preset} />

            <p className="mt-6 text-center text-[11px] text-muted">
              New institute?{" "}
              <a href="mailto:support@coachgenie.in" className="link">
                Talk to the platform team
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
