/**
 * `pnpm seed` - demo data so the full loop works immediately, offline:
 *  - demo store + user (magic link logs to console)
 *  - fixture catalog (Pokemon Base Set - singles + sealed)
 *  - ~60 inventory lines: the holo case across conditions, playables, bulk,
 *    and a small sealed shelf, all with cost bases
 *  - 2 reprice rules (singles peg / sealed margin-guarded)
 *  - 3 alerts (pct_change 7d>=20%, Charizard threshold watch, restock on packs)
 *  - 30 days of price snapshots + sales stats, then one alert-eval pass so
 *    the dashboard, charts, and alert feed demo instantly
 */
import { pathToFileURL } from "node:url";
import { eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, pool } from "./index";
import {
  alertEvents,
  alerts,
  expansions,
  games,
  inventoryItems,
  memberships,
  priceSnapshots,
  products,
  repriceRules,
  salesStats,
  skus,
  stores,
  transactions,
  users,
  watchlistItems,
} from "./schema";
import { classifyProduct } from "@/lib/catalog/classifier";
import { suggestedStickerPrice } from "@/lib/sticker";
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

/** synthetic id band the offline fixture catalog allocates from */
const FIXTURE_ID_MIN = 42_300;
const FIXTURE_ID_MAX = 42_500;

/**
 * Remove catalog rows outside the MVP game set (e.g. the MTG demo data from
 * earlier versions) plus fixture products that have since been retired from
 * the bundled catalog, including everything hanging off them. Without this a
 * re-seed leaves ghosts behind: the upsert below only adds and updates.
 */
async function pruneOutOfScopeCatalog() {
  const keepCats = FIXTURE_GAMES.map((g) => g.categoryId);
  const fixtureIds = new Set(FIXTURE_PRODUCTS.map((p) => p.productId));
  const all = await db
    .select({ productId: products.productId, categoryId: products.categoryId })
    .from(products);
  const ids = all
    .filter(
      (p) =>
        !keepCats.includes(p.categoryId) ||
        (p.productId >= FIXTURE_ID_MIN &&
          p.productId <= FIXTURE_ID_MAX &&
          !fixtureIds.has(p.productId))
    )
    .map((p) => p.productId);
  if (ids.length === 0) return;

  await db.delete(alertEvents).where(inArray(alertEvents.productId, ids));
  await db.delete(watchlistItems).where(inArray(watchlistItems.productId, ids));
  await db.delete(priceSnapshots).where(inArray(priceSnapshots.productId, ids));
  await db.delete(salesStats).where(inArray(salesStats.productId, ids));
  // inventory delete cascades any reprice_run_items pointing at it
  await db.delete(inventoryItems).where(inArray(inventoryItems.productId, ids));
  await db.delete(skus).where(inArray(skus.productId, ids));
  await db.delete(products).where(inArray(products.productId, ids));
  await db.delete(expansions).where(notInArray(expansions.categoryId, keepCats));
  await db.delete(games).where(notInArray(games.categoryId, keepCats));
  console.log(`✓ pruned ${ids.length} retired/out-of-scope catalog products`);
}

async function seedCatalog() {
  await pruneOutOfScopeCatalog();
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
        imageUrl: p.image ?? null,
        productType: classifyProduct({ name: p.name, number: p.number, rarity: p.rarity }),
      }))
    )
    .onConflictDoUpdate({
      target: products.productId,
      set: {
        name: sql`excluded.name`,
        cleanName: sql`excluded.clean_name`,
        number: sql`excluded.number`,
        rarity: sql`excluded.rarity`,
        imageUrl: sql`excluded.image_url`,
        productType: sql`excluded.product_type`,
        updatedAt: sql`now()`,
      },
    });
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

/**
 * Rebuild the demo store from scratch. Exported so it can run from a server
 * route too — hosted demos have no terminal. `pnpm seed` passes closePool so
 * the CLI process can exit; the server route must NOT close the shared pool.
 */
