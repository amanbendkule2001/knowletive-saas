"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, getTenantContext } from "@/lib/auth";

export async function getInAppNotificationsAction() {
  const user = await getSession();
  if (!user) return { notifications: [], unreadCount: 0 };

  const ctx = await getTenantContext();

  const whereCondition = {
    channel: "IN_APP" as const,
    OR: [
      { recipientUserId: user.id },
      ...(ctx ? [{ tenantId: ctx.tenant.id, recipientUserId: null }] : []),
    ],
  };

  const [notifications, unreadCount] = await Promise.all([
    db.notificationLog.findMany({
      where: whereCondition,
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        subject: true,
        body: true,
        isRead: true,
        readAt: true,
        createdAt: true,
        template: true,
        meta: true,
      },
    }),
    db.notificationLog.count({
      where: {
        ...whereCondition,
        isRead: false,
      },
    }),
  ]);

  return { notifications, unreadCount };
}

export async function markNotificationReadAction(formData: FormData) {
  const user = await getSession();
  if (!user) return;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const ctx = await getTenantContext();

  const notification = await db.notificationLog.findUnique({
    where: { id },
  });

  if (!notification) return;

  // Security check: must belong to the user or their active tenant
  const isOwner =
    notification.recipientUserId === user.id ||
    (ctx && notification.tenantId === ctx.tenant.id);

  if (!isOwner) return;

  await db.notificationLog.update({
    where: { id },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  revalidatePath("/app");
  revalidatePath("/portal");
}

export async function markAllNotificationsReadAction() {
  const user = await getSession();
  if (!user) return;

  const ctx = await getTenantContext();

  await db.notificationLog.updateMany({
    where: {
      channel: "IN_APP",
      isRead: false,
      OR: [
        { recipientUserId: user.id },
        ...(ctx ? [{ tenantId: ctx.tenant.id, recipientUserId: null }] : []),
      ],
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  revalidatePath("/app");
  revalidatePath("/portal");
}

