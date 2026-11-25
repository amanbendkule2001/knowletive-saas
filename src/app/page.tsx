import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  Cpu,
  CreditCard,
  GraduationCap,
  Layers,
  Lock,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Logo, LogoMark } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { money } from "@/lib/format";
import { PLAN_SEEDS, FEATURES } from "@/lib/catalog";

const modules = [
  {
    icon: Building2,
    title: "Multi-tenant institutes",
    body: "Onboard schools, colleges and coaching centres with their own branding, data boundary and subscription.",
  },
  {
    icon: ShieldCheck,
    title: "Roles & permissions",
    body: "18 granular permissions, seven ready roles and a live matrix. Change what a teacher or accountant can see in seconds.",
  },
  {
    icon: GraduationCap,
    title: "Students & parents",
    body: "Admissions, class allocation, guardian links, attendance, fee ledgers and a parent portal foundation.",
  },
  {
    icon: CreditCard,
    title: "Subscriptions & billing",
    body: "Plans, trials, entitlements, GST invoices and payment status. Provider-agnostic: manual today, Razorpay or Stripe tomorrow.",
  },
  {
    icon: Cpu,
    title: "AI Studio",
    body: "Report card remarks, lesson plans, question papers, fee reminders and attendance insights — metered per institute.",
  },
  {
    icon: BarChart3,
    title: "Operational analytics",
    body: "Enrolment, collection, attendance and AI usage in one glance. Server-rendered, fast on a ₹8,000 phone.",
  },
];

const roles = ["Institute admin", "Principal", "Teacher", "Accountant", "Front desk", "Parent", "Student"];

