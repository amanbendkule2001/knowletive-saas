import { getTenantContext, hasTenantPermission, isStaffMember } from "@/lib/auth";
import { db } from "@/lib/db";

function cell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isStaffMember(ctx) || !hasTenantPermission(ctx, "tenant.students.read")) {
    return Response.json(
      { error: "Access denied. You do not have permission to view this page." },
      { status: 403 },
    );
  }

  const students = await db.student.findMany({
    where: { tenantId: ctx.tenant.id, status: { not: "ALUMNI" } },
    include: {
      section: { include: { class: true } },
      guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  const header = [
    "admissionNo",
    "firstName",
    "lastName",
    "class",
    "section",
    "gender",
    "dob",
    "email",
    "phone",
    "address",
    "status",
    "guardianName",
    "guardianPhone",
    "guardianEmail",
    "guardianRelation",
  ];

  const rows = students.map((student) => {
    const guardian = student.guardians[0]?.guardian;
    return [
      student.admissionNo,
      student.firstName,
      student.lastName,
      student.section?.class.name ?? "",
      student.section?.name ?? "",
      student.gender ?? "",
      student.dob ? student.dob.toISOString().slice(0, 10) : "",
      student.email ?? "",
      student.phone ?? "",
      student.address ?? "",
      student.status,
      guardian?.name ?? "",
      guardian?.phone ?? "",
      guardian?.email ?? "",
      guardian?.relation ?? "",
    ];
  });

  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = ctx.tenant.slug.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "institute";

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-students-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
