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
    if (margin !== null) detail.push(`${formatPct(margin).replace("+", "")} margin on costed sales`);
    if (d.uncostedSales > 0) {
      detail.push(`${d.uncostedSales} of ${d.sales} ${d.sales === 1 ? "sale" : "sales"} uncosted`);
    }
    return { date: d.date, value: d.profit, detail };
  });

  const { last7 } = a;
  const costedSales = last7.sales - last7.uncostedSales;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Sales by day" meta="last 14 days" bodyClassName="p-4">
          <Summary
            value={whole(last7.revenue)}
            parts={[
              "last 7 days",
              a.revenueDeltaPct !== null ? `${formatPct(a.revenueDeltaPct)} vs the week before` : null,
            ]}
          />
          <DailyBarChart
            data={revenueSeries}
            emptyMessage="No sales in the last two weeks. Record a sale and it charts here."
          />
        </SectionCard>

        <SectionCard title="Profit by day" meta="last 14 days" bodyClassName="p-4">
          {/*
            No week-over-week delta here on purpose: profit only covers sales
            with a cost on file, and two weeks rarely have the same coverage,
            so the comparison would be between different slices of the store.
          */}
          <Summary
            value={whole(last7.profit)}
            parts={[
              "last 7 days",
              last7.marginPct !== null ? `${last7.marginPct.toFixed(0)}% margin on costed sales` : null,
            ]}
          />
          <DailyBarChart
            data={profitSeries}
            emptyMessage="Profit charts once sales come from lines with a cost recorded."
          />
          {last7.uncostedSales > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {last7.uncostedSales} of {last7.sales} sales this week had no cost on file, so they
              count toward revenue but not profit
              {costedSales === 0 ? " - nothing above is costed yet" : ""}.{" "}
              <Link
                href="/inventory?cost=missing"
                className="font-medium text-primary hover:underline"
              >
                Lines missing a cost →
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

// Whole dollars: a headline, not a ledger.
const whole = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * The card's headline number and its qualifiers, in the body rather than the
 * 48px header so they can wrap on a phone instead of truncating the one part
 * (the margin, the caveat) the owner most needs to read.
 */
function Summary({ value, parts }: { value: string; parts: (string | null)[] }) {
  return (
    <p className="mb-3 text-sm leading-snug">
      <span className="text-xl font-semibold tracking-[-0.02em] text-foreground">{value}</span>{" "}
      <span className="text-muted-foreground">{parts.filter(Boolean).join(" · ")}</span>
    </p>
  );
}
