"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, Lock, Shield, School, UserCircle2 } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { Field } from "@/components/ui/form-field";
import { loginAction } from "@/actions/auth";
import { DEMO_ACCOUNTS, type DemoAccount } from "@/lib/demo-accounts";

type CategoryFilter = "ALL" | "Institute" | "Platform" | "Portal";

export function LoginFormClient({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("Admin@123");
  const [showPassword, setShowPassword] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("ALL");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const handleSelectAccount = (account: DemoAccount) => {
    setEmail(account.email);
    setPassword("Admin@123");

    // Update URL query parameter without triggering full page reload
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("email", account.email);
      window.history.replaceState(null, "", url.toString());
    }
  };

  const filteredAccounts =
    activeCategory === "ALL"
      ? DEMO_ACCOUNTS
      : DEMO_ACCOUNTS.filter((a) => a.category === activeCategory);

  const categoryCounts = {
    ALL: DEMO_ACCOUNTS.length,
    Institute: DEMO_ACCOUNTS.filter((a) => a.category === "Institute").length,
    Platform: DEMO_ACCOUNTS.filter((a) => a.category === "Platform").length,
    Portal: DEMO_ACCOUNTS.filter((a) => a.category === "Portal").length,
  };

  return (
    <div className="space-y-5" data-hydrated={hydrated ? "true" : "false"}>
      {/* Login Card */}
      <div className="card p-5 sm:p-6 shadow-sm">
        <ActionForm
          action={loginAction}
          submitLabel="Sign in"
          pendingLabel="Signing in…"
          submitClassName="w-full"
        >
          <Field label="Email or Login ID" htmlFor="email" required>
            <input
              id="email"
              name="email"
              type="text"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input transition duration-150 focus:border-[var(--brand)]"
              placeholder="Email, admission no, or phone"
            />
          </Field>
          <Field label="Password" htmlFor="password" required>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input transition duration-150 focus:border-[var(--brand)] pr-10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-[var(--text)] transition"
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <Lock className="size-3" /> Secured with httpOnly session cookies
            </span>
            <a href="mailto:support@coachgenie.in" className="link">
              Need help?
            </a>
          </div>
        </ActionForm>
      </div>

      {/* Demo Credentials Picker with Responsive Auto-Adjust Grid */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold text-muted">
              <span className="uppercase tracking-[0.12em]">Demo Accounts · Password</span>{" "}
              <span className="font-mono font-bold text-[var(--brand)] normal-case">Admin@123</span>{" "}
              <span className="text-[10px] text-muted normal-case font-normal">(case-sensitive: capital &apos;A&apos;)</span>
            </p>
            <p className="text-[11px] text-muted mt-0.5">
              Click any role to autofill tested credentials immediately.
            </p>
          </div>
        </div>

        {/* Category Filter Pills for Quick Device Navigation */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] pb-2.5">
          {(["ALL", "Institute", "Platform", "Portal"] as const).map((cat) => {
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                  isActive
                    ? "bg-[var(--brand)] text-white shadow-xs"
                    : "text-muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                }`}
              >
                {cat === "ALL" && "All"}
                {cat === "Institute" && (
                  <>
                    <School className="size-3" /> Institute
                  </>
                )}
                {cat === "Platform" && (
                  <>
                    <Shield className="size-3" /> Platform
                  </>
                )}
                {cat === "Portal" && (
                  <>
                    <UserCircle2 className="size-3" /> Portal
                  </>
                )}
                <span
                  className={`ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] ${
                    isActive ? "bg-white/20 text-white" : "bg-[var(--surface-3)] text-muted"
                  }`}
                >
                  {categoryCounts[cat]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Responsive Grid: Automatically adjusts columns based on viewport */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[380px] overflow-y-auto pr-0.5">
          {filteredAccounts.map((a) => {
            const isSelected = email.trim().toLowerCase() === a.email.toLowerCase();
            return (
              <button
                key={a.email}
                type="button"
                onClick={() => handleSelectAccount(a)}
                title={a.hint}
                className={`group relative flex flex-col justify-between rounded-xl border p-2.5 text-left transition duration-150 ${
                  isSelected
                    ? "border-[var(--brand)] bg-[var(--brand-soft)]/25 ring-1.5 ring-[var(--brand)] shadow-xs"
                    : "border-[var(--border)] bg-[var(--surface-2)]/60 hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
                }`}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <span className="text-[12px] font-semibold text-[var(--text)] leading-tight">
                    {a.label}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${
                      isSelected
                        ? "bg-[var(--brand)] text-white"
                        : a.category === "Platform"
                        ? "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300"
                        : a.category === "Portal"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                        : "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                    }`}
                  >
                    {a.badge}
                  </span>
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-1">
                  <p className="truncate font-mono text-[10.5px] text-muted group-hover:text-[var(--text)]">
                    {a.email}
                  </p>
                  {isSelected ? (
                    <span className="flex items-center gap-0.5 text-[10px] font-medium text-[var(--brand)] shrink-0">
                      <Check className="size-3" /> Filled
                    </span>
                  ) : (
                    <ArrowRight className="size-3 text-muted opacity-0 transition group-hover:opacity-100 shrink-0" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

