/**
 * Alert evaluation - pure functions, no I/O.
 * The alert-eval job feeds these with locally-snapshotted data.
 */

export type AlertType =
  | "threshold_cross"
  | "pct_change"
  | "velocity"
  | "buylist_arb"
  | "restock_velocity";

export type AlertConfig = {
  product_id?: number;
  direction?: "above" | "below";
  threshold?: number;
  pct?: number;
  window?: "24h" | "7d" | "30d";
  scope?: "watchlist" | "inventory";
  min_sales_24h?: number;
  spread_pct?: number;
  max_quantity?: number;
  min_market_sales_24h?: number;
};

export type ProductPriceData = {
  productId: number;
  /** latest tcgplayer retail snapshot */
  market: number | null;
  /** the snapshot immediately before the latest (for cross detection) */
  prevMarket: number | null;
  /** closest snapshot at/before each lookback window */
  marketAgo: { "24h": number | null; "7d": number | null; "30d": number | null };
  /** latest cardkingdom buylist snapshot */
  buylist: number | null;
  /** last-24h sale count from sales_stats */
  sales24h: number | null;
};

export type StoreAlertContext = {
  /** productIds on the store's watchlist */
  watchlist: Set<number>;
  /** productId -> total quantity in the store's inventory */
  inventoryQty: Map<number, number>;
};

export type FireResult = { fired: boolean; payload?: Record<string, unknown> };

const not = { fired: false } as const;

export function evaluateThresholdCross(
  config: AlertConfig,
  data: ProductPriceData
): FireResult {
  const { threshold, direction = "above", product_id } = config;
  if (threshold == null || product_id == null) return not;
  if (data.productId !== product_id) return not;
  if (data.market == null) return not;

  const beyond =
    direction === "above" ? data.market >= threshold : data.market <= threshold;
  if (!beyond) return not;

  // true cross when we know the previous price; first observation beyond the
  // threshold also fires (cooldown prevents repeats)
  if (data.prevMarket != null) {
    const prevBeyond =
      direction === "above" ? data.prevMarket >= threshold : data.prevMarket <= threshold;
    if (prevBeyond) return not;
  }

  return {
    fired: true,
    payload: {
      market: data.market,
      prev: data.prevMarket,
      threshold,
      direction,
    },
  };
}

export function evaluatePctChange(
  config: AlertConfig,
  data: ProductPriceData,
  ctx: StoreAlertContext
): FireResult {
  const { pct, window = "7d", scope = "inventory" } = config;
  if (pct == null) return not;
  if (scope === "watchlist" && !ctx.watchlist.has(data.productId)) return not;
  if (scope === "inventory" && !ctx.inventoryQty.has(data.productId)) return not;
  if (data.market == null) return not;
  const base = data.marketAgo[window];
  if (base == null || base <= 0) return not;

  const change = ((data.market - base) / base) * 100;
  if (Math.abs(change) < pct) return not;
  return {
    fired: true,
    payload: {
      market: data.market,
      base,
      window,
      pct_change: Math.round(change * 10) / 10,
    },
  };
}

export function evaluateVelocity(
  config: AlertConfig,
  data: ProductPriceData,
  ctx: StoreAlertContext
): FireResult {
  const { min_sales_24h, product_id } = config;
  if (min_sales_24h == null) return not;
  if (product_id != null && data.productId !== product_id) return not;
  if (product_id == null && !ctx.watchlist.has(data.productId)) return not;
  if (data.sales24h == null || data.sales24h < min_sales_24h) return not;
  return {
    fired: true,
    payload: { sales_24h: data.sales24h, threshold: min_sales_24h, market: data.market },
  };
}

export function evaluateBuylistArb(
  config: AlertConfig,
  data: ProductPriceData,
  ctx: StoreAlertContext
): FireResult {
  const { spread_pct } = config;
  if (spread_pct == null) return not;
  // relevant to products the store touches: inventory or watchlist
  if (!ctx.inventoryQty.has(data.productId) && !ctx.watchlist.has(data.productId)) return not;
  if (data.market == null || data.market <= 0 || data.buylist == null) return not;

  const ratio = (data.buylist / data.market) * 100;
  if (ratio < spread_pct) return not;
  return {
    fired: true,
    payload: {
      market: data.market,
      buylist: data.buylist,
      spread_pct: Math.round(ratio * 10) / 10,
      threshold: spread_pct,
    },
  };
}

export function evaluateRestockVelocity(
  config: AlertConfig,
  data: ProductPriceData,
  ctx: StoreAlertContext
): FireResult {
  const { max_quantity, min_market_sales_24h, product_id } = config;
  if (max_quantity == null || min_market_sales_24h == null) return not;
  if (product_id != null && data.productId !== product_id) return not;
  const qty = ctx.inventoryQty.get(data.productId);
  if (qty === undefined) return not; // not stocked at all - nothing to restock
  if (qty > max_quantity) return not;
  if (data.sales24h == null || data.sales24h < min_market_sales_24h) return not;
  return {
    fired: true,
    payload: {
      quantity: qty,
      max_quantity,
      sales_24h: data.sales24h,
      threshold: min_market_sales_24h,
      market: data.market,
    },
  };
}

export function evaluateAlert(
  type: AlertType,
  config: AlertConfig,
  data: ProductPriceData,
  ctx: StoreAlertContext
): FireResult {
  switch (type) {
    case "threshold_cross":
      return evaluateThresholdCross(config, data);
    case "pct_change":
      return evaluatePctChange(config, data, ctx);
    case "velocity":
      return evaluateVelocity(config, data, ctx);
    case "buylist_arb":
      return evaluateBuylistArb(config, data, ctx);
    case "restock_velocity":
      return evaluateRestockVelocity(config, data, ctx);
  }
}

/** Cooldown dedupe per (alert, product). */
export function shouldFire(
  lastFiredAt: Date | null,
  cooldownHours: number,
  now: Date = new Date()
): boolean {
  if (!lastFiredAt) return true;
  return now.getTime() - lastFiredAt.getTime() >= cooldownHours * 3600_000;
}
