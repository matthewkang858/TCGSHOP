/**
 * Repricing engine - pure functions, no I/O.
 *
 * Pipeline per item:
 *   1. raw   = basis * multiplier + offset
 *   2. clamp to [floor, ceiling]
 *   3. condition multiplier (product-level basis, non-NM singles only;
 *      sealed items and SKU-level bases skip this entirely)
 *   4. rounding mode
 *   5. guards: min_price, then cost-basis margin floor. Guards run AFTER
 *      rounding so no rounding mode can ever defeat them.
 *   6. max_change_pct check -> flag (never auto-apply a flagged row)
 */

export type Rounding = "psychological" | "quarter" | "dollar" | "cents";

export const DEFAULT_CONDITION_MULTIPLIERS: Record<string, number> = {
  "Near Mint": 1.0,
  "Lightly Played": 0.85,
  "Moderately Played": 0.7,
  "Heavily Played": 0.55,
  Damaged: 0.4,
};

export type EngineRule = {
  multiplier: number;
  offset: number;
  conditionMultipliers?: Record<string, number> | null;
  floor?: number | null;
  ceiling?: number | null;
  minPrice: number;
  maxChangePct?: number | null;
  rounding: Rounding;
  respectCostBasis: boolean;
  minMarginPct: number;
};

export type EngineItem = {
  productType: "single" | "sealed" | "other";
  condition: string;
  currentPrice?: number | null;
  costBasis?: number | null;
  /** resolved basis price for this item */
  basisValue: number;
  /** true when the basis already reflects the exact condition (SKU-level price) */
  basisIsSkuLevel?: boolean;
};

export type PriceResult = {
  newPrice: number;
  pctChange: number | null;
  flagged: boolean;
  flagReason: string | null;
  /** human-readable notes about guards that fired */
  guards: string[];
};

// epsilon guards the classic 1.005*100 === 100.4999… fp artifact (prices are non-negative)
const round2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;
/** ceil to cents - used for guard floors so we never undercut them */
const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;

export function applyRounding(price: number, mode: Rounding): number {
  if (!Number.isFinite(price)) return price;
  switch (mode) {
    case "cents":
      return round2(price);
    case "quarter":
      return round2(Math.round(price * 4) / 4);
    case "dollar":
      return Math.round(price);
    case "psychological": {
      // round UP to the next price ending in .49 or .99
      const cents = Math.round(price * 100);
      const dollars = Math.floor(cents / 100);
      const rem = cents - dollars * 100;
      if (rem <= 49) return dollars + 0.49;
      if (rem <= 99) return dollars + 0.99;
      return dollars + 1 + 0.49; // rem == 100 edge (fp)
    }
  }
}

export function conditionMultiplier(
  condition: string,
  overrides?: Record<string, number> | null
): number {
  const table = { ...DEFAULT_CONDITION_MULTIPLIERS, ...(overrides ?? {}) };
  return table[condition] ?? 1.0;
}

