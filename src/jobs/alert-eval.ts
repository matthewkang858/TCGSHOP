import type PgBoss from "pg-boss";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  alertEvents,
  alerts,
  expansions,
  inventoryItems,
  memberships,
  products,
  salesStats,
  stores,
  users,
  watchlistItems,
  type AlertDelivered,
} from "@/db/schema";
import {
  evaluateAlert,
  shouldFire,
  type ProductPriceData,
  type StoreAlertContext,
} from "@/lib/alerts/evaluate";
import { sendDiscordAlert } from "@/lib/notify/discord";
import { sendEmail } from "@/lib/notify/email";
import { env } from "@/lib/env";
import { withJobRun } from "./job-run";
import { JOB } from "./names";

const inputSchema = z.object({
  productIds: z.array(z.number().int()).min(1),
  source: z.string().optional(),
});

const WINDOWS = { "24h": 1, "7d": 7, "30d": 30 } as const;

/** Bulk-load per-product price data (latest, prev, lookbacks, buylist, sales). */
async function loadPriceData(productIds: number[]): Promise<Map<number, ProductPriceData>> {
  const map = new Map<number, ProductPriceData>();
  for (const id of productIds) {
    map.set(id, {
      productId: id,
      market: null,
      prevMarket: null,
      marketAgo: { "24h": null, "7d": null, "30d": null },
      buylist: null,
      sales24h: null,
    });
  }
  const idsParam = sql.param(productIds);

  // latest + previous market snapshot per product
  const marketRows = await db.execute<{
    product_id: number;
    price: string;
    rn: string;
  }>(sql`
    select product_id, price, rn from (
      select product_id, price,
             row_number() over (partition by product_id order by captured_at desc) rn
      from price_snapshots
      where product_id = any(${idsParam}::int[])
        and provider = 'tcgplayer' and listing = 'retail'
    ) t where rn <= 2
  `);
  for (const row of marketRows.rows) {
    const d = map.get(row.product_id)!;
    if (Number(row.rn) === 1) d.market = Number(row.price);
    else d.prevMarket = Number(row.price);
  }

  // lookback baselines: closest snapshot at/before each cutoff
  for (const [window, days] of Object.entries(WINDOWS) as ["24h" | "7d" | "30d", number][]) {
    const rows = await db.execute<{ product_id: number; price: string }>(sql`
      select distinct on (product_id) product_id, price
      from price_snapshots
      where product_id = any(${idsParam}::int[])
        and provider = 'tcgplayer' and listing = 'retail'
        and captured_at <= now() - make_interval(days => ${days})
      order by product_id, captured_at desc
    `);
    for (const row of rows.rows) {
      map.get(row.product_id)!.marketAgo[window] = Number(row.price);
    }
  }

  // latest buylist
  const buylistRows = await db.execute<{ product_id: number; price: string }>(sql`
    select distinct on (product_id) product_id, price
    from price_snapshots
    where product_id = any(${idsParam}::int[])
      and provider = 'cardkingdom' and listing = 'buylist'
    order by product_id, captured_at desc
  `);
  for (const row of buylistRows.rows) {
    map.get(row.product_id)!.buylist = Number(row.price);
  }

  // 24h sales
  const salesRows = await db
    .select({ productId: salesStats.productId, saleCount: salesStats.saleCount })
    .from(salesStats)
    .where(and(inArray(salesStats.productId, productIds), eq(salesStats.window, "24h")));
  for (const row of salesRows) {
    map.get(row.productId)!.sales24h = row.saleCount;
  }

  return map;
}

async function loadStoreContexts(
  storeIds: string[]
): Promise<Map<string, StoreAlertContext>> {
  const ctxs = new Map<string, StoreAlertContext>();
  for (const id of storeIds) {
    ctxs.set(id, { watchlist: new Set(), inventoryQty: new Map() });
  }
  if (storeIds.length === 0) return ctxs;

  const watch = await db
    .select({ storeId: watchlistItems.storeId, productId: watchlistItems.productId })
    .from(watchlistItems)
    .where(inArray(watchlistItems.storeId, storeIds));
  for (const w of watch) ctxs.get(w.storeId)!.watchlist.add(w.productId);

  const inv = await db
    .select({
      storeId: inventoryItems.storeId,
      productId: inventoryItems.productId,
      qty: sql<number>`sum(${inventoryItems.quantity})::int`,
    })
    .from(inventoryItems)
    .where(inArray(inventoryItems.storeId, storeIds))
    .groupBy(inventoryItems.storeId, inventoryItems.productId);
  for (const i of inv) ctxs.get(i.storeId)!.inventoryQty.set(i.productId, i.qty);

  return ctxs;
}

