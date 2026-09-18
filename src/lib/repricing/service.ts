import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expansions,
  inventoryItems,
  priceSnapshots,
  products,
  repriceRules,
  repriceRunItems,
  repriceRuns,
  salesStats,
  stores,
} from "@/db/schema";
import { ensureFreshSnapshots } from "@/jobs/price-sweep";
import { withJobRun } from "@/jobs/job-run";
import { getTcgApisClient } from "@/lib/tcgapis/client";
import {
  computePrice,
  conditionMultiplier,
  isSkuLevelBasis,
  selectRule,
  streetBasisValue,
  type EngineRule,
  type ScopeInput,
  type StreetPriceRow,
} from "./engine";

/**
 * basis -> (provider, listing) in price_snapshots. Bases that read their own
 * table map to null: sales_median_7d reads sales_stats, street_blended reads
 * street_prices.
 */
export const BASIS_SNAPSHOT_SOURCE: Record<
  string,
  { provider: string; listing: "retail" | "buylist" } | null
> = {
  tcg_market: { provider: "tcgplayer", listing: "retail" },
  tcg_low: { provider: "tcgplayer_low", listing: "retail" },
  ck_buylist: { provider: "cardkingdom", listing: "buylist" },
  cardmarket_trend: { provider: "cardmarket", listing: "retail" },
  sales_median_7d: null,
  // street_blended reads street_prices, but it also needs the marketplace
  // snapshot as its fallback for cards the tape has never seen.
  street_blended: { provider: "tcgplayer", listing: "retail" },
};

const DEFAULT_STALENESS_HOURS = 24;

type LatestPriceKey = string; // `${productId}|${provider}|${listing}`

async function latestSnapshotPrices(
  productIds: number[],
  sources: { provider: string; listing: string }[]
): Promise<Map<LatestPriceKey, number>> {
  const map = new Map<LatestPriceKey, number>();
  if (productIds.length === 0 || sources.length === 0) return map;
  for (const source of sources) {
    const res = await db.execute<{ product_id: number; price: string }>(sql`
      select distinct on (product_id) product_id, price
      from price_snapshots
      where product_id = any(${sql.param(productIds)}::int[])
        and provider = ${source.provider}
        and listing = ${source.listing}
      order by product_id, captured_at desc
    `);
    for (const row of res.rows) {
      map.set(`${row.product_id}|${source.provider}|${source.listing}`, Number(row.price));
    }
  }
  return map;
}

/** The four columns street_prices is keyed by - NULL printing is a real key. */
export type SkuIdentity = {
  productId: number;
  condition: string;
  printing: string | null;
  language: string;
};

/**
 * Map key over the full street_prices identity. JSON keeps a NULL printing
 * distinct from the string "null" and from an empty printing, which is what
 * the table's own `nullsNotDistinct` unique index means: a NULL printing
 * matches a NULL printing and nothing else.
 */
export function streetIdentityKey(i: SkuIdentity): string {
  return JSON.stringify([i.productId, i.condition, i.printing, i.language]);
}

/**
 * Latest street_prices row per (product, condition, printing, language).
 *
 * `distinct on` carries the same nulls-not-distinct semantics as the table's
 * unique index - DISTINCT groups NULL with NULL - so a sealed row (printing
 * NULL) collapses to one latest row rather than one per as_of. Latest is max
 * as_of; the row is then handed to `streetBasisValue`, which decides whether
 * it is usable at all (confidence > 0, blended price present).
 */
export async function latestStreetPrices(
  productIds: number[]
): Promise<Map<string, StreetPriceRow>> {
  const map = new Map<string, StreetPriceRow>();
  if (productIds.length === 0) return map;
  const res = await db.execute<{
    product_id: number;
    condition: string;
    printing: string | null;
    language: string;
    blended_price: string | null;
    confidence: string | null;
  }>(sql`
    select distinct on (product_id, condition, printing, language)
      product_id, condition, printing, language, blended_price, confidence
    from street_prices
    where product_id = any(${sql.param(productIds)}::int[])
    order by product_id, condition, printing, language, as_of desc
  `);
  for (const row of res.rows) {
    map.set(
      streetIdentityKey({
        productId: Number(row.product_id),
        condition: row.condition,
        printing: row.printing,
        language: row.language,
      }),
      { blendedPrice: row.blended_price, confidence: row.confidence }
    );
  }
  return map;
}

/**
 * Populate tcgplayer_low snapshots for rules using the tcg_low basis.
 * Per-product calls, so capped; requires prices tier (or offline fixtures).
 */
