"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Ops charts. Same conventions as `@/components/price-history-chart`: colours
 * come from the design tokens (which the ops layout re-points at the teal
 * accent), grid is horizontal-only and barely there, and ticks are tabular.
 */

const tickStyle = {
  fontSize: 11,
  fill: "var(--muted-foreground)",
  fontVariantNumeric: "tabular-nums",
} as const;

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--foreground)",
  boxShadow: "var(--shadow-float)",
} as const;

const labelStyle = { color: "var(--muted-foreground)", marginBottom: 4 } as const;

const legendStyle = { fontSize: 11, color: "var(--muted-foreground)" } as const;

const fmtMoney = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtMoneyTick = (v: number) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0,
  });

const fmtDayLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export type TradesDay = {
  day: string; // yyyy-mm-dd
  counted: number;
  excluded: number;
};

/**
 * Trades per day, split into what the tape counted and what it threw away.
 * Stacked, so the column height is trades ingested and the darker part is the
 * share that actually priced anything.
 */
export function TradesTrendChart({ data }: { data: TradesDay[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center px-4 text-center text-xs text-muted-foreground md:h-64">
        <p className="max-w-xs">No trades have reached the tape yet.</p>
      </div>
    );
  }
  const tickGap = Math.max(1, Math.ceil(data.length / 6));
  return (
    <div className="h-56 w-full md:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.2} vertical={false} />
          <XAxis
            dataKey="day"
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
            axisLine={false}
            tickLine={false}
            width={44}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={labelStyle}
            labelFormatter={(label) => (typeof label === "string" ? fmtDayLabel(label) : label)}
            cursor={{ fill: "var(--muted)", opacity: 0.45 }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            height={20}
            iconSize={8}
            wrapperStyle={legendStyle}
          />
          <Bar dataKey="counted" name="Counted" stackId="t" fill="var(--primary)" radius={[0, 0, 0, 0]} />
          <Bar dataKey="excluded" name="Excluded" stackId="t" fill="var(--warning)" fillOpacity={0.55} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export type ObservationPoint = {
  day: string; // yyyy-mm-dd
  vwap: number | null;
  median: number | null;
  reference: number | null;
  trades: number;
};

/**
 * One sku identity's day-by-day tape history: price on the left axis, the
 * day's trade count as columns on the right, so a price move on two trades
 * reads differently from the same move on thirty.
 */
export function ObservationHistoryChart({ data }: { data: ObservationPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center px-4 text-center text-xs text-muted-foreground md:h-64">
        <p className="max-w-xs">
          No daily observations for this identity in the last 90 days.
        </p>
      </div>
    );
  }
  const hasReference = data.some((d) => d.reference != null);
  const tickGap = Math.max(1, Math.ceil(data.length / 6));
  return (
    <div className="h-64 w-full md:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.2} vertical={false} />
          <XAxis
            dataKey="day"
            tick={tickStyle}
            tickFormatter={(d: string) => d.slice(5)}
            interval={tickGap - 1}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            tickMargin={8}
            minTickGap={16}
          />
          <YAxis
            yAxisId="price"
            tick={tickStyle}
            tickFormatter={fmtMoneyTick}
            axisLine={false}
            tickLine={false}
            width={56}
            domain={["auto", "auto"]}
          />
          <YAxis
            yAxisId="trades"
            orientation="right"
            tick={tickStyle}
            axisLine={false}
            tickLine={false}
            width={36}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={labelStyle}
            labelFormatter={(label) => (typeof label === "string" ? fmtDayLabel(label) : label)}
            formatter={(value, name) => {
              if (typeof value !== "number") return [String(value), String(name)];
              return [name === "Trades" ? value.toLocaleString("en-US") : fmtMoney(value), String(name)];
            }}
            cursor={{ stroke: "var(--border-strong)" }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            height={20}
            iconSize={8}
            wrapperStyle={legendStyle}
          />
          <Bar
            yAxisId="trades"
            dataKey="trades"
            name="Trades"
            fill="var(--muted-foreground)"
            fillOpacity={0.18}
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="vwap"
            name="Street VWAP"
            stroke="var(--primary)"
            strokeWidth={1.75}
            dot={false}
            activeDot={{ r: 3, stroke: "var(--card)", strokeWidth: 1 }}
            connectNulls
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="median"
            name="Median"
            stroke="var(--warning)"
            strokeWidth={1.25}
            strokeDasharray="3 3"
            dot={false}
            connectNulls
          />
          {hasReference ? (
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="reference"
              name="Reference"
              stroke="var(--muted-foreground)"
              strokeWidth={1.25}
              dot={false}
              connectNulls
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export type PriceBucket = {
  label: string;
  verified: number;
  unverified: number;
};

/**
 * Where the rejected prices sat. Split by attestation, because the whole
 * argument for the payment-ref gate is that rejections cluster in the
 * self-reported column.
 */
export function RejectedPriceChart({ data }: { data: PriceBucket[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center px-4 text-center text-xs text-muted-foreground md:h-64">
        <p className="max-w-xs">Nothing was rejected in this window.</p>
      </div>
    );
  }
  return (
    <div className="h-56 w-full md:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.2} vertical={false} />
          <XAxis
            dataKey="label"
            tick={tickStyle}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            tickMargin={8}
            interval={0}
          />
          <YAxis
            tick={tickStyle}
            axisLine={false}
            tickLine={false}
            width={40}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={labelStyle}
            cursor={{ fill: "var(--muted)", opacity: 0.45 }}
          />
          <Legend
            verticalAlign="top"
            align="right"
            height={20}
            iconSize={8}
            wrapperStyle={legendStyle}
          />
          <Bar
            dataKey="unverified"
            name="Self-reported"
            stackId="p"
            fill="var(--warning)"
            fillOpacity={0.65}
          />
          <Bar dataKey="verified" name="Card-verified" stackId="p" fill="var(--primary)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
