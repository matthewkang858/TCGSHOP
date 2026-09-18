/**
 * The contributing-store population behind the tape.
 *
 * The tape (`src/lib/tape/aggregate.ts`) is a cross-store dataset: with a
 * single store it has nothing to say and every defense it implements is
 * invisible. This module manufactures the rest of the market — eight more
 * shops, each with a character — plus 60 days of counter trades across all of
 * them (the demo store included), so the demo can watch each defense work:
 *
 *   honest spread      the five typical stores sit on price levels a few
 *                      percent apart and scatter ±9% per ticket around them.
 *                      Their trades are the distribution everything else gets
 *                      measured against.
 *   cash is not fraud  Cardboard Cantina takes 85% cash at honest prices. It
 *                      has to survive: attestation lowers a cash trade's
 *                      weight, it never revokes its right to be counted.
 *   cheap is not fraud Warehouse 9 runs ~13% under market on purpose. A shop
 *                      that is genuinely cheaper is signal, not noise, and the
 *                      store-median fence must not throw it out.
 *   manipulation       Sunset Vault Collectibles reports ~2.5x market, all
 *                      cash, at high volume, on four cards it is sitting on.
 *                      That is the one the aggregator has to catch.
 *
 * Everything here is deterministic. Volumes and prices come from a hash of
 * (store key, product, UTC day, draw), never `Math.random()`, so a re-seed
 * reproduces the same ledger row for row — every closed day is byte-identical,
 * and only the day still in progress grows as the clock does. The hash keys off
 * the store's stable slug rather than its row id, because the id is a fresh
 * uuid on every re-seed.
 *
 * Prices are anchored to the same offline fixture generator the rest of the
 * seed uses (`fixturePrice`), so a trade is always "the marketplace reference
 * for that day, times what this counter does to it" — condition wear, the
 * store's own price level, and a per-trade wiggle.
 *
 * Note on `printing`: every row is written with `printing: null`, matching the
 * demo store's inventory lines. Bucket identity in `market_observations` is
 * (product, condition, printing, language), so a stray printing label would
 * fork a card into two thin buckets that never reach k-anonymity and would
 * never join back to the store's own inventory. Base Set Unlimited is one
 * printing anyway; condition is where the real variation lives.
 *
 * Two notes for whoever writes `src/jobs/tape-aggregate.ts`:
 *   - these rows include over-the-counter buys (`side: "purchase"`, ~45-60% of
 *     retail, never card-attested because a shop pays out in cash or store
 *     credit). Those are buylist prices, not market prices, so the tape should
 *     read `side = 'sale'`.
 *   - a worn card really does sell for less, so an MP bucket here sits near 58%
 *     of the Near Mint marketplace price and an HP one near 40%. Whatever gets
 *     passed as `reference` wants the same condition adjustment, or every
 *     played bucket reads as a permanent `street_discount`.
 */
import type { transactions } from "./schema";
import { FIXTURE_PRODUCTS, fixturePrice } from "@/lib/tcgapis/fixtures";

type TapeTransaction = typeof transactions.$inferInsert;

const DAY = 86_400_000;

/** how many days of cross-store history to manufacture */
export const TAPE_DAYS = 60;

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export type StoreCharacter = "typical" | "cash_heavy" | "discount" | "adversarial";

/**
 * Share of tickets by tender; the four add up to 1. "other"/"unknown" are
 * left to hand-entered rows — `recordTransaction` defaults to "unknown",
 * because a clerk typing a ticket in afterwards often does not know.
 */
export type PaymentMix = {
  card: number;
  cash: number;
  store_credit: number;
  trade: number;
};

export type TapeStoreProfile = {
  /** stable slug — the PRNG hashes this, never the (random) store uuid */
  key: string;
  name: string;
  character: StoreCharacter;
  /** one line for the seed log, so the demo can narrate the population */
  blurb: string;
  /** systematic price level against the marketplace reference */
  priceBias: number;
  /** half-width of the per-trade band around that level */
  priceJitter: number;
  /** counter volume relative to a median shop */
  size: number;
  payments: PaymentMix;
  /** who issues this store's charge ids, when a ticket is run on a card */
  processor: "stripe" | "square";
};

