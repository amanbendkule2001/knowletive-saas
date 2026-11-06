import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantWrite } from "@/lib/rbac";
import { inviteStaffAction } from "@/actions/students";
import { ActionForm } from "@/components/ui/action-form";
import { Callout, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Field, FormGrid, FormIntro } from "@/components/ui/form-field";

export const metadata = { title: "Invite staff" };

export default async function NewStaffPage() {
  const ctx = await requireTenantWrite("tenant.staff.write");
  const roles = await db.role.findMany({
    where: { tenantId: ctx.tenant.id, scope: "TENANT" },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-5">
      <Link
        href="/app/staff"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-3.5" /> All staff
      </Link>

      <PageHeader
        eyebrow="Access"
        title="Invite a staff member"
        description="Create a login and assign a role. Share the temporary password securely — the member can change it after signing in."
        actions={
          <Link href="/app/roles" className="btn btn-secondary">
            <ShieldCheck className="size-3.5" /> Review permissions
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="Staff details" description="The email becomes their sign-in ID." />
          <div className="p-4">
            <ActionForm action={inviteStaffAction} submitLabel="Create account" pendingLabel="Creating…">
              <FormGrid>
                <Field label="Full name" htmlFor="name" required>
                  <input id="name" name="name" className="input" autoComplete="name" required />
                </Field>
                <Field label="Work email" htmlFor="email" required>
                  <input id="email" name="email" type="email" className="input" autoComplete="email" required />
                </Field>
                <Field
                  label="Temporary password"
                  htmlFor="password"
                  required
                  hint="At least 8 characters with a letter and a number."
                >
                  <input
                    id="password"
                    name="password"
                    type="password"
                    className="input"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </Field>
                <Field label="Role" htmlFor="roleId" required>
                  <select id="roleId" name="roleId" className="select" required>
                    <option value="">Choose a role</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Designation" htmlFor="designation">
                  <input
                    id="designation"
                    name="designation"
                    className="input"
                    placeholder="e.g. Senior Teacher"
                  />
                </Field>
                <Field label="Phone" htmlFor="phone">
                  <input id="phone" name="phone" type="tel" className="input" placeholder="Optional" />
                </Field>
              </FormGrid>

              <FormIntro
                title="What the role can do"
                description="Roles control every page and server action. You can adjust permissions at any time from Roles & permissions — changes apply on the member's next request."
              />
            </ActionForm>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Roles in this institute" description={`${roles.length} available`} />
            <div className="divide-y divide-[var(--border)]">
              {roles.map((role) => (
                <div key={role.id} className="px-4 py-3">
                  <p className="text-[13px] font-medium">{role.name}</p>
                  <p className="text-[11px] text-muted">{role.description ?? "Custom role"}</p>
                </div>
              ))}
            </div>
          </Card>

          <Callout tone="info" title="Seat limits">
            Your plan allows {ctx.tenant.subscription?.plan?.maxStaff ?? 0} staff accounts. Suspended
            members do not count towards the seat limit. Upgrade in Billing before inviting more.
          </Callout>
        </div>
      </div>
    </div>
  );
}
