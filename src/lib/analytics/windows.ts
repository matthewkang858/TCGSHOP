/**
 * Pure window math for the dashboard analytics. The SQL produces one row per
 * day; everything derived from those rows (7-day totals, deltas, margin) lives
 * here so it can be tested without a database.
 */

export type DayPoint = {
  /** yyyy-mm-dd */
  date: string;
  /** sale revenue for the day, in dollars */
  revenue: number;
  units: number;
  sales: number;
  /** gross profit over sales whose inventory line has a cost basis */
  profit: number;
  /** revenue of those same costed sales - the honest margin denominator */
  costedRevenue: number;
  /** sales we could not cost because the line has no cost basis */
  uncostedSales: number;
};

export type WindowTotals = {
  revenue: number;
  units: number;
  sales: number;
  profit: number;
  costedRevenue: number;
  uncostedSales: number;
  /** profit / costedRevenue, as a percentage; null when nothing was costed */
  marginPct: number | null;
};

const round2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;

export function sumWindow(days: DayPoint[]): WindowTotals {
  const t = { revenue: 0, units: 0, sales: 0, profit: 0, costedRevenue: 0, uncostedSales: 0 };
  for (const d of days) {
    t.revenue += d.revenue;
    t.units += d.units;
    t.sales += d.sales;
    t.profit += d.profit;
    t.costedRevenue += d.costedRevenue;
    t.uncostedSales += d.uncostedSales;
  }
  return {
    revenue: round2(t.revenue),
    units: t.units,
    sales: t.sales,
    profit: round2(t.profit),
    costedRevenue: round2(t.costedRevenue),
    uncostedSales: t.uncostedSales,
    marginPct: t.costedRevenue > 0 ? round2((t.profit / t.costedRevenue) * 100) : null,
  };
}

/**
 * Percentage change from `prior` to `current`. Null when there is no prior to
 * compare against - "+∞%" is not a number a shop owner can act on.
 */
export function pctDelta(current: number, prior: number): number | null {
  if (!(prior > 0)) return null;
  return round2(((current - prior) / prior) * 100);
}

/** Split a 14-day series into the trailing week and the week before it. */
export function splitWeeks(days: DayPoint[]): { last7: DayPoint[]; prior7: DayPoint[] } {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const last7 = sorted.slice(-7);
  const prior7 = sorted.slice(-14, -7);
  return { last7, prior7 };
}
