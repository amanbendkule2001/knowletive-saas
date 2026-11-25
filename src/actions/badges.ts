"use server";

import { getTenantContext } from "@/lib/auth";
import { getModuleBadges, type ModuleBadges } from "@/lib/module-badges";

export async function getLiveModuleBadgesAction(
  visits?: Record<string, number | string | null>
): Promise<ModuleBadges> {
  try {
    const ctx = await getTenantContext();
    if (!ctx?.tenant) return {};

    return await getModuleBadges(ctx.tenant.id, visits);
  } catch {
    return {};
  }
}
