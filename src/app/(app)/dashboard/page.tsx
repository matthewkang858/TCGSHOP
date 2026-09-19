import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import {
  ArrowLeftRight,
  Bell,
  Boxes,
  Gauge,
  Package,
  Receipt,
  Target,
  TrendingUp,
  Upload,
} from "lucide-react";
import { db } from "@/db";
import { alertEvents, alerts, expansions, products, repriceRuns, transactions } from "@/db/schema";
import { requireStore } from "@/lib/tenancy";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import type { ValuePoint } from "@/components/inventory-value-chart";
import { cn, formatDateTime, formatMoney, formatPct } from "@/lib/utils";
import { DashboardAnalytics } from "./analytics";
import { StickerRow } from "./sticker-row";
import {
  EmptyRows,
  Row,
  RowActions,
  RowBody,
  RowIcon,
  RowMeta,
  RowRail,
  RowThumb,
  RowTitle,
  SectionCard,
  StatCard,
} from "./ui";

// Headline stats read better without cents.
function formatMoneyWhole(value: string | number | null | undefined): string {
  const n = Number(value ?? NaN);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// Time-only for today's events; date + time otherwise.
function formatWhen(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return formatDateTime(date);
}

const alertIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  threshold_cross: Target,
  pct_change: TrendingUp,
  velocity: Gauge,
  buylist_arb: ArrowLeftRight,
  restock_velocity: Package,
};