export default function LandingPage() {
  const plans = PLAN_SEEDS.filter((p) => p.isPublic);

  return (
    <div className="min-h-dvh overflow-x-hidden">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo href="/" subtitle="Institute OS" />
          <nav className="hidden items-center gap-6 text-[13px] font-medium text-muted md:flex">
            <a href="#modules" className="hover:text-[var(--text)]">Modules</a>
            <a href="#platform" className="hover:text-[var(--text)]">For platform owners</a>
            <a href="#ai" className="hover:text-[var(--text)]">AI</a>
            <a href="#pricing" className="hover:text-[var(--text)]">Pricing</a>
            <a href="#security" className="hover:text-[var(--text)]">Security</a>
          </nav>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Link href="/login" className="btn btn-ghost hidden sm:inline-flex">Sign in</Link>
            <Link href="/login" className="btn btn-primary">
              Get started <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative">
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12 lg:pb-24 lg:pt-16">
            <div className="animate-in">
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="size-1.5 rounded-full bg-[var(--brand)]" />
                <span>Multi-tenant academic operations</span>
              </div>
              <h1 className="mt-4 text-3xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.25rem]">
                Run every institute from one platform.
              </h1>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base">
                Coachgenie gives platform owners complete control of institutes, roles, students,
                parents, subscriptions and AI — while each institute gets a fast, focused workspace
                of its own.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link href="/login" className="btn btn-primary px-5 py-2.5">
                  Explore live demo <ArrowRight className="size-4" />
                </Link>
                <a href="#platform" className="btn btn-secondary px-5 py-2.5">
                  Platform console
                </a>
              </div>
              <p className="mt-3 text-xs text-muted">
                Pre-loaded with 5 institutes, 280+ students and ledger records. No signup required.
              </p>

              <dl className="mt-8 grid max-w-lg grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--border)] pt-6 sm:grid-cols-4">
                {[
                  ["7", "Ready roles"],
                  ["18", "Permissions"],
                  ["6", "AI workflows"],
                  ["100%", "Tenant isolation"],
                ].map(([value, label]) => (
                  <div key={label}>
                    <dt className="text-xl font-semibold tabular-nums">{value}</dt>
                    <dd className="mt-0.5 text-[11px] text-muted">{label}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Product mock */}
            <div className="relative animate-in lg:pl-2" aria-hidden>
              <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-md)]">
                <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <LogoMark size={20} />
                    <span className="text-xs font-medium">Sunrise Public School</span>
                    <span className="text-[10px] tabular-nums text-muted">· inst_01k9</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[var(--success)]" />
                    <span className="text-[11px] text-muted">Active</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5 p-4">
                  {[
                    ["Enrolled students", "1,284", "+6.2% vs last term"],
                    ["Attendance today", "94.1%", "1,208 present"],
                    ["Collected this term", "₹18,40,000", "91.2% of billed"],
                  ].map(([label, value, sub]) => (
                    <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                      <p className="text-[11px] text-muted">{label}</p>
                      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
                      <p className="mt-0.5 text-[10px] text-muted">{sub}</p>
                    </div>
                  ))}
                </div>

                <div className="mx-4 rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <p className="text-xs font-medium">Fee collection</p>
                      <p className="text-[11px] text-muted">Monthly receipts across all batches</p>
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-muted">FY 2025–26</span>
                  </div>
                  <div className="mt-4 flex h-24 items-end gap-2">
                    {[
                      { h: 42, m: "Apr" },
                      { h: 58, m: "May" },
                      { h: 51, m: "Jun" },
                      { h: 76, m: "Jul" },
                      { h: 68, m: "Aug" },
                      { h: 84, m: "Sep" },
                      { h: 79, m: "Oct" },
                      { h: 96, m: "Nov", current: true },
                    ].map((bar, i) => (
                      <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                        <div
                          className={`w-full rounded-xs transition-colors ${
                            bar.current ? "bg-[var(--brand)]" : "bg-[var(--surface-3)]"
                          }`}
                          style={{ height: `${bar.h}%` }}
                        />
                        <span className="font-mono text-[9px] text-muted">{bar.m}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted">Isolation:</span>
                    <span className="text-muted">Tenant-scoped query filter active</span>
                  </div>
                  <span className="badge badge-neutral font-mono">Growth tier</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Modules */}
        <section id="modules" className="border-t border-[var(--border)] bg-[var(--surface-2)]/50 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-xs font-medium text-[var(--brand)]">Academic modules</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                The whole institute, without the spreadsheet sprawl.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Each module respects the same permission model and subscription entitlements. Turn a
                feature on for a plan and it appears for every institute on that plan immediately.
              </p>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((m) => (
                <div key={m.title} className="card card-hover p-5">
                  <span className="grid size-8 place-items-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]">
                    <m.icon className="size-4" />
                  </span>
                  <h3 className="mt-3.5 text-sm font-semibold">{m.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">{m.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-5 text-xs text-muted">
              <span className="font-medium text-[var(--text)]">Default role matrix:</span>
              {roles.map((r, i) => (
                <span key={r} className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                  {r}
                  {i < roles.length - 1 && <span className="text-[var(--border-strong)]">·</span>}
                </span>
              ))}
              <span className="ml-auto text-[11px] text-muted">+ custom tenant roles</span>
            </div>
          </div>
        </section>

        {/* Platform owner */}
        <section id="platform" className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-medium text-[var(--brand)]">Platform governance</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                You decide what every institute can access.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                The platform owner owns the product surface, not just the billing. Create institutes,
                assign plans, edit entitlements, extend trials, reset roles and audit every sensitive
                action from one console.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  "Create an institute and its admin in one step",
                  "Feature matrix per plan — change once, applies everywhere",
                  "Trials, plan changes, GST invoices and payment status",
                  "Granular audit trail across platform and institutes",
                  "Support access to any workspace, explicitly and visibly",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[13px]">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--success)]" />
                    <span className="text-muted">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card overflow-hidden" aria-hidden>
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <div>
                  <p className="text-xs font-semibold">Plan entitlements</p>
                  <p className="text-[11px] text-muted">Configuring Growth tier</p>
                </div>
                <span className="badge badge-neutral font-mono text-[10px]">Active</span>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {FEATURES.slice(0, 7).map((f, i) => (
                  <div key={f.key} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Layers className="size-3.5 shrink-0 text-[var(--muted-2)]" />
                      <span className="truncate text-[12px]">{f.label}</span>
                    </div>
                    <span
                      className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
                        i < 5 ? "bg-[var(--brand)]" : "bg-[var(--surface-3)]"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 size-3 rounded-full bg-white transition-all shadow-xs ${
                          i < 5 ? "left-3.5" : "left-0.5"
                        }`}
                      />
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
                <p className="text-[11px] text-muted">Applies to 2 institutes on this plan</p>
                <span className="btn btn-primary btn-sm">Save changes</span>
              </div>
            </div>
          </div>
        </section>

        {/* AI */}
        <section id="ai" className="border-y border-[var(--border)] bg-[var(--surface-2)]/50 py-16 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div className="order-2 lg:order-1">
              <div className="card overflow-hidden">
                <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
                  <Cpu className="size-3.5 text-[var(--brand)]" />
                  <p className="text-xs font-semibold">AI Studio · Academic remarks</p>
                  <span className="ml-auto font-mono text-[10px] text-muted">2 credits / run</span>
                </div>
                <div className="p-4">
                  <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[11px] leading-relaxed text-muted">
                    <span className="font-medium text-[var(--text)]">Input context:</span> Class 6-B · Aarav Sharma. Mathematics 78, Science 84, English 71. Regular attendance, active in science lab, needs encouragement in class discussions.
                  </div>
                  <div className="mt-3 rounded-md border border-[var(--border)] p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold">Draft remark</p>
                      <span className="font-mono text-[9px] text-muted">Term 1 report</span>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted">
                      Aarav has shown commendable dedication this term, demonstrating genuine curiosity in Science experiments. Mathematics scores reflect steady conceptual understanding. With greater active participation during classroom discussions, his overall confidence will continue to flourish.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <span className="btn btn-primary btn-sm">Insert into ledger</span>
                      <span className="btn btn-secondary btn-sm">Copy text</span>
                    </div>
                  </div>
                </div>
                <div className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-[10px] text-muted">
                  Runs via deterministic schema output with per-institute quota allocation.
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <p className="text-xs font-medium text-[var(--brand)]">Academic automation</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Useful AI, not a chatbot bolted on.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Six focused modules that remove the work teachers and accountants actually dread.
                Every call is metered against the institute&apos;s plan, logged, and refunded if the
                provider fails.
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {[
                  "Report card remarks",
                  "Lesson plans",
                  "Question papers",
                  "Fee reminders",
                  "Admission replies",
                  "Attendance insights",
                ].map((label) => (
                  <div key={label} className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px]">
                    <span className="size-1.5 rounded-full bg-[var(--brand)]" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2 text-[11px] text-muted">
                <span className="font-mono text-[10px]">Governance:</span>
                <span>Per-tenant credit limits · Atomic quota deduction · Full audit trail</span>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="text-center">
              <p className="text-xs font-medium text-[var(--brand)]">Subscription plans</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Plans the platform owner controls
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-muted">
                Prices, limits and features are data — not code. Edit them in the console and every
                institute sees the new entitlements.
              </p>
            </div>
            <div className="mt-9 grid gap-4 lg:grid-cols-3">
              {plans.map((p) => (
                <div
                  key={p.key}
                  className={`card relative p-5 ${
                    p.highlighted ? "border-[var(--brand)]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold">{p.name}</h3>
                    {p.highlighted && (
                      <span className="badge badge-brand font-mono text-[10px]">Recommended</span>
                    )}
                  </div>
                  <p className="mt-1 min-h-[2.5rem] text-[11px] leading-relaxed text-muted">{p.description}</p>
                  <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
                    {money(p.priceMonthly, "INR")}
                    <span className="text-xs font-normal text-muted"> / month</span>
                  </p>
                  <p className="text-[10px] text-muted">
                    or {money(p.priceYearly, "INR")} billed yearly
                  </p>
                  <ul className="mt-4 space-y-1.5 border-t border-[var(--border)] pt-4">
                    {[
                      `Up to ${p.maxStudents.toLocaleString("en-IN")} students`,
                      `${p.maxStaff} staff accounts`,
                      `${p.aiCreditsMonthly.toLocaleString("en-IN")} AI credits / month`,
                      `${p.features.length} modules included`,
                    ].map((line) => (
                      <li key={line} className="flex items-center gap-2 text-[11px] text-muted">
                        <Check className="size-3 text-[var(--success)]" /> {line}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/login"
                    className={`btn mt-5 w-full ${p.highlighted ? "btn-primary" : "btn-secondary"}`}
                  >
                    {p.key === "scale" ? "Contact sales" : "Start trial"}
                  </Link>
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-[11px] text-muted">
              Prices exclude 18% GST. Enterprise plans are provisioned directly from the platform console.
            </p>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="border-t border-[var(--border)] bg-[var(--surface-2)]/50 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-xs font-medium text-[var(--brand)]">Platform security</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Secure and fast by default, not by promise.
              </h2>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Lock, title: "Tenant isolation", body: "Every read and write scoped to the active institute, enforced server-side." },
                { icon: ShieldCheck, title: "RBAC & audit log", body: "Role matrix, per-user overrides and an append-only audit trail." },
                { icon: Zap, title: "Low-bandwidth speed", body: "Server components, minimal client JS, pagination and indexed queries." },
                { icon: CreditCard, title: "Deterministic billing", body: "Signed webhooks, idempotent payments and fail-closed entitlements." },
              ].map((c) => (
                <div key={c.title} className="card p-4">
                  <span className="grid size-7 place-items-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]">
                    <c.icon className="size-3.5" />
                  </span>
                  <p className="mt-3 text-[13px] font-semibold">{c.title}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="card overflow-hidden border border-[var(--border)] bg-[var(--surface-2)] px-6 py-12 text-center sm:px-12 sm:py-16">
              <div className="mx-auto max-w-2xl">
                <LogoMark size={36} className="mx-auto" />
                <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                  Explore the platform environment.
                </h2>
                <p className="mx-auto mt-2.5 max-w-lg text-sm leading-relaxed text-muted">
                  Five pre-configured institutes, live role matrix, billing ledger and academic workflows — testable without onboarding delay.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link href="/login" className="btn btn-primary px-5 py-2.5">
                    Launch live demo <ArrowRight className="size-4" />
                  </Link>
                  <a href="#modules" className="btn btn-secondary px-5 py-2.5">
                    Review modules
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border)] py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <Logo href="/" size={24} subtitle="Institute OS" />
          <p className="text-[11px] text-muted">
            © {new Date().getFullYear()} Coachgenie · Multi-tenant institute platform.
          </p>
          <div className="flex gap-4 text-[11px] text-muted">
            <Link href="/login" className="hover:text-[var(--text)]">Sign in</Link>
            <a href="#platform" className="hover:text-[var(--text)]">Platform console</a>
            <a href="#security" className="hover:text-[var(--text)]">Security & isolation</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
