"use client";

import React, { useState, useRef, useEffect } from "react";
import { CopilotHeader } from "./CopilotHeader";
import { CopilotMessages } from "./CopilotMessages";
import { CopilotInput } from "./CopilotInput";
import { CopilotHistory } from "./CopilotHistory";
import { MessageItem } from "./CopilotMessage";
import { ToolSourceItem } from "./CopilotSourceReference";

interface Props {
  onClose: () => void;
  tenantName?: string;
  roleKey?: string;
  canViewFees?: boolean;
}

export function CopilotPanel({ onClose, tenantName, roleKey, canViewFees }: Props) {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [currentThreadTitle, setCurrentThreadTitle] = useState<string | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load thread messages when threadId changes
  const loadThread = async (threadId: string) => {
    try {
      const res = await fetch(`/api/copilot/threads/${threadId}`);
      if (res.ok) {
        const data = await res.json();
        const thread = data.thread;
        setCurrentThreadId(thread.id);
        setCurrentThreadTitle(thread.title);

        const loadedMessages: MessageItem[] = (thread.messages || []).map(
          (m: {
            id: string;
            role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
            content: string;
            createdAt: string;
            model?: string | null;
            durationMs?: number | null;
            metadata?: {
              toolResults?: {
                tool: string;
                success: boolean;
                code?: string;
                hasData: boolean;
              }[];
            };
          }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
            model: m.model,
            durationMs: m.durationMs,
            sources: m.metadata?.toolResults?.map((t) => ({
              toolName: t.tool,
              success: t.success,
              code: t.code,
            })),
          }),
        );
        setMessages(loadedMessages);
        setShowHistory(false);
      }
    } catch (err) {
      console.error("Failed to load thread details", err);
    }
  };

  const handleNewChat = () => {
    if (isStreaming && abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setCurrentThreadId(null);
    setCurrentThreadTitle(undefined);
    setMessages([]);
    setInput("");
    setShowHistory(false);
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = (customPrompt || input).trim();
    if (!textToSend || isStreaming) return;

    setInput("");

    // Create optimistic user message
    const userMsgId = `user-${Date.now()}`;
    const userMsg: MessageItem = {
      id: userMsgId,
      role: "USER",
      content: textToSend,
      createdAt: new Date().toISOString(),
      status: "COMPLETE",
    };

    // Create placeholder assistant message
    const assistantMsgId = `assistant-${Date.now()}`;
    const assistantPlaceholder: MessageItem = {
      id: assistantMsgId,
      role: "ASSISTANT",
      content: "",
      createdAt: new Date().toISOString(),
      status: "STREAMING",
    };

    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message: textToSend,
          threadId: currentThreadId,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        const isForbidden = response.status === 403;
        const errorMessage =
          errorJson.error ||
          (isForbidden
            ? "AI Copilot is not enabled for your account. Please contact your Institute Owner to request access."
            : `Request failed with status ${response.status}`);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: isForbidden ? `🔒 ${errorMessage}` : `⚠️ Error: ${errorMessage}`,
                  status: isForbidden ? "COMPLETE" : "ERROR",
                }
              : m,
          ),
        );
        setIsStreaming(false);
        return;
      }

      // Check if response is SSE stream
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let accumulatedText = "";
        let sourcesFound: ToolSourceItem[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const lines = part.split("\n");
            let event = "message";
            let data = "";

            for (const line of lines) {
              if (line.startsWith("event: ")) {
                event = line.replace("event: ", "").trim();
              } else if (line.startsWith("data: ")) {
                data = line.replace("data: ", "").trim();
              }
            }

            if (!data) continue;

            try {
              const parsed = JSON.parse(data);

              if (event === "thread") {
                if (parsed.threadId) {
                  setCurrentThreadId(parsed.threadId);
                }
              } else if (event === "tools" || event === "tool_end") {
                const rawList = Array.isArray(parsed)
                  ? parsed
                  : Array.isArray(parsed.tools)
                  ? parsed.tools
                  : [];

                if (rawList.length > 0) {
                  sourcesFound = rawList.map((t: {
                    toolName?: string;
                    tool?: string;
                    success: boolean;
                    code?: string;
                    data?: unknown;
                    disclaimer?: string;
                  }) => ({
                    toolName: t.toolName || t.tool || "unknown_tool",
                    success: Boolean(t.success),
                    code: t.code,
                    data: t.data,
                    disclaimer: t.disclaimer,
                  }));

                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId ? { ...m, sources: sourcesFound } : m,
                    ),
                  );
                }
              } else if (event === "tool_start") {
                // Grounding step indicator
                if (parsed.message) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId && !m.content
                        ? { ...m, content: `_🔍 ${parsed.message}_\n\n` }
                        : m,
                    ),
                  );
                }
              } else if (event === "chunk") {
                accumulatedText += parsed.text || "";
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: accumulatedText }
                      : m,
                  ),
                );
              } else if (event === "done") {
                if (parsed.threadId) {
                  setCurrentThreadId(parsed.threadId);
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          content: accumulatedText || m.content,
                          status: "COMPLETE",
                          model: parsed.engine,
                        }
                      : m,
                  ),
                );
              } else if (event === "error") {
                const errMsg =
                  parsed.error || parsed.message || "An error occurred during generation.";
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          content: `⚠️ Error: ${errMsg}`,
                          status: "ERROR",
                        }
                      : m,
                  ),
                );
              }
            } catch (jsonErr) {
              console.warn("Could not parse SSE chunk", data, jsonErr);
            }
          }
        }
      } else {
        // Standard JSON response fallback
        const data = await response.json();
        if (data.threadId) {
          setCurrentThreadId(data.threadId);
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: data.message || "No content returned.",
                  status: "COMPLETE",
                  model: data.engine,
                }
              : m,
          ),
        );
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: `${m.content} [Generation stopped]`,
                  status: "COMPLETE",
                }
              : m,
          ),
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: "⚠️ Network or service error. Please try again.",
                  status: "ERROR",
                }
              : m,
          ),
        );
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--surface)] select-text">
      {/* Header */}
      <CopilotHeader
        onNewChat={handleNewChat}
        onToggleHistory={() => setShowHistory(!showHistory)}
        onClose={onClose}
        showHistory={showHistory}
        currentThreadTitle={currentThreadTitle}
      />

      {/* Main Content: History Drawer or Messages */}
      {showHistory ? (
        <CopilotHistory
          currentThreadId={currentThreadId}
          onSelectThread={loadThread}
          onBack={() => setShowHistory(false)}
        />
      ) : (
        <>
          <CopilotMessages
            messages={messages}
            isStreaming={isStreaming}
            onSelectSuggestion={(prompt) => handleSend(prompt)}
            tenantName={tenantName}
            roleKey={roleKey}
            canViewFees={canViewFees}
          />
          <CopilotInput
            input={input}
            setInput={setInput}
            onSend={() => handleSend()}
            onStop={handleStop}
            isStreaming={isStreaming}
          />
        </>
      )}
    </div>
  );
}
