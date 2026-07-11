// Deterministic fixture data for offline dev mode (no TCGAPIS_API_KEY).
// Prices are a pure function of (productId, provider, listing, date) so
// repeated sweeps produce a coherent, drifting 30-day history.
import type {
  ApiSalesBucket,
  ApiSalesHistory,
  ApiTrendPrice,
  TrendListing,
  TrendProvider,
} from "../types";
import {
  FIXTURE_EXPANSIONS,
  FIXTURE_GAMES,
  FIXTURE_PRODUCTS,
} from "./catalog";

export { FIXTURE_EXPANSIONS, FIXTURE_GAMES, FIXTURE_PRODUCTS };

// --- deterministic PRNG helpers -------------------------------------------

function hash32(n: number): number {
  let x = n | 0;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = (x >>> 16) ^ x;
  return x >>> 0;
}

/** stable [0,1) for a product+salt */
function rand01(productId: number, salt: number): number {
  return hash32(productId * 2654435761 + salt * 97) / 0xffffffff;
}

// --- base price model ------------------------------------------------------

const SEALED_BASE: Array<[RegExp, number]> = [
  [/booster display case/i, 4200],
  [/booster box|booster display/i, 520],
  [/collector booster display/i, 240],
  [/collector booster pack/i, 22],
  [/booster pack/i, 5.5],
  [/bundle/i, 42],
  [/commander deck/i, 48],
  [/prerelease/i, 28],
  [/theme deck|starter/i, 180],
];

function isSealedName(name: string) {
  return SEALED_BASE.some(([re]) => re.test(name));
}

export function fixtureBasePrice(productId: number): number {
  const p = FIXTURE_PRODUCTS.find((x) => x.productId === productId);
  const r = rand01(productId, 1);
  if (!p) return 1 + r * 10;

  if (!p.number && !p.rarity && isSealedName(p.name)) {
    const [, base] = SEALED_BASE.find(([re]) => re.test(p.name))!;
    // vintage premium for the Pokemon Base Set wall
    const vintage = p.groupId === 604 ? 10 : 1;
    return base * vintage * (0.85 + r * 0.3);
  }

  switch (p.rarity) {
    case "Rare Holo":
      return 25 + r * 375; // Charizard territory at the top
    case "Mythic":
      return 8 + r * 32;
    case "Rare":
      return 1.5 + r * 12;
    case "Uncommon":
      return 0.4 + r * 2.5;
    default:
      return 0.15 + r * 1.2;
  }
}

const PROVIDER_FACTOR: Record<string, number> = {
  tcgplayer: 1.0,
  cardkingdom: 1.22,
  manapool: 0.97,
  cardhoarder: 0.45,
  cardmarket: 0.92,
};

const DAY_MS = 86_400_000;

/**
 * Price for a product on a given date.
 * - gentle sinusoidal drift (+/-6%)
 * - ~1 in 6 products gets a +30% spike over the last 5 days (demo pct_change alerts)
 * - buylist = retail * per-product ratio in [0.55, 0.95] (some cross the 85%
 *   arb threshold by design)
 */
export function fixturePrice(
  productId: number,
  provider: TrendProvider,
  listing: TrendListing,
  date: Date = new Date()
): number {
  const base = fixtureBasePrice(productId);
  const day = Math.floor(date.getTime() / DAY_MS);
  const phase = rand01(productId, 2) * Math.PI * 2;
  const drift = 1 + 0.06 * Math.sin(day / 5 + phase);

  // recent spike for a deterministic subset
  let spike = 1;
  if (hash32(productId) % 6 === 0) {
    const daysAgo = Math.floor(Date.now() / DAY_MS) - day;
    if (daysAgo <= 5) spike = 1.3;
  }

  let price = base * drift * spike * (PROVIDER_FACTOR[provider] ?? 1);

  if (listing === "buylist") {
    const ratio = 0.55 + rand01(productId, 3) * 0.4;
    price = price * ratio;
  }

  return Math.max(0.01, Math.round(price * 100) / 100);
}

export function fixtureTrendPrice(
  productId: number,
  provider: TrendProvider,
  listing: TrendListing,
  date: Date = new Date()
): ApiTrendPrice {
  return {
    productId,
    provider,
    listing,
    finish: "normal",
    price: fixturePrice(productId, provider, listing, date),
    currency: "USD",
    date: date.toISOString().slice(0, 10),
  };
}

// --- sales history ---------------------------------------------------------

export function fixtureSalesHistory(productId: number): ApiSalesHistory {
  const market = fixturePrice(productId, "tcgplayer", "retail");
  const velocity = Math.floor(rand01(productId, 4) * 40); // 0-39 sales/24h
  const sales = Array.from({ length: Math.min(velocity * 2 + 3, 100) }, (_, i) => ({
    price: Math.round(market * (0.92 + rand01(productId, 10 + i) * 0.16) * 100) / 100,
    quantity: 1 + (hash32(productId + i) % 3),
    condition: "Near Mint",
    variant: "Normal",
    orderDate: new Date(Date.now() - i * 3 * 3600_000).toISOString(),
  }));
  const trend =
    hash32(productId) % 6 === 0 ? "up" : hash32(productId) % 5 === 0 ? "down" : "stable";
  return {
    productId,
    sales,
    statistics: { last24Hours: { count: velocity, quantity: velocity } },
    priceAnalysis: { trend },
    variants: {
      "Near Mint|Normal": {
        avg: market,
        median: Math.round(market * 0.99 * 100) / 100,
        min: Math.round(market * 0.9 * 100) / 100,
        max: Math.round(market * 1.12 * 100) / 100,
        count: sales.length,
      },
    },
  };
}

export function fixtureFullSalesHistory(productId: number): ApiSalesBucket[] {
  const buckets: ApiSalesBucket[] = [];
  const today = Math.floor(Date.now() / DAY_MS);
  for (let i = 0; i < 30; i += 3) {
    const day = today - i;
    const date = new Date(day * DAY_MS);
    const market = fixturePrice(productId, "tcgplayer", "retail", date);
    const qty = Math.floor(rand01(productId, 20 + i) * 25);
    buckets.push({
      condition: "Near Mint",
      variant: "Normal",
      language: "English",
      bucketStart: date.toISOString().slice(0, 10),
      marketPrice: market,
      quantitySold: qty,
      lowSalePrice: Math.round(market * 0.9 * 100) / 100,
      highSalePrice: Math.round(market * 1.1 * 100) / 100,
      transactionCount: qty,
    });
  }
  return buckets;
}
