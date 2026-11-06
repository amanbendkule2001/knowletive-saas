import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DEFAULT_CBSE_BANDS = [
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

async function main() {
  const tenants = await db.tenant.findMany({ select: { id: true, name: true } });
  console.log(`Checking grade scales for ${tenants.length} tenants...`);

  for (const tenant of tenants) {
    const existing = await db.gradeScale.findFirst({
      where: { tenantId: tenant.id, code: "CBSE-9" },
    });

    if (!existing) {
      console.log(`Creating default CBSE-9 scale for ${tenant.name}...`);
      await db.gradeScale.create({
        data: {
          tenantId: tenant.id,
          name: "CBSE 9-Point Grading System",
          code: "CBSE-9",
          description: "Standard 9-band academic performance scale with letter grades and grade points.",
          isDefault: true,
          isSystem: true,
          bands: {
            create: DEFAULT_CBSE_BANDS.map((b) => ({
              ...b,
              tenantId: tenant.id,
            })),
          },
        },
      });
    }
  }

  console.log("Grade scale initialization complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

