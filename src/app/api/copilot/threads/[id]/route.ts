import { NextRequest, NextResponse } from "next/server";
import { getEffectiveAiContext, evaluateAiPermission } from "@/lib/ai-permissions";
import { db } from "@/lib/db";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/copilot/threads/[id]
 * Fetch a single conversation thread and its message history.
 */
export async function GET(_req: NextRequest, context: RouteContext) {
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

  const { id } = await context.params;

  const whereClause = ctx.user.isPlatformOwner
    ? { id, userId: ctx.user.id, deletedAt: null }
    : { id, tenantId: ctx.tenant.id, userId: ctx.user.id, deletedAt: null };

  const thread = await db.copilotThread.findFirst({
    where: whereClause,
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!thread) {
    return NextResponse.json(
      { error: "Thread not found or access denied." },
      { status: 404 },
    );
  }

  return NextResponse.json({ thread });
}

/**
 * PATCH /api/copilot/threads/[id]
 * Rename a conversation thread.
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
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

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const rawTitle = typeof body.title === "string" ? body.title.trim() : "";

  if (!rawTitle) {
    return NextResponse.json(
      { error: "Title is required for renaming." },
      { status: 400 },
    );
  }

  const whereClause = ctx.user.isPlatformOwner
    ? { id, userId: ctx.user.id, deletedAt: null }
    : { id, tenantId: ctx.tenant.id, userId: ctx.user.id, deletedAt: null };

  const thread = await db.copilotThread.findFirst({
    where: whereClause,
  });

  if (!thread) {
    return NextResponse.json(
      { error: "Thread not found or access denied." },
      { status: 404 },
    );
  }

  const updated = await db.copilotThread.update({
    where: { id },
    data: {
      title: rawTitle.slice(0, 80),
    },
    select: {
      id: true,
      title: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ thread: updated });
}

/**
 * DELETE /api/copilot/threads/[id]
 * Soft-delete a conversation thread.
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
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

  const { id } = await context.params;

  const whereClause = ctx.user.isPlatformOwner
    ? { id, userId: ctx.user.id, deletedAt: null }
    : { id, tenantId: ctx.tenant.id, userId: ctx.user.id, deletedAt: null };

  const thread = await db.copilotThread.findFirst({
    where: whereClause,
  });

  if (!thread) {
    return NextResponse.json(
      { error: "Thread not found or access denied." },
      { status: 404 },
    );
  }

  await db.copilotThread.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, deletedId: id });
}
