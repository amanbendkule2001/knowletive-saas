import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const EXAM_PERMISSIONS = [
  { key: "tenant.exams.read", group: "Exams", label: "View examinations, schedules, marks and reports", scope: "TENANT" },
  { key: "tenant.exams.write", group: "Exams", label: "Create and edit examinations, schedules and subjects", scope: "TENANT" },
  { key: "tenant.exams.manage_grading", group: "Exams", label: "Configure grade scales and grade bands", scope: "TENANT" },
  { key: "tenant.exams.enroll", group: "Exams", label: "Enroll and manage student exam participation", scope: "TENANT" },
  { key: "tenant.exams.enter_marks", group: "Exams", label: "Enter and update marks for assigned subjects", scope: "TENANT" },
  { key: "tenant.exams.verify_marks", group: "Exams", label: "Verify and lock evaluated marks", scope: "TENANT" },
  { key: "tenant.exams.publish_results", group: "Exams", label: "Calculate authoritative results and publish report cards", scope: "TENANT" },
  { key: "tenant.exams.correct_published_marks", group: "Exams", label: "Correct marks for published examinations with audit revision trail", scope: "TENANT" },
  { key: "tenant.exams.view_reports", group: "Exams", label: "View institutional exam performance analytics and reports", scope: "TENANT" },
];

async function main() {
  console.log("Upserting Exam permissions...");
  for (const perm of EXAM_PERMISSIONS) {
    await db.permission.upsert({
      where: { key: perm.key },
      update: { group: perm.group, label: perm.label, scope: perm.scope },
      create: perm,
    });
  }

  // Find all roles
  const roles = await db.role.findMany({
    include: { permissions: true },
  });

  console.log(`Found ${roles.length} roles to evaluate.`);
  for (const role of roles) {
    const existingKeys = new Set(role.permissions.map((p) => p.permissionKey));
    let keysToAdd = [];

    if (role.key === "INSTITUTE_ADMIN") {
      // Admin gets all exam perms
      keysToAdd = EXAM_PERMISSIONS.map((p) => p.key);
    } else if (role.key === "PRINCIPAL") {
      // Principal gets all 8 exam perms
      keysToAdd = EXAM_PERMISSIONS.map((p) => p.key);
    } else if (role.key === "TEACHER") {
      // Teacher gets read, enter_marks, view_reports
      keysToAdd = ["tenant.exams.read", "tenant.exams.enter_marks", "tenant.exams.view_reports"];
    }

    const permsToInsert = keysToAdd.filter((k) => !existingKeys.has(k));
    if (permsToInsert.length > 0) {
      await db.rolePermission.createMany({
        data: permsToInsert.map((k) => ({
          roleId: role.id,
          permissionKey: k,
        })),
        skipDuplicates: true,
      });
      console.log(`Added ${permsToInsert.length} permissions to role ${role.name} (${role.key})`);
    }
  }

  console.log("Exam permissions synced successfully.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

