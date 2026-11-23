import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const platformOwners = await db.user.findMany({
    where: { isPlatformOwner: true },
    include: { memberships: { include: { tenant: true, role: true } } },
  });

  console.log("Found platform owners:", platformOwners.length);
  for (const po of platformOwners) {
    console.log({
      id: po.id,
      name: po.name,
      email: po.email,
      isPlatformOwner: po.isPlatformOwner,
      memberships: po.memberships.map((m) => ({
        tenantId: m.tenantId,
        tenantName: m.tenant.name,
        roleKey: m.role.key,
        isOwner: m.isOwner,
      })),
    });
  }
}

main().catch(console.error).finally(() => db.$disconnect());