async function sweepLowPrices(productIds: number[], cap = 200): Promise<void> {
  const client = await getTcgApisClient();
  if (!client.supports("prices")) return;
  const todo = productIds.slice(0, cap);
  if (todo.length === 0) return;
  await withJobRun("tcg-low-sweep", async (stats) => {
    let inserted = 0;
    for (const productId of todo) {
      try {
        const prices = await client.getProductPrices(productId);
        const lows = prices.prices
          .map((p) => p.lowPrice)
          .filter((v): v is number => v != null && v > 0);
        if (lows.length === 0) continue;
        await db.insert(priceSnapshots).values({
          productId,
          provider: "tcgplayer_low",
          listing: "retail",
          finish: "normal",
          price: Math.min(...lows).toFixed(2),
          currency: "USD",
        });
        inserted++;
      } catch {
        // missing product prices shouldn't kill the whole run
      }
    }
    stats.products = todo.length;
    stats.inserted = inserted;
  });
}

export type CreateRunResult =
  | { ok: true; runId: string; itemCount: number; flaggedCount: number; noDataCount: number }
  | { ok: false; error: string };

export async function createRepriceRun(
  storeId: string,
  userId: string,
  ruleIds: string[]
): Promise<CreateRunResult> {
  const rules = await db
    .select()
    .from(repriceRules)
    .where(
      and(
        eq(repriceRules.storeId, storeId),
        eq(repriceRules.active, true),
        inArray(repriceRules.id, ruleIds)
      )
    )
    .orderBy(asc(repriceRules.priority), asc(repriceRules.createdAt));

  if (rules.length === 0) return { ok: false, error: "Select at least one active rule" };

  const items = await db
    .select({
      id: inventoryItems.id,
      productId: inventoryItems.productId,
      condition: inventoryItems.condition,
      printing: inventoryItems.printing,
      language: inventoryItems.language,
      quantity: inventoryItems.quantity,
      currentPrice: inventoryItems.currentPrice,
      costBasis: inventoryItems.costBasis,
      tags: inventoryItems.tags,
      categoryId: products.categoryId,
      groupId: products.groupId,
      rarity: products.rarity,
      productType: sql<
        "single" | "sealed" | "other"
      >`coalesce(${products.productTypeOverride}, ${products.productType})`,
    })
    .from(inventoryItems)
    .innerJoin(products, eq(products.productId, inventoryItems.productId))
    .where(eq(inventoryItems.storeId, storeId));

  if (items.length === 0) return { ok: false, error: "No inventory to reprice" };

  const productIds = [...new Set(items.map((i) => i.productId))];

  // freshness: sweep stale products first (store-configurable threshold)
  const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
  const staleness = store?.settings.snapshot_staleness_hours ?? DEFAULT_STALENESS_HOURS;
  await ensureFreshSnapshots(productIds, staleness);

  const usedBases = [...new Set(rules.map((r) => r.basis))];
  if (usedBases.includes("tcg_low")) {
    await sweepLowPrices(productIds);
  }

  const sources = usedBases
    .map((b) => BASIS_SNAPSHOT_SOURCE[b])
    .filter((s): s is { provider: string; listing: "retail" | "buylist" } => s !== null);
  const prices = await latestSnapshotPrices(productIds, sources);

  // street_blended basis - our own published price, keyed by the full sku identity
  let streetRows = new Map<string, StreetPriceRow>();
  if (usedBases.includes("street_blended")) {
    streetRows = await latestStreetPrices(productIds);
  }

  // sales_median_7d basis
  const medians = new Map<number, number>();
  if (usedBases.includes("sales_median_7d")) {
    const rows = await db
      .select({ productId: salesStats.productId, medianPrice: salesStats.medianPrice })
      .from(salesStats)
      .where(and(inArray(salesStats.productId, productIds), eq(salesStats.window, "7d")));
    for (const r of rows) {
      if (r.medianPrice != null) medians.set(r.productId, Number(r.medianPrice));
    }
  }

  const engineRules = rules.map((r) => ({
    id: r.id,
    scope: (r.scope ?? {}) as ScopeInput,
    basis: r.basis,
    engine: {
      multiplier: Number(r.multiplier),
      offset: Number(r.offset),
      conditionMultipliers: r.conditionMultipliers,
      floor: r.floor != null ? Number(r.floor) : null,
      ceiling: r.ceiling != null ? Number(r.ceiling) : null,
      minPrice: Number(r.minPrice),
      maxChangePct: r.maxChangePct != null ? Number(r.maxChangePct) : null,
      rounding: r.rounding,
      respectCostBasis: r.respectCostBasis,
      minMarginPct: Number(r.minMarginPct),
    } satisfies EngineRule,
  }));

  const resolveBasisFor = (item: SkuIdentity) => (rule: (typeof engineRules)[number]) => {
    if (rule.basis === "street_blended") {
      const street = streetBasisValue(streetRows.get(streetIdentityKey(item)));
      if (street !== null) return street;
      // No published row for this sku identity at all. The blend for a card
      // nobody has sold in person IS the marketplace price, so fall back to it
      // rather than skipping the item - otherwise a card traded once prices
      // fine while a card traded never gets skipped, which is incoherent.
      //
      // The snapshot is quoted Near Mint and this basis is SKU-level, so the
      // condition step has to be applied here. It uses the platform ladder,
      // not the rule's overrides, so that a card with street data and a card
      // without are stepped down by the same amount.
      const source = BASIS_SNAPSHOT_SOURCE.street_blended!;
      const reference =
        prices.get(`${item.productId}|${source.provider}|${source.listing}`) ?? null;
      return reference === null ? null : reference * conditionMultiplier(item.condition);
    }
    if (rule.basis === "sales_median_7d") return medians.get(item.productId) ?? null;
    const source = BASIS_SNAPSHOT_SOURCE[rule.basis];
    if (!source) return null;
    return prices.get(`${item.productId}|${source.provider}|${source.listing}`) ?? null;
  };

  let flaggedCount = 0;
  let noDataCount = 0;
  const runItems: (typeof repriceRunItems.$inferInsert)[] = [];

  for (const item of items) {
    const picked = selectRule(
      engineRules,
      {
        productType: item.productType,
        categoryId: item.categoryId,
        groupId: item.groupId,
        rarity: item.rarity,
        condition: item.condition,
        printing: item.printing,
        tags: item.tags,
      },
      resolveBasisFor(item)
    );
    if (!picked) continue; // out of scope for every selected rule

    const { rule, basisValue } = picked;
    if (basisValue == null) {
      noDataCount++;
      runItems.push({
        runId: "", // filled after run insert
        inventoryItemId: item.id,
        ruleId: rule.id,
        basisValue: null,
        oldPrice: item.currentPrice,
        newPrice: null,
        pctChange: null,
        flagged: true,
        flagReason:
          rule.basis === "street_blended"
            ? "No street price and no market price for this card - run a sweep or pick another basis"
            : "No price data for this basis - run a sweep or pick another basis",
        excluded: true,
      });
      continue;
    }

    const result = computePrice(rule.engine, {
      productType: item.productType,
      condition: item.condition,
      currentPrice: item.currentPrice != null ? Number(item.currentPrice) : null,
      costBasis: item.costBasis != null ? Number(item.costBasis) : null,
      basisValue,
      // street_blended rows are already condition-exact; don't discount twice
      basisIsSkuLevel: isSkuLevelBasis(rule.basis),
    });
    if (result.flagged) flaggedCount++;

    runItems.push({
      runId: "",
      inventoryItemId: item.id,
      ruleId: rule.id,
      basisValue: basisValue.toFixed(2),
      oldPrice: item.currentPrice,
      newPrice: result.newPrice.toFixed(2),
      pctChange: result.pctChange?.toFixed(2) ?? null,
      flagged: result.flagged,
      flagReason: result.flagReason,
      excluded: false,
    });
  }

  if (runItems.length === 0) {
    return { ok: false, error: "No inventory items matched the selected rules' scopes" };
  }

  const runId = await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(repriceRuns)
      .values({
        storeId,
        status: "previewing",
        itemCount: runItems.length,
        flaggedCount,
        ruleIds,
        createdBy: userId,
      })
      .returning();
    const CHUNK = 1000;
    const withRun = runItems.map((ri) => ({ ...ri, runId: run.id }));
    for (let i = 0; i < withRun.length; i += CHUNK) {
      await tx.insert(repriceRunItems).values(withRun.slice(i, i + CHUNK));
    }
    return run.id;
  });

  return { ok: true, runId, itemCount: runItems.length, flaggedCount, noDataCount };
}

