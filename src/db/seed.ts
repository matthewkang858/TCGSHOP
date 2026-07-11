/**
 * `pnpm seed` - demo data so the full loop works immediately, offline:
 *  - demo store + user (magic link logs to console)
 *  - fixture catalog (Pokemon Base Set - singles + sealed)
 *  - ~50 inventory lines: singles across conditions + 8 sealed w/ cost basis
 *  - 2 reprice rules (singles peg / sealed margin-guarded)
 *  - 3 alerts (pct_change 7d>=20%, buylist_arb 85%, restock on a booster box)
 *  - 30 days of price snapshots + sales stats, then one alert-eval pass so
 *    the dashboard, charts, and alert feed demo instantly
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "./index";
import {
  alerts,
  expansions,
  games,
  inventoryItems,
  memberships,
  priceSnapshots,
  products,
  repriceRules,
  salesStats,
  stores,
  users,
  watchlistItems,
} from "./schema";
import { classifyProduct } from "@/lib/catalog/classifier";
import {
  FIXTURE_EXPANSIONS,
  FIXTURE_GAMES,
  FIXTURE_PRODUCTS,
  fixturePrice,
  fixtureSalesHistory,
} from "@/lib/tcgapis/fixtures";
import { runAlertEval } from "@/jobs/alert-eval";

const DAY = 86_400_000;
const DEMO_EMAIL = "demo@countertop.local";
const DEMO_STORE = "Countertop Demo Store";

async function seedCatalog() {
  await db
    .insert(games)
    .values(
      FIXTURE_GAMES.map((g) => ({
        categoryId: g.categoryId,
        name: g.name,
        displayName: g.displayName ?? g.name,
      }))
    )
    .onConflictDoNothing();

  await db
    .insert(expansions)
    .values(
      FIXTURE_EXPANSIONS.map((e) => ({
        groupId: e.groupId,
        categoryId: e.categoryId,
        name: e.name,
        abbreviation: e.abbreviation ?? null,
        publishedOn: e.publishedOn ? new Date(e.publishedOn) : null,
      }))
    )
    .onConflictDoNothing();

  const expByGroup = new Map(FIXTURE_EXPANSIONS.map((e) => [e.groupId, e]));
  await db
    .insert(products)
    .values(
      FIXTURE_PRODUCTS.map((p) => ({
        productId: p.productId,
        groupId: p.groupId,
        categoryId: expByGroup.get(p.groupId)!.categoryId,
        name: p.name,
        cleanName: p.cleanName ?? p.name,
        number: p.number ?? null,
        rarity: p.rarity ?? null,
        imageUrl: null,
        productType: classifyProduct({ name: p.name, number: p.number, rarity: p.rarity }),
      }))
    )
    .onConflictDoNothing();
  console.log(
    `✓ catalog: ${FIXTURE_PRODUCTS.length} products across ${FIXTURE_EXPANSIONS.length} set(s)`
  );
}

/** does this product carry the fixture "recent spike"? */
function hasSpike(productId: number): boolean {
  const now = fixturePrice(productId, "tcgplayer", "retail", new Date());
  const before = fixturePrice(productId, "tcgplayer", "retail", new Date(Date.now() - 10 * DAY));
  return now / before > 1.2;
}

