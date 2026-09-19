import Link from "next/link";
import { loadDashboardAnalytics } from "@/lib/analytics/dashboard";
import { DailyBarChart, type DailyBarPoint } from "@/components/daily-bar-chart";
import { InventoryValueChart, type ValuePoint } from "@/components/inventory-value-chart";
import { formatPct } from "@/lib/utils";
import { SectionCard } from "./ui";

/**
 * The analytics block: two weeks of sales and gross profit by day, plus the
 * 30-day inventory value chart. Self-contained so it can be switched off per
 * store (Settings → "Show analytics charts") or removed outright by deleting
 * this file and its one call site.
 */
export async function DashboardAnalytics({
  storeId,
  valueSeries,
}: {
  storeId: string;
  valueSeries: ValuePoint[];
}) {
  const a = await loadDashboardAnalytics(storeId);

  const revenueSeries: DailyBarPoint[] = a.days.map((d) => ({
    date: d.date,
    value: d.revenue,
    detail: [`${d.units} ${d.units === 1 ? "unit" : "units"} · ${d.sales} ${d.sales === 1 ? "sale" : "sales"}`],
  }));

  const profitSeries: DailyBarPoint[] = a.days.map((d) => {
    const margin = d.costedRevenue > 0 ? (d.profit / d.costedRevenue) * 100 : null;
    const detail: string[] = [];
    if (margin !== null) detail.push(`${formatPct(margin).replace("+", "")} margin`);
    if (d.uncostedSales > 0) detail.push(`${d.uncostedSales} uncosted ${d.uncostedSales === 1 ? "sale" : "sales"} excluded`);
    return { date: d.date, value: d.profit, detail };
  });

  // Whole dollars: this is a card subtitle, not a ledger, and it has to fit
  // beside the title on a phone.
  const whole = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const withDelta = (total: number, delta: number | null) =>
    delta === null
      ? `${whole(total)} last 7d`
      : `${whole(total)} last 7d · ${formatPct(delta)} vs prior`;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Sales by day"
          meta={withDelta(a.last7.revenue, a.revenueDeltaPct)}
          bodyClassName="p-4"
        >
          <DailyBarChart
            data={revenueSeries}
            emptyMessage="No sales in the last two weeks. Record a sale and it charts here."
          />
        </SectionCard>

        <SectionCard
          title="Profit by day"
          meta={
            a.last7.marginPct === null
              ? withDelta(a.last7.profit, a.profitDeltaPct)
              : `${withDelta(a.last7.profit, a.profitDeltaPct)} · ${a.last7.marginPct.toFixed(0)}% margin`
          }
          bodyClassName="p-4"
        >
          <DailyBarChart
            data={profitSeries}
            emptyMessage="Profit charts once sales come from lines with a cost recorded."
          />
          {a.uncostedLines > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {a.uncostedLines} {a.uncostedLines === 1 ? "line has" : "lines have"} no cost
              recorded, so their sales count toward revenue but not profit.{" "}
              <Link href="/inventory" className="font-medium text-primary hover:underline">
                Add costs
              </Link>
            </p>
          ) : null}
        </SectionCard>
      </div>

      <SectionCard title="Inventory value" meta="last 30 days" bodyClassName="p-4">
        <InventoryValueChart data={valueSeries} />
      </SectionCard>
    </>
  );
}
