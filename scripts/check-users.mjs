import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "sunrise" } }) || await prisma.tenant.findFirst();
  if (!tenant) throw new Error("No tenant found");

  const passwordHash = await bcrypt.hash("Admin@123", 10);

  // For tenant-scoped roles, find the role for this tenant
  const tenantRoles = await prisma.role.findMany({ where: { tenantId: tenant.id } });
  // For platform roles, tenantId is null
  const platformRoles = await prisma.role.findMany({ where: { scope: "PLATFORM" } });

  const roleConfigs = [
    { key: "PLATFORM_OWNER", email: "owner@knowletive.com", name: "Platform Owner", platform: true },
    { key: "PLATFORM_SUPPORT", email: "support@knowletive.com", name: "Platform Support", platform: true },
    { key: "INSTITUTE_ADMIN", email: "admin@sunrise.test", name: "Sunrise Admin" },
    { key: "PRINCIPAL", email: "principal@sunrise.test", name: "Dr. Aditya Singh" },
    { key: "TEACHER", email: "teacher@sunrise.test", name: "Kabir Iyer" },
    { key: "ACCOUNTANT", email: "accounts@sunrise.test", name: "Rohan Naik" },
    { key: "FRONT_DESK", email: "frontdesk.test@sunrise.test", name: "Sunrise Front Desk" },
    { key: "STUDENT", email: "student@sunrise.test", name: "Aarav Sharma" },
    { key: "PARENT", email: "parent@sunrise.test", name: "Rajesh Sharma (Father)" },
  ];

  console.log("Setting up / verifying 9 role accounts with password 'Admin@123'...");

  for (const cfg of roleConfigs) {
    let role;
    if (cfg.platform) {
      role = platformRoles.find(r => r.key === cfg.key);
    } else {
      role = tenantRoles.find(r => r.key === cfg.key);
    }

    if (!role) {
      console.warn(`WARNING: Role ${cfg.key} not found!`);
      continue;
    }

    let user = await prisma.user.findFirst({
      where: { email: cfg.email },
      include: { memberships: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          name: cfg.name,
          email: cfg.email,
          passwordHash,
          status: "ACTIVE",
          memberships: cfg.platform ? undefined : {
            create: {
              tenantId: tenant.id,
              roleId: role.id,
              status: "ACTIVE",
            },
          },
        },
        include: { memberships: true },
      });
      console.log(`[CREATED] ${cfg.key}: ${cfg.email}`);
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, status: "ACTIVE" },
      });

      if (!cfg.platform) {
        const mem = user.memberships.find(m => m.tenantId === tenant.id);
        if (mem) {
          if (mem.roleId !== role.id) {
            await prisma.membership.update({
              where: { id: mem.id },
              data: { roleId: role.id, status: "ACTIVE" },
            });
            console.log(`[UPDATED ROLE] ${cfg.key} for ${cfg.email}`);
          } else {
            console.log(`[VERIFIED] ${cfg.key}: ${cfg.email}`);
          }
        } else {
          await prisma.membership.create({
            data: {
              userId: user.id,
              tenantId: tenant.id,
              roleId: role.id,
              status: "ACTIVE",
            },
          });
          console.log(`[ATTACHED MEMBERSHIP] ${cfg.key} for ${cfg.email}`);
        }
      } else {
        const platMem = await prisma.membership.findFirst({
          where: { userId: user.id, roleId: role.id },
        });
        if (!platMem) {
          await prisma.membership.create({
            data: {
              userId: user.id,
              roleId: role.id,
              status: "ACTIVE",
            },
          });
          console.log(`[ATTACHED PLATFORM ROLE] ${cfg.key} to ${cfg.email}`);
        } else {
          console.log(`[VERIFIED PLATFORM] ${cfg.key}: ${cfg.email}`);
        }
      }
    }
  }

  console.log("\nAll 9 role test accounts verified!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