const TYPICAL_PAYMENTS: PaymentMix = { card: 0.65, cash: 0.3, store_credit: 0.04, trade: 0.01 };

/**
 * Eight shops that exist only as data: rows in `stores` with no membership and
 * no inventory. They contribute trades and nothing else, which is exactly what
 * a contributing store is before it becomes a customer.
 */
export const CONTRIBUTING_STORES: TapeStoreProfile[] = [
  {
    key: "pinnacle-cards",
    name: "Pinnacle Cards & Comics",
    character: "typical",
    blurb: "busy suburban shop, prices on the marketplace reference",
    priceBias: 1.03,
    priceJitter: 0.09,
    size: 1.15,
    payments: TYPICAL_PAYMENTS,
    processor: "stripe",
  },
  {
    key: "rook-and-rally",
    name: "Rook & Rally Games",
    character: "typical",
    blurb: "play-space shop, singles move on event nights",
    priceBias: 0.97,
    priceJitter: 0.09,
    size: 0.95,
    payments: { card: 0.68, cash: 0.27, store_credit: 0.04, trade: 0.01 },
    processor: "stripe",
  },
  {
    key: "third-turn-games",
    name: "Third Turn Games",
    character: "typical",
    blurb: "small vintage counter, thin but steady volume",
    priceBias: 1.05,
    priceJitter: 0.09,
    size: 0.8,
    payments: { card: 0.62, cash: 0.32, store_credit: 0.05, trade: 0.01 },
    processor: "square",
  },
  {
    key: "fox-river-hobby",
    name: "Fox River Hobby",
    character: "typical",
    blurb: "mall storefront, heavy walk-in traffic",
    priceBias: 1.0,
    priceJitter: 0.09,
    size: 1.05,
    payments: TYPICAL_PAYMENTS,
    processor: "stripe",
  },
  {
    key: "bell-tower-games",
    name: "Bell Tower Games",
    character: "typical",
    blurb: "downtown shop, slightly under market to move stock",
    priceBias: 0.96,
    priceJitter: 0.09,
    size: 1.0,
    payments: { card: 0.6, cash: 0.34, store_credit: 0.05, trade: 0.01 },
    processor: "square",
  },
  {
    // The control for defense (3). Honest prices, almost no card attestation:
    // the tape must discount its weight without ever fencing it out.
    key: "cardboard-cantina",
    name: "Cardboard Cantina",
    character: "cash_heavy",
    blurb: "cash-first counter (85% cash) at honest prices",
    priceBias: 1.02,
    priceJitter: 0.09,
    size: 0.85,
    payments: { card: 0.12, cash: 0.85, store_credit: 0.02, trade: 0.01 },
    processor: "square",
  },
  {
    // The control for defense (2b). A whole price level below the market is
    // legitimate — high-volume, low-margin — and must not read as an outlier.
    key: "warehouse-nine",
    name: "Warehouse 9 Cards",
    character: "discount",
    blurb: "high-volume discounter, systematically ~13% under market",
    priceBias: 0.87,
    priceJitter: 0.06,
    size: 1.2,
    payments: { card: 0.7, cash: 0.26, store_credit: 0.03, trade: 0.01 },
    processor: "stripe",
  },
  {
    // The attacker. Honest everywhere except on the four cards it is long,
    // where it reports ~2.5x market, in cash, at twice its normal volume —
    // enough to be the loudest single reporter in every one of those buckets.
    key: "sunset-vault",
    name: "Sunset Vault Collectibles",
    character: "adversarial",
    blurb: "reports ~2.5x market, all cash, on four cards it holds deep",
    priceBias: 1.0,
    priceJitter: 0.07,
    size: 0.9,
    payments: { card: 0.2, cash: 0.75, store_credit: 0.04, trade: 0.01 },
    processor: "stripe",
  },
];

/** the demo store is a contributor too — its own trades feed the same tape */
export const DEMO_STORE_KEY = "countertop-demo";

const DEMO_STORE_PROFILE: TapeStoreProfile = {
  key: DEMO_STORE_KEY,
  name: "Countertop Demo Store",
  character: "typical",
  blurb: "the store the demo logs into",
  priceBias: 1.0,
  priceJitter: 0.09,
  size: 0.9,
  payments: { card: 0.62, cash: 0.3, store_credit: 0.05, trade: 0.03 },
  processor: "stripe",
};

