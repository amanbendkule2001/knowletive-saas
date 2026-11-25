import { db } from "@/lib/db";

export type ModuleBadges = Record<string, number>;

export async function getModuleBadges(
  tenantId: string,
  visits?: Record<string, number | string | null>
): Promise<ModuleBadges> {
  const badges: ModuleBadges = {};
  const now = new Date();
  const defaultRecentThreshold = new Date(now.getTime() - 48 * 3600 * 1000); // 48 hours

  const resolveThreshold = (path: string): Date => {
    const raw = visits?.[path];
    if (raw) {
      const parsed = typeof raw === "number" ? new Date(raw) : new Date(raw);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return defaultRecentThreshold;
  };

  const leadsThreshold = resolveThreshold("/app/leads");
  const studentsThreshold = resolveThreshold("/app/students");
  const feesThreshold = resolveThreshold("/app/fees");
  const examsThreshold = resolveThreshold("/app/exams");
  const announcementsThreshold = resolveThreshold("/app/announcements");

  try {
    const [
      activeLeads,
      pendingFees,
      recentStudents,
      scheduledExams,
      recentAnnouncements,
    ] = await Promise.all([
      db.lead.count({
        where: {
          tenantId,
          updatedAt: { gt: leadsThreshold },
        },
      }),
      db.feeInvoice.count({
        where: {
          tenantId,
          createdAt: { gt: feesThreshold },
        },
      }),
      db.student.count({
        where: {
          tenantId,
          createdAt: { gt: studentsThreshold },
        },
      }),
      db.examination.count({
        where: {
          tenantId,
          updatedAt: { gt: examsThreshold },
        },
      }),
      db.announcement.count({
        where: {
          tenantId,
          publishedAt: { gt: announcementsThreshold },
        },
      }),
    ]);

    if (activeLeads > 0) badges["/app/leads"] = activeLeads;
    if (pendingFees > 0) badges["/app/fees"] = pendingFees;
    if (recentStudents > 0) badges["/app/students"] = recentStudents;
    if (scheduledExams > 0) badges["/app/exams"] = scheduledExams;
    if (recentAnnouncements > 0) badges["/app/announcements"] = recentAnnouncements;
  } catch (error) {
    console.error("[badges] Failed to fetch module badges", error);
  }

  return badges;
}