export function computePrice(rule: EngineRule, item: EngineItem): PriceResult {
  const guards: string[] = [];

  // 1. formula
  let price = item.basisValue * rule.multiplier + rule.offset;

  // 2. clamp
  if (rule.floor != null && price < rule.floor) {
    price = rule.floor;
    guards.push(`raised to floor $${rule.floor.toFixed(2)}`);
  }
  if (rule.ceiling != null && price > rule.ceiling) {
    price = rule.ceiling;
    guards.push(`capped at ceiling $${rule.ceiling.toFixed(2)}`);
  }

  // 3. condition multiplier - product-level basis, singles only, non-NM only
  const isSealed = item.productType === "sealed";
  if (!isSealed && !item.basisIsSkuLevel) {
    const mult = conditionMultiplier(item.condition, rule.conditionMultipliers);
    if (mult !== 1.0) {
      price *= mult;
      guards.push(`condition ×${mult}`);
    }
  }

  // 4. rounding
  price = applyRounding(price, rule.rounding);

  // 5. guards AFTER rounding - rounding must never defeat them
  if (price < rule.minPrice) {
    price = round2(rule.minPrice);
    guards.push(`raised to min price $${rule.minPrice.toFixed(2)}`);
  }
  if (rule.respectCostBasis && item.costBasis != null) {
    const marginFloor = ceil2(item.costBasis * (1 + rule.minMarginPct / 100));
    if (price < marginFloor) {
      price = marginFloor;
      guards.push(
        rule.minMarginPct > 0
          ? `raised to cost + ${rule.minMarginPct}% margin ($${marginFloor.toFixed(2)})`
          : `raised to cost basis ($${marginFloor.toFixed(2)})`
      );
    }
  }
  price = round2(price);

  // 6. change guard
  let pctChange: number | null = null;
  let flagged = false;
  let flagReason: string | null = null;
  if (item.currentPrice != null && item.currentPrice > 0) {
    pctChange = round2(((price - item.currentPrice) / item.currentPrice) * 100);
    if (rule.maxChangePct != null && Math.abs(pctChange) > rule.maxChangePct) {
      flagged = true;
      flagReason = `change ${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}% exceeds ±${rule.maxChangePct}% - needs manual approval`;
    }
  }

  return { newPrice: price, pctChange, flagged, flagReason, guards };
}

// --- rule scope matching -------------------------------------------------------

export type ScopeInput = {
  product_type?: ("single" | "sealed")[];
  category_ids?: number[];
  group_ids?: number[];
  rarity?: string[];
  price_min?: number;
  price_max?: number;
  tags?: string[];
  condition?: string[];
  printing?: "normal" | "foil";
};

export type ScopeItem = {
  productType: "single" | "sealed" | "other";
  categoryId: number;
  groupId: number;
  rarity?: string | null;
  condition: string;
  printing?: string | null;
  tags: string[];
  /** basis price used for the price-band check */
  basisValue?: number | null;
};

/**
 * All scope fields are AND-ed; arrays within a field are OR-ed
 * (e.g. product_type: [single, sealed] matches either).
 * Tag scope matches when the item carries ANY of the listed tags.
 */
export function ruleMatchesItem(scope: ScopeInput, item: ScopeItem): boolean {
  if (scope.product_type?.length) {
    if (!scope.product_type.includes(item.productType as "single" | "sealed")) return false;
  }
  if (scope.category_ids?.length && !scope.category_ids.includes(item.categoryId)) return false;
  if (scope.group_ids?.length && !scope.group_ids.includes(item.groupId)) return false;
  if (scope.rarity?.length) {
    if (!item.rarity || !scope.rarity.some((r) => r.toLowerCase() === item.rarity!.toLowerCase()))
      return false;
  }
  if (scope.price_min != null || scope.price_max != null) {
    if (item.basisValue == null) return false;
    if (scope.price_min != null && item.basisValue < scope.price_min) return false;
    if (scope.price_max != null && item.basisValue > scope.price_max) return false;
  }
  if (scope.tags?.length) {
    if (!scope.tags.some((t) => item.tags.includes(t))) return false;
  }
  if (scope.condition?.length) {
    if (!scope.condition.some((c) => c.toLowerCase() === item.condition.toLowerCase()))
      return false;
  }
  if (scope.printing) {
    const itemPrinting = item.printing?.toLowerCase() === "foil" ? "foil" : "normal";
    if (itemPrinting !== scope.printing) return false;
  }
  return true;
}

/**
 * First-match rule selection: rules must be pre-sorted by priority
 * (ascending - lower number wins). Returns the first whose scope matches.
 * `resolveBasis` supplies the per-rule basis value for the price-band check.
 */
export function selectRule<R extends { scope: ScopeInput }>(
  rules: R[],
  item: Omit<ScopeItem, "basisValue">,
  resolveBasis: (rule: R) => number | null
): { rule: R; basisValue: number | null } | null {
  for (const rule of rules) {
    const basisValue = resolveBasis(rule);
    if (ruleMatchesItem(rule.scope, { ...item, basisValue })) {
      return { rule, basisValue };
    }
  }
  return null;
}
