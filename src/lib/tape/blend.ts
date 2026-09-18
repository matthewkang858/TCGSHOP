/**
 * The tape, part two: how much do we believe it, and what price do we publish?
 *
 * `aggregate.ts` turns one day's trades into one honest number. This file
 * answers the two questions that follow:
 *
 *   1. Over a rolling window, what is the street price? (recency- and
 *      volume-weighted, so a stale week does not outvote yesterday)
 *   2. How much of the published price should be ours vs the marketplace's?
 *
 * The second question is the whole product. A marketplace reference price is
 * always available and never wrong-by-much, but it only sees online sales. Our
 * street price sees the counter, which is where most of the volume actually
 * happens — but on a thin day it is three trades from two stores and deserves
 * almost no weight. So we do not choose between them: we blend continuously by
 * confidence. Thin data quietly becomes the reference price; thick data pulls
 * the published price toward what cards are really selling for.
 *
 * Confidence is a weighted geometric mean, not an average, so a weakness on
 * any single axis drags the whole score down. Ten trades from one store is not
 * a market price, and the geometric mean says so by returning zero.
 *
 * Every function here is pure.
 */

/** One day's aggregated bucket, as persisted in `market_observations`. */
export type DailyObservation = {
  /** days before `asOf`; 0 is the most recent day in the window */
  ageDays: number;
  vwap: number;
  tradeCount: number;
  unitCount: number;
  storeCount: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  /** share of the day's units backed by a processor charge, 0-1 */
  verifiedShare?: number;
};

export type BlendConfig = {
  /** a day's weight halves every this many days */
  halfLifeDays: number;
  /** trades at which the sample axis scores 0.5 */
  sampleHalf: number;
  /** stores beyond the first at which the breadth axis scores 0.5 */
  breadthHalf: number;
  /** relative IQR spread at which the agreement axis hits 0 */
  maxRelSpread: number;
  /** days since the newest trade at which the recency axis scores 0.5 */
  recencyHalfLifeDays: number;
  /** a day needs this many trades before its spread says anything */
  minTradesForSpread: number;
  /** assumed spread when no day in the window was thick enough to measure */
  unknownRelSpread: number;
  /** what an entirely self-reported window scores on the attestation axis */
  unverifiedFloor: number;
  /** confidence is capped here — we never fully abandon the reference */
  maxConfidence: number;
  /** |divergence| beyond this, at or above minSignalConfidence, is a signal */
  divergenceThresholdPct: number;
  minSignalConfidence: number;
};

export const DEFAULT_BLEND_CONFIG: BlendConfig = {
  halfLifeDays: 7,
  sampleHalf: 8,
  breadthHalf: 2,
  maxRelSpread: 0.6,
  recencyHalfLifeDays: 5,
  minTradesForSpread: 3,
  unknownRelSpread: 0.35,
  unverifiedFloor: 0.45,
  maxConfidence: 0.85,
  divergenceThresholdPct: 8,
  minSignalConfidence: 0.35,
};

export type ConfidenceInput = {
  tradeCount: number;
  storeCount: number;
  /** (p75 - p25) / median across the window; null when unmeasurable */
  relSpread: number | null;
  /** days since the most recent trade in the window */
  stalenessDays: number;
  /** share of units backed by a processor charge, 0-1 */
  verifiedShare?: number;
};

export type Confidence = {
  score: number;
  sample: number;
  breadth: number;
  agreement: number;
  recency: number;
  attestation: number;
};

export type StreetPrice = {
  streetPrice: number | null;
  sampleTrades: number;
  sampleUnits: number;
  sampleStores: number;
  relSpread: number | null;
  stalenessDays: number;
  verifiedShare: number;
  confidence: Confidence;
};

export type Blend = {
  streetPrice: number | null;
  referencePrice: number | null;
  blendedPrice: number | null;
  confidence: number;
  /** signed % the street sits above (+) or below (-) the reference */
  divergencePct: number | null;
  signal: "aligned" | "street_premium" | "street_discount" | "insufficient";
};

