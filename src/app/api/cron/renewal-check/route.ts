import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendNotification } from "@/lib/notifications";
import { date } from "@/lib/format";

export async function GET(request: NextRequest) {
  return handleRenewalCheck(request);
}

export async function POST(request: NextRequest) {
  return handleRenewalCheck(request);
}

async function handleRenewalCheck(request: NextRequest) {
  // Authorization check via CRON_SECRET if configured
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "") || request.nextUrl.searchParams.get("key");
    if (token !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // In production without secret, restrict to loopback/internal requests
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor && !forwardedFor.includes("127.0.0.1") && !forwardedFor.includes("::1")) {
      return NextResponse.json({ error: "Unauthorized: CRON_SECRET required in production" }, { status: 401 });
    }
  }

  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const cutoff48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // Find subscriptions ending soon
  const expiring = await db.tenantSubscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING"] },
      OR: [
        { currentPeriodEnd: { lte: in7Days, gte: now } },
        { trialEndsAt: { lte: in3Days, gte: now } },
      ],
    },
    include: {
      tenant: {
        include: {
          memberships: {
            where: {
              status: "ACTIVE",
            },
            include: { user: true, role: true },
          },
        },
      },
      plan: true,
    },
  });

  let notifiedCount = 0;

  for (const sub of expiring) {
    // Check if we sent a reminder in the last 48 hours for this tenant
    const recentReminder = await db.notificationLog.findFirst({
      where: {
        tenantId: sub.tenantId,
        template: "subscription_renewal_reminder",
        createdAt: { gte: cutoff48h },
      },
      select: { id: true },
    });

    if (recentReminder) {
      continue;
    }

    const isTrial = sub.status === "TRIALING";
    const expiryDate = isTrial && sub.trialEndsAt ? sub.trialEndsAt : sub.currentPeriodEnd;
    const daysLeft = Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    const subject = isTrial
      ? `[Action Required] Your Knowletive free trial expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
      : `[Upcoming Renewal] Knowletive subscription renewal in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;

    const body = `Hello ${sub.tenant.name} Team,

Your ${isTrial ? "free trial" : `${sub.plan.name} subscription plan`} for ${sub.tenant.name} is scheduled to end on ${date(expiryDate)} (${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining).

To prevent any disruption to your school attendance registers, parent portal, or staff access, please review your subscription invoice and record your payment proof.

You can view your active plan and outstanding invoices here:
/app/billing

If you have already arranged payment with the accounts team, please disregard this notice.

Best regards,
The Knowletive Platform Team`;

    // Filter admins or owners to receive the alert
    const admins = sub.tenant.memberships.filter((m) => {
      const roleName = m.role?.name?.toLowerCase() ?? "";
      return roleName.includes("admin") || roleName.includes("owner") || roleName.includes("principal");
    });

    // Notify admins in-app and by email
    for (const admin of admins) {
      // In-app alert
      await sendNotification({
        tenantId: sub.tenantId,
        recipientUserId: admin.userId,
        channel: "IN_APP",
        template: "subscription_renewal_reminder",
        to: admin.user.email ?? sub.tenant.email,
        subject,
        body,
        meta: { subscriptionId: sub.id, daysLeft, expiryDate: expiryDate.toISOString() },
      }).catch((e) => console.error("[cron:renewal] in-app error:", e));

      // Email alert
      if (admin.user.email) {
        await sendNotification({
          tenantId: sub.tenantId,
          recipientUserId: admin.userId,
          channel: "EMAIL",
          template: "subscription_renewal_reminder",
          to: admin.user.email,
          subject,
          body,
          meta: { subscriptionId: sub.id, daysLeft },
        }).catch((e) => console.error("[cron:renewal] email error:", e));
      }
    }

    // Also send an email to the school contact email if different from admins
    if (sub.tenant.email && !admins.some((a) => a.user.email === sub.tenant.email)) {
      await sendNotification({
        tenantId: sub.tenantId,
        channel: "EMAIL",
        template: "subscription_renewal_reminder",
        to: sub.tenant.email,
        subject,
        body,
        meta: { subscriptionId: sub.id, daysLeft },
      }).catch((e) => console.error("[cron:renewal] tenant email error:", e));
    }

    notifiedCount++;
  }

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    checked: expiring.length,
    notified: notifiedCount,
  });
}

