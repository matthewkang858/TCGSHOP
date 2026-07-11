import { describe, expect, it } from "vitest";
import {
  applyRounding,
  computePrice,
  conditionMultiplier,
  ruleMatchesItem,
  selectRule,
  type EngineItem,
  type EngineRule,
} from "./engine";

function rule(over: Partial<EngineRule> = {}): EngineRule {
  return {
    multiplier: 1,
    offset: 0,
    conditionMultipliers: null,
    floor: null,
    ceiling: null,
    minPrice: 0.25,
    maxChangePct: null,
    rounding: "cents",
    respectCostBasis: false,
    minMarginPct: 0,
    ...over,
  };
}

function item(over: Partial<EngineItem> = {}): EngineItem {
  return {
    productType: "single",
    condition: "Near Mint",
    currentPrice: null,
    costBasis: null,
    basisValue: 10,
    ...over,
  };
}

describe("applyRounding", () => {
  it("cents rounds to 2dp", () => {
    expect(applyRounding(1.005, "cents")).toBe(1.01);
    expect(applyRounding(1.004, "cents")).toBe(1.0);
  });

  it("quarter rounds to nearest .25 (half up)", () => {
    expect(applyRounding(1.12, "quarter")).toBe(1.0);
    expect(applyRounding(1.13, "quarter")).toBe(1.25);
    expect(applyRounding(1.125, "quarter")).toBe(1.25);
    expect(applyRounding(1.87, "quarter")).toBe(1.75);
    expect(applyRounding(1.88, "quarter")).toBe(2.0);
  });

  it("dollar rounds to nearest whole dollar (half up) - the sealed default", () => {
    expect(applyRounding(2.49, "dollar")).toBe(2);
    expect(applyRounding(2.5, "dollar")).toBe(3);
    expect(applyRounding(449.5, "dollar")).toBe(450);
    expect(applyRounding(0.4, "dollar")).toBe(0);
  });

  it("psychological rounds UP to the next .49/.99 ending", () => {
    expect(applyRounding(3.12, "psychological")).toBe(3.49);
    expect(applyRounding(3.49, "psychological")).toBe(3.49);
    expect(applyRounding(3.5, "psychological")).toBe(3.99);
    expect(applyRounding(3.99, "psychological")).toBe(3.99);
    expect(applyRounding(4.0, "psychological")).toBe(4.49);
    expect(applyRounding(0.1, "psychological")).toBe(0.49);
  });
});

describe("conditionMultiplier", () => {
  it("ships spec defaults", () => {
    expect(conditionMultiplier("Near Mint")).toBe(1.0);
    expect(conditionMultiplier("Lightly Played")).toBe(0.85);
    expect(conditionMultiplier("Moderately Played")).toBe(0.7);
    expect(conditionMultiplier("Heavily Played")).toBe(0.55);
    expect(conditionMultiplier("Damaged")).toBe(0.4);
  });
  it("rule overrides win; unknown conditions default to 1.0", () => {
    expect(conditionMultiplier("Lightly Played", { "Lightly Played": 0.9 })).toBe(0.9);
    expect(conditionMultiplier("Unopened")).toBe(1.0);
  });
});

describe("computePrice - formula", () => {
  it("applies multiplier and offset to the basis", () => {
    const r = computePrice(rule({ multiplier: 1.1, offset: 0.5 }), item({ basisValue: 10 }));
    expect(r.newPrice).toBe(11.5);
    expect(r.flagged).toBe(false);
  });

  it("clamps to floor before rounding", () => {
    const r = computePrice(rule({ multiplier: 0.5, floor: 8 }), item({ basisValue: 10 }));
    expect(r.newPrice).toBe(8);
    expect(r.guards.join()).toMatch(/floor/);
  });

  it("clamps to ceiling", () => {
    const r = computePrice(rule({ multiplier: 2, ceiling: 15 }), item({ basisValue: 10 }));
    expect(r.newPrice).toBe(15);
  });
});

