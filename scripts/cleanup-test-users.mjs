import { createRequire } from "module";
const require = createRequire("d:/IT/Saas/package.json");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function clean() {
  await prisma.membership.deleteMany({
    where: { user: { email: { in: ["multi-staff@knowletive.test", "unassigned@knowletive.test"] } } },
  });
  await prisma.user.deleteMany({
    where: { email: { in: ["multi-staff@knowletive.test", "unassigned@knowletive.test"] } },
  });
  console.log("Temporary test users successfully cleaned.");
}

clean().finally(() => prisma.$disconnect());

