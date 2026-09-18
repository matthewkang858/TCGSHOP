"use client";

import { ChartLine } from "lucide-react";
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

// axis ticks: whole dollars once values leave pocket-change territory
const fmtTick = (v: number) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0,
  });

const fmtLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export function PriceHistoryChart({ data }: { data: PricePoint[] }) {
  const hasBuylist = data.some((p) => p.buylist != null);
  if (data.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-center">
        <ChartLine className="h-7 w-7 text-muted-foreground/60" />
        <p className="text-sm font-medium">No price history yet</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Snapshots appear here after the first price sweep runs.
        </p>
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          tickFormatter={(d: string) => d.slice(5)}
          stroke="var(--border)"
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          tickFormatter={fmtTick}
          stroke="var(--border)"
          tickLine={false}
          width={64}
          domain={["auto", "auto"]}
        />
        <Tooltip
          formatter={(value) => (typeof value === "number" ? fmtMoney(value) : String(value))}
          labelFormatter={(label) => (typeof label === "string" ? fmtLabel(label) : label)}
          contentStyle={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--foreground)",
            boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)",
          }}
          labelStyle={{ color: "var(--muted-foreground)", marginBottom: 4 }}
          cursor={{ stroke: "var(--border)" }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
        <Line
          type="monotone"
          dataKey="market"
          name="TCG Market"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, stroke: "var(--card)", strokeWidth: 1 }}
          connectNulls
        />
        {hasBuylist ? (
          <Line
            type="monotone"
            dataKey="buylist"
            name="CK Buylist"
            stroke="var(--success)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, stroke: "var(--card)", strokeWidth: 1 }}
            connectNulls
          />
        ) : null}
      </LineChart>
    </ResponsiveContainer>
  );
}
