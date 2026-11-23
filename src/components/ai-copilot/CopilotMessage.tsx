"use client";

import React, { useState } from "react";
import { Copy, Check, Bot, User, Cpu } from "lucide-react";
import { CopilotDataTable } from "./CopilotDataTable";
import { CopilotSourceReference, ToolSourceItem } from "./CopilotSourceReference";

export interface MessageItem {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
  content: string;
  createdAt: string | Date;
  status?: "SENT" | "STREAMING" | "COMPLETE" | "ERROR";
  provider?: string | null;
  model?: string | null;
  durationMs?: number | null;
  sources?: ToolSourceItem[];
}

interface Props {
  message: MessageItem;
}

/**
 * Parses markdown-like text containing simple formatting and tables.
 */
function renderFormattedContent(content: string) {
  // Check if content has markdown tables
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let tableBuffer: string[] = [];

  function flushTable(buf: string[], keyPrefix: number) {
    if (buf.length < 2) {
      buf.forEach((line, idx) => {
        elements.push(<p key={`${keyPrefix}-${idx}`} className="my-1">{line}</p>);
      });
      return;
    }
    const headerLine = buf[0];
    const dataLines = buf.slice(2); // Skip separator |---|---|
    const headers = headerLine
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    const rows = dataLines.map((rowStr) =>
      rowStr
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    elements.push(
      <CopilotDataTable key={`tbl-${keyPrefix}`} headers={headers} rows={rows} />,
    );
  }

  lines.forEach((line, idx) => {
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      tableBuffer.push(line.trim());
    } else {
      if (tableBuffer.length > 0) {
        flushTable(tableBuffer, idx);
        tableBuffer = [];
      }
      if (!line.trim()) {
        elements.push(<div key={`sp-${idx}`} className="h-2" />);
      } else if (line.startsWith("### ")) {
        elements.push(
          <h4 key={idx} className="font-semibold text-sm mt-2 mb-1 text-[var(--foreground)]">
            {line.replace("### ", "")}
          </h4>,
        );
      } else if (line.startsWith("## ")) {
        elements.push(
          <h3 key={idx} className="font-bold text-sm mt-2 mb-1 text-[var(--foreground)]">
            {line.replace("## ", "")}
          </h3>,
        );
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        elements.push(
          <li key={idx} className="ml-4 list-disc my-0.5 text-xs">
            {parseInlineStyles(line.slice(2))}
          </li>,
        );
      } else if (/^\d+\.\s/.test(line)) {
        const match = line.match(/^(\d+)\.\s(.*)$/);
        elements.push(
          <li key={idx} className="ml-4 list-decimal my-0.5 text-xs">
            {parseInlineStyles(match ? match[2] : line)}
          </li>,
        );
      } else {
        elements.push(
          <p key={idx} className="my-1 text-xs leading-relaxed">
            {parseInlineStyles(line)}
          </p>,
        );
      }
    }
  });

  if (tableBuffer.length > 0) {
    flushTable(tableBuffer, lines.length);
  }

  return elements;
}

function parseInlineStyles(text: string): React.ReactNode {
  // Bold **text**
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-[var(--foreground)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-[var(--muted-surface)] px-1 py-0.5 font-mono text-[11px] text-[var(--brand)]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export function CopilotMessage({ message }: Props) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "USER";

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isUser) {
    return (
      <div className="flex justify-end gap-2 my-2">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[var(--brand)] px-3.5 py-2 text-white shadow-sm">
          <p className="text-xs whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 my-3 text-[var(--foreground)] group">
      <div className="grid size-7 shrink-0 place-items-center rounded-xl bg-[var(--brand-surface,rgba(79,70,229,0.1))] text-[var(--brand)] mt-0.5">
        <Bot className="size-4" />
      </div>
      <div className="flex-1 max-w-[88%] min-w-0">
        <div className="rounded-2xl rounded-tl-sm border border-[var(--border)] bg-[var(--surface-2,var(--surface))] p-3 shadow-sm">
          <div className="text-xs">
            {renderFormattedContent(message.content)}
          </div>

          {/* Render Grounding Sources if present */}
          {message.sources && message.sources.length > 0 && (
            <CopilotSourceReference sources={message.sources} />
          )}

          {/* Footer Metadata & Copy Button */}
          <div className="mt-2.5 flex items-center justify-between border-t border-[var(--border)] pt-1.5 text-[10px] text-[var(--muted)]">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 font-mono">
                <Cpu className="size-3" />
                {message.model ? message.model.split("/").pop() : "Grounded Copilot"}
              </span>
              {message.durationMs && (
                <span>• {(message.durationMs / 1000).toFixed(1)}s</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[var(--hover-surface)] hover:text-[var(--foreground)] transition-colors opacity-70 group-hover:opacity-100"
              title="Copy message text"
            >
              {copied ? (
                <>
                  <Check className="size-3 text-emerald-500" />
                  <span className="text-emerald-500">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
