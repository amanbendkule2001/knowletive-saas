import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePlatformPermission } from "@/lib/rbac";
import { createPlanAction } from "@/actions/platform";
import { PlanForm } from "@/components/platform/plan-form";
import { Callout, Card, PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "New plan" };

export default async function NewPlanPage() {
  await requirePlatformPermission("platform.plans.manage");

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/platform/plans" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-[var(--text)]">
        <ArrowLeft className="size-3.5" /> Plans
      </Link>
      <PageHeader
        eyebrow="Platform"
        title="Create a plan"
        description="Define pricing, limits and the features institutes unlock."
      />
      <Callout tone="info">
        The plan key becomes the identifier your payment provider uses. Choose it carefully — it is
        visible to billing integrations, not to end users.
      </Callout>
      <Card className="p-4 sm:p-5">
        <PlanForm action={createPlanAction} />
      </Card>
    </div>
  );
}
