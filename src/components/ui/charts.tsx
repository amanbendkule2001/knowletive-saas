import { cn } from "@/lib/utils";

type Point = { label: string; value: number };

const palette = ["#6366f1", "#8b5cf6", "#06b6d4", "#f59e0b", "#10b981", "#ef4444"];

function fmtNumber(n: number, kind?: "money" | "number" | "percent") {
  if (kind === "money") {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n / 100);
  }
  if (kind === "percent") return `${n.toFixed(0)}%`;
  return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function AreaChart({
  data,
  height = 190,
  format = "number",
  className,
}: {
  data: Point[];
  height?: number;
  format?: "money" | "number" | "percent";
  className?: string;
}) {
  const w = 640;
  const h = 200;
  const padX = 8;
  const top = 18;
  const bottom = 34;
  const max = Math.max(1, ...data.map((d) => d.value));
  const innerW = w - padX * 2;
  const innerH = h - top - bottom;
  const n = Math.max(1, data.length - 1);

  const pts = data.map((d, i) => ({
    x: padX + (i / n) * innerW,
    y: top + innerH - (d.value / max) * innerH,
    ...d,
  }));

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${(padX + innerW).toFixed(1)},${top + innerH} L${padX},${top + innerH} Z`;
  const gid = `area-${format}-${data.length}-${Math.round(max)}`;
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));

  return (
    <div className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Trend chart with ${data.length} points, peak ${max}`}
        className="h-auto w-full"
        style={{ maxHeight: height }}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={padX}
            x2={w - padX}
            y1={top + innerH * t}
            y2={top + innerH * t}
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray={t === 1 ? "0" : "3 4"}
          />
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke="#6366f1" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <g key={`${p.label}-${i}`}>
            <circle cx={p.x} cy={p.y} r="2.6" fill="var(--surface)" stroke="#6366f1" strokeWidth="1.6" />
            {i % labelEvery === 0 && (
              <text x={p.x} y={h - 12} textAnchor="middle" fontSize="9" fill="var(--muted)">
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
        <span>{data[0]?.label ?? ""}</span>
        <span>
          Peak {fmtNumber(max, format)}
        </span>
        <span>{data[data.length - 1]?.label ?? ""}</span>
      </div>
    </div>
  );
}

export function BarList({
  data,
  format = "number",
  color,
  className,
}: {
  data: Point[];
  format?: "money" | "number" | "percent";
  color?: string;
  className?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className={cn("space-y-3", className)}>
      {data.length === 0 && <p className="text-xs text-muted">No data yet.</p>}
      {data.map((d, i) => (
        <div key={d.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-medium">{d.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{fmtNumber(d.value, format)}</span>
          </div>
          <div className="meter">
            <span
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                background: color ?? palette[i % palette.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const w = 96;
  const h = 28;
  const max = Math.max(1, ...data);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const n = Math.max(1, data.length - 1);
  const path = data
    .map((v, i) => `${i === 0 ? "M" : "L"}${((i / n) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-7 w-24", className)} aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Donut({
  segments,
  centerValue,
  centerLabel,
  size = 148,
}: {
  segments: { label: string; value: number; color?: string }[];
  centerValue: string;
  centerLabel: string;
  size?: number;
}) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arcs: { segment: (typeof segments)[number]; index: number; length: number; offset: number }[] = [];
  let cursor = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const length = (segment.value / total) * c;
    arcs.push({ segment, index, length, offset: cursor });
    cursor += length;
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
          {arcs.map(({ segment, index, length, offset }) => {
            const visible = Math.max(0, length - 2);
            return (
              <circle
                key={segment.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={segment.color ?? palette[index % palette.length]}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${visible} ${c - visible}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <p className="text-xl font-semibold tabular-nums">{centerValue}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted">{centerLabel}</p>
        </div>
      </div>
      <div className="min-w-[9rem] flex-1 space-y-2">
        {segments.map((s, i) => (
          <div key={s.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ background: s.color ?? palette[i % palette.length] }}
              />
              <span className="text-muted">{s.label}</span>
            </span>
            <span className="font-semibold tabular-nums">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
