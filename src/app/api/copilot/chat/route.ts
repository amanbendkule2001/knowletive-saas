import { NextRequest, NextResponse } from "next/server";
import { getEffectiveAiContext, evaluateAiPermission } from "@/lib/ai-permissions";
import { rateLimit } from "@/lib/rate-limit";
import { detectPromptInjection, scrubPii } from "@/lib/ai-security";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  executeApprovedTool,
  forwardToCopilotEngine,
  ToolExecutionResult,
} from "@/lib/ai-gateway";
import { ApprovedToolName } from "@/lib/ai-tools";
import { getActiveAiRuntimeConfig } from "@/lib/ai-credential-vault";

export const runtime = "nodejs";

/**
 * AI Copilot Conversational Chat Endpoint.
 * Serves as the secure Next.js authorization gateway between clients,
 * the database services, and the Python Copilot engine.
 *
 * Security Pipeline:
 * 1. User & Tenant / Platform Context Resolution.
 * 2. Centralized RBAC Evaluation (tenant.ai.copilot capability).
 * 3. Atomic Rate Limiting (15 req / min).
 * 4. Prompt Injection & Jailbreak Detection.
 * 5. PII Scrubbing.
 * 6. Conversation Thread Resolution & Persistence.
 * 7. Approved Tool Execution with per-module authorization.
 * 8. LLM Orchestration & Assistant Message Persistence.
 * 9. Streaming SSE / JSON Response Dispatch.
 */
/**
 * Deterministic Chat Intent Routing.
 * Maps cleaned user messages and explicit client requested tools to approved backend tools.
 * Invariant: An attendance inquiry that merely mentions "students" or "below 75%"
 * must NOT trigger get_student_count.
 */
export function resolveChatIntents(
  cleanMessage: string,
  clientRequested: string[] = [],
  _isPlatformOwner: boolean = false,
): ApprovedToolName[] {
  const requestedTools: ApprovedToolName[] = [];
  
  // 1. Platform-wide intent recognition (independent of caller role)
  const isPlatformQuery =
    /\b(?:platform|system|mrr|institutes|tenants|cross-tenant|across all institutes|across institutes|subscription distribution|ai-credit|ai credits)\b/i.test(cleanMessage);

  const isOverallSummary = /\b(?:overall|overview|performance|kpi)\b/i.test(cleanMessage);

  if (
    clientRequested.includes("get_platform_metrics") ||
    isPlatformQuery
  ) {
    requestedTools.push("get_platform_metrics");
  }

  // 2. Attendance intent
  const isAttendanceQuery =
    clientRequested.includes("get_attendance_summary") ||
    clientRequested.includes("get_student_attendance_details") ||
    /\b(?:attendance|absent|present|late|excused|register)\b/i.test(cleanMessage);

  const isStudentAttendanceDetailsQuery =
    clientRequested.includes("get_student_attendance_details") ||
    (isAttendanceQuery &&
      /\b(?:below|threshold|individual|percentage|detail|details|who|which student|records|dates|75%|75 percent)\b/i.test(cleanMessage));

  // 3. Student census intent:
  // Detect if query explicitly refers to platform-wide student counts (e.g. "total students across all institutes")
  const hasPlatformStudentRef =
    /\b(?:students?|total students?)\s+(?:across|in all|on the platform|platform-wide)\b/i.test(cleanMessage) ||
    /\bplatform[- ]wide\s+(?:students?|student statistics|census)\b/i.test(cleanMessage);

  // Detect genuine institute student census requests
  const hasInstituteSpecificStudentKeywords =
    /\b(?:how many students|student count|count of students|enrol|enrolled|enrolment|census|strength|breakdown by class|class breakdown|in my institute|in our institute|in this institute)\b/i.test(cleanMessage);

  const hasGeneralTotalStudents = /\btotal students\b/i.test(cleanMessage);

  const isStudentCensusQuery =
    clientRequested.includes("get_student_count") ||
    hasInstituteSpecificStudentKeywords ||
    (hasGeneralTotalStudents && !hasPlatformStudentRef) ||
    (!isAttendanceQuery && !isPlatformQuery && /\b(?:student|students)\b/i.test(cleanMessage));

  // Support mixed requests: schedule institute tools when their specific intent is present
  if (isOverallSummary || isStudentCensusQuery) {
    requestedTools.push("get_student_count");
  }

  if (isOverallSummary || isAttendanceQuery) {
    requestedTools.push("get_attendance_summary");
  }

  if (isStudentAttendanceDetailsQuery) {
    requestedTools.push("get_student_attendance_details");
  }

  if (
    clientRequested.includes("get_outstanding_fee_summary") ||
    isOverallSummary ||
    /\b(?:fee|fees|dues|invoice|invoices|outstanding|delinquen|balance|collection)\b/i.test(cleanMessage)
  ) {
    requestedTools.push("get_outstanding_fee_summary");
  }

  return requestedTools;
}

