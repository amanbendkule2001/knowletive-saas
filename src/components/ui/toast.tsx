"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { ShieldAlert, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastType = "error" | "warning" | "success" | "info";

export type ToastItem = {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  timestamp: number;
};

export const ACCESS_DENIED_MESSAGES = {
  PAGE: "Access denied. You do not have permission to view this page.",
  CREATE: "Permission denied. You are not authorized to create this record.",
  UPDATE: "Permission denied. You do not have permission to modify this information.",
  DELETE: "Access denied. You are not authorized to delete this record.",
  GENERAL: "You do not have permission to perform this action.",
  MODULE: "You do not have access to this module. Please contact your administrator.",
} as const;

const EVENT_NAME = "knowletive:toast";
const DEDUP_WINDOW_MS = 2500;
const TOAST_LIFETIME_MS = 4500;

let lastToastMessage = "";
let lastToastTime = 0;

export function showToast(options: { type?: ToastType; title?: string; message: string }) {
  if (typeof window === "undefined") return;

  const now = Date.now();
  if (options.message === lastToastMessage && now - lastToastTime < DEDUP_WINDOW_MS) {
    return; // Suppress duplicate toast
  }

  lastToastMessage = options.message;
  lastToastTime = now;

  window.dispatchEvent(
    new CustomEvent(EVENT_NAME, {
      detail: {
        id: Math.random().toString(36).substring(2, 9),
        type: options.type ?? "error",
        title: options.title,
        message: options.message,
        timestamp: now,
      },
    }),
  );
}

export const toast = {
  error: (message: string, title?: string) => showToast({ type: "error", title, message }),
  warning: (message: string, title?: string) => showToast({ type: "warning", title, message }),
  success: (message: string, title?: string) => showToast({ type: "success", title, message }),
  info: (message: string, title?: string) => showToast({ type: "info", title, message }),

  // Pre-configured standardized access denied helpers
  accessDenied: (message: string = ACCESS_DENIED_MESSAGES.PAGE) =>
    showToast({ type: "error", title: "Access Restricted", message }),
  permissionDenied: (message: string = ACCESS_DENIED_MESSAGES.GENERAL) =>
    showToast({ type: "error", title: "Permission Denied", message }),
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const handledUrlRef = useRef<string>("");

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Listen to custom dispatch events
  useEffect(() => {
    function handleEvent(event: Event) {
      const customEvent = event as CustomEvent<ToastItem>;
      if (!customEvent.detail) return;
      const item = customEvent.detail;
      setToasts((prev) => [...prev.slice(-4), item]); // keep max 5 items

      setTimeout(() => {
        removeToast(item.id);
      }, TOAST_LIFETIME_MS);
    }

    window.addEventListener(EVENT_NAME, handleEvent);
    return () => window.removeEventListener(EVENT_NAME, handleEvent);
  }, [removeToast]);

  // Inspect URL search params on mount/location change for access denied triggers
  useEffect(() => {
    if (typeof window === "undefined") return;

    const currentUrl = window.location.href;
    if (handledUrlRef.current === currentUrl) return;
    handledUrlRef.current = currentUrl;

    const params = new URLSearchParams(window.location.search);
    const denied = params.get("denied");
    const forbidden = params.get("forbidden");
    const deniedAction = params.get("denied_action");
    const deniedModule = params.get("denied_module");

    if (deniedAction === "create") {
      toast.error(ACCESS_DENIED_MESSAGES.CREATE, "Permission Denied");
    } else if (deniedAction === "update") {
      toast.error(ACCESS_DENIED_MESSAGES.UPDATE, "Permission Denied");
    } else if (deniedAction === "delete") {
      toast.error(ACCESS_DENIED_MESSAGES.DELETE, "Access Denied");
    } else if (deniedModule === "1" || deniedModule === "true") {
      toast.error(ACCESS_DENIED_MESSAGES.MODULE, "Module Restricted");
    } else if (denied === "page" || forbidden === "1" || window.location.pathname === "/app/forbidden") {
      toast.error(ACCESS_DENIED_MESSAGES.PAGE, "Access Denied");
    } else if (denied) {
      toast.error(ACCESS_DENIED_MESSAGES.GENERAL, "Permission Denied");
    }

    // Clean up query param from URL without refreshing the page
    if (denied || forbidden || deniedAction || deniedModule) {
      params.delete("denied");
      params.delete("forbidden");
      params.delete("denied_action");
      params.delete("denied_module");
      const cleanSearch = params.toString() ? `?${params.toString()}` : "";
      window.history.replaceState(null, "", `${window.location.pathname}${cleanSearch}`);
    }
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none sm:max-w-md"
    >
      {toasts.map((item) => {
        const isError = item.type === "error";
        const isWarning = item.type === "warning";
        const isSuccess = item.type === "success";

        return (
          <div
            key={item.id}
            role="alert"
            aria-live="assertive"
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-2xl backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-top-3",
              isError &&
                "bg-[var(--surface)] text-[var(--text)] border-[color-mix(in_srgb,var(--danger)_35%,transparent)] shadow-[0_12px_32px_-4px_rgba(239,68,68,0.2)]",
              isWarning &&
                "bg-[var(--surface)] text-[var(--text)] border-[color-mix(in_srgb,var(--warning)_35%,transparent)] shadow-[0_12px_32px_-4px_rgba(245,158,11,0.2)]",
              isSuccess &&
                "bg-[var(--surface)] text-[var(--text)] border-[color-mix(in_srgb,var(--success)_35%,transparent)] shadow-[0_12px_32px_-4px_rgba(16,185,129,0.2)]",
              !isError &&
                !isWarning &&
                !isSuccess &&
                "bg-[var(--surface)] text-[var(--text)] border-[var(--border)]",
            )}
          >
            <div className="shrink-0 mt-0.5">
              {isError && <ShieldAlert className="size-5 text-[var(--danger)]" />}
              {isWarning && <AlertTriangle className="size-5 text-[var(--warning)]" />}
              {isSuccess && <CheckCircle2 className="size-5 text-[var(--success)]" />}
              {!isError && !isWarning && !isSuccess && (
                <Info className="size-5 text-[var(--brand)]" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              {item.title && (
                <p className="text-[13px] font-semibold leading-tight mb-0.5">{item.title}</p>
              )}
              <p className="text-xs text-[var(--text)] leading-relaxed font-normal">{item.message}</p>
            </div>

            <button
              type="button"
              onClick={() => removeToast(item.id)}
              className="shrink-0 rounded-lg p-1 text-muted transition hover:bg-[var(--surface-2)] hover:text-foreground"
              aria-label="Dismiss notification"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

