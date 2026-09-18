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
import { EmptyState } from "@/components/page-header";

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

const tickStyle = {
  fontSize: 11,
  fill: "var(--muted-foreground)",
  fontVariantNumeric: "tabular-nums",
} as const;

export function PriceHistoryChart({ data }: { data: PricePoint[] }) {
  const hasBuylist = data.some((p) => p.buylist != null);
  if (data.length === 0) {
    return (
      <EmptyState
        icon={<ChartLine />}
        title="No price history yet"
        description="Snapshots appear here after the first price sweep runs."
      />
    );
  }
  // Thin the date ticks so labels never collide or rotate at phone width.
  const tickGap = Math.max(1, Math.ceil(data.length / 6));
  return (
    <div className="h-56 w-full md:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid
            stroke="var(--border)"
            strokeOpacity={0.2}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={tickStyle}
            tickFormatter={(d: string) => d.slice(5)}
            interval={tickGap - 1}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            tickMargin={8}
            minTickGap={16}
          />
          <YAxis
            tick={tickStyle}
            tickFormatter={fmtTick}
            axisLine={false}
            tickLine={false}
            width={56}
            domain={["auto", "auto"]}
          />
          <Tooltip
            formatter={(value) =>
              typeof value === "number" ? fmtMoney(value) : String(value)
            }
            labelFormatter={(label) => (typeof label === "string" ? fmtLabel(label) : label)}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--foreground)",
              boxShadow: "var(--shadow-float)",
            }}
            labelStyle={{ color: "var(--muted-foreground)", marginBottom: 4 }}
            cursor={{ stroke: "var(--border-strong)" }}
          />
          {/* One series needs no legend - the card title already says what it is. */}
          {hasBuylist ? (
            <Legend
              verticalAlign="top"
              align="right"
              height={20}
              iconType="plainline"
              iconSize={10}
              wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="market"
            name="TCG market"
            stroke="var(--primary)"
            strokeWidth={1.75}
            dot={false}
            activeDot={{ r: 3, stroke: "var(--card)", strokeWidth: 1 }}
            connectNulls
          />
          {hasBuylist ? (
            <Line
              type="monotone"
              dataKey="buylist"
              name="CK buylist"
              stroke="var(--success)"
              strokeWidth={1.75}
              dot={false}
              activeDot={{ r: 3, stroke: "var(--card)", strokeWidth: 1 }}
              connectNulls
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