export async function seedDemoData({ closePool = false } = {}) {
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

  // Hosted demos: SEED_OWNER_EMAIL=you@example.com pnpm seed
  // adds a real, magic-link-reachable owner to the demo store.
  const extraOwner = process.env.SEED_OWNER_EMAIL?.trim();
  if (extraOwner) {
    let [owner] = await db.select().from(users).where(eq(users.email, extraOwner));
    if (!owner) {
      [owner] = await db
        .insert(users)
        .values({ email: extraOwner, emailVerified: new Date() })
        .returning();
    }
    await db
      .insert(memberships)
      .values({ userId: owner.id, storeId: store.id, role: "owner" })
      .onConflictDoNothing();
    console.log(`✓ added ${extraOwner} as demo store owner`);
  }

  // --- inventory ------------------------------------------------------------
  // The demo store is a vintage counter: a Base Set singles case (the holo run
  // in a couple of conditions each, plus playables and bulk) and a small sealed
  // shelf. Quantities are hand-set rather than generated so the totals read
  // like a real LGS - nobody has ten Charizards, everybody has a stack of
  // Charmanders - and so no single line dominates the store's value.
  const byName = new Map(FIXTURE_PRODUCTS.map((p) => [p.name, p]));
  const isSealed = (p: (typeof FIXTURE_PRODUCTS)[number]) =>
    classifyProduct({ name: p.name, number: p.number, rarity: p.rarity }) === "sealed";
  const pokeSingles = FIXTURE_PRODUCTS.filter((p) => p.groupId === 604 && !isSealed(p));

  // Vintage condition ladder: played Base Set holos fall off NM harder than
  // modern cards do, and the shelf price has to show it.
  const CONDITION_FACTOR: Record<string, number> = {
    "Near Mint": 1,
    "Lightly Played": 0.78,
    "Moderately Played": 0.58,
    "Heavily Played": 0.4,
    Unopened: 1,
  };

  type SeedLine = {
    productId: number;
    condition: string;
    quantity: number;
    /** market -> shelf price (condition wear x this counter's local drift) */
    priceFactor: number;
    /** what the store paid, as a share of its own shelf price */
    costRatio: number | null;
    tags: string[];
  };

  // [name, NM qty, second condition, second qty] - the holo case
  const HOLO_CASE: Array<[string, number, string | null, number]> = [
    ["Charizard", 1, "Lightly Played", 1],
    ["Blastoise", 1, "Lightly Played", 2],
    ["Venusaur", 2, "Moderately Played", 2],
    ["Raichu", 2, "Lightly Played", 2],
    ["Chansey", 3, "Moderately Played", 2],
    ["Mewtwo", 3, "Lightly Played", 2],
    ["Zapdos", 3, "Heavily Played", 2],
    ["Alakazam", 4, "Moderately Played", 3],
    ["Gyarados", 3, "Lightly Played", 3],
    ["Nidoking", 3, null, 0],
    ["Ninetales", 4, "Lightly Played", 2],
    ["Clefairy", 4, null, 0],
    ["Hitmonchan", 4, "Moderately Played", 3],
    ["Poliwrath", 5, null, 0],
    ["Magneton", 5, "Lightly Played", 4],
    ["Machamp", 6, "Moderately Played", 4],
  ];

  // [name, condition, qty] - trainers, evolutions and bulk behind the case
  const PLAYABLES: Array<[string, string, number]> = [
    ["Computer Search", "Near Mint", 4],
    ["Item Finder", "Near Mint", 5],
    ["Professor Oak", "Lightly Played", 8],
    ["Pokemon Breeder", "Near Mint", 6],
    ["Pokemon Trader", "Near Mint", 5],
    ["Super Energy Removal", "Lightly Played", 7],
    ["Scoop Up", "Near Mint", 6],
    ["Lass", "Near Mint", 4],
    ["Dragonair", "Near Mint", 6],
    ["Electabuzz", "Near Mint", 8],
    ["Beedrill", "Moderately Played", 6],
    ["Pidgeotto", "Lightly Played", 9],
    ["Charmeleon", "Near Mint", 10],
    ["Ivysaur", "Near Mint", 8],
    ["Wartortle", "Near Mint", 8],
    ["Kadabra", "Lightly Played", 12],
    ["Magikarp", "Near Mint", 9],
    ["Jynx", "Near Mint", 7],
    ["Charmander", "Near Mint", 14],
    ["Bulbasaur", "Near Mint", 12],
    ["Squirtle", "Near Mint", 12],
    ["Pikachu", "Near Mint", 18],
    ["Double Colorless Energy", "Near Mint", 16],
    ["Water Energy", "Near Mint", 24],
  ];

  // [name, qty] - the sealed shelf. A $5.5k Base Set booster box is watched,
  // not stocked: one line that size swamps every chart the store looks at.
  const SEALED_SHELF: Array<[string, number]> = [
    ["Base Set Booster Pack", 6],
    ["Base Set Blackout Theme Deck", 3],
    ["Base Set Brushfire Theme Deck", 2],
    ["Base Set Overgrowth Theme Deck", 3],
    ["Base Set Zap Theme Deck", 2],
    ["Base Set 2-Player Starter Set", 2],
  ];

  // a little local mispricing so a reprice run has real work to show
  const LOCAL_DRIFT = [1.0, 0.96, 1.05, 0.92, 1.02];

  const singleLines: SeedLine[] = [];
  HOLO_CASE.forEach(([name, nmQty, altCondition, altQty], i) => {
    const p = byName.get(name);
    if (!p) return;
    singleLines.push({
      productId: p.productId,
      condition: "Near Mint",
      quantity: nmQty,
      priceFactor: LOCAL_DRIFT[i % LOCAL_DRIFT.length],
      costRatio: 0.5 + (i % 3) * 0.05, // bought over the counter at 50-60%
      tags: i % 4 === 0 ? ["display-case"] : ["binder"],
    });
    if (altCondition && altQty > 0) {
      singleLines.push({
        productId: p.productId,
        condition: altCondition,
        quantity: altQty,
        priceFactor:
          CONDITION_FACTOR[altCondition] * LOCAL_DRIFT[(i + 2) % LOCAL_DRIFT.length],
        costRatio: i % 3 === 0 ? null : 0.45 + (i % 4) * 0.05,
        tags: [],
      });
    }
  });
  PLAYABLES.forEach(([name, condition, quantity], i) => {
    const p = byName.get(name);
    if (!p) return;
    singleLines.push({
      productId: p.productId,
      condition,
      quantity,
      priceFactor: CONDITION_FACTOR[condition] * LOCAL_DRIFT[i % LOCAL_DRIFT.length],
      costRatio: i % 3 === 0 ? null : 0.5,
      tags: [],
    });
  });

  const sealedLines: SeedLine[] = SEALED_SHELF.map(([name, quantity], i) => {
    const p = byName.get(name)!;
    return {
      productId: p.productId,
      condition: "Unopened",
      quantity,
      priceFactor: [1.0, 1.04, 0.95, 1.0][i % 4],
      costRatio: 0.72 + (i % 3) * 0.05, // vintage sealed comes in at 72-82%
      tags: ["sealed-wall"],
    };
  });

  const allLines = [...singleLines, ...sealedLines];
  const lineRow = (line: SeedLine) => {
    const shelf = Math.max(0.25, fixturePrice(line.productId, "tcgplayer", "retail") * line.priceFactor);
    return {
      storeId: store.id,
      productId: line.productId,
      condition: line.condition,
      printing: null,
      language: "English",
      quantity: line.quantity,
      currentPrice: shelf.toFixed(2),
      costBasis: line.costRatio == null ? null : (shelf * line.costRatio).toFixed(2),
      tags: line.tags,
    };
  };
  // returning() preserves insertion order, so ids line up with allLines
  const insertedItems = await db
    .insert(inventoryItems)
    .values(allLines.map(lineRow))
    .returning({ id: inventoryItems.id });
  console.log(`✓ inventory: ${singleLines.length} single lines + ${sealedLines.length} sealed lines`);

  // shelf stickers as of ~2 weeks ago: items whose price has since moved show
  // up in the dashboard sticker queue; every 5th line never got a sticker
  const then = new Date(Date.now() - 14 * DAY);
  let stickered = 0;
  for (const [i, line] of allLines.entries()) {
    if (i % 5 === 4) continue; // needs a first sticker
    const sticker = suggestedStickerPrice(
      fixturePrice(line.productId, "tcgplayer", "retail", then) * line.priceFactor
    );
    if (sticker <= 0) continue;
    await db
      .update(inventoryItems)
      .set({ stickerPrice: sticker.toFixed(2), stickerUpdatedAt: then })
      .where(eq(inventoryItems.id, insertedItems[i].id));
    stickered++;
  }
  console.log(`✓ shelf stickers recorded for ${stickered} lines (2 weeks stale)`);

  // watchlist: the booster box the owner is deciding whether to buy, plus a
  // few singles they do not stock yet
  const stockedIds = new Set(allLines.map((l) => l.productId));
  const watch = [
    byName.get("Base Set Booster Box")!,
    ...pokeSingles.filter((p) => !stockedIds.has(p.productId)).slice(0, 3),
  ];
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
  const restockTarget = sealedLines[0]; // the sealed pack shelf
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
      name: "Charizard price watch",
      type: "threshold_cross",
      config: {
        product_id: 42304, // Base Set Charizard
        direction: "above",
        threshold:
          Math.ceil((fixturePrice(42304, "tcgplayer", "retail") * 1.1) / 10) * 10,
      },
      cooldownHours: 24,
    },
    {
      storeId: store.id,
      name: "Sealed packs selling fast & low stock",
      type: "restock_velocity",
      config: {
        product_id: restockTarget.productId,
        max_quantity: restockTarget.quantity + 2,
        min_market_sales_24h: Math.max(1, Math.min(restockVelocity, 5)),
      },
      cooldownHours: 24,
    },
  ]);
  console.log("✓ alerts: pct_change 7d, Charizard threshold watch, restock_velocity");
  console.log(
    `  (${new Set(allLines.filter((l) => hasSpike(l.productId)).map((l) => l.productId)).size} stocked products carry the fixture spike -> pct_change fires)`
  );

  // --- 30 days of price snapshots -------------------------------------------------
  const allSeededProducts = [
    ...new Set([
      ...allLines.map((l) => l.productId),
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

  // --- counter transactions: 2 weeks of realistic sales/buys -----------------
  // sold at roughly the line's shelf price (+/- a few %), bought over the
  // counter at 50-65% of it - this is the realized-price ledger the platform
  // builds on. Every ticket is a single card: that is how a counter works.
  const txValues: (typeof transactions.$inferInsert)[] = [];
  const sellable = [
    ...allLines.filter((_, i) => i % 3 === 0).slice(0, 16),
    ...sealedLines.slice(0, 3),
  ];
  sellable.forEach((line, i) => {
    const salesCount = 1 + (i % 3); // 1-3 sales per item over the window
    for (let s = 0; s < salesCount; s++) {
      const daysAgo = (i * 3 + s * 5) % 14;
      const when = new Date(Date.now() - daysAgo * DAY - (i % 12) * 3600_000);
      const shelf =
        fixturePrice(line.productId, "tcgplayer", "retail", when) * line.priceFactor;
      const realized = shelf * (0.96 + ((i + s) % 5) * 0.02); // 96-104% of shelf
      txValues.push({
        storeId: store.id,
        productId: line.productId,
        side: "sale",
        condition: line.condition,
        printing: null,
        language: "English",
        quantity: 1,
        unitPrice: Math.max(0.25, realized).toFixed(2),
        occurredAt: when,
        source: "seed",
        recordedBy: user.id,
      });
    }
    if (i % 4 === 0) {
      const when = new Date(Date.now() - ((i * 2) % 13) * DAY - 5 * 3600_000);
      const shelf =
        fixturePrice(line.productId, "tcgplayer", "retail", when) * line.priceFactor;
      txValues.push({
        storeId: store.id,
        productId: line.productId,
        side: "purchase",
        condition: line.condition,
        printing: null,
        language: "English",
        quantity: 1,
        unitPrice: Math.max(0.1, shelf * (0.5 + (i % 3) * 0.075)).toFixed(2),
        occurredAt: when,
        source: "seed",
        recordedBy: user.id,
      });
    }
  });
  await db.insert(transactions).values(txValues);
  console.log(
    `✓ counter ledger: ${txValues.filter((t) => t.side === "sale").length} sales + ${txValues.filter((t) => t.side === "purchase").length} buys over 2 weeks`
  );

  // --- fire one evaluation pass so the alert feed demos immediately -----------------
  await runAlertEval({ productIds: allSeededProducts, source: "seed" });
  const fired = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sql`alert_events`);
  console.log(`✓ alert evaluation: ${fired[0].n} events in the feed`);

  // headline totals, so a re-seed reports the same numbers the dashboard shows
  const [totals] = await db.execute<{
    lines: number;
    total_value: string;
    singles_value: string;
    sealed_value: string;
    top_line: string;
  }>(sql`
    select count(*)::int lines,
           round(sum(i.current_price * i.quantity), 2) total_value,
           round(sum(i.current_price * i.quantity)
             filter (where coalesce(p.product_type_override, p.product_type) = 'single'), 2) singles_value,
           round(sum(i.current_price * i.quantity)
             filter (where coalesce(p.product_type_override, p.product_type) = 'sealed'), 2) sealed_value,
           round(max(i.current_price * i.quantity), 2) top_line
    from inventory_items i
    join products p on p.product_id = i.product_id
    where i.store_id = ${store.id}
  `).then((r) => r.rows);
  const pct = (part: string) => ((Number(part) / Number(totals.total_value)) * 100).toFixed(1);
  console.log(
    `✓ store value: $${Number(totals.total_value).toLocaleString("en-US")} over ${totals.lines} lines` +
      ` — singles $${Number(totals.singles_value).toLocaleString("en-US")} (${pct(totals.singles_value)}%)` +
      ` / sealed $${Number(totals.sealed_value).toLocaleString("en-US")} (${pct(totals.sealed_value)}%)` +
      `, biggest line ${pct(totals.top_line)}% of value`
  );

  console.log(`
Done! Start the app:
  pnpm dev        # web app  -> http://localhost:3000
  pnpm worker     # background jobs (sweeps, alerts, catalog sync)

Sign in with ${DEMO_EMAIL} - the magic link prints to the pnpm dev console.
`);
  if (closePool) await pool.end();
}

// CLI entry (`pnpm seed`) only — importing this module from a route must not
// kick off a seed or tear down the shared connection pool.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  seedDemoData({ closePool: true }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
