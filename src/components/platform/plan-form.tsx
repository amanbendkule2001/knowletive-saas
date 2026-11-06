import type { Plan } from "@prisma/client";
import { ActionForm } from "@/components/ui/action-form";
import { Field, FormGrid } from "@/components/ui/form-field";
import { Callout } from "@/components/ui/primitives";
import { FEATURES } from "@/lib/catalog";
import type { FormState } from "@/lib/validation";

const groups = FEATURES.reduce<Record<string, typeof FEATURES>>((acc, f) => {
  (acc[f.group] ??= []).push(f);
  return acc;
}, {});

export function PlanForm({
  plan,
  action,
}: {
  plan?: Plan | null;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const selected = new Set(plan?.features ?? []);

  return (
    <ActionForm
      action={action}
      submitLabel={plan ? "Save plan & entitlements" : "Create plan"}
      pendingLabel="Saving…"
      cancelHref="/platform/plans"
    >
      {plan && <input type="hidden" name="planId" value={plan.id} />}

      <FormGrid>
        <Field label="Plan name" htmlFor="name" required>
          <input id="name" name="name" required defaultValue={plan?.name} className="input" placeholder="Growth" />
        </Field>
        <Field
          label="Plan key"
          htmlFor="key"
          required
          hint="Stable identifier used by the billing provider. Lowercase, no spaces."
        >
          <input
            id="key"
            name="key"
            required
            defaultValue={plan?.key}
            className="input font-mono"
            placeholder="growth"
            pattern="[a-z0-9-]{2,30}"
          />
        </Field>
        <Field label="Short description" htmlFor="description" className="sm:col-span-2">
          <input
            id="description"
            name="description"
            defaultValue={plan?.description ?? ""}
            className="input"
            placeholder="The complete academic + billing toolkit for growing institutes."
            maxLength={240}
          />
        </Field>
        <Field label="Monthly price (₹)" htmlFor="priceMonthly" required hint="Excluding GST. Use 0 for custom/enterprise.">
          <input
            id="priceMonthly"
            name="priceMonthly"
            type="number"
            min={0}
            step={1}
            required
            defaultValue={plan ? plan.priceMonthly / 100 : 0}
            className="input"
          />
        </Field>
        <Field label="Yearly price (₹)" htmlFor="priceYearly" required hint="Usually ~10 months' price.">
          <input
            id="priceYearly"
            name="priceYearly"
            type="number"
            min={0}
            step={1}
            required
            defaultValue={plan ? plan.priceYearly / 100 : 0}
            className="input"
          />
        </Field>
        <Field label="Student limit" htmlFor="maxStudents" required>
          <input
            id="maxStudents"
            name="maxStudents"
            type="number"
            min={1}
            required
            defaultValue={plan?.maxStudents ?? 250}
            className="input"
          />
        </Field>
        <Field label="Staff limit" htmlFor="maxStaff" required>
          <input
            id="maxStaff"
            name="maxStaff"
            type="number"
            min={1}
            required
            defaultValue={plan?.maxStaff ?? 25}
            className="input"
          />
        </Field>
        <Field label="Storage (GB)" htmlFor="maxStorageMb" required>
          <input
            id="maxStorageMb"
            name="maxStorageMb"
            type="number"
            min={1}
            required
            defaultValue={plan ? Math.round(plan.maxStorageMb / 1024) : 2}
            className="input"
          />
        </Field>
        <Field label="AI credits / month" htmlFor="aiCreditsMonthly" required>
          <input
            id="aiCreditsMonthly"
            name="aiCreditsMonthly"
            type="number"
            min={0}
            required
            defaultValue={plan?.aiCreditsMonthly ?? 100}
            className="input"
          />
        </Field>
        <Field label="Trial days" htmlFor="trialDays" required>
          <input
            id="trialDays"
            name="trialDays"
            type="number"
            min={0}
            max={90}
            required
            defaultValue={plan?.trialDays ?? 14}
            className="input"
          />
        </Field>
        <Field label="Visibility" htmlFor="isPublic">
          <select id="isPublic" name="isPublic" className="select" defaultValue={String(plan?.isPublic ?? true)}>
            <option value="true">Public — shown on pricing</option>
            <option value="false">Private — assign manually</option>
          </select>
        </Field>
        <Field label="Highlight" htmlFor="highlighted">
          <select id="highlighted" name="highlighted" className="select" defaultValue={String(plan?.highlighted ?? false)}>
            <option value="false">No</option>
            <option value="true">Yes — most popular</option>
          </select>
        </Field>
      </FormGrid>

      <div className="pt-2">
        <p className="text-sm font-semibold">Entitlements</p>
        <p className="mt-0.5 text-xs text-muted">
          Toggling a feature changes what every institute on this plan can access. Access is still
          enforced server-side on each request.
        </p>

        <div className="mt-3 space-y-4">
          {Object.entries(groups).map(([group, features]) => (
            <div key={group}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-2)]">
                {group}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {features.map((f) => (
                  <label
                    key={f.key}
                    className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
                  >
                    <input
                      type="checkbox"
                      name="features"
                      value={f.key}
                      defaultChecked={selected.has(f.key)}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-[12px] font-medium">{f.label}</span>
                      <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                        {f.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Callout tone="warning">
        Changing limits applies immediately. Institutes already above a new lower limit keep their
        data, but new records are blocked until they upgrade.
      </Callout>
    </ActionForm>
  );
}
