"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type DailyBarPoint = {
  /** yyyy-mm-dd */
  date: string;
  value: number;
  /** extra lines for the tooltip, already formatted */
  detail?: string[];
};

const fmtMoney = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// "$850" below $1k, "$1.2k" above - matches the inventory value chart.
const fmtTick = (v: number) =>
  Math.abs(v) >= 1000
    ? `${v < 0 ? "-" : ""}$${(Math.abs(v) / 1000).toFixed(1).replace(/\.0$/, "")}k`
    : `${v < 0 ? "-" : ""}$${Math.round(Math.abs(v))}`;

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

const tick = { fontSize: 11, fill: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" } as const;

/**
 * One series of daily dollar values. Single series, so no legend - the card
 * title says what it is. Negative days (sold below cost) hang below the
 * baseline in the destructive color so a bad day reads as one at a glance.
 */
export function DailyBarChart({
  data,
  emptyMessage,
}: {
  data: DailyBarPoint[];
  emptyMessage: string;
}) {
  const hasAny = data.some((d) => d.value !== 0);
  if (!hasAny) {
    return (
      <div className="flex h-48 items-center justify-center px-4 text-center text-sm text-muted-foreground md:h-56">
        <p className="max-w-xs">{emptyMessage}</p>
      </div>
    );
  }
  const hasNegative = data.some((d) => d.value < 0);

  return (
    <div className="h-48 min-w-0 md:h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.2} />
          <XAxis
            dataKey="date"
            tick={tick}
            tickFormatter={(d: string) => d.slice(5)}
            tickLine={false}
            axisLine={false}
            minTickGap={20}
          />
          <YAxis tick={tick} tickFormatter={fmtTick} tickLine={false} axisLine={false} width={44} />
          {hasNegative ? <ReferenceLine y={0} stroke="var(--border-strong)" /> : null}
          <Tooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as DailyBarPoint;
              return (
                <div
                  className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-[var(--shadow-float)]"
                  style={{ color: "var(--foreground)" }}
                >
                  <p className="mb-1 text-muted-foreground">{fmtDay(p.date)}</p>
                  <p className="font-medium tabular-nums">{fmtMoney(p.value)}</p>
                  {p.detail?.map((line) => (
                    <p key={line} className="text-muted-foreground tabular-nums">
                      {line}
                    </p>
                  ))}
                </div>
              );
            }}
          />
          {/* 4px rounded data-end, square at the baseline; capped thickness so the slot keeps some air. */}
          <Bar dataKey="value" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.date} fill={d.value < 0 ? "var(--destructive)" : "var(--primary)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
