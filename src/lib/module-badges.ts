import { db } from "@/lib/db";

export type ModuleBadges = Record<string, number>;

export async function getModuleBadges(tenantId: string): Promise<ModuleBadges> {
  const badges: ModuleBadges = {};
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

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
          status: { in: ["NEW", "CONTACTED", "FOLLOW_UP", "INTERESTED"] },
        },
      }),
      db.feeInvoice.count({
        where: {
          tenantId,
          status: { in: ["PENDING", "OVERDUE", "PARTIAL"] },
        },
      }),
      db.student.count({
        where: {
          tenantId,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      db.examination.count({
        where: {
          tenantId,
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        },
      }),
      db.announcement.count({
        where: {
          tenantId,
          publishedAt: { gte: sevenDaysAgo },
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
