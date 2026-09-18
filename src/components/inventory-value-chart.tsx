"use client";

import { TrendingUp } from "lucide-react";
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

export function InventoryValueChart({ data }: { data: ValuePoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <TrendingUp className="h-8 w-8" />
        <p className="max-w-xs">
          No history yet. Your inventory&apos;s value starts charting here after a day or two of
          price updates.
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gSingles" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gSealed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--warning)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--warning)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            tickFormatter={(d: string) => d.slice(5)}
            stroke="var(--border)"
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            tickFormatter={fmtTick}
            stroke="var(--border)"
            width={44}
          />
          <Tooltip
            formatter={(value) => (typeof value === "number" ? fmtMoney(value) : String(value))}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconSize={10}
            wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
          />
          <Area
            type="monotone"
            dataKey="singles"
            name="Singles"
            stackId="v"
            stroke="var(--primary)"
            fill="url(#gSingles)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="sealed"
            name="Sealed"
            stackId="v"
            stroke="var(--warning)"
            fill="url(#gSealed)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