export async function applyRepriceRun(
  storeId: string,
  runId: string
): Promise<{ ok: true; applied: number } | { ok: false; error: string }> {
  const [run] = await db
    .select()
    .from(repriceRuns)
    .where(and(eq(repriceRuns.id, runId), eq(repriceRuns.storeId, storeId)));
  if (!run) return { ok: false, error: "Run not found" };
  if (run.status !== "previewing") return { ok: false, error: `Run already ${run.status}` };

  const applied = await db.transaction(async (tx) => {
    // eligible: not excluded, has a price, and (unflagged OR manually approved)
    const res = await tx.execute<{ count: string }>(sql`
      with eligible as (
        select ri.inventory_item_id, ri.new_price
        from reprice_run_items ri
        where ri.run_id = ${runId}
          and ri.excluded = false
          and ri.new_price is not null
          and (ri.flagged = false or ri.approved = true)
      )
      update inventory_items i
      set current_price = e.new_price, updated_at = now()
      from eligible e
      where i.id = e.inventory_item_id
        and i.store_id = ${storeId}
    `);
    const count = res.rowCount ?? 0;
    await tx
      .update(repriceRuns)
      .set({ status: "applied", appliedCount: count, appliedAt: new Date() })
      .where(eq(repriceRuns.id, runId));
    return count;
  });

  return { ok: true, applied };
}

export async function discardRepriceRun(storeId: string, runId: string) {
  await db
    .update(repriceRuns)
    .set({ status: "discarded" })
    .where(
      and(
        eq(repriceRuns.id, runId),
        eq(repriceRuns.storeId, storeId),
        eq(repriceRuns.status, "previewing")
      )
    );
}
