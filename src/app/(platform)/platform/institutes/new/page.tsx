import Link from "next/link";
import { Building2, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformPermission } from "@/lib/rbac";
import { createInstituteAction } from "@/actions/platform";
import { ActionForm } from "@/components/ui/action-form";
import { Field, FormGrid } from "@/components/ui/form-field";
import { Callout, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { money } from "@/lib/format";

export const metadata = { title: "New institute" };

export default async function NewInstitutePage() {
  await requirePlatformPermission("platform.institutes.manage");
  const plans = await db.plan.findMany({ where: { isArchived: false }, orderBy: { sortOrder: "asc" } });
  const defaultPlan = plans.find((p) => p.highlighted) ?? plans[0];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        eyebrow="Platform"
        title="Create an institute"
        description="This creates the workspace, its subscription and the first institute admin in one transaction."
        actions={
          <Link href="/platform/institutes" className="btn btn-secondary">
            Back to institutes
          </Link>
        }
      />

      <Callout tone="info" icon={<ShieldCheck className="size-4" />} title="What happens next">
        The institute starts on a trial with seven seeded roles. The admin you create can sign in
        immediately and invite staff. You can change the plan or extend the trial at any time.
      </Callout>

      <Card>
        <CardHeader title="Institute & first administrator" description="All fields are required unless marked optional." />
        <div className="p-4 sm:p-5">
          <ActionForm
            action={createInstituteAction}
            submitLabel="Create institute"
            pendingLabel="Creating…"
            cancelHref="/platform/institutes"
          >
            <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold">
              <Building2 className="size-4 text-[var(--brand)]" /> Institute details
            </div>
            <FormGrid>
              <Field label="Institute name" htmlFor="name" required className="sm:col-span-2">
                <input id="name" name="name" required className="input" placeholder="Sunrise Public School" />
              </Field>
              <Field label="Type" htmlFor="type" required>
                <select id="type" name="type" className="select" defaultValue="SCHOOL">
                  <option value="SCHOOL">School (K–12)</option>
                  <option value="COLLEGE">College / junior college</option>
                  <option value="COACHING">Coaching / academy</option>
                </select>
              </Field>
              <Field label="City" htmlFor="city">
                <input id="city" name="city" className="input" placeholder="Pune" />
              </Field>
              <Field label="Institute email" htmlFor="email" required>
                <input id="email" name="email" type="email" required className="input" placeholder="office@school.edu" />
              </Field>
              <Field label="Phone (optional)" htmlFor="phone">
                <input id="phone" name="phone" className="input" placeholder="+91 98765 43210" />
              </Field>
            </FormGrid>

            <div className="my-5 h-px bg-[var(--border)]" />

            <div className="mb-4 flex items-center gap-2 text-[13px] font-semibold">
              <ShieldCheck className="size-4 text-[var(--brand)]" /> Subscription & admin
            </div>
            <FormGrid>
              <Field label="Plan" htmlFor="planKey" required>
                <select id="planKey" name="planKey" className="select" defaultValue={defaultPlan?.key}>
                  {plans.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} — {p.isPublic ? money(p.priceMonthly) + "/mo" : "Custom"} · {p.maxStudents} students
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Trial length (days)" htmlFor="trialDays" hint="Set 0 to start as active (no trial).">
                <input id="trialDays" name="trialDays" type="number" min={0} max={90} defaultValue={14} className="input" />
              </Field>
              <Field label="Admin name" htmlFor="adminName" required>
                <input id="adminName" name="adminName" required className="input" placeholder="Ananya Deshmukh" />
              </Field>
              <Field label="Admin email" htmlFor="adminEmail" required>
                <input id="adminEmail" name="adminEmail" type="email" required className="input" placeholder="admin@school.edu" />
              </Field>
              <Field
                label="Temporary password"
                htmlFor="adminPassword"
                required
                hint="At least 8 characters with a letter and a number. Share it securely."
                className="sm:col-span-2"
              >
                <input
                  id="adminPassword"
                  name="adminPassword"
                  type="text"
                  required
                  minLength={8}
                  defaultValue="Admin@123"
                  className="input font-mono"
                />
              </Field>
            </FormGrid>

            <div className="mt-5">
              <Callout tone="neutral">
                Need a plan that isn&apos;t listed? Create the institute on any plan, then change it
                from the institute page — pro-rated pricing is handled by your billing provider.
              </Callout>
            </div>
          </ActionForm>
        </div>
      </Card>
    </div>
  );
}
