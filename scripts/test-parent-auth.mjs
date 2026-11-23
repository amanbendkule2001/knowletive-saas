import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'parent@sunrise.test' },
    include: { memberships: { include: { role: true, tenant: true } } }
  });
  console.log('User:', JSON.stringify(user, null, 2));
  if (user) {
    const match = await bcrypt.compare('Admin@123', user.passwordHash);
    console.log('Admin@123 matches passwordHash?', match);
    const matchLower = await bcrypt.compare('admin@123', user.passwordHash);
    console.log('admin@123 matches passwordHash?', matchLower);
  }
  const guardians = await prisma.guardian.findMany({
    where: { OR: [{ email: 'parent@sunrise.test' }, { name: { contains: 'Rajesh' } }] }
  });
  console.log('Guardians:', JSON.stringify(guardians, null, 2));
}

main().finally(() => prisma.$disconnect());
