"use client";

import React, { useState, useEffect } from "react";
import { MessageSquare, Trash2, Edit2, Check, X, ArrowLeft } from "lucide-react";
import { timeAgo } from "@/lib/format";

export interface ThreadItem {
  id: string;
  title: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  messageCount: number;
  lastMessage?: { content: string; createdAt: string | Date; role: string } | null;
}

interface Props {
  currentThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onBack: () => void;
}

export function CopilotHistory({
  currentThreadId,
  onSelectThread,
  onBack,
}: Props) {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const loadThreads = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/copilot/threads");
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads || []);
      }
    } catch (err) {
      console.error("Failed to load threads", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadThreads();
  }, []);

  const handleStartRename = (thread: ThreadItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(thread.id);
    setEditTitle(thread.title);
  };

  const handleSaveRename = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editTitle.trim()) return;

    try {
      const res = await fetch(`/api/copilot/threads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle.trim() }),
      });
      if (res.ok) {
        setThreads((prev) =>
          prev.map((t) => (t.id === id ? { ...t, title: editTitle.trim() } : t)),
        );
        setEditingId(null);
      }
    } catch (err) {
      console.error("Failed to rename thread", err);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this conversation?")) return;

    try {
      const res = await fetch(`/api/copilot/threads/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setThreads((prev) => prev.filter((t) => t.id !== id));
      }
    } catch (err) {
      console.error("Failed to delete thread", err);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to chat</span>
        </button>
        <span className="text-[11px] font-medium text-[var(--muted)]">
          {threads.length} Conversation{threads.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {loading ? (
          <div className="py-8 text-center text-xs text-[var(--muted)]">
            Loading conversations…
          </div>
        ) : threads.length === 0 ? (
          <div className="py-8 text-center text-xs text-[var(--muted)]">
            No previous conversations found.
          </div>
        ) : (
          threads.map((t) => {
            const isSelected = t.id === currentThreadId;
            const isEditing = editingId === t.id;

            return (
              <div
                key={t.id}
                onClick={() => onSelectThread(t.id)}
                className={`group relative flex items-start justify-between rounded-xl p-2.5 text-left text-xs transition-colors cursor-pointer border ${
                  isSelected
                    ? "bg-[var(--brand-surface,rgba(79,70,229,0.08))] border-[var(--brand)] text-[var(--foreground)]"
                    : "border-transparent hover:bg-[var(--hover-surface)] text-[var(--foreground)]"
                }`}
              >
                <div className="min-w-0 flex-1 pr-2">
                  {isEditing ? (
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="input text-xs py-0.5 px-1.5 h-6 w-full"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={(e) => handleSaveRename(t.id, e)}
                        className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded"
                      >
                        <Check className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(null);
                        }}
                        className="p-1 text-[var(--muted)] hover:bg-[var(--hover-surface)] rounded"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="font-medium truncate">{t.title}</div>
                  )}

                  <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--muted)]">
                    <span>{timeAgo(t.updatedAt)}</span>
                    <span>• {t.messageCount} msg{t.messageCount === 1 ? "" : "s"}</span>
                  </div>
                </div>

                {!isEditing && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => handleStartRename(t, e)}
                      className="grid size-6 place-items-center rounded text-[var(--muted)] hover:bg-[var(--hover-surface)] hover:text-[var(--foreground)]"
                      title="Rename conversation"
                    >
                      <Edit2 className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(t.id, e)}
                      className="grid size-6 place-items-center rounded text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-500"
                      title="Delete conversation"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