const PROFILES_BY_KEY = new Map<string, TapeStoreProfile>(
  [...CONTRIBUTING_STORES, DEMO_STORE_PROFILE].map((s) => [s.key, s])
);

export const ADVERSARIAL_STORE = CONTRIBUTING_STORES.find(
  (s) => s.character === "adversarial"
)!;

/**
 * The four cards Sunset Vault is pumping — the ones the demo should point at.
 *
 * They are all liquid names it plausibly holds in depth, which is how price
 * manipulation actually works: you hide inside volume, because a lie nobody
 * else is trading against is just a weird number in your own ledger. It is also
 * what makes the catch demoable. Every defense in `aggregate.ts` needs a bucket
 * with points in it — the per-store-median fence needs four distinct stores in
 * the day, the card-verified fence needs four attested trades from two — and
 * these four cards clear that bar on most days:
 *
 *   Pikachu                  ~5.7 stores a day. Both fences form on nearly
 *                            every day: ~98% of the inflated trades are
 *                            excluded outright and the published price does
 *                            not move at all.
 *   Machamp, Professor Oak   ~4 stores a day, so the fences form on the busy
 *                            days and the exclusion audit fills up. ~70%
 *                            excluded; the leak moves the published price ~4-8%
 *                            instead of the ~150% the attacker was reaching for.
 *   Double Colorless Energy  the set's most-played uncommon and the thinnest of
 *                            the four (~3.8 stores/day): ~56% excluded, ~6%
 *                            residue. This is the honest edge of the defense —
 *                            fewer stores in the bucket, more leaks through.
 *
 * Deliberately NOT Charizard: at believable counter volume a $350 card trades
 * once or twice a day across the whole population, and a bucket that thin has
 * no distribution to fence against. Attacking it would have shown the tape
 * losing, which is a fine thing to know and a bad thing to demo. The honest
 * Charizard tape is its own lesson instead — thin, low-confidence, and
 * therefore published as the marketplace reference.
 */
export const ADVERSARIAL_TARGETS = [
  "Machamp",
  "Professor Oak",
  "Double Colorless Energy",
  "Pikachu",
] as const;

/** what the attacker multiplies the honest price by */
const ADVERSARY_MARKUP = 2.5;
/**
 * How much louder it trades those four cards than anything else. Twice its own
 * rate puts it ~2x above the busiest honest store in each of those buckets:
 * loud enough to drown the raw quartiles (which is the attack the two-pass
 * fence exists for), without being so loud that the thin days it does win
 * drag the published price somewhere silly.
 */
const ADVERSARY_VOLUME_MULTIPLE = 2;

// ---------------------------------------------------------------------------
// What actually crosses the counter
// ---------------------------------------------------------------------------

type Tier = "chase" | "holo" | "trainer" | "uncommon" | "common" | "sealed";

/**
 * The traded universe, as expected tickets per store per day for a
 * median-sized shop. Deliberately narrow: a 60-day window across nine stores
 * has a row budget, and a tape spread thin over 109 products is a tape with no
 * bucket thick enough to publish. These are the cards that actually move.
 */
