import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { actorId: 'cmw3i55ki000zckeofj4xw5v3' },
        { entityId: 'cmw3i55ki000zckeofj4xw5v3' },
        { action: { contains: 'auth' } }
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 15
  });
  console.log(JSON.stringify(logs, null, 2));
}
main().finally(() => prisma.$disconnect());
