import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const exams = await db.examination.findMany();
  console.log("Examination count:", exams.length);
  const gradeScales = await db.gradeScale.findMany();
  console.log("GradeScale count:", gradeScales.length);
}
main().finally(() => db.$disconnect());
