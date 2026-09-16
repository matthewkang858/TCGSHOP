"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type PricePoint = {
  date: string; // yyyy-mm-dd
  market?: number | null;
  buylist?: number | null;
};

const fmtMoney = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function PriceHistoryChart({ data }: { data: PricePoint[] }) {
  const hasBuylist = data.some((p) => p.buylist != null);
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No price history yet — snapshots appear after the first price sweep.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12 }}
          tickFormatter={(d: string) => d.slice(5)}
          stroke="var(--muted-foreground)"
        />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={(v: number) => `$${v}`}
          stroke="var(--muted-foreground)"
          width={64}
          domain={["auto", "auto"]}
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
        <Line
          type="monotone"
          dataKey="market"
          name="TCG Market"
          stroke="hsl(240 55% 45%)"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        {hasBuylist ? (
          <Line
            type="monotone"
            dataKey="buylist"
            name="CK Buylist"
            stroke="hsl(150 60% 38%)"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ) : null}
      </LineChart>
    </ResponsiveContainer>
  );
}
