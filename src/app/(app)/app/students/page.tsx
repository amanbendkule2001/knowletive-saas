import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Download,
  GraduationCap,
  Plus,
  Search,
  Upload,
  UserRound,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireTenantPermission } from "@/lib/rbac";
import { hasTenantPermission, isStaffMember } from "@/lib/auth";
import {
  Avatar,
  Badge,
  Callout,
  Card,
  PageHeader,
  Pagination,
  statusTone,
  statusLabel,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { date, num } from "@/lib/format";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Students" };

type StudentRow = Prisma.StudentGetPayload<{
  include: {
    section: { include: { class: true } };
    guardians: { include: { guardian: true } };
  };
}>;

const PAGE_SIZE = 20;

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    classId?: string;
    page?: string;
    created?: string;
    archived?: string;
  }>;
}) {
  const ctx = await requireTenantPermission("tenant.students.read");
  if (!isStaffMember(ctx)) redirect("/portal");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = ["ACTIVE", "INACTIVE", "ALUMNI"].includes(sp.status ?? "")
    ? (sp.status as "ACTIVE" | "INACTIVE" | "ALUMNI")
    : "ACTIVE";
  const classId = sp.classId ?? "";
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const tenantId = ctx.tenant.id;

  const where: Prisma.StudentWhereInput = {
    tenantId,
    status,
    ...(classId ? { section: { classId } } : {}),
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" as const } },
            { lastName: { contains: q, mode: "insensitive" as const } },
            { admissionNo: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [students, total, classes, statusCounts] = await Promise.all([
    db.student.findMany({
      where,
      include: {
        section: { include: { class: true } },
        guardians: { include: { guardian: true } },
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.student.count({ where }),
    db.classLevel.findMany({
      where: { tenantId },
      include: { _count: { select: { sections: true } } },
      orderBy: { order: "asc" },
    }),
    db.student.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: { _all: true },
    }),
  ]);

  const canWrite = hasTenantPermission(ctx, "tenant.students.write");
  const countFor = (value: string) =>
    statusCounts.find((row) => row.status === value)?._count._all ?? 0;

  const columns: Column<StudentRow>[] = [
    {
      key: "student",
      header: "Student",
      mobile: "title",
      render: (student) => (
        <Link href={`/app/students/${student.id}`} className="group flex items-center gap-2.5">
          <Avatar
            name={`${student.firstName} ${student.lastName}`}
            size={32}
            color={ctx.tenant.accentColor}
          />
          <span className="min-w-0">
            <span className="block truncate font-medium group-hover:underline">
              {student.firstName} {student.lastName}
            </span>
            <span className="block truncate font-mono text-[10px] text-muted">
              {student.admissionNo}
            </span>
          </span>
        </Link>
      ),
    },
    {
      key: "class",
      header: "Class",
      mobile: "subtitle",
      render: (student) =>
        student.section ? (
          <span className="text-muted">
            {student.section.class.name} — {student.section.name}
          </span>
        ) : (
          <span className="text-[var(--muted-2)]">Unassigned</span>
        ),
    },
    {
      key: "guardian",
      header: "Guardian",
      mobile: "detail",
      render: (student) => {
        const guardian =
          student.guardians.find((g) => g.isPrimary)?.guardian ?? student.guardians[0]?.guardian;
        return guardian ? (
          <span>
            <span className="block">{guardian.name}</span>
            <span className="block text-[10px] text-muted">{guardian.phone}</span>
          </span>
        ) : (
          <span className="text-[var(--muted-2)]">—</span>
        );
      },
    },
    {
      key: "contact",
      header: "Contact",
      mobile: "detail",
      render: (student) => (
        <span className="text-muted">{student.phone ?? student.email ?? "—"}</span>
      ),
    },
    {
      key: "admitted",
      header: "Admitted",
      mobile: "detail",
      render: (student) => <span className="text-muted">{date(student.admissionDate)}</span>,
    },
    {
      key: "status",
      header: "Status",
      mobile: "hidden",
      render: (student) => (
        <Badge tone={statusTone(student.status)}>{statusLabel(student.status)}</Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "hidden",
      render: (student) => (
        <Link href={`/app/students/${student.id}`} className="link text-xs">
          View
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People"
        title="Students"
        description="Admissions, class placement and guardian records for this institute."
        actions={
          <>
            <Link href="/app/students/export" className="btn btn-secondary">
              <Download className="size-3.5" /> Export CSV
            </Link>
            {canWrite && (
              <>
                <Link href="/app/students/import" className="btn btn-secondary">
                  <Upload className="size-3.5" /> Import
                </Link>
                <Link href="/app/students/new" className="btn btn-primary">
                  <Plus className="size-4" /> Add student
                </Link>
              </>
            )}
          </>
        }
      />

      {(sp.created || sp.archived) && (
        <Callout tone="success" title={sp.archived ? "Student archived" : "Student added"}>
          {sp.archived
            ? "The student has been moved out of the active roll. You can find alumni using the status filter."
            : "The profile is ready. Add guardian details and a fee plan when you are ready."}
        </Callout>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {(["ACTIVE", "INACTIVE", "ALUMNI"] as const).map((value) => {
          const active = status === value;
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (classId) params.set("classId", classId);
          if (value !== "ACTIVE") params.set("status", value);
          return (
            <Link
              key={value}
              href={`/app/students?${params.toString()}`}
              className={`card p-4 transition hover:border-[var(--border-strong)] ${
                active ? "ring-1 ring-[var(--brand)]" : ""
              }`}
            >
              <p className="flex items-center justify-between text-xs text-muted">
                {statusLabel(value)}
                <UserRound className="size-4" />
              </p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums">{num(countFor(value))}</p>
            </Link>
          );
        })}
      </div>

      <Card>
        <form className="flex flex-col gap-2 border-b border-[var(--border)] p-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-2)]" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name, admission no., phone or email"
              className="input pl-8"
              aria-label="Search students"
            />
          </div>
          <select name="classId" defaultValue={classId} className="select sm:w-44" aria-label="Filter by class">
            <option value="">All classes</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name}
              </option>
            ))}
          </select>
          <input type="hidden" name="status" value={status === "ACTIVE" ? "" : status} />
          <button className="btn btn-secondary" type="submit">
            Filter
          </button>
          {(q || classId || status !== "ACTIVE") && (
            <Link href="/app/students" className="btn btn-ghost">
              Clear
            </Link>
          )}
        </form>

        <DataTable
          columns={columns}
          rows={students}
          emptyTitle={q || classId ? "No students match those filters" : "No students yet"}
          emptyDescription={
            q || classId
              ? "Try a different spelling, admission number or class."
              : "Add your first student or import an existing list from a CSV file."
          }
          emptyAction={
            canWrite && !q && !classId ? (
              <Link href="/app/students/new" className="btn btn-primary btn-sm">
                <Plus className="size-3.5" /> Add student
              </Link>
            ) : undefined
          }
          footer={
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              basePath="/app/students"
              query={{
                q: q || undefined,
                status: status === "ACTIVE" ? undefined : status,
                classId: classId || undefined,
              }}
            />
          }
        />
      </Card>

      {classes.length === 0 && (
        <Callout tone="info" title="Set up classes first" icon={<GraduationCap className="size-4" />}>
          You have no class levels yet.{" "}
          <Link href="/app/academics" className="underline">
            Create classes and sections
          </Link>{" "}
          so students can be placed correctly for attendance and fees.
        </Callout>
      )}
    </div>
  );
}
