import { sql } from "drizzle-orm";
import { db } from "@/db";
import { pctDelta, splitWeeks, sumWindow, type DayPoint, type WindowTotals } from "./windows";

/** two weeks of days: the trailing week for the charts' story, the prior for the delta */
const SERIES_DAYS = 14;

export type DashboardAnalytics = {
  days: DayPoint[];
  last7: WindowTotals;
  prior7: WindowTotals;
  revenueDeltaPct: number | null;
};

/**
 * Daily sales and gross profit for one store, store-scoped at the query.
 *
 * Profit uses the cost recorded on the sale itself (`unit_cost`, snapshotted
 * from the inventory line at the moment of sale), so a later restock or cost
 * edit cannot rewrite history. Rows recorded before that column existed fall
 * back to the line's current cost basis, which is the best information there
 * is for them.
 *
 * A sale with no cost either way is counted in revenue and units but
 * contributes nothing to profit and is reported as "uncosted" rather than
 * treated as pure margin - overstating profit is worse than a gap the owner
 * can see and fix by recording what they paid.
 */
export async function loadDashboardAnalytics(storeId: string): Promise<DashboardAnalytics> {
  const rows = await db
    .execute<{
      d: string;
      revenue: string;
      units: number;
      sales: number;
      profit: string;
      costed_revenue: string;
      uncosted_sales: number;
    }>(sql`
      with days as (
        select generate_series(
          (now() - interval '${sql.raw(String(SERIES_DAYS - 1))} days')::date,
          now()::date,
          interval '1 day'
        )::date d
      ),
      sales as (
        select t.occurred_at::date d, t.quantity, t.unit_price,
               coalesce(t.unit_cost, i.cost_basis) as cost
        from transactions t
        left join inventory_items i
          on i.store_id = t.store_id
         and i.product_id = t.product_id
         and i.condition = t.condition
         and i.printing is not distinct from t.printing
         and i.language = t.language
        where t.store_id = ${storeId}
          and t.side = 'sale'
          and t.occurred_at >= (now() - interval '${sql.raw(String(SERIES_DAYS - 1))} days')::date
      )
      select days.d::text as d,
             coalesce(sum(s.quantity * s.unit_price), 0) as revenue,
             coalesce(sum(s.quantity), 0)::int as units,
             count(s.quantity)::int as sales,
             coalesce(sum((s.unit_price - s.cost) * s.quantity)
               filter (where s.cost is not null), 0) as profit,
             coalesce(sum(s.quantity * s.unit_price)
               filter (where s.cost is not null), 0) as costed_revenue,
             count(s.quantity) filter (where s.cost is null)::int as uncosted_sales
      from days
      left join sales s on s.d = days.d
      group by days.d
      order by days.d
    `)
    .then((r) => r.rows);

  const days: DayPoint[] = rows.map((r) => ({
    date: r.d,
    revenue: Number(r.revenue),
    units: r.units,
    sales: r.sales,
    profit: Number(r.profit),
    costedRevenue: Number(r.costed_revenue),
    uncostedSales: r.uncosted_sales,
  }));

  const { last7, prior7 } = splitWeeks(days);
  const last = sumWindow(last7);
  const prior = sumWindow(prior7);

  return {
    days,
    last7: last,
    prior7: prior,
    revenueDeltaPct: pctDelta(last.revenue, prior.revenue),
  };
}
