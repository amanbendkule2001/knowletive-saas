import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  CreditCard,
  GraduationCap,
  Layers,
  Lock,
  ShieldCheck,
  Sparkles,
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
    icon: Sparkles,
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
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 grid-bg opacity-40 [mask-image:radial-gradient(70%_60%_at_50%_0%,#000,transparent)]" />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-8 lg:pb-24 lg:pt-20">
            <div className="animate-in">
              <span className="badge badge-brand">
                <span className="size-1.5 rounded-full bg-[var(--brand)]" />
                Built for schools, colleges & coaching
              </span>
              <h1 className="mt-5 text-[2.1rem] font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.35rem]">
                Run every institute from{" "}
                <span className="text-gradient">one platform.</span>
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base">
                Knowletive gives platform owners complete control of institutes, roles, students,
                parents, subscriptions and AI — while each institute gets a fast, focused workspace
                of its own.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link href="/login" className="btn btn-primary px-5 py-3">
                  Explore the live demo <ArrowRight className="size-4" />
                </Link>
                <a href="#platform" className="btn btn-secondary px-5 py-3">
                  See the platform console
                </a>
              </div>
              <p className="mt-3 text-xs text-muted">
                Seeded with 5 institutes, 280+ students and real dashboards. No signup required.
              </p>

              <dl className="mt-9 grid max-w-lg grid-cols-2 gap-x-6 gap-y-4 border-t border-[var(--border)] pt-6 sm:grid-cols-4">
                {[
                  ["7", "ready roles"],
                  ["18", "permissions"],
                  ["6", "AI modules"],
                  ["100%", "tenant isolation"],
                ].map(([value, label]) => (
                  <div key={label}>
                    <dt className="text-xl font-semibold tabular-nums">{value}</dt>
                    <dd className="text-[11px] text-muted">{label}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Product mock */}
            <div className="relative animate-in lg:pl-4" aria-hidden>
              <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-indigo-500/15 via-violet-500/10 to-cyan-400/15 blur-2xl" />
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_-30px_rgb(15_23_42/0.45)]">
                <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <LogoMark size={22} />
                    <span className="text-[11px] font-semibold">Sunrise Public School</span>
                  </div>
                  <span className="badge badge-success">Active</span>
                </div>
                <div className="grid grid-cols-3 gap-2 p-4">
                  {[
                    ["Students", "1,284", "+6.2%"],
                    ["Attendance", "94.1%", "today"],
                    ["Collected", "₹18.4L", "this term"],
                  ].map(([label, value, sub]) => (
                    <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
                      <p className="text-[9px] uppercase tracking-wide text-muted">{label}</p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
                      <p className="text-[9px] text-[var(--success)]">{sub}</p>
                    </div>
                  ))}
                </div>
                <div className="mx-4 rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-end justify-between">
                    <p className="text-[10px] font-medium">Fee collection</p>
                    <span className="text-[9px] text-muted">last 8 months</span>
                  </div>
                  <div className="mt-3 flex h-24 items-end gap-1.5">
                    {[38, 56, 44, 72, 61, 86, 74, 94].map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t bg-gradient-to-t from-indigo-500/25 to-indigo-500"
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] p-4">
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-[9px] font-bold text-white">
                      AI
                    </span>
                    <div>
                      <p className="text-[10px] font-semibold">Report card remarks</p>
                      <p className="text-[9px] text-muted">32 drafts saved this week</p>
                    </div>
                  </div>
                  <span className="badge badge-brand">Growth plan</span>
                </div>
              </div>
              <div className="absolute -bottom-4 -left-3 hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg sm:block">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold">
                  <Lock className="size-3 text-[var(--success)]" /> Tenant-scoped by default
                </p>
                <p className="mt-0.5 text-[9px] text-muted">Every query filtered by institute</p>
              </div>
            </div>
          </div>
        </section>

        {/* Modules */}
        <section id="modules" className="border-t border-[var(--border)] bg-[var(--surface)]/45 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">Modules</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                The whole institute, without the spreadsheet sprawl.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Each module respects the same permission model and subscription entitlements. Turn a
                feature on for a plan and it appears for every institute on that plan — instantly.
              </p>
            </div>
            <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((m) => (
                <div key={m.title} className="card card-hover p-5">
                  <span className="grid size-9 place-items-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                    <m.icon className="size-4.5" />
                  </span>
                  <h3 className="mt-3.5 text-sm font-semibold">{m.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">{m.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {roles.map((r) => (
                <span key={r} className="badge badge-neutral">
                  <Check className="size-3 text-[var(--success)]" /> {r}
                </span>
              ))}
              <span className="badge badge-brand">+ custom roles</span>
            </div>
          </div>
        </section>

        {/* Platform owner */}
        <section id="platform" className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
                Platform console
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                You decide what every institute can access.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                The platform owner owns the product surface, not just the billing. Create institutes,
                assign plans, edit entitlements, extend trials, reset roles and audit every sensitive
                action from one console.
              </p>
              <ul className="mt-5 space-y-2.5">
                {[
                  "Create an institute and its admin in one step",
                  "Feature matrix per plan — change once, applies everywhere",
                  "Trials, plan changes, GST invoices and payment status",
                  "Granular audit trail across platform and institutes",
                  "Support access to any workspace, explicitly and visibly",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-[13px]">
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">
                      <Check className="size-2.5" />
                    </span>
                    <span className="text-muted">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card overflow-hidden" aria-hidden>
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <p className="text-xs font-semibold">Plan entitlements</p>
                <span className="badge badge-neutral">Editing: Growth</span>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {FEATURES.slice(0, 7).map((f, i) => (
                  <div key={f.key} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Layers className="size-3.5 shrink-0 text-[var(--muted-2)]" />
                      <span className="truncate text-[12px]">{f.label}</span>
                    </div>
                    <span
                      className={`relative h-4 w-7 shrink-0 rounded-full ${i < 5 ? "bg-[var(--brand)]" : "bg-[var(--surface-3)]"}`}
                    >
                      <span
                        className={`absolute top-0.5 size-3 rounded-full bg-white shadow ${i < 5 ? "left-3.5" : "left-0.5"}`}
                      />
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
                <p className="text-[10px] text-muted">Applies to 2 institutes on this plan</p>
                <span className="btn btn-primary btn-sm">Save changes</span>
              </div>
            </div>
          </div>
        </section>

        {/* AI */}
        <section id="ai" className="border-y border-[var(--border)] bg-[var(--surface)]/45 py-16 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div className="order-2 lg:order-1">
              <div className="card overflow-hidden">
                <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
                  <Sparkles className="size-4 text-[var(--brand)]" />
                  <p className="text-xs font-semibold">AI Studio · report card remarks</p>
                  <span className="badge badge-brand ml-auto">2 credits</span>
                </div>
                <div className="p-4">
                  <div className="rounded-lg bg-[var(--surface-2)] p-3 text-[11px] leading-relaxed text-muted">
                    Student: Aarav Sharma, Class 6-B. Maths 78, Science 84, English 71. Hardworking,
                    improves steadily, needs to participate more.
                  </div>
                  <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
                    <p className="text-[11px] font-semibold">Generated draft</p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                      Aarav has had a steady term and shows genuine curiosity in Science. Mathematics
                      is improving with consistent practice, while written accuracy in English needs a
                      little more attention. A 15-minute daily revision routine and one question asked
                      in class each day would help…
                    </p>
                    <div className="mt-3 flex gap-2">
                      <span className="btn btn-primary btn-sm">Insert into report card</span>
                      <span className="btn btn-secondary btn-sm">Copy</span>
                    </div>
                  </div>
                </div>
                <div className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-[10px] text-muted">
                  Demo mode runs without a key. Add OPENAI_API_KEY to switch to a live model.
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">AI modules</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Useful AI, not a chatbot bolted on.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Six focused modules that remove the work teachers and accountants actually dread.
                Every call is metered against the institute&apos;s plan, logged, and refunded if the
                provider fails.
              </p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {[
                  ["Report card remarks", "FileText"],
                  ["Lesson plans", "BookOpen"],
                  ["Question papers", "ClipboardList"],
                  ["Fee reminders", "Wallet"],
                  ["Admission replies", "MessageSquare"],
                  ["Attendance insights", "TrendingUp"],
                ].map(([label, icon]) => (
                  <div key={label} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px]">
                    <span className="size-1.5 rounded-full bg-[var(--brand)]" />
                    {label}
                    <span className="sr-only">{icon}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2 text-[11px] text-muted">
                <Zap className="size-3.5 text-[var(--warning)]" />
                Per-tenant credit limits · atomic deduction · full job log
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">Pricing</p>
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
                  className={`card relative p-5 ${p.highlighted ? "border-[var(--brand)] shadow-[0_0_0_3px_var(--brand-soft)]" : ""}`}
                >
                  {p.highlighted && (
                    <span className="badge badge-brand absolute -top-2.5 left-5">Most popular</span>
                  )}
                  <h3 className="text-sm font-semibold">{p.name}</h3>
                  <p className="mt-1 min-h-[2.5rem] text-[11px] leading-relaxed text-muted">{p.description}</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight">
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
                    {p.key === "scale" ? "Talk to us" : "Start a trial"}
                  </Link>
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-[11px] text-muted">
              Prices exclude 18% GST. Enterprise plans are assigned privately by the platform team.
            </p>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="border-t border-[var(--border)] bg-[var(--surface)]/45 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">Trust</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Secure and fast by default, not by promise.
              </h2>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Lock, title: "Tenant isolation", body: "Every read and write scoped to the active institute, enforced server-side." },
                { icon: ShieldCheck, title: "RBAC + audit", body: "Role matrix, per-user overrides and an append-only audit trail." },
                { icon: Zap, title: "Fast on slow phones", body: "Server components, minimal client JS, pagination and indexed queries." },
                { icon: CreditCard, title: "Billing safe by design", body: "Signed webhooks, idempotent payments and fail-closed entitlements." },
              ].map((c) => (
                <div key={c.title} className="card p-4">
                  <c.icon className="size-4 text-[var(--brand)]" />
                  <p className="mt-2.5 text-[13px] font-semibold">{c.title}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="relative overflow-hidden rounded-2xl px-6 py-12 text-center brand-gradient sm:px-12 sm:py-16">
              <div className="absolute inset-0 grid-bg opacity-20 mix-blend-overlay" />
              <div className="relative">
                <LogoMark size={42} className="mx-auto" />
                <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Open the demo. Break things. See the whole product.
                </h2>
                <p className="mx-auto mt-2 max-w-lg text-sm text-white/80">
                  Five seeded institutes, live RBAC, subscription console and AI Studio — ready in
                  under a minute.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link href="/login" className="btn bg-white px-5 py-3 text-slate-900 hover:bg-slate-100">
                    Sign in to the demo <ArrowRight className="size-4" />
                  </Link>
                  <a href="#modules" className="btn border-white/30 bg-white/10 px-5 py-3 text-white backdrop-blur hover:bg-white/20">
                    Browse modules
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border)] py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <Logo href="/" size={26} subtitle="Institute OS" />
          <p className="text-[11px] text-muted">
            © {new Date().getFullYear()} Knowletive. Multi-tenant institute platform.
          </p>
          <div className="flex gap-4 text-[11px] text-muted">
            <Link href="/login" className="hover:text-[var(--text)]">Sign in</Link>
            <a href="#security" className="hover:text-[var(--text)]">Security</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
