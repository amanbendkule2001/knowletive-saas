import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const members = await prisma.membership.findMany({
    include: { user: true, role: true, tenant: true },
  });
  console.log(
    members.map((m) => ({
      tenantSlug: m.tenant.slug,
      name: m.user.name,
      email: m.user.email,
      roleKey: m.role.key,
      isOwner: m.isOwner,
      isPlatformOwner: m.user.isPlatformOwner,
      extraPermissions: m.extraPermissions,
    })),
  );
}

main().finally(() => prisma.$disconnect());
