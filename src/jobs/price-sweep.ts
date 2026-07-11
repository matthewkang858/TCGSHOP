import type PgBoss from "pg-boss";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  alerts,
  inventoryItems,
  priceSnapshots,
  products,
  salesStats,
  watchlistItems,
} from "@/db/schema";
import { getTcgApisClient } from "@/lib/tcgapis/client";
import type { TrendListing, TrendProvider } from "@/lib/tcgapis/types";
import { withJobRun } from "./job-run";
import { JOB } from "./names";

/**
 * Price sweeps write our own price_snapshots history; alerts and charts read
 * ONLY local data. Providers swept:
 *  - tcgplayer retail  (tcg_market basis, charts, pct_change alerts)
 *  - cardkingdom buylist (ck_buylist basis, buylist_arb alerts) - Card
 *    Kingdom only buys Magic, so this target is restricted to categoryId 1
 */
const MAGIC_CATEGORY_ID = 1;

const SWEEP_TARGETS: {
  provider: TrendProvider;
  listing: TrendListing;
  categoryIds?: number[];
}[] = [
  { provider: "tcgplayer", listing: "retail" },
  { provider: "cardkingdom", listing: "buylist", categoryIds: [MAGIC_CATEGORY_ID] },
];

/** don't record a new snapshot unless the price changed or the last one is older than this */
const SNAPSHOT_MIN_AGE_HOURS = 20;

/** items priced at/above this get sales-stats refreshes in the nightly sweep */
const DEFAULT_SALES_STATS_MIN_PRICE = 5;

export async function sweepProducts(
  productIds: number[],
  stats: Record<string, unknown> = {}
): Promise<number[]> {
  if (productIds.length === 0) return [];
  const client = await getTcgApisClient();
  if (!client.supports("trendprices")) {
    stats.skipped = "tier does not include trendprices";
    return [];
  }

  const affected = new Set<number>();

  // category lookup so game-restricted targets (CK buylist = Magic) skip the rest
  const categoryRows = await db
    .select({ productId: products.productId, categoryId: products.categoryId })
    .from(products)
    .where(inArray(products.productId, productIds));
  const categoryById = new Map(categoryRows.map((r) => [r.productId, r.categoryId]));

  for (const target of SWEEP_TARGETS) {
    const targetIds = target.categoryIds
      ? productIds.filter((id) => target.categoryIds!.includes(categoryById.get(id) ?? -1))
      : productIds;
    if (targetIds.length === 0) {
      stats[`${target.provider}_${target.listing}`] = 0;
      continue;
    }

    // latest existing snapshot per product for change detection
    const latest = await db.execute<{
      product_id: number;
      price: string;
      captured_at: Date;
    }>(sql`
      select distinct on (product_id) product_id, price, captured_at
      from price_snapshots
      where product_id = any(${sql.param(targetIds)}::int[])
        and provider = ${target.provider}
        and listing = ${target.listing}
      order by product_id, captured_at desc
    `);

    const latestByProduct = new Map<number, { price: string; capturedAt: Date | null }>();
    for (const row of latest.rows) {
      latestByProduct.set(row.product_id, {
        price: row.price,
        capturedAt: row.captured_at ? new Date(row.captured_at) : null,
      });
    }

    const trends = await client.bulkTrendPrices(targetIds, {
      provider: target.provider,
      listing: target.listing,
    });

    const cutoff = Date.now() - SNAPSHOT_MIN_AGE_HOURS * 3600_000;
    const values = [];
    for (const t of trends) {
      if (t.price === null || t.price === undefined) continue;
      const prev = latestByProduct.get(t.productId);
      const priceChanged = !prev || Number(prev.price) !== t.price;
      const stale = !prev?.capturedAt || prev.capturedAt.getTime() < cutoff;
      if (!priceChanged && !stale) continue;
      values.push({
        productId: t.productId,
        provider: target.provider,
        listing: target.listing,
        finish: t.finish ?? "normal",
        price: t.price.toFixed(2),
        currency: t.currency ?? "USD",
        capturedAt: new Date(),
      });
      affected.add(t.productId);
    }
    if (values.length > 0) {
      const CHUNK = 1000;
      for (let i = 0; i < values.length; i += CHUNK) {
        await db.insert(priceSnapshots).values(values.slice(i, i + CHUNK));
      }
    }
    stats[`${target.provider}_${target.listing}`] = values.length;
  }

  return [...affected];
}

