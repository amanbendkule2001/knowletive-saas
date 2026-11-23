import "server-only";

import { db } from "@/lib/db";
import { startOfDay } from "@/lib/format";

/**
 * Standard Tool Response Envelope.
 * Guarantees consistent structure for AI agent ingestion.
 */
export type ToolResponse<T> =
  | { success: true; data: T; error?: never }
  | { success: false; error: string; data?: never };

// ============================================================================
// TOOL 1: get_student_count
// ============================================================================

export type StudentCountParams = {
  status?: "ACTIVE" | "INACTIVE" | "ALUMNI";
  classId?: string;
};

export type StudentCountResult = {
  tenantId: string;
  totalStudents: number;
  activeStudents: number;
  filteredCount: number;
  filterApplied: StudentCountParams;
  statusBreakdown: { ACTIVE: number; INACTIVE: number; ALUMNI: number };
  byClassBreakdown: Array<{ classId: string | null; className?: string; count: number }>;
};

/**
 * Tool 1: Retrieves student census and demographic metrics.
 * Scoped strictly to the caller's tenantId.
 */
export async function getStudentCount(
  tenantId: string,
  params: StudentCountParams = {},
): Promise<ToolResponse<StudentCountResult>> {
  if (!tenantId) {
    return { success: false, error: "Missing required tenant context for student count." };
  }

  try {
    const [totalStudents, activeStudents, filteredCount, statusGroups, classGroups, classes] = await Promise.all([
      db.student.count({ where: { tenantId } }),
      db.student.count({ where: { tenantId, status: "ACTIVE" } }),
      db.student.count({
        where: {
          tenantId,
          ...(params.status ? { status: params.status } : {}),
          ...(params.classId ? { classId: params.classId } : {}),
        },
      }),
      db.student.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true },
      }),
      db.student.groupBy({
        by: ["classId"],
        where: { tenantId, status: "ACTIVE" },
        _count: { _all: true },
      }),
      db.classLevel.findMany({
        where: { tenantId },
        select: { id: true, name: true },
      }),
    ]);

    const statusBreakdown = {
      ACTIVE: statusGroups.find((g) => g.status === "ACTIVE")?._count._all ?? 0,
      INACTIVE: statusGroups.find((g) => g.status === "INACTIVE")?._count._all ?? 0,
      ALUMNI: statusGroups.find((g) => g.status === "ALUMNI")?._count._all ?? 0,
    };

    const classMap = new Map(classes.map((c) => [c.id, c.name]));
    const byClassBreakdown = classGroups.map((g) => ({
      classId: g.classId,
      className: g.classId ? (classMap.get(g.classId) ?? "Unassigned") : "Unassigned",
      count: g._count._all,
    }));

    return {
      success: true,
      data: {
        tenantId,
        totalStudents,
        activeStudents,
        filteredCount,
        filterApplied: params,
        statusBreakdown,
        byClassBreakdown,
      },
    };
  } catch (error) {
    console.error("[ai-tools] getStudentCount failed:", error);
    return { success: false, error: "Failed to query student count from database." };
  }
}

// ============================================================================
// TOOL 2: get_attendance_summary
// ============================================================================

export type AttendanceSummaryParams = {
  date?: string; // YYYY-MM-DD
  timezone?: string; // e.g. "Asia/Kolkata"
  sectionId?: string;
  batchId?: string;
  studentIds?: string[];
  scopeDescription?: string;
  daysHistory?: number;
};

export type AttendanceSummaryResult = {
  tenantId: string;
  targetDate: string;
  totalMarked: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  attendanceRatePercentage: number;
  isFallbackDate: boolean;
  scopeDescription?: string;
  assignedBatchesCount?: number;
};

/**
 * Resolves local calendar date in the institute's configured timezone.
 */
