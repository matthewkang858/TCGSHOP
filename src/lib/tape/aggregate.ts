/**
 * The tape: turning raw in-person trades into a credible price.
 *
 * Every function here is pure. The hard part is not averaging prices, it is
 * deciding which prices deserve to count. Our data is self-reported by
 * competing businesses, so the aggregation has to assume some of it is wrong
 * (fat fingers), some is unrepresentative (a bulk lot, a friend price), and
 * some may eventually be adversarial (a store inflating a card it holds).
 *
 * Four defenses, applied in order:
 *   1. sanity vs the marketplace reference — a $2,000 print on a $30 card is
 *      a typo or a lie, not a signal
 *   2. IQR outlier fences — trims the tails without assuming a distribution.
 *      Run twice: once over raw trades (catches typos) and once over
 *      per-store medians, one vote per store (catches a store whose whole
 *      price level is out of line with the market). Never narrower than a
 *      floor either side of the median, so a shop that is honestly cheaper
 *      is treated as a competitor rather than an error
 *   3. payment attestation — a trade backed by a processor charge id counts
 *      in full; a self-reported one counts at a discount, and defines nothing
 *   4. store-concentration capping — one store cannot dominate a bucket's
 *      weight no matter how many trades it reports
 * Then k-anonymity: nothing is published until enough distinct stores
 * contributed, which protects the stores and makes manipulation need
 * collusion rather than volume.
 *
 * On (2): the two-pass fence is what makes volume-based manipulation
 * expensive. A store reporting sixty inflated trades drowns out the raw
 * quartiles — its own prices become the middle of the distribution, so a raw
 * fence sees nothing wrong. Giving each store one vote strips that leverage:
 * to move the fence you now need more colluding businesses, not more rows.
 *
 * On (3): this is the defense that actually costs an attacker money. Anyone
 * can type a number into a form; producing a Stripe or Square charge id means
 * a card was really run for that amount, with processor fees and a chargeback
 * trail attached. So whenever a bucket has enough processor-attested trades to
 * describe a distribution, *those* trades define the fences and every
 * self-reported price is measured against them. Ten cash sales at triple the
 * market price no longer set their own standard — they get judged by the card
 * sales sitting next to them, and fall outside. Cash is not dismissed (it is a
 * real and large share of counter business), it just does not get to vouch for
 * itself.
 */

export type Trade = {
  transactionId: string;
  storeId: string;
  unitPrice: number;
  quantity: number;
  /**
   * True when a payment processor attested this amount (the transaction
   * carries a charge id), as opposed to a clerk typing in a cash sale.
   */
  verified: boolean;
};

export type ExclusionReason =
  | "price_outlier"
  | "store_outlier"
  | "implausible_vs_reference"
  | "non_positive_price";

export type Exclusion = {
  transactionId: string;
  unitPrice: number;
  reason: ExclusionReason;
  detail: string;
};

export type AggregationConfig = {
  /** a trade this many times above/below the reference is implausible */
  referenceUpperMultiple: number;
  referenceLowerMultiple: number;
  /** IQR fence multiplier (1.5 = Tukey's standard) */
  iqrMultiple: number;
  /** no single store may carry more than this share of bucket weight */
  maxStoreWeightShare: number;
  /** minimum distinct stores before an observation may be published */
  minStores: number;
  /** weight multiplier for a self-reported (unattested) trade */
  unverifiedWeight: number;
  /**
   * Fences never close tighter than this fraction either side of the median.
   *
   * Without a floor, tight agreement produces razor-thin fences: when honest
   * stores cluster within a few percent, the interquartile range is a few
   * percent, and a shop that is legitimately 15% cheaper lands outside. That
   * shop is not an outlier, it is a competitor - and excluding it would make
   * the tape describe the consensus rather than the market.
   */
  minFenceHalfWidth: number;
};

export const DEFAULT_CONFIG: AggregationConfig = {
  referenceUpperMultiple: 4,
  referenceLowerMultiple: 0.2,
  iqrMultiple: 1.5,
  maxStoreWeightShare: 0.5,
  minStores: 2,
  unverifiedWeight: 0.35,
  minFenceHalfWidth: 0.25,
};

export type Observation = {
  tradeCount: number;
  unitCount: number;
  storeCount: number;
  /** trades whose amount a payment processor attested */
  verifiedTradeCount: number;
  /** share of surviving units backed by a processor charge, 0-1 */
  verifiedShare: number;
  /** true when processor-attested trades defined this bucket's fences */
  fencedOnVerified: boolean;
  vwap: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  low: number | null;
  high: number | null;
  rawTradeCount: number;
  excluded: Exclusion[];
  /** true once storeCount >= minStores; below that the bucket stays private */
  publishable: boolean;
};