// --- sales stats -------------------------------------------------------------

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function refreshSalesStats(productIds: number[], stats: Record<string, unknown>) {
  const client = await getTcgApisClient();
  if (!client.supports("sales")) {
    stats.salesSkipped = "tier does not include sales history";
    return;
  }

  // respect the 4h upstream cache on v1 sales-history
  const recentCutoff = new Date(Date.now() - 4 * 3600_000);
  const fresh = await db
    .select({ productId: salesStats.productId })
    .from(salesStats)
    .where(
      and(
        inArray(salesStats.productId, productIds),
        eq(salesStats.window, "24h"),
        gte(salesStats.computedAt, recentCutoff)
      )
    );
  const freshSet = new Set(fresh.map((f) => f.productId));
  const todo = productIds.filter((id) => !freshSet.has(id));

  let refreshed = 0;
  for (const productId of todo) {
    const [recent, buckets] = await Promise.all([
      client.getSalesHistory(productId),
      client.getFullSalesHistory(productId),
    ]);

    const now = new Date();
    const upserts: (typeof salesStats.$inferInsert)[] = [];

    const count24 = recent.statistics?.last24Hours?.count ?? 0;
    const trend = recent.priceAnalysis?.trend ?? null;
    const recentPrices = (recent.sales ?? []).map((s) => s.price).filter(Number.isFinite);
    upserts.push({
      productId,
      window: "24h",
      saleCount: count24,
      medianPrice: median(recentPrices)?.toFixed(2) ?? null,
      avgPrice: recentPrices.length
        ? (recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length).toFixed(2)
        : null,
      trend,
      computedAt: now,
    });

    for (const [window, days] of [
      ["7d", 7],
      ["30d", 30],
    ] as const) {
      const cutoff = Date.now() - days * 86_400_000;
      const inWindow = buckets.filter((b) => new Date(b.bucketStart).getTime() >= cutoff);
      const weighted: number[] = [];
      let saleCount = 0;
      for (const b of inWindow) {
        const qty = b.quantitySold ?? 0;
        saleCount += qty;
        if (b.marketPrice != null && qty > 0) {
          // weight bucket market price by quantity for a median that reflects volume
          for (let i = 0; i < Math.min(qty, 50); i++) weighted.push(b.marketPrice);
        }
      }
      upserts.push({
        productId,
        window,
        saleCount,
        medianPrice: median(weighted)?.toFixed(2) ?? null,
        avgPrice: weighted.length
          ? (weighted.reduce((a, b) => a + b, 0) / weighted.length).toFixed(2)
          : null,
        trend,
        computedAt: now,
      });
    }

    for (const row of upserts) {
      await db
        .insert(salesStats)
        .values(row)
        .onConflictDoUpdate({
          target: [salesStats.productId, salesStats.window],
          set: {
            saleCount: sql`excluded.sale_count`,
            medianPrice: sql`excluded.median_price`,
            avgPrice: sql`excluded.avg_price`,
            trend: sql`excluded.trend`,
            computedAt: sql`excluded.computed_at`,
          },
        });
    }
    refreshed++;
  }
  stats.salesStatsRefreshed = refreshed;
}

// --- jobs ---------------------------------------------------------------------

