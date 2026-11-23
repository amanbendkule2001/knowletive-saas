import { NextRequest, NextResponse } from "next/server";
import { getEffectiveAiContext, evaluateAiPermission } from "@/lib/ai-permissions";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/copilot/threads
 * List conversation threads for the authenticated user within their tenant or platform console.
 */
export async function GET() {
  const ctx = await getEffectiveAiContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Unauthorized. Valid session required." },
      { status: 401 },
    );
  }

  const access = evaluateAiPermission(ctx, "tenant.ai.copilot");
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, code: access.code },
      { status: 403 },
    );
  }

  const threadFilter = ctx.user.isPlatformOwner
    ? { userId: ctx.user.id, deletedAt: null }
    : { tenantId: ctx.tenant.id, userId: ctx.user.id, deletedAt: null };

  const threads = await db.copilotThread.findMany({
    where: threadFilter,
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { messages: true } },
      messages: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { content: true, createdAt: true, role: true },
      },
    },
    take: 50,
  });

  return NextResponse.json({
    threads: threads.map((t) => ({
      id: t.id,
      title: t.title,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      messageCount: t._count.messages,
      lastMessage: t.messages[0] || null,
    })),
  });
}

/**
 * POST /api/copilot/threads
 * Create a new conversation thread for the authenticated user.
 */
export async function POST(req: NextRequest) {
  const ctx = await getEffectiveAiContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Unauthorized. Valid session required." },
      { status: 401 },
    );
  }

  const access = evaluateAiPermission(ctx, "tenant.ai.copilot");
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, code: access.code },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const rawTitle = typeof body.title === "string" ? body.title.trim() : "";
  const title = rawTitle.slice(0, 80) || "New Chat";

  const thread = await db.copilotThread.create({
    data: {
      tenantId: ctx.tenant.id,
      userId: ctx.user.id,
      title,
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ thread }, { status: 201 });
}
