import { db } from "@/lib/db";

export const DEFAULT_CBSE_BANDS = [
  { letterGrade: "A1", gradePoint: 10.0, minPercentage: 91, maxPercentage: 100, isPassing: true, remarks: "Outstanding", order: 1 },
  { letterGrade: "A2", gradePoint: 9.0, minPercentage: 81, maxPercentage: 90.99, isPassing: true, remarks: "Excellent", order: 2 },
  { letterGrade: "B1", gradePoint: 8.0, minPercentage: 71, maxPercentage: 80.99, isPassing: true, remarks: "Very Good", order: 3 },
  { letterGrade: "B2", gradePoint: 7.0, minPercentage: 61, maxPercentage: 70.99, isPassing: true, remarks: "Good", order: 4 },
  { letterGrade: "C1", gradePoint: 6.0, minPercentage: 51, maxPercentage: 60.99, isPassing: true, remarks: "Above Average", order: 5 },
  { letterGrade: "C2", gradePoint: 5.0, minPercentage: 41, maxPercentage: 50.99, isPassing: true, remarks: "Average", order: 6 },
  { letterGrade: "D", gradePoint: 4.0, minPercentage: 33, maxPercentage: 40.99, isPassing: true, remarks: "Pass Threshold", order: 7 },
  { letterGrade: "E1", gradePoint: 0.0, minPercentage: 21, maxPercentage: 32.99, isPassing: false, remarks: "Needs Improvement", order: 8 },
  { letterGrade: "E2", gradePoint: 0.0, minPercentage: 0, maxPercentage: 20.99, isPassing: false, remarks: "Unsatisfactory", order: 9 },
];

/**
 * Retrieves grade scales for a tenant. If no grade scale exists yet
 * (e.g. for newly created institutes), auto-provisions the default
 * CBSE 9-Point Grading Scale with standard performance bands.
 */
export async function getOrProvisionGradeScales(tenantId: string) {
  const existing = await db.gradeScale.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  if (existing.length > 0) {
    return existing;
  }

  try {
    await db.gradeScale.create({
      data: {
        tenantId,
        name: "CBSE 9-Point Grading System",
        code: "CBSE-9",
        description: "Standard 9-band academic performance scale with letter grades and grade points.",
        isDefault: true,
        isSystem: true,
        bands: {
          create: DEFAULT_CBSE_BANDS.map((b) => ({
            ...b,
            tenantId,
          })),
        },
      },
    });
  } catch {
    // In case of concurrent provision, ignore and re-fetch below
  }

  return db.gradeScale.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}