describe("computePrice - condition multipliers", () => {
  it("applies the default LP multiplier to non-NM singles", () => {
    const r = computePrice(rule(), item({ condition: "Lightly Played", basisValue: 10 }));
    expect(r.newPrice).toBe(8.5);
  });

  it("NM singles pay full price", () => {
    const r = computePrice(rule(), item({ condition: "Near Mint", basisValue: 10 }));
    expect(r.newPrice).toBe(10);
  });

  it("SEALED items skip condition multipliers entirely", () => {
    const r = computePrice(
      rule(),
      item({ productType: "sealed", condition: "Unopened", basisValue: 100 })
    );
    expect(r.newPrice).toBe(100);
    // even a weird condition string on sealed must not trigger multipliers
    const r2 = computePrice(
      rule({ conditionMultipliers: { Damaged: 0.4 } }),
      item({ productType: "sealed", condition: "Damaged", basisValue: 100 })
    );
    expect(r2.newPrice).toBe(100);
  });

  it("SKU-level basis skips multipliers (price already condition-exact)", () => {
    const r = computePrice(
      rule(),
      item({ condition: "Heavily Played", basisValue: 4.2, basisIsSkuLevel: true })
    );
    expect(r.newPrice).toBe(4.2);
  });

  it("uses rule-specific multiplier overrides", () => {
    const r = computePrice(
      rule({ conditionMultipliers: { "Moderately Played": 0.5 } }),
      item({ condition: "Moderately Played", basisValue: 10 })
    );
    expect(r.newPrice).toBe(5);
  });
});

describe("computePrice - guards", () => {
  it("enforces min_price (default $0.25)", () => {
    const r = computePrice(rule(), item({ basisValue: 0.1 }));
    expect(r.newPrice).toBe(0.25);
    expect(r.guards.join()).toMatch(/min price/);
  });

  it("dollar rounding to $0 never defeats min_price", () => {
    const r = computePrice(rule({ rounding: "dollar" }), item({ basisValue: 0.4 }));
    expect(r.newPrice).toBe(0.25);
  });

  it("quarter rounding never defeats min_price", () => {
    const r = computePrice(rule({ rounding: "quarter", minPrice: 0.3 }), item({ basisValue: 0.2 }));
    expect(r.newPrice).toBe(0.3);
  });

  it("cost-basis floor with margin (the sealed guard)", () => {
    const r = computePrice(
      rule({ respectCostBasis: true, minMarginPct: 15, rounding: "dollar" }),
      item({ productType: "sealed", condition: "Unopened", basisValue: 80, costBasis: 90 })
    );
    // market dipped to 80 but the box cost 90 - floor is 90*1.15=103.5
    expect(r.newPrice).toBe(103.5);
    expect(r.guards.join()).toMatch(/margin/);
  });

  it("plain cost floor when min_margin_pct is 0", () => {
    const r = computePrice(
      rule({ respectCostBasis: true }),
      item({ basisValue: 5, costBasis: 7.5 })
    );
    expect(r.newPrice).toBe(7.5);
  });

  it("rounding never defeats the margin floor (dollar rounds below it)", () => {
    const r = computePrice(
      rule({ respectCostBasis: true, minMarginPct: 0, rounding: "dollar" }),
      item({ basisValue: 10.2, costBasis: 10.37 })
    );
    // dollar-rounded 10.00 < cost 10.37 -> guard lifts back to 10.37
    expect(r.newPrice).toBe(10.37);
  });

  it("margin floor is ceiled to the cent, never truncated below", () => {
    const r = computePrice(
      rule({ respectCostBasis: true, minMarginPct: 15 }),
      item({ basisValue: 1, costBasis: 3.33 })
    );
    // 3.33 * 1.15 = 3.8295 -> 3.83
    expect(r.newPrice).toBe(3.83);
  });

  it("no cost guard when respect_cost_basis is off or cost missing", () => {
    expect(
      computePrice(rule({ minMarginPct: 15 }), item({ basisValue: 5, costBasis: 90 })).newPrice
    ).toBe(5);
    expect(
      computePrice(rule({ respectCostBasis: true }), item({ basisValue: 5, costBasis: null }))
        .newPrice
    ).toBe(5);
  });
});

describe("computePrice - max_change_pct flagging", () => {
  it("flags increases beyond the cap instead of auto-applying", () => {
    const r = computePrice(
      rule({ maxChangePct: 40 }),
      item({ basisValue: 20, currentPrice: 10 })
    );
    expect(r.newPrice).toBe(20);
    expect(r.pctChange).toBe(100);
    expect(r.flagged).toBe(true);
    expect(r.flagReason).toMatch(/\+100.0% exceeds ±40%/);
  });

  it("flags decreases beyond the cap", () => {
    const r = computePrice(rule({ maxChangePct: 40 }), item({ basisValue: 5, currentPrice: 10 }));
    expect(r.pctChange).toBe(-50);
    expect(r.flagged).toBe(true);
  });

  it("does not flag changes inside the cap", () => {
    const r = computePrice(
      rule({ maxChangePct: 40 }),
      item({ basisValue: 13, currentPrice: 10 })
    );
    expect(r.flagged).toBe(false);
    expect(r.pctChange).toBe(30);
  });

  it("no flag when the item has no current price", () => {
    const r = computePrice(rule({ maxChangePct: 1 }), item({ basisValue: 99, currentPrice: null }));
    expect(r.flagged).toBe(false);
    expect(r.pctChange).toBeNull();
  });

  it("no flag when max_change_pct is unset", () => {
    const r = computePrice(rule(), item({ basisValue: 100, currentPrice: 1 }));
    expect(r.flagged).toBe(false);
    expect(r.pctChange).toBe(9900);
  });
});

