import Link from "next/link";
import { LockKeyhole, Sparkles } from "lucide-react";
import { FEATURE_MAP } from "@/lib/catalog";
import { Card, PageHeader } from "@/components/ui/primitives";

/**
 * Shown when a module exists but the institute's plan does not include it.
 * Entitlements are enforced again in the server actions, so this is UX only.
 */
export function FeatureLocked({
  feature,
  title,
  description,
}: {
  feature: string;
  title?: string;
  description?: string;
}) {
  const def = FEATURE_MAP.get(feature);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Plan entitlement"
        title={title ?? def?.label ?? "Module locked"}
        description={description ?? def?.description}
      />
      <Card className="mx-auto max-w-xl">
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <LockKeyhole className="size-5" />
          </span>
          <h2 className="mt-4 text-base font-semibold">
            {def?.label ?? "This module"} is not included in your plan
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted">
            Upgrade your subscription to unlock {def?.label.toLowerCase() ?? "this module"}. Your data
            stays safe and nothing is deleted when you change plans.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href="/app/billing" className="btn btn-primary">
              <Sparkles className="size-4" /> View plans & upgrade
            </Link>
            <a href="mailto:support@knowletive.com" className="btn btn-secondary">
              Talk to support
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
}
