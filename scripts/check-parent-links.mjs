import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const links = await prisma.studentGuardian.findMany({
    where: { guardianId: 'cmw3i55km0013ckeofsbxzfnn' },
    include: { student: true, guardian: true }
  });
  console.log('StudentGuardian links for parent@sunrise.test:', JSON.stringify(links, null, 2));

  const aarav = await prisma.student.findFirst({
    where: { admissionNo: 'SPS-2026-1001' },
    include: { guardians: { include: { guardian: true } } }
  });
  console.log('Aarav Sharma guardians:', JSON.stringify(aarav?.guardians, null, 2));
}
main().finally(() => prisma.$disconnect());