describe("ruleMatchesItem - scope AND semantics", () => {
  const base = {
    productType: "single" as const,
    categoryId: 3,
    groupId: 604,
    rarity: "Rare Holo",
    condition: "Near Mint",
    printing: null,
    tags: ["binder"],
    basisValue: 50,
  };

  it("empty scope matches everything", () => {
    expect(ruleMatchesItem({}, base)).toBe(true);
  });

  it("product_type filter", () => {
    expect(ruleMatchesItem({ product_type: ["sealed"] }, base)).toBe(false);
    expect(ruleMatchesItem({ product_type: ["single", "sealed"] }, base)).toBe(true);
    expect(ruleMatchesItem({ product_type: ["sealed"] }, { ...base, productType: "sealed" })).toBe(
      true
    );
  });

  it("category/group/rarity filters", () => {
    expect(ruleMatchesItem({ category_ids: [1] }, base)).toBe(false);
    expect(ruleMatchesItem({ category_ids: [3], group_ids: [604] }, base)).toBe(true);
    expect(ruleMatchesItem({ rarity: ["rare holo"] }, base)).toBe(true);
    expect(ruleMatchesItem({ rarity: ["Common"] }, base)).toBe(false);
  });

  it("price band applies to the basis value", () => {
    expect(ruleMatchesItem({ price_min: 10, price_max: 100 }, base)).toBe(true);
    expect(ruleMatchesItem({ price_min: 60 }, base)).toBe(false);
    expect(ruleMatchesItem({ price_max: 40 }, base)).toBe(false);
    expect(ruleMatchesItem({ price_min: 1 }, { ...base, basisValue: null })).toBe(false);
  });

  it("tags match ANY listed tag; conditions OR within the array", () => {
    expect(ruleMatchesItem({ tags: ["binder", "display"] }, base)).toBe(true);
    expect(ruleMatchesItem({ tags: ["display"] }, base)).toBe(false);
    expect(ruleMatchesItem({ condition: ["Near Mint", "Lightly Played"] }, base)).toBe(true);
    expect(ruleMatchesItem({ condition: ["Damaged"] }, base)).toBe(false);
  });

  it("printing: null printing counts as normal", () => {
    expect(ruleMatchesItem({ printing: "normal" }, base)).toBe(true);
    expect(ruleMatchesItem({ printing: "foil" }, base)).toBe(false);
    expect(ruleMatchesItem({ printing: "foil" }, { ...base, printing: "Foil" })).toBe(true);
  });

  it("multiple scope fields AND together", () => {
    expect(
      ruleMatchesItem({ product_type: ["single"], category_ids: [3], tags: ["binder"] }, base)
    ).toBe(true);
    expect(
      ruleMatchesItem({ product_type: ["single"], category_ids: [3], tags: ["nope"] }, base)
    ).toBe(false);
  });
});

describe("selectRule - first match by priority", () => {
  const sealedRule = { id: "sealed", scope: { product_type: ["sealed"] as ("single" | "sealed")[] } };
  const catchAll = { id: "all", scope: {} };

  it("picks the first matching rule in priority order", () => {
    const sealed = {
      productType: "sealed" as const,
      categoryId: 3,
      groupId: 604,
      rarity: null,
      condition: "Unopened",
      printing: null,
      tags: [],
    };
    const picked = selectRule([sealedRule, catchAll], sealed, () => 100);
    expect(picked?.rule.id).toBe("sealed");

    const single = { ...sealed, productType: "single" as const, condition: "Near Mint" };
    expect(selectRule([sealedRule, catchAll], single, () => 100)?.rule.id).toBe("all");
  });

  it("skips rules whose basis cannot be resolved when a price band is set", () => {
    const banded = { id: "banded", scope: { price_min: 1 } };
    const single = {
      productType: "single" as const,
      categoryId: 3,
      groupId: 604,
      rarity: null,
      condition: "Near Mint",
      printing: null,
      tags: [],
    };
    const picked = selectRule([banded, catchAll], single, (r) =>
      r.id === "banded" ? null : 10
    );
    expect(picked?.rule.id).toBe("all");
  });

  it("returns null when nothing matches", () => {
    const single = {
      productType: "single" as const,
      categoryId: 1,
      groupId: 1,
      rarity: null,
      condition: "Near Mint",
      printing: null,
      tags: [],
    };
    expect(selectRule([sealedRule], single, () => 10)).toBeNull();
  });
});