function getTenantLocalDate(timezone = "Asia/Kolkata", d = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Tool 2: Computes daily attendance metrics and rates.
 * Exact mathematical alignment with src/app/(app)/app/page.tsx dashboard.
 */
export async function getAttendanceSummary(
  tenantId: string,
  params: AttendanceSummaryParams = {},
): Promise<ToolResponse<AttendanceSummaryResult>> {
  if (!tenantId) {
    return { success: false, error: "Missing required tenant context for attendance summary." };
  }

  try {
    // If explicit studentIds list was passed and is empty (e.g. teacher with no assigned students/batches)
    if (params.studentIds && params.studentIds.length === 0) {
      const tz = params.timezone || "Asia/Kolkata";
      const dateStr = params.date || getTenantLocalDate(tz);
      return {
        success: true,
        data: {
          tenantId,
          targetDate: dateStr,
          totalMarked: 0,
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
          attendanceRatePercentage: 0,
          isFallbackDate: false,
          scopeDescription: params.scopeDescription || "No students found in the assigned scope.",
        },
      };
    }

    const tz = params.timezone || "Asia/Kolkata";
    const dateStr = params.date || getTenantLocalDate(tz);
    let targetDate = new Date(`${dateStr}T00:00:00.000Z`);
    let isFallbackDate = false;

    // 1. Fetch attendance records for target date
    let dayGroups = await db.attendance.groupBy({
      by: ["status"],
      where: {
        tenantId,
        date: targetDate,
        ...(params.sectionId ? { student: { sectionId: params.sectionId } } : {}),
        ...(params.studentIds ? { studentId: { in: params.studentIds } } : {}),
      },
      _count: { _all: true },
    });

    // 2. If target date has no entries and no explicit date was requested, fallback to most recent date
    if (dayGroups.length === 0 && !params.date) {
      const latestRecord = await db.attendance.findFirst({
        where: {
          tenantId,
          ...(params.sectionId ? { student: { sectionId: params.sectionId } } : {}),
          ...(params.studentIds ? { studentId: { in: params.studentIds } } : {}),
        },
        orderBy: { date: "desc" },
        select: { date: true },
      });

      if (latestRecord?.date) {
        targetDate = latestRecord.date;
        isFallbackDate = true;
        dayGroups = (await db.attendance.groupBy({
          by: ["status"],
          where: {
            tenantId,
            date: latestRecord.date,
            ...(params.sectionId ? { student: { sectionId: params.sectionId } } : {}),
            ...(params.studentIds ? { studentId: { in: params.studentIds } } : {}),
          },
          _count: { _all: true },
        })) as any;
      }
    }

    const totalMarked = dayGroups.reduce((sum, g) => sum + g._count._all, 0);
    const present = dayGroups.find((g) => g.status === "PRESENT")?._count._all ?? 0;
    const late = dayGroups.find((g) => g.status === "LATE")?._count._all ?? 0;
    const absent = dayGroups.find((g) => g.status === "ABSENT")?._count._all ?? 0;
    const excused = dayGroups.find((g) => g.status === "EXCUSED")?._count._all ?? 0;

    // Attendance rate formula: (present + late) / total * 100
    const attendanceRatePercentage = totalMarked
      ? Number((((present + late) / totalMarked) * 100).toFixed(2))
      : 0;

    return {
      success: true,
      data: {
        tenantId,
        targetDate: targetDate.toISOString().split("T")[0]!,
        totalMarked,
        present,
        absent,
        late,
        excused,
        attendanceRatePercentage,
        isFallbackDate,
        scopeDescription: params.scopeDescription,
      },
    };
  } catch (error) {
    console.error("[ai-tools] getAttendanceSummary failed:", error);
    return { success: false, error: "Failed to compute attendance summary from database." };
  }
}

// ============================================================================
// TOOL 2B: get_student_attendance_details
// ============================================================================

export type StudentAttendanceDetailsParams = {
  batchId?: string;
  studentIds?: string[];
  thresholdPercentage?: number; // default 75
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  sectionId?: string;
  scopeDescription?: string;
  timezone?: string;
};

export type SupportingAttendanceDate = {
  date: string;
  status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
  note?: string | null;
};

export type StudentAttendanceRecordItem = {
  studentId: string;
  studentName: string;
  admissionNo: string;
  admissionNumber?: string;
  batchId?: string;
  batchName?: string;
  totalEligibleSessions: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  attendedSessions: number; // present + late
  attendancePercentage: number;
  isBelowThreshold: boolean;
  supportingDates: SupportingAttendanceDate[];
};

export type StudentAttendanceDetailsResult = {
  tenantId: string;
  reportingPeriod: {
    startDate?: string;
    endDate?: string;
    description: string;
  };
  thresholdPercentage: number;
  attendanceFormula: string;
  totalStudentsAnalyzed: number;
  totalStudentsEvaluated: number;
  studentsBelowThresholdCount: number;
  belowThresholdCount: number;
  studentsWithRecordsCount: number;
  studentsWithZeroSessionsCount: number;
  students: StudentAttendanceRecordItem[];
  records: StudentAttendanceRecordItem[];
  scopeDescription: string;
};

/**
 * Tool 2B: Computes granular student-level attendance analytics, rates, and threshold evaluation (<75%).
 * Strictly scoped to authenticated caller's tenantId and assigned batches.
 */
export async function getStudentAttendanceDetails(
  tenantId: string,
  params: StudentAttendanceDetailsParams = {},
): Promise<ToolResponse<StudentAttendanceDetailsResult>> {
  if (!tenantId) {
    return { success: false, error: "Missing required tenant context for student attendance details." };
  }

  const threshold = typeof params.thresholdPercentage === "number" ? params.thresholdPercentage : 75;

  try {
    if (params.studentIds && params.studentIds.length === 0) {
      return {
        success: true,
        data: {
          tenantId,
          reportingPeriod: {
            startDate: params.startDate,
            endDate: params.endDate,
            description: params.startDate && params.endDate
              ? `${params.startDate} to ${params.endDate}`
              : "All recorded sessions",
          },
          thresholdPercentage: threshold,
          attendanceFormula: "(Present + Late) / Total Eligible Sessions * 100",
          totalStudentsAnalyzed: 0,
          totalStudentsEvaluated: 0,
          studentsBelowThresholdCount: 0,
          belowThresholdCount: 0,
          studentsWithRecordsCount: 0,
          studentsWithZeroSessionsCount: 0,
          students: [],
          records: [],
          scopeDescription: params.scopeDescription || "No students found in the assigned scope.",
        },
      };
    }

    // 1. Resolve students in scope
    const studentWhere: any = {
      tenantId,
      status: "ACTIVE",
      ...(params.studentIds ? { id: { in: params.studentIds } } : {}),
      ...(params.sectionId ? { sectionId: params.sectionId } : {}),
    };

    const students = await db.student.findMany({
      where: studentWhere,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        batchEnrollments: {
          where: {
            status: "ACTIVE",
            ...(params.batchId ? { batchId: params.batchId } : {}),
          },
          select: {
            batch: { select: { id: true, name: true, code: true } },
          },
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    const targetStudentIds = students.map((s) => s.id);

    // 2. Build date filter if provided
    let dateFilter: any = undefined;
    if (params.startDate || params.endDate) {
      dateFilter = {};
      if (params.startDate) {
        dateFilter.gte = new Date(`${params.startDate}T00:00:00.000Z`);
      }
      if (params.endDate) {
        dateFilter.lte = new Date(`${params.endDate}T23:59:59.999Z`);
      }
    }

    // 3. Query attendance records
    const attendanceRecords = targetStudentIds.length > 0
      ? await db.attendance.findMany({
          where: {
            tenantId,
            studentId: { in: targetStudentIds },
            ...(dateFilter ? { date: dateFilter } : {}),
          },
          select: {
            studentId: true,
            date: true,
            status: true,
            note: true,
          },
          orderBy: { date: "asc" },
        })
      : [];

    // Group records by student
    const recordsByStudent = new Map<string, typeof attendanceRecords>();
    for (const rec of attendanceRecords) {
      let list = recordsByStudent.get(rec.studentId);
      if (!list) {
        list = [];
        recordsByStudent.set(rec.studentId, list);
      }
      list.push(rec);
    }

    // 4. Calculate individual student statistics
    const studentItems: StudentAttendanceRecordItem[] = [];

    for (const stu of students) {
      const records = recordsByStudent.get(stu.id) || [];
      const presentCount = records.filter((r) => r.status === "PRESENT").length;
      const lateCount = records.filter((r) => r.status === "LATE").length;
      const absentCount = records.filter((r) => r.status === "ABSENT").length;
      const excusedCount = records.filter((r) => r.status === "EXCUSED").length;

      const totalEligibleSessions = presentCount + lateCount + absentCount + excusedCount;
      const attendedSessions = presentCount + lateCount;

      // Calculate attendance rate (handling zero sessions safely)
      const attendancePercentage = totalEligibleSessions > 0
        ? Number(((attendedSessions / totalEligibleSessions) * 100).toFixed(2))
        : 0;

      // A student is only below threshold if they actually have eligible sessions recorded
      const isBelowThreshold = totalEligibleSessions > 0 && attendancePercentage < threshold;

      const primaryBatch = stu.batchEnrollments[0]?.batch;

      const supportingDates: SupportingAttendanceDate[] = records.map((r) => ({
        date: r.date.toISOString().split("T")[0]!,
        status: r.status as "PRESENT" | "ABSENT" | "LATE" | "EXCUSED",
        note: r.note,
      }));

      studentItems.push({
        studentId: stu.id,
        studentName: `${stu.firstName} ${stu.lastName}`.trim(),
        admissionNo: stu.admissionNo,
        admissionNumber: stu.admissionNo,
        batchId: primaryBatch?.id,
        batchName: primaryBatch?.name,
        totalEligibleSessions,
        presentCount,
        absentCount,
        lateCount,
        excusedCount,
        attendedSessions,
        attendancePercentage,
        isBelowThreshold,
        supportingDates,
      });
    }

    // Sort priority:
    // 1. Students with attendance below the requested threshold, first.
    // 2. Among other students, those with actual attendance sessions before students with zero sessions.
    // 3. Among students with sessions, lowest attendance percentage first.
    // 4. Alphabetical ordering as the final tie-breaker.
    studentItems.sort((a, b) => {
      // 1. Below threshold first
      if (a.isBelowThreshold !== b.isBelowThreshold) {
        return a.isBelowThreshold ? -1 : 1;
      }
      // 2. Actual attendance sessions before zero sessions
      const aHasSessions = a.totalEligibleSessions > 0 ? 1 : 0;
      const bHasSessions = b.totalEligibleSessions > 0 ? 1 : 0;
      if (aHasSessions !== bHasSessions) {
        return bHasSessions - aHasSessions;
      }
      // 3. Lowest attendance percentage first (among students with sessions)
      if (a.attendancePercentage !== b.attendancePercentage) {
        return a.attendancePercentage - b.attendancePercentage;
      }
      // 4. Alphabetical tie-breaker
      return a.studentName.localeCompare(b.studentName);
    });

    const studentsBelowThresholdCount = studentItems.filter((s) => s.isBelowThreshold).length;
    const studentsWithRecordsCount = studentItems.filter((s) => s.totalEligibleSessions > 0).length;
    const studentsWithZeroSessionsCount = studentItems.filter((s) => s.totalEligibleSessions === 0).length;

    let periodDescription = "All recorded sessions";
    if (params.startDate && params.endDate) {
      periodDescription = `${params.startDate} to ${params.endDate}`;
    } else if (params.startDate) {
      periodDescription = `From ${params.startDate} onwards`;
    } else if (params.endDate) {
      periodDescription = `Up to ${params.endDate}`;
    }

    return {
      success: true,
      data: {
        tenantId,
        reportingPeriod: {
          startDate: params.startDate,
          endDate: params.endDate,
          description: periodDescription,
        },
        thresholdPercentage: threshold,
        attendanceFormula: "(Present + Late) / Total Eligible Sessions * 100 [Where Total = Present + Late + Absent + Excused]",
        totalStudentsAnalyzed: studentItems.length,
        totalStudentsEvaluated: studentItems.length,
        studentsBelowThresholdCount,
        belowThresholdCount: studentsBelowThresholdCount,
        studentsWithRecordsCount,
        studentsWithZeroSessionsCount,
        students: studentItems,
        records: studentItems,
        scopeDescription: params.scopeDescription || (params.batchId ? `Batch: ${params.batchId}` : "All assigned students in scope"),
      },
    };
  } catch (error) {
    console.error("[ai-tools] getStudentAttendanceDetails failed:", error);
    return { success: false, error: "Failed to compute student attendance details from database." };
  }
}

// ============================================================================
// TOOL 3: get_outstanding_fee_summary
// ============================================================================

export type OutstandingFeeSummaryResult = {
  tenantId: string;
  branchId?: string | null;
  totalInvoicedPaise: number;
  totalCollectedPaise: number;
  totalOutstandingPaise: number;
  totalOutstandingRupees: number;
  overdueAmountPaise: number;
  overdueAmountRupees: number;
  pendingInvoicesCount: number;
  overdueInvoicesCount: number;
  currency: string;
};

export type OutstandingFeeSummaryOptions = {
  branchId?: string;
  allowedBranchIds?: string[];
};

/**
 * Tool 3: Computes institutional financial fee balance and delinquency.
 * Matches arithmetic in src/app/(app)/app/fees/page.tsx, with strict multi-branch scoping.
 */
export async function getOutstandingFeeSummary(
  tenantId: string,
  options: OutstandingFeeSummaryOptions = {},
): Promise<ToolResponse<OutstandingFeeSummaryResult>> {
  if (!tenantId) {
    return { success: false, error: "Missing required tenant context for fee summary." };
  }

  try {
    const now = new Date();
    const OPEN_STATUSES = ["PENDING", "PARTIAL", "OVERDUE"] as const;

    const branchFilter = options.branchId
      ? { branchId: options.branchId }
      : options.allowedBranchIds && options.allowedBranchIds.length > 0
      ? { branchId: { in: options.allowedBranchIds } }
      : {};

    const [billed, overdue, pendingCount] = await Promise.all([
      db.feeInvoice.aggregate({
        where: { tenantId, status: { not: "WAIVED" }, ...branchFilter },
        _sum: { amount: true, paidAmount: true },
      }),
      db.feeInvoice.aggregate({
        where: { tenantId, status: { in: [...OPEN_STATUSES] }, dueDate: { lt: now }, ...branchFilter },
        _sum: { amount: true, paidAmount: true },
        _count: { _all: true },
      }),
      db.feeInvoice.count({
        where: { tenantId, status: { in: [...OPEN_STATUSES] }, ...branchFilter },
      }),
    ]);

    const totalInvoicedPaise = billed._sum.amount ?? 0;
    const totalCollectedPaise = billed._sum.paidAmount ?? 0;
    const totalOutstandingPaise = Math.max(0, totalInvoicedPaise - totalCollectedPaise);
    const overdueAmountPaise = Math.max(
      0,
      (overdue._sum.amount ?? 0) - (overdue._sum.paidAmount ?? 0),
    );

    return {
      success: true,
      data: {
        tenantId,
        branchId: options.branchId || null,
        totalInvoicedPaise,
        totalCollectedPaise,
        totalOutstandingPaise,
        totalOutstandingRupees: Number((totalOutstandingPaise / 100).toFixed(2)),
        overdueAmountPaise,
        overdueAmountRupees: Number((overdueAmountPaise / 100).toFixed(2)),
        pendingInvoicesCount: pendingCount,
        overdueInvoicesCount: overdue._count._all ?? 0,
        currency: "INR",
      },
    };
  } catch (error) {
    console.error("[ai-tools] getOutstandingFeeSummary failed:", error);
    return { success: false, error: "Failed to compute outstanding fee summary from database." };
  }
}

// ============================================================================
// TOOL 4: get_platform_metrics
// ============================================================================

export type PlatformMetricsResult = {
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  suspendedTenants: number;
  totalStudentsAcrossPlatform: number;
  monthlyAiCreditsUsed: number;
  monthlyAiCreditsAllocated: number;
  plansCount: number;
  recentAuditCount: number;
};

/**
 * Tool 4: Computes platform-wide aggregated metrics.
 * Strictly restricted to verified Platform Owners with 'platform.overview.read'.
 */
export async function getPlatformMetrics(): Promise<ToolResponse<PlatformMetricsResult>> {
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [tenants, totalStudents, usage, plans, auditCount] = await Promise.all([
      db.tenant.findMany({
        where: { status: { not: "CHURNED" } },
        select: { status: true },
      }),
      db.student.count(),
      db.tenantUsage.findMany({ where: { periodStart: monthStart } }),
      db.plan.count({ where: { isArchived: false } }),
      db.auditLog.count(),
    ]);

    const activeTenants = tenants.filter((t) => t.status === "ACTIVE").length;
    const trialTenants = tenants.filter((t) => t.status === "TRIAL").length;
    const suspendedTenants = tenants.filter((t) => t.status === "SUSPENDED").length;

    const monthlyAiCreditsUsed = usage.reduce((s, u) => s + u.aiCreditsUsed, 0);
    const monthlyAiCreditsAllocated = usage.reduce((s, u) => s + u.aiCreditsLimit, 0);

    return {
      success: true,
      data: {
        totalTenants: tenants.length,
        activeTenants,
        trialTenants,
        suspendedTenants,
        totalStudentsAcrossPlatform: totalStudents,
        monthlyAiCreditsUsed,
        monthlyAiCreditsAllocated,
        plansCount: plans,
        recentAuditCount: auditCount,
      },
    };
  } catch (error) {
    console.error("[ai-tools] getPlatformMetrics failed:", error);
    return { success: false, error: "Failed to compute platform overview metrics from database." };
  }
}

// ============================================================================
// APPROVED TOOL REGISTRY & MODULE PERMISSION MAPPING
// ============================================================================

export type ApprovedToolName =
  | "get_student_count"
  | "get_attendance_summary"
  | "get_student_attendance_details"
  | "get_outstanding_fee_summary"
  | "get_platform_metrics";

export const TOOL_PERMISSION_MAP: Record<ApprovedToolName, string> = {
  get_student_count: "tenant.ai.analytics.student",
  get_attendance_summary: "tenant.ai.analytics.attendance",
  get_student_attendance_details: "tenant.ai.analytics.attendance",
  get_outstanding_fee_summary: "tenant.ai.analytics.fees",
  get_platform_metrics: "platform.overview.read",
};

export const APPROVED_TOOLS_REGISTRY: Record<
  ApprovedToolName,
  {
    name: ApprovedToolName;
    description: string;
    requiredPermission: string;
    parametersSchema: Record<string, unknown>;
  }
> = {
  get_student_count: {
    name: "get_student_count",
    description: "Returns the active student count, class distribution, and enrolment statistics for the institute.",
    requiredPermission: "tenant.ai.analytics.student",
    parametersSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ACTIVE", "INACTIVE", "ALUMNI"] },
        classId: { type: "string" },
      },
    },
  },
  get_attendance_summary: {
    name: "get_attendance_summary",
    description: "Returns attendance register aggregates (present, absent, late, percentage) for a date. Scoped strictly to assigned batches for Teachers.",
    requiredPermission: "tenant.ai.analytics.attendance",
    parametersSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        sectionId: { type: "string" },
        batchId: { type: "string", description: "Batch ID to filter attendance" },
      },
    },
  },
  get_student_attendance_details: {
    name: "get_student_attendance_details",
    description: "Returns granular student-level attendance percentages, session counts, dates, and identifies students below an attendance threshold (default 75%). Scoped strictly to assigned batches for Teachers.",
    requiredPermission: "tenant.ai.analytics.attendance",
    parametersSchema: {
      type: "object",
      properties: {
        batchId: { type: "string", description: "Optional batch ID to filter records" },
        thresholdPercentage: { type: "number", description: "Attendance threshold percentage (default 75)" },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD" },
      },
    },
  },
  get_outstanding_fee_summary: {
    name: "get_outstanding_fee_summary",
    description: "Returns outstanding fee dues, overdue invoice counts, and collection totals.",
    requiredPermission: "tenant.ai.analytics.fees",
    parametersSchema: {
      type: "object",
      properties: {},
    },
  },
  get_platform_metrics: {
    name: "get_platform_metrics",
    description: "Returns aggregated platform overview metrics (total institutes, active/trial breakdown, platform student census, AI usage, and plans). Restricted strictly to Platform Owners.",
    requiredPermission: "platform.overview.read",
    parametersSchema: {
      type: "object",
      properties: {},
    },
  },
};