const round2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;
const round4 = (n: number) => Math.round(n * 10000 + 1e-9) / 10000;

/**
 * Below this many points there is no distribution to speak of, so the fences
 * would be measuring noise and throwing away real trades.
 */
const MIN_POINTS_FOR_FENCES = 4;

/** Linear-interpolated quantile over a sorted array. */
export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: number[]): number | null {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

/**
 * Tukey fences over a set of values, never narrower than `minHalfWidth` either
 * side of the median. Returns null when there are too few points, or when the
 * interquartile range is zero — a zero IQR would collapse the fences onto the
 * median and reject everything that is not exactly it.
 *
 * The floor is what keeps a tight-agreeing bucket from turning every honest
 * price difference into an outlier. It widens the fence, so it can only ever
 * let a trade through, never reject one.
 */
export function tukeyFence(
  values: number[],
  iqrMultiple: number,
  minHalfWidth = 0
): { low: number; high: number } | null {
  if (values.length < MIN_POINTS_FOR_FENCES) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25)!;
  const q3 = quantile(sorted, 0.75)!;
  const iqr = q3 - q1;
  if (iqr <= 0) return null;

  const med = quantile(sorted, 0.5)!;
  const floor = Math.abs(med) * minHalfWidth;
  return {
    low: Math.min(q1 - iqrMultiple * iqr, med - floor),
    high: Math.max(q3 + iqrMultiple * iqr, med + floor),
  };
}

/**
 * Collapse one day's trades for one sku identity into a single observation.
 * `reference` is the marketplace price used only for the plausibility gate;
 * pass null when we have no reference (the gate is then skipped).
 */
