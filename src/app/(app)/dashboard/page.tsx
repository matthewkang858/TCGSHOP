import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Boxes,
  Check,
  PackageX,
  Tags,
  TicketPercent,
  TrendingUp,
  Upload,
} from "lucide-react";
import { db } from "@/db";
import { alertEvents, alerts, expansions, products, repriceRuns } from "@/db/schema";
import { requireStore } from "@/lib/tenancy";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InventoryValueChart, type ValuePoint } from "@/components/inventory-value-chart";
import { cn, formatDateTime, formatMoney, formatPct } from "@/lib/utils";
import { markNotCarriedAction, markStickerUpdatedAction } from "./actions";

export default async function DashboardPage() {
  const ctx = await requireStore();
  const storeId = ctx.storeId;

  // headline stats
  const [stats] = await db.execute<{
    lines: number;
    total_value: string | null;
    sealed_value: string | null;
    singles_value: string | null;
  }>(sql`
    select count(*)::int lines,
           sum(coalesce(i.current_price,0) * i.quantity) total_value,
           sum(coalesce(i.current_price,0) * i.quantity)
             filter (where coalesce(p.product_type_override, p.product_type) = 'sealed') sealed_value,
           sum(coalesce(i.current_price,0) * i.quantity)
             filter (where coalesce(p.product_type_override, p.product_type) = 'single') singles_value
    from inventory_items i
    join products p on p.product_id = i.product_id
    where i.store_id = ${storeId}
  `).then((r) => r.rows);

  const hasInventory = (stats?.lines ?? 0) > 0;

  // inventory value over time (30 days), split singles vs sealed, priced off
  // local snapshots at each day's close with current quantities
  const valueRows = hasInventory
    ? await db.execute<{ d: string; ptype: string; value: string }>(sql`
        with inv as (
          select i.product_id, sum(i.quantity) qty,
                 coalesce(p.product_type_override, p.product_type) ptype
          from inventory_items i
          join products p on p.product_id = i.product_id
          where i.store_id = ${storeId}
          group by 1, 3
        ),
        days as (
          select generate_series(
            (now() - interval '29 days')::date, now()::date, interval '1 day'
          )::date d
        )
        select days.d::text, inv.ptype, sum(inv.qty * ps.price) value
        from days
        cross join inv
        join lateral (
          select price from price_snapshots s
          where s.product_id = inv.product_id
            and s.provider = 'tcgplayer' and s.listing = 'retail'
            and s.captured_at < days.d + 1
          order by s.captured_at desc
          limit 1
        ) ps on true
        group by 1, 2
        order by 1
      `).then((r) => r.rows)
    : [];

  const valueByDay = new Map<string, ValuePoint>();
  for (const row of valueRows) {
    const point = valueByDay.get(row.d) ?? { date: row.d, singles: 0, sealed: 0 };
    if (row.ptype === "sealed") point.sealed = Math.round(Number(row.value));
    else point.singles += Math.round(Number(row.value));
    valueByDay.set(row.d, point);
  }
  const valueSeries = [...valueByDay.values()].sort((a, b) => a.date.localeCompare(b.date));

  // top movers over 7d among stocked products
  const movers = hasInventory
    ? await db.execute<{
        product_id: number;
        name: string;
        set_name: string;
        ptype: string;
        now_price: string;
        then_price: string;
        pct: string;
      }>(sql`
        with stocked as (
          select distinct i.product_id from inventory_items i where i.store_id = ${storeId}
        ),
        latest as (
          select distinct on (product_id) product_id, price
          from price_snapshots
          where provider='tcgplayer' and listing='retail'
            and product_id in (select product_id from stocked)
          order by product_id, captured_at desc
        ),
        baseline as (
          select distinct on (product_id) product_id, price
          from price_snapshots
          where provider='tcgplayer' and listing='retail'
            and captured_at <= now() - interval '7 days'
            and product_id in (select product_id from stocked)
          order by product_id, captured_at desc
        )
        select p.product_id, p.name, e.name set_name,
               coalesce(p.product_type_override, p.product_type) ptype,
               l.price now_price, b.price then_price,
               round((l.price - b.price) / nullif(b.price,0) * 100, 1) pct
        from latest l
        join baseline b on b.product_id = l.product_id
        join products p on p.product_id = l.product_id
        join expansions e on e.group_id = p.group_id
        where b.price > 0
        order by abs((l.price - b.price) / nullif(b.price,0)) desc
        limit 8
      `).then((r) => r.rows)
    : [];

  const recentEvents = await db
    .select({
      id: alertEvents.id,
      firedAt: alertEvents.firedAt,
      alertName: alerts.name,
      productId: products.productId,
      productName: products.name,
      payload: alertEvents.payload,
    })
    .from(alertEvents)
    .innerJoin(alerts, eq(alerts.id, alertEvents.alertId))
    .innerJoin(products, eq(products.productId, alertEvents.productId))
    .where(eq(alerts.storeId, storeId))
    .orderBy(desc(alertEvents.firedAt))
    .limit(5);

  const [lastRun] = await db
    .select()
    .from(repriceRuns)
    .where(eq(repriceRuns.storeId, storeId))
    .orderBy(desc(repriceRuns.createdAt))
    .limit(1);

  // Sticker queue: lines whose shelf sticker no longer matches the system
  // price. `suggested` mirrors suggestedStickerPrice in src/lib/sticker.ts:
  // >=$20 nearest $5, $5-20 nearest $1, <$5 exact cents.
  const stickerQueue = hasInventory
    ? await db.execute<{
        id: string;
        product_id: number;
        name: string;
        image_url: string | null;
        condition: string;
        quantity: number;
        current_price: string;
        sticker_price: string | null;
        suggested: string;
        total: string;
      }>(sql`
        with candidates as (
          select i.id, i.condition, i.quantity, i.current_price, i.sticker_price,
                 p.product_id, p.name, p.image_url,
                 case
                   when i.current_price >= 20 then round(i.current_price / 5) * 5
                   when i.current_price >= 5 then round(i.current_price)
                   else i.current_price
                 end as suggested
          from inventory_items i
          join products p on p.product_id = i.product_id
          where i.store_id = ${storeId} and i.quantity > 0 and i.current_price is not null
        ),
        due as (
          select * from candidates
          where sticker_price is null or sticker_price <> suggested
        )
        select *, count(*) over () as total
        from due
        order by (sticker_price is not null) desc,
                 abs(suggested - coalesce(sticker_price, suggested)) desc
        limit 12
      `).then((r) => r.rows)
    : [];
  const stickerTotal = stickerQueue.length > 0 ? Number(stickerQueue[0].total) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description={`${ctx.storeName} at a glance.`} />

      {!hasInventory ? (
        <EmptyState
          icon={<Boxes className="h-8 w-8" />}
          title="Welcome to Countertop"
          description="Import your inventory to start tracking value, repricing against live market data, and getting alerts when products move."
          action={
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/inventory/import">
                  <Upload />
                  Import inventory
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/products">Browse catalog</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Inventory value"
              value={formatMoney(stats.total_value)}
              sub={`${stats.lines.toLocaleString()} lines`}
            />
            <StatCard
              label="Singles"
              value={formatMoney(stats.singles_value)}
              sub="at current prices"
            />
            <StatCard
              label="Sealed"
              value={formatMoney(stats.sealed_value)}
              sub="at current prices"
            />
            <StatCard
              label="Last reprice"
              value={
                lastRun
                  ? lastRun.status === "applied"
                    ? `${lastRun.appliedCount} applied`
                    : lastRun.status
                  : "never"
              }
              sub={lastRun ? formatDateTime(lastRun.createdAt) : "run one from Repricing"}
              href={lastRun ? `/repricing/runs/${lastRun.id}` : "/repricing"}
            />
          </div>

          <Card className={stickerTotal > 0 ? "border-warning/50" : undefined}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2">
                <TicketPercent className="h-4 w-4" />
                Sticker queue
                {stickerTotal > 0 ? (
                  <Badge variant="warning">{stickerTotal} to re-label</Badge>
                ) : (
                  <Badge variant="success">all current</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stickerQueue.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  Every shelf sticker matches the current price. When a reprice run (or a
                  price edit) moves an item past its sticker, it shows up here as a to-do.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {stickerQueue.map((s) => {
                    const suggested = Number(s.suggested);
                    const old = s.sticker_price !== null ? Number(s.sticker_price) : null;
                    const delta = old !== null ? suggested - old : null;
                    return (
                      <div
                        key={s.id}
                        className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/products/${s.product_id}`}
                            className="block truncate text-sm font-medium text-primary hover:underline"
                          >
                            {s.name}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {s.condition} · {s.quantity} in stock
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <div className="text-right">
                            <div className="text-sm font-semibold tabular-nums">
                              {old !== null ? (
                                <>
                                  <span className="font-normal text-muted-foreground line-through">
                                    {formatMoney(old)}
                                  </span>{" "}
                                  → {formatMoney(suggested)}
                                </>
                              ) : (
                                <>{formatMoney(suggested)}</>
                              )}
                            </div>
                            <div
                              className={cn(
                                "text-xs tabular-nums",
                                delta === null
                                  ? "text-muted-foreground"
                                  : delta >= 0
                                    ? "text-success"
                                    : "text-destructive"
                              )}
                            >
                              {delta === null
                                ? "needs first sticker"
                                : `${delta >= 0 ? "+" : "−"}${formatMoney(Math.abs(delta)).replace("$", "$")}`}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <form action={markStickerUpdatedAction}>
                              <input type="hidden" name="itemId" value={s.id} />
                              <Button type="submit" size="sm" variant="outline" className="w-full">
                                <Check />
                                Updated
                              </Button>
                            </form>
                            <form action={markNotCarriedAction}>
                              <input type="hidden" name="itemId" value={s.id} />
                              <Button
                                type="submit"
                                size="sm"
                                variant="ghost"
                                className="w-full text-xs text-muted-foreground"
                                title="Shelf spot is empty - remove from the working checklist (sets quantity to 0; restock brings it back)"
                              >
                                <PackageX />
                                Don&apos;t carry
                              </Button>
                            </form>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {stickerTotal > stickerQueue.length ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing the {stickerQueue.length} biggest moves of {stickerTotal} total.
                  Mark these updated and the next batch appears.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inventory value · 30 days · singles vs sealed</CardTitle>
            </CardHeader>
            <CardContent>
              <InventoryValueChart data={valueSeries} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Top movers (7d, your stock)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {movers.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Movers appear once snapshots span a week. Keep the worker running.
                  </p>
                ) : (
                  movers.map((m) => {
                    const pct = Number(m.pct);
                    return (
                      <div
                        key={m.product_id}
                        className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/products/${m.product_id}`}
                            className="block truncate text-sm font-medium text-primary hover:underline"
                          >
                            {m.name}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {m.set_name}
                            {m.ptype === "sealed" ? " · sealed" : ""}
                          </span>
                        </div>
                        <div className="shrink-0 text-right">
                          <div
                            className={cn(
                              "flex items-center justify-end gap-1 text-sm font-semibold tabular-nums",
                              pct >= 0 ? "text-success" : "text-destructive"
                            )}
                          >
                            {pct >= 0 ? (
                              <ArrowUpRight className="h-4 w-4" />
                            ) : (
                              <ArrowDownRight className="h-4 w-4" />
                            )}
                            {formatPct(pct)}
                          </div>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {formatMoney(m.then_price)} → {formatMoney(m.now_price)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-4 w-4" />
                  Recent alerts
                </CardTitle>
                <Link href="/alerts" className="text-sm text-primary hover:underline">
                  View all
                </Link>
              </CardHeader>
              <CardContent className="space-y-2">
                {recentEvents.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No alerts fired yet.{" "}
                    <Link href="/alerts" className="text-primary hover:underline">
                      Create alerts
                    </Link>{" "}
                    to hear about spikes, drops, and restock signals.
                  </p>
                ) : (
                  recentEvents.map((e) => {
                    const p = e.payload as Record<string, unknown>;
                    return (
                      <div key={e.id} className="rounded-md border px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{e.alertName}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(e.firedAt)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          <Link
                            href={`/products/${e.productId}`}
                            className="text-primary hover:underline"
                          >
                            {e.productName}
                          </Link>
                          {"pct_change" in p ? ` · Δ ${p.pct_change}%` : ""}
                          {"market" in p && p.market != null ? ` · $${p.market}` : ""}
                        </p>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/repricing">
                <Tags />
                Run repricing
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/inventory/import">
                <Upload />
                Import CSV
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
}) {
  const inner = (
    <Card className={cn(href && "transition-colors hover:border-primary/50")}>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
