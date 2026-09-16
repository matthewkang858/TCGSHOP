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

export function InventoryValueChart({ data }: { data: ValuePoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Value history appears once price sweeps build up snapshots.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="gSingles" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(240 55% 45%)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="hsl(240 55% 45%)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gSealed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(38 90% 45%)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="hsl(38 90% 45%)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12 }}
          tickFormatter={(d: string) => d.slice(5)}
          stroke="var(--muted-foreground)"
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
          stroke="var(--muted-foreground)"
          width={56}
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
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="singles"
          name="Singles"
          stackId="v"
          stroke="hsl(240 55% 45%)"
          fill="url(#gSingles)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="sealed"
          name="Sealed"
          stackId="v"
          stroke="hsl(38 90% 45%)"
          fill="url(#gSealed)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