export async function POST(req: NextRequest) {
  // 1. Resolve Session & Effective AI Context
  const ctx = await getEffectiveAiContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Unauthorized. Valid session and tenant context required." },
      { status: 401 },
    );
  }

  // 2. Centralized AI Permission Check
  const copilotAccess = evaluateAiPermission(ctx, "tenant.ai.copilot");
  if (!copilotAccess.ok) {
    return NextResponse.json(
      { error: copilotAccess.error, code: copilotAccess.code },
      { status: 403 },
    );
  }

  // 3. Atomic Rate Limiting
  const limit = await rateLimit(`ai:copilot:${ctx.user.id}`, 15, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded. Please wait a moment before sending more requests.",
        retryAfterMs: limit.retryAfterMs,
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      },
    );
  }

  // 4. Parse Request Payload
  const body = await req.json().catch(() => null);
  if (!body || typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json(
      { error: "Invalid request. 'message' string is required." },
      { status: 400 },
    );
  }

  const userMessage = body.message.trim();

  // 5. Payload Size Guard (Maximum 4,000 characters per message)
  if (userMessage.length > 4000) {
    return NextResponse.json(
      {
        error: "Message payload too large. Maximum 4,000 characters per prompt allowed.",
        code: "PAYLOAD_TOO_LARGE",
      },
      { status: 400 },
    );
  }

  // 6. Prompt Injection & Safety Guard
  const injectionCheck = detectPromptInjection(userMessage);
  if (injectionCheck.isSuspicious) {
    return NextResponse.json(
      {
        error: injectionCheck.reason,
        code: "PROMPT_SAFETY_VIOLATION",
      },
      { status: 400 },
    );
  }

  // 7. Scrub PII before LLM distribution
  const { sanitized: cleanMessage } = scrubPii(userMessage);

  // 8. Resolve or Create Conversation Thread & Load Context
  const requestedThreadId =
    typeof body.threadId === "string" && body.threadId.trim()
      ? body.threadId.trim()
      : null;

  type ThreadRecord = {
    id: string;
    tenantId: string;
    userId: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  };

  let thread: ThreadRecord;
  let historyMessages: { role: string; content: string }[] = [];

  if (requestedThreadId) {
    const existingThread = await db.copilotThread.findFirst({
      where: {
        id: requestedThreadId,
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        deletedAt: null,
      },
    });

    if (!existingThread) {
      return NextResponse.json(
        { error: "Thread not found or access denied.", code: "THREAD_NOT_FOUND" },
        { status: 404 },
      );
    }
    thread = existingThread;

    // Load recent message history window (up to 10 previous messages)
    const recentDbMessages = await db.copilotMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    historyMessages = recentDbMessages.reverse().map((m) => ({
      role: m.role.toLowerCase(),
      content: m.content,
    }));
  } else {
    // Generate initial title from prompt snippet
    const autoTitle = userMessage.length > 36 ? `${userMessage.slice(0, 36)}…` : userMessage;
    thread = await db.copilotThread.create({
      data: {
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        title: autoTitle || "New Chat",
      },
    });
  }

  // Persist User Message
  await db.copilotMessage.create({
    data: {
      threadId: thread.id,
      role: "USER",
      content: userMessage,
      status: "COMPLETE",
    },
  });

  // 9. Determine which approved tools to run
  const clientRequested = Array.isArray(body.tools) ? (body.tools as string[]) : [];
  const requestedTools = resolveChatIntents(cleanMessage, clientRequested, ctx.user.isPlatformOwner);

  // 10. Execute tools through secure gateway (with automatic tenant timezone injection)
  const toolResults: ToolExecutionResult[] = [];
  const toolParams: Record<string, unknown> = {
    ...(body.params || {}),
    timezone: ctx.tenant.timezone || "Asia/Kolkata",
  };

  for (const toolName of requestedTools) {
    const toolExec = await executeApprovedTool(toolName, toolParams, ctx);
    toolResults.push(toolExec);
  }

  // 11. Dispatch to Copilot Engine or local synthesis
  const conversationContext =
    historyMessages.length > 0
      ? historyMessages
      : Array.isArray(body.history)
      ? body.history
      : [];

  const synthesis = await forwardToCopilotEngine(
    {
      message: cleanMessage,
      conversationHistory: conversationContext,
      requestedTools,
    },
    ctx,
    toolResults,
  );

  // 12. Persist Assistant Response
  const estimatedInputTokens = Math.ceil(userMessage.length / 4);
  const estimatedOutputTokens =
    synthesis.tokens ?? Math.ceil(synthesis.text.length / 4);
  const isPythonService = synthesis.engineUsed === "python_service";
  const activeRuntimeConfig = await getActiveAiRuntimeConfig();

  await db.copilotMessage.create({
    data: {
      threadId: thread.id,
      role: "ASSISTANT",
      content: synthesis.text,
      status: "COMPLETE",
      provider: isPythonService ? "groq" : "local",
      model: isPythonService
        ? activeRuntimeConfig.activeModel
        : "local-synthesis",
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      durationMs: synthesis.durationMs,
      metadata: {
        engine: synthesis.engineUsed,
        toolsRequested: requestedTools,
        toolResults: toolResults.map((t) => ({
          tool: t.toolName,
          success: t.success,
          code: (t as any).code,
          hasData: t.success ? !!t.data : false,
        })),
      },
    },
  });

  // Touch thread updated timestamp
  await db.copilotThread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date() },
  });

  // 13. Record usage & audit log for Copilot interaction
  const totalTokens = estimatedInputTokens + estimatedOutputTokens;
  void writeAudit({
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "ai.copilot.chat",
    entity: "CopilotInteraction",
    meta: {
      threadId: thread.id,
      engine: synthesis.engineUsed,
      toolsRequested: requestedTools,
      toolsExecutedCount: toolResults.length,
      tokens: totalTokens,
      durationMs: synthesis.durationMs,
    },
  });

  const wantsStream =
    req.headers.get("accept")?.includes("text/event-stream") || body.stream === true;

  if (wantsStream) {
    // Return Server-Sent Events (SSE) Stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Disconnect handler
        if (req.signal.aborted) {
          controller.close();
          return;
        }

        req.signal.addEventListener("abort", () => {
          try {
            controller.close();
          } catch {}
        });

        // 0. Emit thread information
        controller.enqueue(
          encoder.encode(`event: thread\ndata: ${JSON.stringify({ threadId: thread.id })}\n\n`),
        );

        // 1. Emit tool results if any
        if (toolResults.length > 0) {
          controller.enqueue(
            encoder.encode(`event: tools\ndata: ${JSON.stringify(toolResults)}\n\n`),
          );
        }

        // 2. Stream synthesized text chunks
        const chunks = synthesis.text.split(" ");
        let idx = 0;

        function emitNextChunk() {
          if (req.signal.aborted) {
            try {
              controller.close();
            } catch {}
            return;
          }

          if (idx < chunks.length) {
            const word = chunks[idx] + (idx === chunks.length - 1 ? "" : " ");
            controller.enqueue(
              encoder.encode(`event: chunk\ndata: ${JSON.stringify({ text: word })}\n\n`),
            );
            idx++;
            setTimeout(emitNextChunk, 15);
          } else {
            controller.enqueue(
              encoder.encode(
                `event: done\ndata: ${JSON.stringify({
                  engine: synthesis.engineUsed,
                  threadId: thread.id,
                })}\n\n`,
              ),
            );
            controller.close();
          }
        }

        emitNextChunk();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // Return standard JSON response
  return NextResponse.json({
    ok: true,
    threadId: thread.id,
    message: synthesis.text,
    toolResults,
    engine: synthesis.engineUsed,
  });
}