const round2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;
const round4 = (n: number) => Math.round(n * 10000 + 1e-9) / 10000;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Exponential decay: weight halves every `halfLife` days. */
export function recencyWeight(ageDays: number, halfLife: number): number {
  if (halfLife <= 0) return ageDays <= 0 ? 1 : 0;
  return Math.pow(0.5, Math.max(0, ageDays) / halfLife);
}

/**
 * Collapse a window of daily observations into one street price.
 *
 * Weight is volume × recency: a day with 12 units counts more than a day with
 * one, and last Tuesday counts less than yesterday. `distinctStores` must be
 * supplied by the caller when known, because distinct stores across a window
 * cannot be recovered from per-day counts (the same store trades on many
 * days). Without it we fall back to the single busiest day, which understates
 * breadth and therefore confidence — the safe direction to be wrong in.
 */
export function rollupWindow(
  days: DailyObservation[],
  opts: { distinctStores?: number; config?: BlendConfig } = {}
): StreetPrice {
  const config = opts.config ?? DEFAULT_BLEND_CONFIG;
  const usable = days.filter((d) => d.tradeCount > 0 && d.vwap > 0 && Number.isFinite(d.vwap));

  if (usable.length === 0) {
    const zero: Confidence = {
      score: 0,
      sample: 0,
      breadth: 0,
      agreement: 0,
      recency: 0,
      attestation: 0,
    };
    return {
      streetPrice: null,
      sampleTrades: 0,
      sampleUnits: 0,
      sampleStores: 0,
      relSpread: null,
      stalenessDays: Infinity,
      verifiedShare: 0,
      confidence: zero,
    };
  }

  let weightedSum = 0;
  let weightTotal = 0;
  let sampleTrades = 0;
  let sampleUnits = 0;
  let verifiedUnits = 0;
  let spreadSum = 0;
  let spreadWeight = 0;

  for (const d of usable) {
    const w = Math.max(1, d.unitCount) * recencyWeight(d.ageDays, config.halfLifeDays);
    weightedSum += d.vwap * w;
    weightTotal += w;
    sampleTrades += d.tradeCount;
    sampleUnits += d.unitCount;
    verifiedUnits += d.unitCount * (d.verifiedShare ?? 0);

    // Only thick days say anything about dispersion. A single-trade day has
    // p25 === p75 === median, which would read as perfect agreement.
    if (
      d.tradeCount >= config.minTradesForSpread &&
      d.p25 !== null &&
      d.p75 !== null &&
      d.median !== null &&
      d.median > 0
    ) {
      spreadSum += ((d.p75 - d.p25) / d.median) * w;
      spreadWeight += w;
    }
  }

  const sampleStores = opts.distinctStores ?? Math.max(...usable.map((d) => d.storeCount));
  const relSpread = spreadWeight > 0 ? round4(spreadSum / spreadWeight) : null;
  const stalenessDays = Math.min(...usable.map((d) => Math.max(0, d.ageDays)));
  const verifiedShare = sampleUnits > 0 ? round4(verifiedUnits / sampleUnits) : 0;

  const confidence = scoreConfidence(
    {
      tradeCount: sampleTrades,
      storeCount: sampleStores,
      relSpread,
      stalenessDays,
      verifiedShare,
    },
    config
  );

  return {
    streetPrice: weightTotal > 0 ? round2(weightedSum / weightTotal) : null,
    sampleTrades,
    sampleUnits,
    sampleStores,
    relSpread,
    stalenessDays,
    verifiedShare,
    confidence,
  };
}