const TRADE_RATES: Array<[name: string, tier: Tier, ratePerStoreDay: number]> = [
  // chase holos — a few times a week per store
  ["Charizard", "chase", 0.34],
  ["Blastoise", "chase", 0.26],
  ["Venusaur", "chase", 0.24],
  // the rest of the holo run
  // The most-printed Base Set holo by a distance — every starter deck had one —
  // so it is both the most-traded holo and a believable thing to be long on.
  ["Machamp", "holo", 1.35],
  ["Mewtwo", "holo", 0.3],
  ["Alakazam", "holo", 0.28],
  ["Magneton", "holo", 0.28],
  ["Zapdos", "holo", 0.26],
  ["Hitmonchan", "holo", 0.26],
  ["Gyarados", "holo", 0.24],
  ["Ninetales", "holo", 0.22],
  ["Chansey", "holo", 0.2],
  ["Raichu", "holo", 0.18],
  // trainers people actually play
  ["Professor Oak", "trainer", 1.25],
  ["Computer Search", "trainer", 0.35],
  ["Item Finder", "trainer", 0.3],
  ["Pokemon Breeder", "trainer", 0.28],
  ["Super Energy Removal", "trainer", 0.26],
  ["Pokemon Trader", "trainer", 0.26],
  // evolutions and staples out of the binder
  ["Double Colorless Energy", "uncommon", 1.0],
  ["Charmeleon", "uncommon", 0.5],
  ["Kadabra", "uncommon", 0.45],
  ["Magikarp", "uncommon", 0.3],
  ["Ivysaur", "uncommon", 0.38],
  ["Wartortle", "uncommon", 0.38],
  ["Jynx", "uncommon", 0.3],
  // bulk that leaves in handfuls, many times a day across the market
  ["Pikachu", "common", 2.0],
  ["Water Energy", "common", 0.85],
  ["Charmander", "common", 0.75],
  ["Bulbasaur", "common", 0.5],
  ["Squirtle", "common", 0.5],
  // sealed leaves in ones and twos
  ["Base Set Booster Pack", "sealed", 0.3],
  ["Base Set Blackout Theme Deck", "sealed", 0.08],
  ["Base Set Overgrowth Theme Deck", "sealed", 0.08],
  ["Base Set Zap Theme Deck", "sealed", 0.07],
  ["Base Set 2-Player Starter Set", "sealed", 0.06],
  ["Base Set Booster Box", "sealed", 0.012], // one changes hands every few months
];

/**
 * Global dial on the whole population's volume. Tuned so 60 days across nine
 * stores lands near 7.2k rows: thick enough that the busy buckets clear
 * k-anonymity every day and the fences have points to work with, small enough
 * that the whole seed inserts in a couple of seconds from a serverless route.
 */
const RATE_SCALE = 0.78;

/** Saturday is not Tuesday. */
const DOW_FACTOR = [1.5, 0.7, 0.75, 0.85, 0.9, 1.2, 1.7]; // Sun..Sat

/** counter hours, UTC — trades are stamped inside them and never after now */
const OPEN_HOUR = 11;
const CLOSE_HOUR = 20;

/**
 * The same vintage condition ladder the demo store's shelf uses: played Base
 * Set falls off Near Mint hard, and the realized price has to show it.
 */
const CONDITION_FACTOR: Record<string, number> = {
  "Near Mint": 1,
  "Lightly Played": 0.78,
  "Moderately Played": 0.58,
  "Heavily Played": 0.4,
  Unopened: 1,
};

type Weighted<T> = Array<[T, number]>;

/** what condition the card that just crossed the counter was in */
const CONDITION_MIX: Record<Tier, Weighted<string>> = {
  // four-figure-adjacent cards get picked over; the beaters still sell
  chase: [
    ["Near Mint", 0.5],
    ["Lightly Played", 0.28],
    ["Moderately Played", 0.16],
    ["Heavily Played", 0.06],
  ],
  holo: [
    ["Near Mint", 0.52],
    ["Lightly Played", 0.27],
    ["Moderately Played", 0.15],
    ["Heavily Played", 0.06],
  ],
  trainer: [
    ["Near Mint", 0.58],
    ["Lightly Played", 0.26],
    ["Moderately Played", 0.12],
    ["Heavily Played", 0.04],
  ],
  uncommon: [
    ["Near Mint", 0.6],
    ["Lightly Played", 0.25],
    ["Moderately Played", 0.11],
    ["Heavily Played", 0.04],
  ],
  common: [
    ["Near Mint", 0.62],
    ["Lightly Played", 0.24],
    ["Moderately Played", 0.1],
    ["Heavily Played", 0.04],
  ],
  sealed: [["Unopened", 1]],
};

/** one card at a time for the good stuff, playsets for bulk */
const QUANTITY_MIX: Record<Tier, Weighted<number>> = {
  chase: [[1, 1]],
  holo: [
    [1, 0.93],
    [2, 0.07],
  ],
  trainer: [
    [1, 0.72],
    [2, 0.18],
    [3, 0.06],
    [4, 0.04],
  ],
  uncommon: [
    [1, 0.66],
    [2, 0.2],
    [3, 0.08],
    [4, 0.06],
  ],
  common: [
    [1, 0.5],
    [2, 0.22],
    [3, 0.14],
    [4, 0.14],
  ],
  sealed: [
    [1, 0.88],
    [2, 0.12],
  ],
};

