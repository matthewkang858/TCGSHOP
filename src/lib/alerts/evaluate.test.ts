import { describe, expect, it } from "vitest";
import {
  evaluateAlert,
  shouldFire,
  type ProductPriceData,
  type StoreAlertContext,
} from "./evaluate";

function data(over: Partial<ProductPriceData> = {}): ProductPriceData {
  return {
    productId: 42304,
    market: 100,
    prevMarket: 100,
    marketAgo: { "24h": 100, "7d": 100, "30d": 100 },
    buylist: 60,
    sales24h: 5,
    ...over,
  };
}

function ctx(over: Partial<StoreAlertContext> = {}): StoreAlertContext {
  return {
    watchlist: new Set([42304]),
    inventoryQty: new Map([[42304, 10]]),
    ...over,
  };
}

describe("threshold_cross", () => {
  const config = { product_id: 42304, direction: "above" as const, threshold: 120 };

  it("fires when price crosses above the threshold", () => {
    const r = evaluateAlert(
      "threshold_cross",
      config,
      data({ market: 125, prevMarket: 110 }),
      ctx()
    );
    expect(r.fired).toBe(true);
    expect(r.payload).toMatchObject({ market: 125, threshold: 120 });
  });

  it("does NOT fire when the price was already above (no cross)", () => {
    expect(
      evaluateAlert("threshold_cross", config, data({ market: 125, prevMarket: 130 }), ctx())
        .fired
    ).toBe(false);
  });

  it("fires on first observation beyond threshold (no previous snapshot)", () => {
    expect(
      evaluateAlert("threshold_cross", config, data({ market: 125, prevMarket: null }), ctx())
        .fired
    ).toBe(true);
  });

  it("below direction crosses downward", () => {
    const below = { product_id: 42304, direction: "below" as const, threshold: 80 };
    expect(
      evaluateAlert("threshold_cross", below, data({ market: 75, prevMarket: 90 }), ctx()).fired
    ).toBe(true);
    expect(
      evaluateAlert("threshold_cross", below, data({ market: 85, prevMarket: 90 }), ctx()).fired
    ).toBe(false);
  });

  it("ignores other products and missing data", () => {
    expect(
      evaluateAlert("threshold_cross", config, data({ productId: 1, market: 200 }), ctx()).fired
    ).toBe(false);
    expect(
      evaluateAlert("threshold_cross", config, data({ market: null }), ctx()).fired
    ).toBe(false);
  });
});

describe("pct_change", () => {
  it("fires on a rise >= pct over the window", () => {
    const r = evaluateAlert(
      "pct_change",
      { pct: 20, window: "7d", scope: "inventory" },
      data({ market: 130, marketAgo: { "24h": 128, "7d": 100, "30d": 90 } }),
      ctx()
    );
    expect(r.fired).toBe(true);
    expect(r.payload).toMatchObject({ pct_change: 30, window: "7d" });
  });

  it("fires on drops too (absolute change)", () => {
    expect(
      evaluateAlert(
        "pct_change",
        { pct: 20, window: "7d", scope: "inventory" },
        data({ market: 75, marketAgo: { "24h": 76, "7d": 100, "30d": 100 } }),
        ctx()
      ).fired
    ).toBe(true);
  });

  it("stays quiet under the threshold", () => {
    expect(
      evaluateAlert(
        "pct_change",
        { pct: 20, window: "7d", scope: "inventory" },
        data({ market: 115, marketAgo: { "24h": 114, "7d": 100, "30d": 100 } }),
        ctx()
      ).fired
    ).toBe(false);
  });

  it("respects scope: watchlist-only alerts skip non-watchlist products", () => {
    const c = ctx({ watchlist: new Set() });
    expect(
      evaluateAlert(
        "pct_change",
        { pct: 20, window: "7d", scope: "watchlist" },
        data({ market: 200 }),
        c
      ).fired
    ).toBe(false);
  });

  it("inventory scope skips products the store doesn't stock", () => {
    const c = ctx({ inventoryQty: new Map() });
    expect(
      evaluateAlert(
        "pct_change",
        { pct: 20, window: "7d", scope: "inventory" },
        data({ market: 200 }),
        c
      ).fired
    ).toBe(false);
  });

  it("needs a baseline snapshot", () => {
    expect(
      evaluateAlert(
        "pct_change",
        { pct: 20, window: "30d", scope: "inventory" },
        data({ marketAgo: { "24h": 1, "7d": 1, "30d": null } }),
        ctx()
      ).fired
    ).toBe(false);
  });
});

