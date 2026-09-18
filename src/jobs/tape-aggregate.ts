import type PgBoss from "pg-boss";
import { gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { marketObservations, streetPrices, tapeExclusions } from "@/db/schema";
import {
  aggregateTrades,
  DEFAULT_CONFIG,
  type Trade,
} from "@/lib/tape/aggregate";
import {
  blendPrices,
  rollupWindow,
  type DailyObservation,
} from "@/lib/tape/blend";
import { conditionMultiplier } from "@/lib/repricing/engine";
import { withJobRun } from "./job-run";
import { JOB } from "./names";

/**
 * Build the tape from the counter ledger.
 *
 * Every store's `transactions` rows are private to that store. This job reads
 * across all of them at once and writes three platform-level tables that are
 * never joined back to a single store:
 *
 *   market_observations - one trimmed, quality-controlled bucket per
 *                         (sku identity, day)
 *   street_prices       - the published number for each sku identity: our
 *                         street price, the marketplace reference, and the
 *                         confidence-weighted blend of the two
 *   tape_exclusions     - every trade the quality filters rejected, with the
 *                         reason, so the filters themselves are auditable
 *
 * Only sales feed the tape. A buy is a buylist price, which is a different
 * number entirely — mixing the two would drag every street price toward what
 * stores pay rather than what customers pay.
 *
 * The job is idempotent: it recomputes a trailing window from scratch each
 * run, so a store back-entering last Saturday's sales on Monday is picked up
 * without any of the bookkeeping that incremental aggregation would need.
 */

/** trailing days of buckets that feed one street price */
const WINDOW_DAYS = 30;

/**
 * Daily buckets recomputed each run. This covers the whole street-price
 * window on purpose: the k-anonymity count below needs a complete exclusion
 * record for every day it looks at, and recomputing a shorter window would
 * leave the older days' exclusions to rot. At real scale this becomes the
 * thing to make incremental - but not before it has to be.
 */
const RECOMPUTE_DAYS = WINDOW_DAYS;

/** identities need this many distinct stores across the window to publish */
const MIN_WINDOW_STORES = DEFAULT_CONFIG.minStores;

type Identity = {
  productId: number;
  condition: string;
  printing: string | null;
  language: string;
};

const identityKey = (i: Identity) =>
  `${i.productId}|${i.condition}|${i.printing ?? ""}|${i.language}`;

const parseIdentity = (key: string): Identity => {
  const [productId, condition, printing, language] = key.split("|");
  return {
    productId: Number(productId),
    condition,
    printing: printing === "" ? null : printing,
    language,
  };
};

/** UTC midnight for a timestamp - the day a bucket covers. */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

const daysBetween = (later: Date, earlier: Date) =>
  Math.round((later.getTime() - earlier.getTime()) / 86_400_000);

type TradeRow = {
  id: string;
  store_id: string;
  product_id: number;
  condition: string;
  printing: string | null;
  language: string;
  quantity: number;
  unit_price: string;
  payment_ref: string | null;
  bucket_date: string;
};

export async function runTapeAggregate(
  opts: { asOf?: Date; days?: number } = {},
  stats: Record<string, unknown> = {}
) {
  const asOf = utcDay(opts.asOf ?? new Date());
  const recomputeDays = Math.max(WINDOW_DAYS, opts.days ?? RECOMPUTE_DAYS);
  const bucketStart = addDays(asOf, -(recomputeDays - 1));
  const windowStart = addDays(asOf, -(WINDOW_DAYS - 1));
  const end = addDays(asOf, 1);

  // ---------------------------------------------------------------- buckets
  const tradeRows = await db.execute<TradeRow>(sql`
    select
      t.id, t.store_id, t.product_id, t.condition, t.printing, t.language,
      t.quantity, t.unit_price, t.payment_ref,
      date_trunc('day', t.occurred_at at time zone 'UTC') as bucket_date
    from transactions t
    where t.side = 'sale'
      and t.occurred_at >= ${bucketStart}
      and t.occurred_at < ${end}
  `);

  // (identity, day) -> trades
  const buckets = new Map<string, { identity: Identity; day: Date; trades: Trade[] }>();
  const productIds = new Set<number>();
  for (const r of tradeRows.rows) {
    const identity: Identity = {
      productId: r.product_id,
      condition: r.condition,
      printing: r.printing,
      language: r.language,
    };
    productIds.add(r.product_id);
    const day = utcDay(new Date(r.bucket_date));
    const key = `${identityKey(identity)}@${day.toISOString()}`;
    const bucket = buckets.get(key) ?? { identity, day, trades: [] };
    bucket.trades.push({
      transactionId: r.id,
      storeId: r.store_id,
      unitPrice: Number(r.unit_price),
      quantity: r.quantity,
      // A processor charge id is the attestation. The `payment_method` label
      // is what the store says; this is what a processor confirmed.
      verified: r.payment_ref !== null,
    });
    buckets.set(key, bucket);
  }

  const references = await loadReferencePrices([...productIds]);

  // Recomputing a window means the old rows for it are stale by definition.
  await db.delete(tapeExclusions).where(gte(tapeExclusions.bucketDate, bucketStart));

  const observationRows: (typeof marketObservations.$inferInsert)[] = [];
  const exclusionRows: (typeof tapeExclusions.$inferInsert)[] = [];

  for (const { identity, day, trades } of buckets.values()) {
    const reference = conditionReference(references.get(identity.productId), identity.condition);
    const o = aggregateTrades(trades, reference);
    const verifiedById = new Map(trades.map((t) => [t.transactionId, t.verified]));

    observationRows.push({
      productId: identity.productId,
      condition: identity.condition,
      printing: identity.printing,
      language: identity.language,
      bucketDate: day,
      tradeCount: o.tradeCount,
      unitCount: o.unitCount,
      storeCount: o.storeCount,
      verifiedTradeCount: o.verifiedTradeCount,
      verifiedShare: String(o.verifiedShare),
      fencedOnVerified: o.fencedOnVerified,
      vwap: o.vwap === null ? null : String(o.vwap),
      medianPrice: o.median === null ? null : String(o.median),
      p25: o.p25 === null ? null : String(o.p25),
      p75: o.p75 === null ? null : String(o.p75),
      lowPrice: o.low === null ? null : String(o.low),
      highPrice: o.high === null ? null : String(o.high),
      rawTradeCount: o.rawTradeCount,
      excludedCount: o.excluded.length,
      computedAt: new Date(),
    });

    for (const e of o.excluded) {
      exclusionRows.push({
        transactionId: e.transactionId,
        productId: identity.productId,
        bucketDate: day,
        reason: e.reason,
        unitPrice: String(e.unitPrice),
        wasVerified: verifiedById.get(e.transactionId) ?? false,
        detail: e.detail,
      });
    }
  }

  await upsertObservations(observationRows);
  await insertChunked(tapeExclusions, exclusionRows);

  stats.buckets = observationRows.length;
  stats.tradesRead = tradeRows.rows.length;
  stats.excluded = exclusionRows.length;

  // ---------------------------------------------------------- street prices
  const published = await computeStreetPrices(asOf, windowStart, end, references);
  stats.identitiesPriced = published.total;
  stats.identitiesPublishable = published.publishable;

  return stats;
}

/**
 * Latest marketplace retail price per product. This is the reference the tape
 * is measured against - both as the plausibility gate for individual trades
 * and as the thing the street price is blended toward.
 */
async function loadReferencePrices(productIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (productIds.length === 0) return map;
  const rows = await db.execute<{ product_id: number; price: string }>(sql`
    select product_id, price from (
      select product_id, price,
             row_number() over (partition by product_id order by captured_at desc) rn
      from price_snapshots
      where provider = 'tcgplayer' and listing = 'retail'
        and product_id = any(${sql.param(productIds)}::int[])
    ) t where rn = 1
  `);
  for (const r of rows.rows) map.set(r.product_id, Number(r.price));
  return map;
}

/**
 * Marketplace prices are quoted Near Mint, but the tape buckets by condition.
 * Comparing a Heavily Played trade to an NM reference would read as a 45%
 * discount on every single card.
 *
 * This uses the platform's default condition ladder, NOT any store's
 * configured multipliers - a store's ladder is its own pricing opinion, and
 * the reference has to mean the same thing for everyone.
 */
function conditionReference(reference: number | undefined, condition: string): number | null {
  if (reference === undefined || !(reference > 0)) return null;
  return reference * conditionMultiplier(condition);
}

async function computeStreetPrices(
  asOf: Date,
  windowStart: Date,
  end: Date,
  references: Map<number, number>
) {
  const obsRows = await db.execute<{
    product_id: number;
    condition: string;
    printing: string | null;
    language: string;
    bucket_date: string;
    vwap: string | null;
    median_price: string | null;
    p25: string | null;
    p75: string | null;
    trade_count: number;
    unit_count: number;
    store_count: number;
    verified_share: string;
  }>(sql`
    select product_id, condition, printing, language, bucket_date,
           vwap, median_price, p25, p75,
           trade_count, unit_count, store_count, verified_share
    from market_observations
    where bucket_date >= ${windowStart} and bucket_date <= ${asOf}
      and trade_count > 0
  `);

  // Distinct stores across the whole window. This cannot be recovered from the
  // per-day counts, because the same store trades on many days - and it is the
  // number the k-anonymity gate turns on, so it has to be exact.
  //
  // Excluded trades must not count. Otherwise one honest store plus one store
  // whose every trade was rejected would read as two contributors and publish
  // a price that only one business actually stands behind - which is the exact
  // situation the gate exists to prevent.
  const storeRows = await db.execute<{
    product_id: number;
    condition: string;
    printing: string | null;
    language: string;
    stores: number;
  }>(sql`
    select t.product_id, t.condition, t.printing, t.language,
           count(distinct t.store_id)::int as stores
    from transactions t
    left join tape_exclusions x on x.transaction_id = t.id
    where t.side = 'sale'
      and t.occurred_at >= ${windowStart} and t.occurred_at < ${end}
      and x.id is null
    group by 1, 2, 3, 4
  `);
  const storesByIdentity = new Map<string, number>();
  for (const r of storeRows.rows) {
    storesByIdentity.set(
      identityKey({
        productId: r.product_id,
        condition: r.condition,
        printing: r.printing,
        language: r.language,
      }),
      r.stores
    );
  }

  const byIdentity = new Map<string, DailyObservation[]>();
  for (const r of obsRows.rows) {
    if (r.vwap === null) continue;
    const key = identityKey({
      productId: r.product_id,
      condition: r.condition,
      printing: r.printing,
      language: r.language,
    });
    const list = byIdentity.get(key) ?? [];
    list.push({
      ageDays: daysBetween(asOf, utcDay(new Date(r.bucket_date))),
      vwap: Number(r.vwap),
      tradeCount: r.trade_count,
      unitCount: r.unit_count,
      storeCount: r.store_count,
      median: r.median_price === null ? null : Number(r.median_price),
      p25: r.p25 === null ? null : Number(r.p25),
      p75: r.p75 === null ? null : Number(r.p75),
      verifiedShare: Number(r.verified_share),
    });
    byIdentity.set(key, list);
  }

  const rows: (typeof streetPrices.$inferInsert)[] = [];
  let publishable = 0;

  for (const [key, days] of byIdentity) {
    const identity = parseIdentity(key);
    const distinctStores = storesByIdentity.get(key) ?? 0;
    const rolled = rollupWindow(days, { distinctStores });

    // k-anonymity. Below the gate we still write the row - ops needs to see
    // that coverage exists - but we publish no street price, which makes the
    // blend fall back to the marketplace reference on its own.
    const withheld = distinctStores < MIN_WINDOW_STORES;
    if (!withheld) publishable += 1;

    const reference = conditionReference(
      references.get(identity.productId),
      identity.condition
    );
    const blend = blendPrices(
      withheld ? null : rolled.streetPrice,
      reference,
      withheld ? 0 : rolled.confidence.score
    );

    rows.push({
      productId: identity.productId,
      condition: identity.condition,
      printing: identity.printing,
      language: identity.language,
      asOf,
      streetPrice: blend.streetPrice === null ? null : String(blend.streetPrice),
      sampleTrades: rolled.sampleTrades,
      sampleStores: distinctStores,
      verifiedShare: String(rolled.verifiedShare),
      confidence: String(blend.confidence),
      confidenceBreakdown: {
        sample: rolled.confidence.sample,
        breadth: rolled.confidence.breadth,
        agreement: rolled.confidence.agreement,
        recency: rolled.confidence.recency,
        attestation: rolled.confidence.attestation,
      },
      referencePrice: blend.referencePrice === null ? null : String(blend.referencePrice),
      blendedPrice: blend.blendedPrice === null ? null : String(blend.blendedPrice),
      divergencePct: blend.divergencePct === null ? null : String(blend.divergencePct),
      computedAt: new Date(),
    });
  }

  await upsertStreetPrices(rows);
  return { total: rows.length, publishable };
}

const CHUNK = 500;

async function upsertObservations(rows: (typeof marketObservations.$inferInsert)[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(marketObservations)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [
          marketObservations.productId,
          marketObservations.condition,
          marketObservations.printing,
          marketObservations.language,
          marketObservations.bucketDate,
        ],
        set: {
          tradeCount: sql`excluded.trade_count`,
          unitCount: sql`excluded.unit_count`,
          storeCount: sql`excluded.store_count`,
          verifiedTradeCount: sql`excluded.verified_trade_count`,
          verifiedShare: sql`excluded.verified_share`,
          fencedOnVerified: sql`excluded.fenced_on_verified`,
          vwap: sql`excluded.vwap`,
          medianPrice: sql`excluded.median_price`,
          p25: sql`excluded.p25`,
          p75: sql`excluded.p75`,
          lowPrice: sql`excluded.low_price`,
          highPrice: sql`excluded.high_price`,
          rawTradeCount: sql`excluded.raw_trade_count`,
          excludedCount: sql`excluded.excluded_count`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }
}

async function upsertStreetPrices(rows: (typeof streetPrices.$inferInsert)[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(streetPrices)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [
          streetPrices.productId,
          streetPrices.condition,
          streetPrices.printing,
          streetPrices.language,
          streetPrices.asOf,
        ],
        set: {
          streetPrice: sql`excluded.street_price`,
          sampleTrades: sql`excluded.sample_trades`,
          sampleStores: sql`excluded.sample_stores`,
          verifiedShare: sql`excluded.verified_share`,
          confidence: sql`excluded.confidence`,
          confidenceBreakdown: sql`excluded.confidence_breakdown`,
          referencePrice: sql`excluded.reference_price`,
          blendedPrice: sql`excluded.blended_price`,
          divergencePct: sql`excluded.divergence_pct`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }
}

async function insertChunked(
  table: typeof tapeExclusions,
  rows: (typeof tapeExclusions.$inferInsert)[]
) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(table).values(rows.slice(i, i + CHUNK));
  }
}

export async function registerTapeJobs(boss: PgBoss) {
  await boss.work(JOB.TAPE_AGGREGATE, async () =>
    withJobRun(JOB.TAPE_AGGREGATE, (stats) => runTapeAggregate({}, stats))
  );
  // Nightly, after the 02:00 inventory sweep has refreshed the references the
  // tape measures itself against.
  await boss.schedule(JOB.TAPE_AGGREGATE, "30 3 * * *", {}, {});
}