/** how often a ticket is the store buying rather than selling */
const PURCHASE_SHARE: Record<Tier, number> = {
  chase: 0.18,
  holo: 0.15,
  trainer: 0.08,
  uncommon: 0.07,
  common: 0.05,
  sealed: 0.06,
};

/** a counter buy pays this share of what the card sells for */
const BUY_RATIO = { min: 0.45, max: 0.62 };

/** stores pay out in cash or credit — a buy is never card-attested */
const PAYOUT_MIX: Weighted<PaymentTender> = [
  ["cash", 0.6],
  ["store_credit", 0.35],
  ["trade", 0.05],
];

/** the tenders a POS export actually labels; see PaymentMix on the other two */
type PaymentTender = "card" | "cash" | "store_credit" | "trade";

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** FNV-1a, then an avalanche pass so neighbouring keys do not correlate */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}

/** stable [0,1) for any tuple of identifiers */
function rand01(...parts: Array<string | number>): number {
  return hash32(parts.join("|")) / 0x1_0000_0000;
}

/**
 * Poisson draw by inverse CDF. Counter traffic is a counting process: some days
 * a card sells three times, most days not at all, and a fixed-rate rounding
 * would give every store the same flat rhythm.
 */
function poisson(lambda: number, u: number): number {
  if (lambda <= 0) return 0;
  let p = Math.exp(-lambda);
  let cumulative = p;
  let k = 0;
  while (u > cumulative && k < 24) {
    k += 1;
    p *= lambda / k;
    cumulative += p;
  }
  return k;
}

function weightedPick<T>(options: Weighted<T>, u: number): T {
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let threshold = u * total;
  for (const [value, weight] of options) {
    threshold -= weight;
    if (threshold <= 0) return value;
  }
  return options[options.length - 1][0];
}

/** a plausible processor charge id — see `transactions.paymentRef` */
function chargeId(processor: TapeStoreProfile["processor"], seed: string): string {
  const token =
    hash32(seed).toString(36).padStart(7, "0") + hash32(`${seed}|ref`).toString(36).padStart(7, "0");
  return processor === "square" ? `sq_seed_${token}` : `pi_seed_${token}`;
}

const round2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const PRODUCT_ID_BY_NAME = new Map(FIXTURE_PRODUCTS.map((p) => [p.name, p.productId]));

type TradedProduct = { productId: number; name: string; tier: Tier; rate: number };

const TRADED_PRODUCTS: TradedProduct[] = TRADE_RATES.flatMap(([name, tier, rate]) => {
  const productId = PRODUCT_ID_BY_NAME.get(name);
  return productId == null ? [] : [{ productId, name, tier, rate }];
});

const TARGET_PRODUCT_IDS = new Set(
  ADVERSARIAL_TARGETS.map((name) => PRODUCT_ID_BY_NAME.get(name)).filter(
    (id): id is number => id != null
  )
);

export type SeededStore = {
  /** matches a `TapeStoreProfile.key` */
  key: string;
  /** the row id the store was inserted with */
  id: string;
  /** contributing stores have no staff, so this is null for all but the demo */
  recordedBy?: string | null;
};

/**
 * 60 days of counter trades across every seeded store.
 *
 * Pure and deterministic given (`stores`, the calendar day): the only inputs
 * are store slugs, the fixture price curve, and hashes. Re-running on the same
 * day produces byte-identical rows, which is what makes the re-seed idempotent
 * rather than merely repeatable.
 */
export function generateTapeTransactions(
  stores: SeededStore[],
  opts: { days?: number; now?: Date } = {}
): TapeTransaction[] {
  const days = opts.days ?? TAPE_DAYS;
  const now = opts.now ?? new Date();
  const today = Math.floor(now.getTime() / DAY);
  const rows: TapeTransaction[] = [];

  for (const store of stores) {
    const profile = PROFILES_BY_KEY.get(store.key);
    if (!profile) continue;

    for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
      const epochDay = today - daysAgo;
      const dayStart = epochDay * DAY;
      // the counter has not opened yet today, so there is nothing to record
      if (now.getTime() - 60_000 <= dayStart + OPEN_HOUR * 3_600_000) continue;
      const dowFactor = DOW_FACTOR[new Date(dayStart).getUTCDay()];

      for (const product of TRADED_PRODUCTS) {
        const manipulated =
          profile.character === "adversarial" && TARGET_PRODUCT_IDS.has(product.productId);
        const lambda =
          product.rate *
          RATE_SCALE *
          profile.size *
          dowFactor *
          (manipulated ? ADVERSARY_VOLUME_MULTIPLE : 1);

        const tickets = poisson(lambda, rand01(profile.key, product.productId, epochDay, "n"));
        for (let k = 0; k < tickets; k++) {
          rows.push(
            buildTrade({ store, profile, product, epochDay, dayStart, k, manipulated, now })
          );
        }
      }
    }
  }

  return rows;
}

