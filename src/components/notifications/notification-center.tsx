"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, Check, CheckCheck, Inbox, Loader2 } from "lucide-react";
import {
  getInAppNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/actions/notifications";
import { timeAgo } from "@/lib/format";

type InAppNotification = {
  id: string;
  subject: string | null;
  body: string;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
  template: string;
  meta: unknown;
};

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  const refresh = async () => {
    try {
      const data = await getInAppNotificationsAction();
      setNotifications(data.notifications as InAppNotification[]);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    }
  };

  useEffect(() => {
    let mounted = true;
    void getInAppNotificationsAction().then((data) => {
      if (mounted && data) {
        setNotifications(data.notifications as InAppNotification[]);
        setUnreadCount(data.unreadCount);
      }
    });

    const interval = setInterval(() => {
      void getInAppNotificationsAction().then((data) => {
        if (mounted && data) {
          setNotifications(data.notifications as InAppNotification[]);
          setUnreadCount(data.unreadCount);
        }
      });
    }, 60_000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleOpen = () => {
    if (!open) {
      setLoading(true);
      refresh().finally(() => setLoading(false));
    }
    setOpen((prev) => !prev);
  };

  const handleMarkRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));

    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", id);
      await markNotificationReadAction(fd);
    });
  };

  const handleMarkAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);

    startTransition(async () => {
      await markAllNotificationsReadAction();
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className="btn btn-ghost btn-icon relative"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="size-4.5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-[var(--brand)] text-[9px] font-bold text-white shadow-sm ring-2 ring-[var(--surface)] animate-in zoom-in-50">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            className="fixed inset-0 z-30 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className="animate-in absolute right-0 top-full z-40 mt-2 w-80 sm:w-96 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-0 shadow-2xl overflow-hidden text-foreground">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 bg-[var(--surface-sunken)]">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">Notifications</span>
                {unreadCount > 0 && (
                  <span className="badge badge-brand text-[10px] px-1.5 py-0.5">
                    {unreadCount} new
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 text-[11px] font-medium text-[var(--brand)] hover:underline disabled:opacity-50"
                >
                  <CheckCheck className="size-3" /> Mark all read
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto divide-y divide-[var(--border)]">
              {loading && notifications.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                  <Inbox className="size-8 text-[var(--muted-2)] mb-2 stroke-[1.5]" />
                  <p className="text-xs font-medium">All caught up</p>
                  <p className="text-[11px] text-muted mt-0.5">
                    No notifications right now.
                  </p>
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 text-left transition hover:bg-[var(--surface-2)] flex items-start gap-2.5 ${
                      !n.isRead ? "bg-[var(--brand-soft)]/20" : ""
                    }`}
                  >
                    <div className="mt-1 shrink-0">
                      {!n.isRead ? (
                        <div className="size-2 rounded-full bg-[var(--brand)] ring-2 ring-[var(--brand-soft)]" />
                      ) : (
                        <div className="size-2 rounded-full bg-transparent" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      {n.subject && (
                        <p className="text-xs font-semibold text-foreground truncate">
                          {n.subject}
                        </p>
                      )}
                      <p className="text-[11px] text-muted line-clamp-2 mt-0.5 whitespace-pre-wrap">
                        {n.body}
                      </p>
                      <span className="block text-[10px] text-[var(--muted-2)] mt-1.5 font-medium">
                        {timeAgo(n.createdAt)}
                      </span>
                    </div>
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={() => handleMarkRead(n.id)}
                        className="btn btn-ghost btn-icon size-6 shrink-0 rounded-md text-muted hover:text-foreground"
                        title="Mark as read"
                      >
                        <Check className="size-3" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