export function aggregateTrades(
  trades: Trade[],
  reference: number | null,
  config: AggregationConfig = DEFAULT_CONFIG
): Observation {
  const rawTradeCount = trades.length;
  const excluded: Exclusion[] = [];
  let surviving: Trade[] = [];

  // 1. structural sanity + plausibility against the marketplace reference
  for (const t of trades) {
    if (!(t.unitPrice > 0) || !Number.isFinite(t.unitPrice) || t.quantity <= 0) {
      excluded.push({
        transactionId: t.transactionId,
        unitPrice: t.unitPrice,
        reason: "non_positive_price",
        detail: `price ${t.unitPrice}, qty ${t.quantity}`,
      });
      continue;
    }
    if (reference !== null && reference > 0) {
      const ratio = t.unitPrice / reference;
      if (ratio > config.referenceUpperMultiple || ratio < config.referenceLowerMultiple) {
        excluded.push({
          transactionId: t.transactionId,
          unitPrice: t.unitPrice,
          reason: "implausible_vs_reference",
          detail: `${ratio.toFixed(2)}x reference ${reference.toFixed(2)}`,
        });
        continue;
      }
    }
    surviving.push(t);
  }

  // 2a. IQR fences over trades - catches typos and one-off odd prices.
  //
  // When enough attested trades exist, they alone define the fence and the
  // self-reported prices are judged against it. That is the whole point: a
  // clerk can type any number, but a charge id means a card was really run.
  // The attested sample must itself span more than one business, or a store
  // willing to eat processor fees on four fake cards could set the fence that
  // throws out everyone else's honest cash.
  const verifiedTrades = surviving.filter((t) => t.verified);
  const fencedOnVerified =
    verifiedTrades.length >= MIN_POINTS_FOR_FENCES &&
    new Set(verifiedTrades.map((t) => t.storeId)).size >= 2;
  const fenceSample = (fencedOnVerified ? verifiedTrades : surviving).map((t) => t.unitPrice);

  {
    const fence = tukeyFence(fenceSample, config.iqrMultiple, config.minFenceHalfWidth);
    if (fence) {
      const kept: Trade[] = [];
      for (const t of surviving) {
        if (t.unitPrice < fence.low || t.unitPrice > fence.high) {
          excluded.push({
            transactionId: t.transactionId,
            unitPrice: t.unitPrice,
            reason: "price_outlier",
            detail: `outside [${round2(fence.low)}, ${round2(fence.high)}]${
              fencedOnVerified ? " (card-verified fence)" : ""
            }`,
          });
        } else {
          kept.push(t);
        }
      }
      surviving = kept;
    }
  }

  // 2b. IQR fences over per-store medians - one vote per store, so a store
  // reporting sixty trades cannot bend the fence that judges it. When a
  // store's whole price level sits outside, all of its trades go.
  const medianByStore = storeMedians(surviving);
  if (medianByStore.size >= MIN_POINTS_FOR_FENCES) {
    const fence = tukeyFence(
      [...medianByStore.values()],
      config.iqrMultiple,
      config.minFenceHalfWidth
    );
    if (fence) {
      const kept: Trade[] = [];
      for (const t of surviving) {
        const storeMedian = medianByStore.get(t.storeId)!;
        if (storeMedian < fence.low || storeMedian > fence.high) {
          excluded.push({
            transactionId: t.transactionId,
            unitPrice: t.unitPrice,
            reason: "store_outlier",
            detail: `store median ${round2(storeMedian)} outside [${round2(
              fence.low
            )}, ${round2(fence.high)}]`,
          });
        } else {
          kept.push(t);
        }
      }
      surviving = kept;
    }
  }

  if (surviving.length === 0) {
    return {
      tradeCount: 0,
      unitCount: 0,
      storeCount: 0,
      verifiedTradeCount: 0,
      verifiedShare: 0,
      fencedOnVerified,
      vwap: null,
      median: null,
      p25: null,
      p75: null,
      low: null,
      high: null,
      rawTradeCount,
      excluded,
      publishable: false,
    };
  }

  // 3. store-concentration cap, then 4. attestation discount.
  //
  // Both act on weight rather than membership: the trades are real and stay in
  // the counts, they just do not all get an equal vote.
  //
  // The cap is computed on raw quantity, before the attestation discount, so
  // the two defenses stay orthogonal. Capping the discounted weight instead
  // would quietly undo the discount in thin buckets — a lone card sale facing
  // a lone cash sale would get pulled back toward an even split by the very
  // rule meant to stop one store dominating.
  const storeIds = [...new Set(surviving.map((t) => t.storeId))];
  const weightByStore = new Map<string, number>();
  for (const t of surviving) {
    weightByStore.set(t.storeId, (weightByStore.get(t.storeId) ?? 0) + t.quantity);
  }
  const totalWeight = [...weightByStore.values()].reduce((a, b) => a + b, 0);
  const scaleByStore = new Map<string, number>();
  if (storeIds.length > 1) {
    const cap = Math.max(config.maxStoreWeightShare, 1 / storeIds.length) * totalWeight;
    for (const [storeId, w] of weightByStore) {
      scaleByStore.set(storeId, w > cap ? cap / w : 1);
    }
  }

  let weightedSum = 0;
  let weightTotal = 0;
  let verifiedUnits = 0;
  let verifiedTradeCount = 0;
  for (const t of surviving) {
    const attestation = t.verified ? 1 : config.unverifiedWeight;
    const w = t.quantity * (scaleByStore.get(t.storeId) ?? 1) * attestation;
    weightedSum += t.unitPrice * w;
    weightTotal += w;
    if (t.verified) {
      verifiedUnits += t.quantity;
      verifiedTradeCount += 1;
    }
  }

  const prices = surviving.map((t) => t.unitPrice).sort((a, b) => a - b);
  const unitCount = surviving.reduce((sum, t) => sum + t.quantity, 0);

  return {
    tradeCount: surviving.length,
    unitCount,
    storeCount: storeIds.length,
    verifiedTradeCount,
    verifiedShare: unitCount > 0 ? round4(verifiedUnits / unitCount) : 0,
    fencedOnVerified,
    vwap: weightTotal > 0 ? round2(weightedSum / weightTotal) : null,
    median: round2(quantile(prices, 0.5)!),
    p25: round2(quantile(prices, 0.25)!),
    p75: round2(quantile(prices, 0.75)!),
    low: round2(prices[0]),
    high: round2(prices[prices.length - 1]),
    rawTradeCount,
    excluded,
    publishable: storeIds.length >= config.minStores,
  };
}

function storeMedians(trades: Trade[]): Map<string, number> {
  const pricesByStore = new Map<string, number[]>();
  for (const t of trades) {
    const list = pricesByStore.get(t.storeId);
    if (list) list.push(t.unitPrice);
    else pricesByStore.set(t.storeId, [t.unitPrice]);
  }
  const out = new Map<string, number>();
  for (const [storeId, prices] of pricesByStore) out.set(storeId, median(prices)!);
  return out;
}