/**
 * Score how much this street price deserves to move the published price.
 *
 * Five axes, each in [0,1], combined as a weighted geometric mean so that a
 * zero anywhere is fatal:
 *   sample      — are there enough trades to average?
 *   breadth     — did more than one business contribute? (one store scores 0)
 *   agreement   — do the trades agree with each other?
 *   recency     — did any of this happen recently?
 *   attestation — did a payment processor vouch for these amounts?
 *
 * Attestation has a floor rather than bottoming out at zero: cash is a real
 * and large share of counter business, so an all-cash window is worth less
 * than an all-card one but is not worthless. The floor is the difference
 * between "trust this less" and "ignore honest stores that take cash."
 *
 * The result is capped below 1: even a thick, broad, tight, fresh window keeps
 * some reference weight, because our sample is one slice of a national market.
 */
export function scoreConfidence(
  input: ConfidenceInput,
  config: BlendConfig = DEFAULT_BLEND_CONFIG
): Confidence {
  const trades = Math.max(0, input.tradeCount);
  const stores = Math.max(0, input.storeCount);

  const sample = trades <= 0 ? 0 : trades / (trades + config.sampleHalf);

  // Breadth measures stores *beyond the first*: a single store is a price
  // list, not a market, and scores exactly zero.
  const extraStores = Math.max(0, stores - 1);
  const breadth = extraStores <= 0 ? 0 : extraStores / (extraStores + config.breadthHalf);

  const spread = input.relSpread ?? config.unknownRelSpread;
  const agreement = clamp01(1 - Math.max(0, spread) / config.maxRelSpread);

  const recency = Number.isFinite(input.stalenessDays)
    ? recencyWeight(input.stalenessDays, config.recencyHalfLifeDays)
    : 0;

  const verifiedShare = clamp01(input.verifiedShare ?? 0);
  const attestation = config.unverifiedFloor + (1 - config.unverifiedFloor) * verifiedShare;

  const weights: Array<[number, number]> = [
    [sample, 0.25],
    [breadth, 0.28],
    [agreement, 0.2],
    [recency, 0.12],
    [attestation, 0.15],
  ];

  let score = 0;
  if (weights.every(([v]) => v > 0)) {
    // Geometric mean in log space; any zero short-circuits above to 0.
    const logSum = weights.reduce((acc, [v, w]) => acc + w * Math.log(v), 0);
    score = Math.exp(logSum);
  }

  return {
    score: round4(Math.min(config.maxConfidence, clamp01(score))),
    sample: round4(sample),
    breadth: round4(breadth),
    agreement: round4(agreement),
    recency: round4(recency),
    attestation: round4(attestation),
  };
}

/**
 * Blend the street price into the marketplace reference.
 *
 * blended = confidence × street + (1 − confidence) × reference
 *
 * With no reference we publish the street price as-is (there is nothing to
 * blend toward). With no street price we publish the reference. With neither,
 * nothing — the caller should leave the previous value standing rather than
 * write a null over a good price.
 */
export function blendPrices(
  street: number | null,
  reference: number | null,
  confidence: number,
  config: BlendConfig = DEFAULT_BLEND_CONFIG
): Blend {
  const c = clamp01(confidence);
  const hasStreet = street !== null && street > 0 && Number.isFinite(street);
  const hasReference = reference !== null && reference > 0 && Number.isFinite(reference);

  let blended: number | null = null;
  if (hasStreet && hasReference) blended = round2(c * street! + (1 - c) * reference!);
  else if (hasStreet) blended = round2(street!);
  else if (hasReference) blended = round2(reference!);

  const divergencePct =
    hasStreet && hasReference ? round2(((street! - reference!) / reference!) * 100) : null;

  let signal: Blend["signal"] = "insufficient";
  if (divergencePct !== null) {
    if (c < config.minSignalConfidence) signal = "insufficient";
    else if (divergencePct > config.divergenceThresholdPct) signal = "street_premium";
    else if (divergencePct < -config.divergenceThresholdPct) signal = "street_discount";
    else signal = "aligned";
  }

  return {
    streetPrice: hasStreet ? round2(street!) : null,
    referencePrice: hasReference ? round2(reference!) : null,
    blendedPrice: blended,
    confidence: round4(c),
    divergencePct,
    signal,
  };
}