function buildTrade(args: {
  store: SeededStore;
  profile: TapeStoreProfile;
  product: TradedProduct;
  epochDay: number;
  dayStart: number;
  k: number;
  manipulated: boolean;
  now: Date;
}): TapeTransaction {
  const { store, profile, product, epochDay, dayStart, k, manipulated, now } = args;
  const seed = `${profile.key}|${product.productId}|${epochDay}|${k}`;
  const draw = (salt: string) => rand01(seed, salt);

  // Counter hours, 11:00 to 20:00 UTC, with two draws averaged so tickets pile
  // up mid-afternoon the way they really do rather than spreading flat. On the
  // day that is still running, the same shape is compressed into the hours that
  // have actually happened — nothing is ever stamped in the future.
  const open = dayStart + OPEN_HOUR * 3_600_000;
  const close = Math.min(dayStart + CLOSE_HOUR * 3_600_000, now.getTime() - 60_000);
  const clock = (draw("clock-a") + draw("clock-b")) / 2;
  const occurredAt = new Date(open + clock * (close - open));

  // The attacker only pumps its own sales; it buys like everybody else.
  const side: "sale" | "purchase" =
    !manipulated && draw("side") < PURCHASE_SHARE[product.tier] ? "purchase" : "sale";

  // It also always claims Near Mint — the lie goes where the money is, and it
  // keeps the inflated prints in the bucket real trades actually live in.
  const condition = manipulated
    ? "Near Mint"
    : weightedPick(CONDITION_MIX[product.tier], draw("condition"));
  // Fabricated tickets are always single cards: a made-up playset at 2.5x is a
  // number nobody would believe, and one card at a time is what a clerk types.
  const quantity = manipulated ? 1 : weightedPick(QUANTITY_MIX[product.tier], draw("quantity"));

  const reference = fixturePrice(product.productId, "tcgplayer", "retail", occurredAt);
  const wear = CONDITION_FACTOR[condition] ?? 1;
  const jitter = 1 + (draw("jitter") * 2 - 1) * profile.priceJitter;
  let unitPrice = reference * wear * profile.priceBias * jitter;
  if (manipulated) {
    // not a suspiciously exact multiple — a fabricated ledger still wobbles
    unitPrice *= ADVERSARY_MARKUP * (0.94 + draw("markup") * 0.12);
  }
  if (side === "purchase") {
    unitPrice *= BUY_RATIO.min + draw("buy") * (BUY_RATIO.max - BUY_RATIO.min);
  }

  const tender: PaymentTender = manipulated
    ? "cash" // nothing to explain to a processor later
    : side === "purchase"
      ? weightedPick(PAYOUT_MIX, draw("payout"))
      : weightedPick(
          [
            ["card", profile.payments.card],
            ["cash", profile.payments.cash],
            ["store_credit", profile.payments.store_credit],
            ["trade", profile.payments.trade],
          ] as Weighted<PaymentTender>,
          draw("tender")
        );

  // Attestation: a card ticket carries the processor's charge id, and that ref
  // — not the tender label — is what the tape counts as proof.
  const verified = tender === "card";

  return {
    storeId: store.id,
    productId: product.productId,
    side,
    condition,
    printing: null,
    language: "English",
    quantity,
    unitPrice: Math.max(0.25, round2(unitPrice)).toFixed(2),
    occurredAt,
    source: "seed",
    paymentMethod: tender,
    paymentRef: verified ? chargeId(profile.processor, seed) : null,
    paymentProcessor: verified ? profile.processor : null,
    recordedBy: store.recordedBy ?? null,
  };
}