/** productIds referenced by active alerts (their configs + store watchlists). */
export async function watchlistProductIds(): Promise<number[]> {
  const ids = new Set<number>();
  const activeAlerts = await db
    .select({ storeId: alerts.storeId, config: alerts.config })
    .from(alerts)
    .where(eq(alerts.active, true));
  const storesWithAlerts = new Set<string>();
  for (const a of activeAlerts) {
    if (a.config.product_id) ids.add(a.config.product_id);
    storesWithAlerts.add(a.storeId);
  }
  if (storesWithAlerts.size > 0) {
    const watch = await db
      .select({ productId: watchlistItems.productId })
      .from(watchlistItems)
      .where(inArray(watchlistItems.storeId, [...storesWithAlerts]));
    for (const w of watch) ids.add(w.productId);
  }
  return [...ids];
}

export async function runWatchlistSweep(): Promise<void> {
  await withJobRun(JOB.PRICE_SWEEP_WATCHLIST, async (stats) => {
    const ids = await watchlistProductIds();
    stats.products = ids.length;
    const affected = await sweepProducts(ids, stats);
    if (affected.length > 0) {
      const { enqueueJob } = await import("./boss");
      await enqueueJob(JOB.ALERT_EVAL, { productIds: affected, source: "watchlist-sweep" });
    }
  });
}

export async function runInventorySweep(): Promise<void> {
  await withJobRun(JOB.PRICE_SWEEP_INVENTORY, async (stats) => {
    const rows = await db
      .selectDistinct({ productId: inventoryItems.productId })
      .from(inventoryItems);
    const ids = rows.map((r) => r.productId);
    stats.products = ids.length;
    const affected = await sweepProducts(ids, stats);

    // sales stats for items above the price threshold (any store)
    const priced = await db
      .selectDistinct({ productId: inventoryItems.productId })
      .from(inventoryItems)
      .where(
        and(
          isNotNull(inventoryItems.currentPrice),
          gte(inventoryItems.currentPrice, DEFAULT_SALES_STATS_MIN_PRICE.toFixed(2))
        )
      );
    await refreshSalesStats(
      priced.map((p) => p.productId),
      stats
    );

    if (affected.length > 0) {
      const { enqueueJob } = await import("./boss");
      await enqueueJob(JOB.ALERT_EVAL, { productIds: affected, source: "inventory-sweep" });
    }
  });
}

/**
 * Freshness guard used by reprice-run creation: sweep any of the given
 * products whose latest tcgplayer retail snapshot is older than maxAgeHours.
 * Capped so a giant inventory can't stall the request - the nightly job
 * remains the workhorse.
 */
export async function ensureFreshSnapshots(
  productIds: number[],
  maxAgeHours: number,
  cap = 1000
): Promise<void> {
  if (productIds.length === 0) return;
  const cutoff = new Date(Date.now() - maxAgeHours * 3600_000);
  const freshRows = await db
    .select({ productId: priceSnapshots.productId })
    .from(priceSnapshots)
    .where(
      and(
        inArray(priceSnapshots.productId, productIds),
        eq(priceSnapshots.provider, "tcgplayer"),
        eq(priceSnapshots.listing, "retail"),
        gte(priceSnapshots.capturedAt, cutoff)
      )
    )
    .groupBy(priceSnapshots.productId);
  const freshSet = new Set(freshRows.map((r) => r.productId));
  const stale = productIds.filter((id) => !freshSet.has(id)).slice(0, cap);
  if (stale.length > 0) {
    await withJobRun("reprice-freshness-sweep", async (stats) => {
      stats.products = stale.length;
      await sweepProducts(stale, stats);
    });
  }
}

export async function registerSweepJobs(boss: PgBoss) {
  await boss.work(JOB.PRICE_SWEEP_WATCHLIST, async () => runWatchlistSweep());
  await boss.work(JOB.PRICE_SWEEP_INVENTORY, async () => runInventorySweep());
  await boss.schedule(JOB.PRICE_SWEEP_WATCHLIST, "0 * * * *", {}, {}); // hourly
  await boss.schedule(JOB.PRICE_SWEEP_INVENTORY, "0 2 * * *", {}, {}); // nightly 02:00
}