async function main() {
  console.log("Seeding Countertop demo data…");
  await seedCatalog();

  // fresh demo store (idempotent re-seed)
  const existing = await db.select().from(stores).where(eq(stores.name, DEMO_STORE));
  if (existing.length > 0) {
    await db.delete(stores).where(eq(stores.name, DEMO_STORE));
    console.log("✓ removed previous demo store");
  }

  let [user] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email: DEMO_EMAIL, name: "Demo Owner", emailVerified: new Date() })
      .returning();
  }

  const [store] = await db
    .insert(stores)
    .values({
      name: DEMO_STORE,
      settings: {
        default_rounding: "psychological",
        email_alerts: true,
        snapshot_staleness_hours: 24,
      },
    })
    .returning();
  await db.insert(memberships).values({ userId: user.id, storeId: store.id, role: "owner" });
  console.log(`✓ store "${DEMO_STORE}" + user ${DEMO_EMAIL}`);

  // --- inventory ------------------------------------------------------------
  const byGroup = (groupId: number) => FIXTURE_PRODUCTS.filter((p) => p.groupId === groupId);
  const isSealed = (p: (typeof FIXTURE_PRODUCTS)[number]) =>
    classifyProduct({ name: p.name, number: p.number, rarity: p.rarity }) === "sealed";

  const pokeSingles = byGroup(604).filter((p) => !isSealed(p));
  const sealed = FIXTURE_PRODUCTS.filter(isSealed);

  // prefer products with the fixture spike so pct_change alerts demo
  const spiked = pokeSingles.filter((p) => hasSpike(p.productId));
  const pickSingles = [
    ...spiked.slice(0, 8),
    ...pokeSingles.filter((p) => !spiked.includes(p)).slice(0, 34),
  ].slice(0, 42);

  const conditions = ["Near Mint", "Near Mint", "Lightly Played", "Moderately Played", "Heavily Played"];
  const singleRows = pickSingles.map((p, i) => {
    const market = fixturePrice(p.productId, "tcgplayer", "retail");
    // deliberately misprice some lines so a reprice run shows real changes
    const drift = [1.0, 0.85, 1.2, 0.6, 1.05][i % 5];
    return {
      storeId: store.id,
      productId: p.productId,
      condition: conditions[i % conditions.length],
      printing: i % 7 === 3 ? "Foil" : null,
      language: "English",
      quantity: 1 + ((i * 3) % 12),
      currentPrice: Math.max(0.25, market * drift).toFixed(2),
      costBasis: i % 4 === 0 ? (market * 0.5).toFixed(2) : null,
      tags: i % 6 === 0 ? ["binder"] : i % 6 === 3 ? ["display-case"] : [],
    };
  });

  const sealedPicks = sealed.slice(0, 8);
  const sealedRows = sealedPicks.map((p, i) => {
    const market = fixturePrice(p.productId, "tcgplayer", "retail");
    return {
      storeId: store.id,
      productId: p.productId,
      condition: "Unopened",
      printing: null,
      language: "English",
      quantity: i === 0 ? 2 : 1 + (i % 5), // first sealed item runs low -> restock alert
      currentPrice: (market * [0.92, 1.0, 1.15, 0.8][i % 4]).toFixed(2),
      costBasis: (market * 0.82).toFixed(2), // distributor cost known for sealed
      tags: ["sealed-wall"],
    };
  });

  await db.insert(inventoryItems).values([...singleRows, ...sealedRows]);
  console.log(`✓ inventory: ${singleRows.length} singles + ${sealedRows.length} sealed`);

  // a couple of watchlist products (not stocked) for watchlist sweeps
  const inventoryIds = new Set(pickSingles.map((p) => p.productId));
  const watch = pokeSingles.filter((p) => !inventoryIds.has(p.productId)).slice(0, 3);
  await db
    .insert(watchlistItems)
    .values(watch.map((p) => ({ storeId: store.id, productId: p.productId })));

  // --- reprice rules -----------------------------------------------------------
  await db.insert(repriceRules).values([
    {
      storeId: store.id,
      name: "Singles: peg to TCG Market",
      priority: 10,
      active: true,
      scope: { product_type: ["single"] },
      basis: "tcg_market",
      multiplier: "1",
      offset: "0",
      floor: "0.25",
      minPrice: "0.25",
      maxChangePct: "40",
      rounding: "psychological",
      respectCostBasis: false,
      minMarginPct: "0",
    },
    {
      storeId: store.id,
      name: "Sealed: market ×1.05, min 15% margin over cost",
      priority: 1,
      active: true,
      scope: { product_type: ["sealed"] },
      basis: "tcg_market",
      multiplier: "1.05",
      offset: "0",
      minPrice: "0.25",
      rounding: "dollar",
      respectCostBasis: true,
      minMarginPct: "15",
    },
  ]);
  console.log("✓ reprice rules: singles peg + sealed margin guard");

  // --- alerts -------------------------------------------------------------------
  const restockTarget = sealedRows[0]; // qty 2 booster box
  const restockVelocity =
    fixtureSalesHistory(restockTarget.productId).statistics?.last24Hours?.count ?? 0;
  await db.insert(alerts).values([
    {
      storeId: store.id,
      name: "Inventory moved ≥20% in 7 days",
      type: "pct_change",
      config: { pct: 20, window: "7d", scope: "inventory" },
      cooldownHours: 24,
    },
    {
      storeId: store.id,
      name: "Buylist arbitrage (CK ≥ 85% of market)",
      type: "buylist_arb",
      config: { spread_pct: 85 },
      cooldownHours: 24,
    },
    {
      storeId: store.id,
      name: "Booster box selling fast & low stock",
      type: "restock_velocity",
      config: {
        product_id: restockTarget.productId,
        max_quantity: 3,
        min_market_sales_24h: Math.max(1, Math.min(restockVelocity, 5)),
      },
      cooldownHours: 24,
    },
  ]);
  console.log("✓ alerts: pct_change 7d, buylist_arb 85%, restock_velocity");

  // --- 30 days of price snapshots -------------------------------------------------
  const allSeededProducts = [
    ...new Set([
      ...singleRows.map((r) => r.productId),
      ...sealedRows.map((r) => r.productId),
      ...watch.map((p) => p.productId),
    ]),
  ];
  // re-seeds must not stack duplicate history
  await db.delete(priceSnapshots).where(inArray(priceSnapshots.productId, allSeededProducts));

  // Card Kingdom only buys Magic - buylist snapshots exist for category 1 only
  const magicGroups = new Set(
    FIXTURE_EXPANSIONS.filter((e) => e.categoryId === 1).map((e) => e.groupId)
  );
  const productGroup = new Map(FIXTURE_PRODUCTS.map((p) => [p.productId, p.groupId]));

  const snapshotValues: (typeof priceSnapshots.$inferInsert)[] = [];
  for (const productId of allSeededProducts) {
    const isMagic = magicGroups.has(productGroup.get(productId) ?? -1);
    for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
      const when = new Date(Date.now() - daysAgo * DAY);
      snapshotValues.push({
        productId,
        provider: "tcgplayer",
        listing: "retail",
        finish: "normal",
        price: fixturePrice(productId, "tcgplayer", "retail", when).toFixed(2),
        currency: "USD",
        capturedAt: when,
      });
      if (isMagic) {
        snapshotValues.push({
          productId,
          provider: "cardkingdom",
          listing: "buylist",
          finish: "normal",
          price: fixturePrice(productId, "cardkingdom", "buylist", when).toFixed(2),
          currency: "USD",
          capturedAt: when,
        });
      }
    }
  }
  for (let i = 0; i < snapshotValues.length; i += 1000) {
    await db.insert(priceSnapshots).values(snapshotValues.slice(i, i + 1000));
  }
  console.log(`✓ price snapshots: ${snapshotValues.length} rows over 30 days`);

  // --- sales stats ------------------------------------------------------------------
  const statsValues: (typeof salesStats.$inferInsert)[] = [];
  for (const productId of allSeededProducts) {
    const history = fixtureSalesHistory(productId);
    const count24 = history.statistics?.last24Hours?.count ?? 0;
    const market = fixturePrice(productId, "tcgplayer", "retail");
    for (const [window, mult] of [
      ["24h", 1],
      ["7d", 6],
      ["30d", 24],
    ] as const) {
      statsValues.push({
        productId,
        window,
        saleCount: count24 * mult,
        medianPrice: market.toFixed(2),
        avgPrice: (market * 1.01).toFixed(2),
        trend: history.priceAnalysis?.trend ?? "stable",
      });
    }
  }
  await db
    .insert(salesStats)
    .values(statsValues)
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
  console.log(`✓ sales stats for ${allSeededProducts.length} products`);

  // --- fire one evaluation pass so the alert feed demos immediately -----------------
  await runAlertEval({ productIds: allSeededProducts, source: "seed" });
  const fired = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sql`alert_events`);
  console.log(`✓ alert evaluation: ${fired[0].n} events in the feed`);

  console.log(`
Done! Start the app:
  pnpm dev        # web app  -> http://localhost:3000
  pnpm worker     # background jobs (sweeps, alerts, catalog sync)

Sign in with ${DEMO_EMAIL} - the magic link prints to the pnpm dev console.
`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
