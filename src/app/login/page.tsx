import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Check, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { getSession } from "@/lib/auth";
import { STAFF_ROLE_KEYS } from "@/lib/catalog";
import { loginAction } from "@/actions/auth";
import { ActionForm } from "@/components/ui/action-form";
import { Field } from "@/components/ui/form-field";
import { Logo, LogoMark } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export const metadata = { title: "Sign in" };

const demoAccounts = [
  { label: "Platform owner", email: "owner@knowletive.com", hint: "Full control of institutes, plans, billing" },
  { label: "Platform support", email: "support@knowletive.com", hint: "Read-only platform access" },
  { label: "Institute admin", email: "admin@sunrise.test", hint: "Sunrise Public School workspace" },
  { label: "Teacher", email: "teacher@sunrise.test", hint: "Limited classroom permissions" },
];

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
  const preset = demoAccounts.find((a) => a.email === email)?.email ?? "owner@knowletive.com";

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_0.95fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden brand-gradient p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 grid-bg opacity-20 mix-blend-overlay" />
        <div className="relative">
          <Link href="/" className="inline-flex items-center gap-2.5 text-white">
            <LogoMark size={34} />
            <span className="text-[15px] font-semibold">Knowletive</span>
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

        <div className="flex flex-1 items-center justify-center px-4 pb-10 sm:px-8">
          <div className="w-full max-w-[26rem]">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
              <p className="mt-1 text-sm text-muted">
                Sign in to the platform console or your institute workspace.
              </p>
            </div>

            <div className="card p-5 sm:p-6">
              <ActionForm action={loginAction} submitLabel="Sign in" pendingLabel="Signing in…" submitClassName="w-full">
                <Field label="Work email" htmlFor="email" required>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    required
                    defaultValue={preset}
                    className="input"
                    placeholder="you@institute.edu"
                  />
                </Field>
                <Field label="Password" htmlFor="password" required>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    defaultValue="Admin@123"
                    className="input"
                    placeholder="••••••••"
                  />
                </Field>
                <div className="flex items-center justify-between text-[11px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <Lock className="size-3" /> Secured with httpOnly session cookies
                  </span>
                  <a href="mailto:support@knowletive.com" className="link">
                    Need help?
                  </a>
                </div>
              </ActionForm>
            </div>

            <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Demo accounts · password Admin@123
              </p>
              <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
                {demoAccounts.map((a) => (
                  <Link
                    key={a.email}
                    href={`/login?email=${encodeURIComponent(a.email)}`}
                    className="group rounded-lg border border-transparent px-2.5 py-2 transition hover:border-[var(--border)] hover:bg-[var(--surface-2)]"
                  >
                    <p className="flex items-center justify-between gap-1 text-[12px] font-medium">
                      {a.label}
                      <ArrowRight className="size-3 opacity-0 transition group-hover:opacity-100" />
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-muted">{a.email}</p>
                  </Link>
                ))}
              </div>
            </div>

            <p className="mt-5 text-center text-[11px] text-muted">
              New institute?{" "}
              <a href="mailto:support@knowletive.com" className="link">
                Talk to the platform team
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