export async function runAlertEval(rawInput: unknown): Promise<void> {
  const input = inputSchema.parse(rawInput);
  await withJobRun(JOB.ALERT_EVAL, async (stats) => {
    stats.source = input.source ?? "manual";
    stats.products = input.productIds.length;

    const activeAlerts = await db.select().from(alerts).where(eq(alerts.active, true));
    if (activeAlerts.length === 0) {
      stats.alerts = 0;
      return;
    }

    const storeIds = [...new Set(activeAlerts.map((a) => a.storeId))];
    const [priceData, storeCtxs] = await Promise.all([
      loadPriceData(input.productIds),
      loadStoreContexts(storeIds),
    ]);

    // last fired per (alert, product) for cooldown dedupe
    const lastFired = new Map<string, Date>();
    const firedRows = await db.execute<{
      alert_id: string;
      product_id: number;
      last: Date;
    }>(sql`
      select alert_id, product_id, max(fired_at) as last
      from alert_events
      where product_id = any(${sql.param(input.productIds)}::int[])
      group by alert_id, product_id
    `);
    for (const row of firedRows.rows) {
      lastFired.set(`${row.alert_id}|${row.product_id}`, new Date(row.last));
    }

    // product + store display metadata for deliveries
    const productMeta = await db
      .select({
        productId: products.productId,
        name: products.name,
        imageUrl: products.imageUrl,
        setName: expansions.name,
      })
      .from(products)
      .innerJoin(expansions, eq(expansions.groupId, products.groupId))
      .where(inArray(products.productId, input.productIds));
    const metaById = new Map(productMeta.map((p) => [p.productId, p]));

    const storeRows = await db.select().from(stores).where(inArray(stores.id, storeIds));
    const storeById = new Map(storeRows.map((s) => [s.id, s]));

    let firedCount = 0;
    for (const alert of activeAlerts) {
      const ctx = storeCtxs.get(alert.storeId)!;
      for (const productId of input.productIds) {
        const data = priceData.get(productId);
        if (!data) continue;

        const result = evaluateAlert(alert.type, alert.config, data, ctx);
        if (!result.fired) continue;

        const key = `${alert.id}|${productId}`;
        if (!shouldFire(lastFired.get(key) ?? null, alert.cooldownHours)) continue;

        const meta = metaById.get(productId);
        const store = storeById.get(alert.storeId);
        const payload = {
          ...result.payload,
          alert_type: alert.type,
          product_name: meta?.name ?? String(productId),
          set_name: meta?.setName ?? "",
        };

        // deliver: in-app always; discord + email per store settings
        const delivered: AlertDelivered = { in_app: true };
        const productUrl = `${env.APP_URL}/products/${productId}`;
        const oldPrice =
          typeof result.payload?.prev === "number"
            ? result.payload.prev
            : typeof result.payload?.base === "number"
              ? result.payload.base
              : null;
        const pctChange =
          typeof result.payload?.pct_change === "number" ? result.payload.pct_change : null;

        if (store?.settings.discord_webhook_url) {
          delivered.discord = await sendDiscordAlert(store.settings.discord_webhook_url, {
            alertName: alert.name,
            alertType: alert.type,
            productName: meta?.name ?? String(productId),
            setName: meta?.setName ?? "",
            imageUrl: meta?.imageUrl,
            oldPrice,
            newPrice: data.market,
            pctChange,
            detail: summarize(alert.type, result.payload ?? {}),
            productUrl,
          });
        }

        if (store?.settings.email_alerts) {
          const owners = await db
            .select({ email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(
              and(eq(memberships.storeId, alert.storeId), eq(memberships.role, "owner"))
            );
          if (owners.length > 0) {
            const res = await sendEmail({
              to: owners.map((o) => o.email).join(", "),
              subject: `[Countertop] ${alert.name}: ${meta?.name ?? productId}`,
              html: `<p><strong>${alert.name}</strong> fired for <strong>${meta?.name ?? productId}</strong> (${meta?.setName ?? ""}).</p><p>${summarize(alert.type, result.payload ?? {})}</p><p><a href="${productUrl}">View product</a></p>`,
              consoleFallback: `\n🔔 [alert-email:console] ${alert.name} -> ${meta?.name}: ${summarize(alert.type, result.payload ?? {})}\n`,
            });
            delivered.email = res;
          }
        }

        await db.insert(alertEvents).values({
          alertId: alert.id,
          productId,
          payload,
          delivered,
        });
        lastFired.set(key, new Date());
        firedCount++;
      }
    }
    stats.alerts = activeAlerts.length;
    stats.fired = firedCount;
  });
}

function summarize(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "threshold_cross":
      return `Price $${payload.market} crossed ${payload.direction} $${payload.threshold}`;
    case "pct_change":
      return `Moved ${payload.pct_change}% over ${payload.window} (from $${payload.base} to $${payload.market})`;
    case "velocity":
      return `${payload.sales_24h} sales in the last 24h (threshold ${payload.threshold})`;
    case "buylist_arb":
      return `CK buylist $${payload.buylist} is ${payload.spread_pct}% of market $${payload.market}`;
    case "restock_velocity":
      return `Only ${payload.quantity} left while the market sold ${payload.sales_24h} in 24h`;
    default:
      return JSON.stringify(payload);
  }
}

export async function registerAlertJobs(boss: PgBoss) {
  await boss.work(JOB.ALERT_EVAL, async ([job]) => {
    await runAlertEval(job.data);
  });
}
