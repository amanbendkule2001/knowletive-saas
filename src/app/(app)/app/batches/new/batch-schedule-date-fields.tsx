"use client";

import { useEffect, useState } from "react";
import {
  Calendar,
  Clock,
  MapPin,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Field, FormGrid } from "@/components/ui/form-field";

const DAYS = [
  { key: "Mon", label: "Mon" },
  { key: "Tue", label: "Tue" },
  { key: "Wed", label: "Wed" },
  { key: "Thu", label: "Thu" },
  { key: "Fri", label: "Fri" },
  { key: "Sat", label: "Sat" },
  { key: "Sun", label: "Sun" },
];

function format12h(time24: string): string {
  if (!time24) return "";
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr || "00";
  if (isNaN(h)) return time24;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  h = h ? h : 12; // 0 becomes 12
  return `${h}:${m} ${ampm}`;
}

export function BatchScheduleDateFields({
  initialStartDate = "",
  initialEndDate = "",
  initialSchedule = "",
}: {
  initialStartDate?: string;
  initialEndDate?: string;
  initialSchedule?: string;
}) {
  // Date State
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);

  // Time & Days State
  const [selectedDays, setSelectedDays] = useState<string[]>(["Mon", "Wed", "Fri"]);
  const [startTime, setStartTime] = useState("16:00");
  const [endTime, setEndTime] = useState("17:30");
  const [room, setRoom] = useState("");

  // Schedule text & custom edit mode
  const [scheduleText, setScheduleText] = useState(initialSchedule);
  const [isCustomEdited, setIsCustomEdited] = useState(Boolean(initialSchedule));

  // Auto-generate schedule when pickers change (unless user manually typed custom schedule)
  useEffect(() => {
    if (isCustomEdited && scheduleText) return;

    if (selectedDays.length === 0 && !startTime && !room) {
      setScheduleText("");
      return;
    }

    const parts: string[] = [];
    if (selectedDays.length > 0) {
      parts.push(selectedDays.join(", "));
    }
    if (startTime && endTime) {
      parts.push(`${format12h(startTime)} – ${format12h(endTime)}`);
    } else if (startTime) {
      parts.push(`From ${format12h(startTime)}`);
    }
    if (room.trim()) {
      parts.push(`(${room.trim()})`);
    }

    setScheduleText(parts.join(" • "));
  }, [selectedDays, startTime, endTime, room, isCustomEdited]);

  // Day toggle
  const toggleDay = (day: string) => {
    setIsCustomEdited(false);
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  // Day Presets
  const applyDayPreset = (days: string[]) => {
    setIsCustomEdited(false);
    setSelectedDays(days);
  };

  // Duration Presets
  const applyDurationHours = (hours: number) => {
    if (!startTime) return;
    setIsCustomEdited(false);
    const [h, m] = startTime.split(":").map(Number);
    const totalMinutes = h * 60 + m + Math.round(hours * 60);
    const newH = Math.floor(totalMinutes / 60) % 24;
    const newM = totalMinutes % 60;
    setEndTime(`${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`);
  };

  // Date Presets
  const applyDatePreset = (months: number) => {
    const today = new Date();
    const startStr = today.toISOString().split("T")[0];
    const end = new Date(today);
    end.setMonth(end.getMonth() + months);
    const endStr = end.toISOString().split("T")[0];
    setStartDate(startStr);
    setEndDate(endStr);
  };

  const handleManualScheduleChange = (val: string) => {
    setScheduleText(val);
    setIsCustomEdited(true);
  };

  const resetToAutoSchedule = () => {
    setIsCustomEdited(false);
    const parts: string[] = [];
    if (selectedDays.length > 0) parts.push(selectedDays.join(", "));
    if (startTime && endTime) parts.push(`${format12h(startTime)} – ${format12h(endTime)}`);
    if (room.trim()) parts.push(`(${room.trim()})`);
    setScheduleText(parts.join(" • "));
  };

  return (
    <div className="space-y-5">
      {/* Date Selection Section */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <label className="label text-xs font-medium block">
            Batch Duration (Dates)
          </label>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted">Presets:</span>
            <button
              type="button"
              onClick={() => applyDatePreset(3)}
              className="px-2 py-0.5 rounded bg-[var(--surface-hover)] hover:bg-[var(--surface-2)] text-[var(--text)] transition"
            >
              3 Months
            </button>
            <button
              type="button"
              onClick={() => applyDatePreset(6)}
              className="px-2 py-0.5 rounded bg-[var(--surface-hover)] hover:bg-[var(--surface-2)] text-[var(--text)] transition"
            >
              6 Months
            </button>
            <button
              type="button"
              onClick={() => applyDatePreset(12)}
              className="px-2 py-0.5 rounded bg-[var(--surface-hover)] hover:bg-[var(--surface-2)] text-[var(--text)] transition"
            >
              1 Year
            </button>
          </div>
        </div>

        <FormGrid>
          <Field label="Start date" htmlFor="startDate">
            <input
              id="startDate"
              name="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input text-xs w-full"
            />
          </Field>

          <Field label="End date" htmlFor="endDate">
            <input
              id="endDate"
              name="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input text-xs w-full"
            />
          </Field>
        </FormGrid>
      </div>

      {/* Structured Time & Days Selection */}
      <div className="border border-[var(--border)] rounded-xl p-4 bg-[var(--surface-subtle)] space-y-4">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-xs font-semibold text-[var(--text)] flex items-center gap-1.5">
              <Clock className="size-3.5 text-[var(--brand)]" />
              Schedule & Timing Builder
            </span>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-muted">Day Presets:</span>
              <button
                type="button"
                onClick={() => applyDayPreset(["Mon", "Wed", "Fri"])}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border)]"
              >
                MWF
              </button>
              <button
                type="button"
                onClick={() => applyDayPreset(["Tue", "Thu", "Sat"])}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border)]"
              >
                TTS
              </button>
              <button
                type="button"
                onClick={() => applyDayPreset(["Mon", "Tue", "Wed", "Thu", "Fri"])}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border)]"
              >
                Mon–Fri
              </button>
              <button
                type="button"
                onClick={() => applyDayPreset(["Sat", "Sun"])}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border)]"
              >
                Weekends
              </button>
            </div>
          </div>

          {/* Day selection chips */}
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => {
              const active = selectedDays.includes(d.key);
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => toggleDay(d.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    active
                      ? "bg-[var(--brand)] text-white shadow-sm"
                      : "bg-[var(--surface)] border border-[var(--border)] text-muted hover:text-[var(--text)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time selection & Duration */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] font-medium text-muted block mb-1">Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
                setIsCustomEdited(false);
              }}
              className="input text-xs w-full font-mono"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[11px] font-medium text-muted">End Time</label>
              <div className="flex gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => applyDurationHours(1)}
                  className="text-[var(--brand)] hover:underline"
                >
                  +1h
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => applyDurationHours(1.5)}
                  className="text-[var(--brand)] hover:underline"
                >
                  +1.5h
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => applyDurationHours(2)}
                  className="text-[var(--brand)] hover:underline"
                >
                  +2h
                </button>
              </div>
            </div>
            <input
              type="time"
              value={endTime}
              onChange={(e) => {
                setEndTime(e.target.value);
                setIsCustomEdited(false);
              }}
              className="input text-xs w-full font-mono"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted block mb-1">Room / Location (Optional)</label>
            <div className="relative">
              <MapPin className="absolute left-2.5 top-2.5 size-3.5 text-muted" />
              <input
                type="text"
                placeholder="e.g. Room 204"
                value={room}
                onChange={(e) => {
                  setRoom(e.target.value);
                  setIsCustomEdited(false);
                }}
                className="input pl-8 text-xs w-full"
              />
            </div>
          </div>
        </div>

        {/* Formatted Schedule Input (Directly Submitted + Editable) */}
        <div className="pt-2 border-t border-[var(--border)]">
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="schedule" className="text-xs font-medium text-[var(--text)] flex items-center gap-1.5">
              <span>Final Schedule Text</span>
              {isCustomEdited ? (
                <span className="text-[10px] bg-amber-500/10 text-amber-500 px-1.5 py-0.2 rounded font-medium">
                  Custom Edited
                </span>
              ) : (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.2 rounded font-medium">
                  Auto-Generated
                </span>
              )}
            </label>
            {isCustomEdited && (
              <button
                type="button"
                onClick={resetToAutoSchedule}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--brand)] hover:underline"
              >
                <RotateCcw className="size-3" /> Re-sync with pickers
              </button>
            )}
          </div>
          <input
            id="schedule"
            name="schedule"
            type="text"
            value={scheduleText}
            onChange={(e) => handleManualScheduleChange(e.target.value)}
            placeholder="e.g. Mon, Wed, Fri • 04:00 PM – 05:30 PM (Room 204)"
            className="input text-xs w-full font-medium"
          />
          <p className="text-[10px] text-muted mt-1">
            Pick from the days and time selectors above or type custom schedule text directly.
          </p>
        </div>
      </div>
    </div>
  );
}