describe("velocity", () => {
  it("fires when 24h sales meet the minimum", () => {
    const r = evaluateAlert(
      "velocity",
      { min_sales_24h: 10 },
      data({ sales24h: 14 }),
      ctx()
    );
    expect(r.fired).toBe(true);
    expect(r.payload).toMatchObject({ sales_24h: 14 });
  });

  it("scopes to the watchlist when no product pinned", () => {
    expect(
      evaluateAlert(
        "velocity",
        { min_sales_24h: 10 },
        data({ sales24h: 20 }),
        ctx({ watchlist: new Set() })
      ).fired
    ).toBe(false);
  });

  it("pins to a specific product when configured", () => {
    expect(
      evaluateAlert(
        "velocity",
        { min_sales_24h: 10, product_id: 999 },
        data({ sales24h: 20 }),
        ctx()
      ).fired
    ).toBe(false);
  });
});

describe("buylist_arb", () => {
  it("fires when buylist reaches the spread threshold", () => {
    const r = evaluateAlert(
      "buylist_arb",
      { spread_pct: 85 },
      data({ market: 100, buylist: 88 }),
      ctx()
    );
    expect(r.fired).toBe(true);
    expect(r.payload).toMatchObject({ spread_pct: 88 });
  });

  it("stays quiet below the spread", () => {
    expect(
      evaluateAlert("buylist_arb", { spread_pct: 85 }, data({ market: 100, buylist: 60 }), ctx())
        .fired
    ).toBe(false);
  });

  it("only considers products the store stocks or watches", () => {
    const c = ctx({ watchlist: new Set(), inventoryQty: new Map() });
    expect(
      evaluateAlert("buylist_arb", { spread_pct: 85 }, data({ buylist: 99 }), c).fired
    ).toBe(false);
  });
});

describe("restock_velocity", () => {
  it("fires when stock is low and the market is moving", () => {
    const r = evaluateAlert(
      "restock_velocity",
      { max_quantity: 2, min_market_sales_24h: 10 },
      data({ sales24h: 15 }),
      ctx({ inventoryQty: new Map([[42304, 1]]) })
    );
    expect(r.fired).toBe(true);
    expect(r.payload).toMatchObject({ quantity: 1, sales_24h: 15 });
  });

  it("quiet when stock is healthy", () => {
    expect(
      evaluateAlert(
        "restock_velocity",
        { max_quantity: 2, min_market_sales_24h: 10 },
        data({ sales24h: 15 }),
        ctx({ inventoryQty: new Map([[42304, 12]]) })
      ).fired
    ).toBe(false);
  });

  it("quiet when the market isn't moving", () => {
    expect(
      evaluateAlert(
        "restock_velocity",
        { max_quantity: 2, min_market_sales_24h: 10 },
        data({ sales24h: 3 }),
        ctx({ inventoryQty: new Map([[42304, 1]]) })
      ).fired
    ).toBe(false);
  });

  it("quiet for products not stocked at all", () => {
    expect(
      evaluateAlert(
        "restock_velocity",
        { max_quantity: 2, min_market_sales_24h: 10 },
        data({ sales24h: 15 }),
        ctx({ inventoryQty: new Map() })
      ).fired
    ).toBe(false);
  });
});

describe("shouldFire cooldown", () => {
  const now = new Date("2026-07-11T12:00:00Z");
  it("fires when never fired before", () => {
    expect(shouldFire(null, 24, now)).toBe(true);
  });
  it("suppresses within the cooldown", () => {
    expect(shouldFire(new Date("2026-07-11T00:00:00Z"), 24, now)).toBe(false);
  });
  it("fires again once the cooldown elapses", () => {
    expect(shouldFire(new Date("2026-07-10T11:00:00Z"), 24, now)).toBe(true);
    expect(shouldFire(new Date("2026-07-10T12:00:00Z"), 24, now)).toBe(true);
  });
});
