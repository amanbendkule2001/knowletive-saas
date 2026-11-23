import { db } from "@/lib/db";

/**
 * Retrieves academic years for a tenant. If no academic years exist yet
 * (e.g. for newly created institutes or unseeded tenants), auto-provisions
 * default academic years using institute settings or current standard sessions.
 */
export async function getOrProvisionAcademicYears(tenantId: string) {
  const existing = await db.academicYear.findMany({
    where: { tenantId },
    select: { id: true, name: true, isActive: true },
    orderBy: { startDate: "desc" },
  });

  if (existing.length > 0) {
    return existing;
  }

  // Fetch tenant settings to check if an academic year string is configured
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });

  const settingsYear =
    tenant?.settings &&
    typeof tenant.settings === "object" &&
    !Array.isArray(tenant.settings) &&
    typeof (tenant.settings as Record<string, unknown>).academicYear === "string"
      ? ((tenant.settings as Record<string, unknown>).academicYear as string).trim()
      : "2026-27";

  const currentYearName = settingsYear || "2026-27";

  try {
    await db.academicYear.createMany({
      data: [
        {
          tenantId,
          name: "2025-26",
          startDate: new Date("2025-04-01T00:00:00.000Z"),
          endDate: new Date("2026-03-31T23:59:59.999Z"),
          isActive: false,
        },
        {
          tenantId,
          name: currentYearName,
          startDate: new Date("2026-04-01T00:00:00.000Z"),
          endDate: new Date("2027-03-31T23:59:59.999Z"),
          isActive: true,
        },
      ],
      skipDuplicates: true,
    });
  } catch {
    // In case of concurrent provision, ignore and fetch below
  }

  return db.academicYear.findMany({
    where: { tenantId },
    select: { id: true, name: true, isActive: true },
    orderBy: { startDate: "desc" },
  });
}
