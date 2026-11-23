import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "sunrise" } });
  if (!tenant) throw new Error("Tenant sunrise not found");

  const studentUser = await prisma.user.findFirst({
    where: { email: "student@sunrise.test" },
    include: { studentProfile: true },
  });

  const parentUser = await prisma.user.findFirst({
    where: { email: "parent@sunrise.test" },
    include: {
      guardianProfiles: {
        include: {
          students: {
            include: { student: true },
          },
        },
      },
    },
  });

  console.log("Student User:", studentUser?.email, "Profile:", studentUser?.studentProfile?.id);
  console.log("Parent User:", parentUser?.email, "Guardians:", parentUser?.guardianProfiles?.length);
  if (parentUser?.guardianProfiles?.length) {
    for (const gp of parentUser.guardianProfiles) {
      console.log("  Guardian ID:", gp.id, "Linked students:", gp.students.map(s => s.student.firstName + ' ' + s.student.lastName));
    }
  }

  // Check section and class
  const classLevel = await prisma.classLevel.findFirst({
    where: { tenantId: tenant.id },
    include: { sections: true },
  });
  console.log("Class Level:", classLevel?.name, "Sections:", classLevel?.sections.map(s => s.name));
}

main().catch(console.error).finally(() => prisma.$disconnect());