// Dashboard is a triage surface: each card is capped and links out for the rest.
const STICKER_CAP = 6;

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
  // Per-store switch for the charts block; on unless the owner turned it off.
  const showAnalytics = ctx.settings.dashboard_analytics ?? true;

  // inventory value over time (30 days), split singles vs sealed, priced off
  // local snapshots at each day's close with current quantities
  const valueRows = hasInventory && showAnalytics
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
        image_url: string | null;
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
        select p.product_id, p.name, p.image_url, e.name set_name,
               coalesce(p.product_type_override, p.product_type) ptype,
               l.price now_price, b.price then_price,
               round((l.price - b.price) / nullif(b.price,0) * 100, 1) pct
        from latest l
        join baseline b on b.product_id = l.product_id
        join products p on p.product_id = l.product_id
        join expansions e on e.group_id = p.group_id
        where b.price > 0
        order by abs((l.price - b.price) / nullif(b.price,0)) desc
        limit 5
      `).then((r) => r.rows)
    : [];

  const recentEvents = await db
    .select({
      id: alertEvents.id,
      firedAt: alertEvents.firedAt,
      alertName: alerts.name,
      alertType: alerts.type,
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

  const recentTransactions = await db
    .select({
      id: transactions.id,
      side: transactions.side,
      quantity: transactions.quantity,
      unitPrice: transactions.unitPrice,
      occurredAt: transactions.occurredAt,
      productId: products.productId,
      productName: products.name,
      productImage: products.imageUrl,
    })
    .from(transactions)
    .innerJoin(products, eq(products.productId, transactions.productId))
    .where(eq(transactions.storeId, storeId))
    .orderBy(desc(transactions.occurredAt))
    .limit(5);

  // today's counter totals (sales only)
  const [today] = await db.execute<{ sales: number; revenue: string | null }>(sql`
    select count(*)::int sales, sum(quantity * unit_price) revenue
    from transactions
    where store_id = ${storeId} and side = 'sale' and occurred_at >= current_date
  `).then((r) => r.rows);

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
        printing: string | null;
        quantity: number;
        current_price: string;
        sticker_price: string | null;
        suggested: string;
        total: string;
      }>(sql`
        with candidates as (
          select i.id, i.condition, i.printing, i.quantity, i.current_price, i.sticker_price,
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
        limit ${STICKER_CAP}
      `).then((r) => r.rows)
    : [];
  const stickerTotal = stickerQueue.length > 0 ? Number(stickerQueue[0].total) : 0;

  const repriceValue = !lastRun
    ? "Not yet run"
    : lastRun.status === "applied"
      ? `${lastRun.appliedCount} updated`
      : lastRun.status === "previewing"
        ? "Preview ready"
        : "Preview discarded";

  const headerFacts = hasInventory
    ? `${stats.lines.toLocaleString()} lines · ${formatMoneyWhole(stats.total_value)} at current prices`
    : "No inventory yet";
  const todaySales = today?.sales ?? 0;

  return (
    <div>
      <PageHeader title="Dashboard" description={headerFacts}>
        {hasInventory ? (
          <Button asChild>
            <Link href="/transactions">Record a sale</Link>
          </Button>
        ) : null}
      </PageHeader>

      {!hasInventory ? (
        <EmptyState
          icon={<Boxes className="h-8 w-8" />}
          title="Welcome to Countertop"
          description="Import your inventory to see what it's worth, keep shelf prices current, and get a heads-up when prices move."
          action={
            <div className="flex flex-col items-center gap-3">
              <div className="flex flex-wrap justify-center gap-2">
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
              <p className="text-xs text-muted-foreground">
                Just trying it out?{" "}
                <a href="/api/sample-inventory.csv" className="text-primary hover:underline">
                  Download a sample CSV
                </a>{" "}
                and import that first.
              </p>
            </div>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <StatCard
              label="Inventory value"
              value={formatMoneyWhole(stats.total_value)}
              sub={`${stats.lines.toLocaleString()} lines`}
            />
            <StatCard
              label="Singles"
              value={formatMoneyWhole(stats.singles_value)}
              sub="at current prices"
            />
            <StatCard
              label="Sealed"
              value={formatMoneyWhole(stats.sealed_value)}
              sub="at current prices"
            />
            <StatCard
              label="Last reprice"
              value={repriceValue}
              sub={lastRun ? formatWhen(lastRun.createdAt) : "start one from Repricing"}
              href={lastRun ? `/repricing/runs/${lastRun.id}` : "/repricing"}
            />
          </div>

          <SectionCard
            title="Sticker queue"
            meta={stickerTotal > 0 ? `${stickerTotal} to re-label` : "all current"}
            bodyClassName="p-0"
            footerHref={stickerTotal > stickerQueue.length ? "/inventory" : undefined}
            footerLabel={
              stickerTotal > stickerQueue.length
                ? `View all ${stickerTotal} to re-label →`
                : undefined
            }
          >
            {stickerQueue.length === 0 ? (
              <EmptyRows>
                Every shelf sticker matches the current price. Items show up here when a price
                change moves past the sticker.
              </EmptyRows>
            ) : (
              stickerQueue.map((s, i) => (
                <StickerRow
                  key={s.id}
                  // Phone caps the walk-list at four rows; desktop shows all six.
                  className={i >= 4 ? "hidden md:flex" : undefined}
                  item={{
                    id: s.id,
                    productId: s.product_id,
                    name: s.name,
                    imageUrl: s.image_url,
                    condition: s.condition,
                    printing: s.printing,
                    quantity: s.quantity,
                    suggested: Number(s.suggested),
                    stickerPrice: s.sticker_price !== null ? Number(s.sticker_price) : null,
                  }}
                />
              ))
            )}
          </SectionCard>

          {showAnalytics ? (
            <DashboardAnalytics storeId={storeId} valueSeries={valueSeries} />
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Counter activity"
              meta={`${todaySales} ${todaySales === 1 ? "sale" : "sales"} today · ${formatMoney(
                today?.revenue ?? 0
              )}`}
              bodyClassName="p-0"
              footerHref="/transactions"
              footerLabel="View all sales and buys →"
            >
              {recentTransactions.length === 0 ? (
                <EmptyRows>
                  No sales or buys recorded yet. Every entry builds your store&apos;s own price
                  history.
                </EmptyRows>
              ) : (
                recentTransactions.map((t) => {
                  const total = Number(t.unitPrice) * t.quantity;
                  return (
                    <Row key={t.id}>
                      <RowThumb
                        productId={t.productId}
                        imageUrl={t.productImage}
                        name={t.productName}
                      />
                      <RowBody>
                        <RowTitle href={`/products/${t.productId}`} title={t.productName}>
                          {t.productName}
                        </RowTitle>
                        <RowMeta>
                          {t.quantity > 1 ? `${t.quantity} × · ` : ""}
                          {formatWhen(t.occurredAt)}
                        </RowMeta>
                      </RowBody>
                      <RowRail>
                        <span
                          className={cn(
                            "text-sm font-medium tabular-nums",
                            t.side === "sale" ? "text-success" : "text-destructive"
                          )}
                        >
                          {t.side === "sale" ? "+" : "−"}
                          {formatMoney(total)}
                        </span>
                      </RowRail>
                    </Row>
                  );
                })
              )}
            </SectionCard>

            <SectionCard
              title="Top movers"
              meta="7 days · your stock"
              bodyClassName="p-0"
              footerHref="/inventory"
              footerLabel="View inventory →"
            >
              {movers.length === 0 ? (
                <EmptyRows>
                  Price movers show up once your stock has a week of price history.
                </EmptyRows>
              ) : (
                movers.map((m) => {
                  const pct = Number(m.pct);
                  return (
                    <Row key={m.product_id}>
                      <RowThumb
                        productId={m.product_id}
                        imageUrl={m.image_url}
                        name={m.name}
                      />
                      <RowBody>
                        <RowTitle href={`/products/${m.product_id}`} title={m.name}>
                          {m.name}
                        </RowTitle>
                        <RowMeta>
                          {m.set_name}
                          {m.ptype === "sealed" ? " · sealed" : ""}
                          {" · was "}
                          <span className="tabular-nums">{formatMoney(m.then_price)}</span>
                        </RowMeta>
                      </RowBody>
                      <RowRail>
                        <span className="text-sm font-medium tabular-nums text-foreground">
                          {formatMoney(m.now_price)}
                        </span>
                        <span
                          className={cn(
                            "text-xs font-medium tabular-nums",
                            pct >= 0 ? "text-success" : "text-destructive"
                          )}
                        >
                          {formatPct(pct)}
                        </span>
                      </RowRail>
                      <RowActions className="w-[60px]">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/transactions?productId=${m.product_id}&side=sale`}>
                            Sell
                          </Link>
                        </Button>
                      </RowActions>
                    </Row>
                  );
                })
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="Recent alerts"
            bodyClassName="p-0"
            footerHref="/alerts"
            footerLabel="View all alerts →"
          >
            {recentEvents.length === 0 ? (
              <EmptyRows>
                No alerts fired yet. Create one to hear about spikes, drops, and restock signals.
              </EmptyRows>
            ) : (
              recentEvents.map((e) => {
                const p = e.payload as Record<string, unknown>;
                const pctChange =
                  "pct_change" in p && p.pct_change != null ? Number(p.pct_change) : null;
                const market = "market" in p && p.market != null ? Number(p.market) : null;
                const Icon = alertIcons[e.alertType] ?? Bell;
                const meta = [
                  e.productName,
                  pctChange !== null ? formatPct(pctChange) : null,
                  market !== null ? `now ${formatMoney(market)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <Row key={e.id}>
                    <RowIcon>
                      <Icon className="size-4" />
                    </RowIcon>
                    <RowBody>
                      <RowTitle href={`/products/${e.productId}`} title={e.alertName}>
                        {e.alertName}
                      </RowTitle>
                      <RowMeta>{meta}</RowMeta>
                    </RowBody>
                    <RowRail>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatWhen(e.firedAt)}
                      </span>
                    </RowRail>
                  </Row>
                );
              })
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
