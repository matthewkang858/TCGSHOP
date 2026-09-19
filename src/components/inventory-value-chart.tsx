"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ValuePoint = {
  date: string;
  singles: number;
  sealed: number;
};

const fmtMoney = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Adaptive ticks: "$850" below $1k, "$1.2k" above, so small stores don't see "$0k".
const fmtTick = (v: number) =>
  Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1).replace(/\.0$/, "")}k` : `$${Math.round(v)}`;

const tick = { fontSize: 11, fill: "var(--muted-foreground)" };

export function InventoryValueChart({ data }: { data: ValuePoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center px-4 text-center text-sm text-muted-foreground md:h-64">
        <p className="max-w-xs">
          No history yet. Your inventory&apos;s value starts charting here after a day or two of
          price updates.
        </p>
      </div>
    );
  }
  return (
    <div className="h-56 min-w-0 md:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gSingles" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.08} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gSealed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--warning)" stopOpacity={0.08} />
              <stop offset="100%" stopColor="var(--warning)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* Horizontal rules only, barely there - the chart is context, not the headline. */}
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.2} />
          <XAxis
            dataKey="date"
            tick={tick}
            tickFormatter={(d: string) => d.slice(5)}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            tick={tick}
            tickFormatter={fmtTick}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            formatter={(value) => (typeof value === "number" ? fmtMoney(value) : String(value))}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconSize={8}
            // Recharts colors legend text with the series color; the swatch
            // already carries identity, so text stays in the text token.
            formatter={(value) => <span style={{ color: "var(--muted-foreground)" }}>{value}</span>}
            wrapperStyle={{
              fontSize: 12,
              paddingBottom: 8,
            }}
          />
          <Area
            type="monotone"
            dataKey="singles"
            name="Singles"
            stackId="v"
            stroke="var(--primary)"
            fill="url(#gSingles)"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
          />
          <Area
            type="monotone"
            dataKey="sealed"
            name="Sealed"
            stackId="v"
            stroke="var(--warning)"
            fill="url(#gSealed)"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
