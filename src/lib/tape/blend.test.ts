import { describe, expect, it } from "vitest";
import {
  blendPrices,
  DEFAULT_BLEND_CONFIG,
  recencyWeight,
  rollupWindow,
  scoreConfidence,
  type DailyObservation,
} from "./blend";

function day(partial: Partial<DailyObservation> & { ageDays: number; vwap: number }): DailyObservation {
  const { tradeCount = 1, unitCount = 1, storeCount = 1, vwap } = partial;
  return {
    ageDays: partial.ageDays,
    vwap,
    tradeCount,
    unitCount,
    storeCount,
    median: partial.median ?? vwap,
    p25: partial.p25 ?? vwap,
    p75: partial.p75 ?? vwap,
    verifiedShare: partial.verifiedShare,
  };
}

/** A window thick enough that confidence is not the thing under test. */
const thick = (ageDays: number, vwap: number, unitCount = 4) =>
  day({ ageDays, vwap, tradeCount: 4, unitCount, storeCount: 4, p25: vwap * 0.97, p75: vwap * 1.03 });

describe("recencyWeight", () => {
  it("halves every half-life", () => {
    expect(recencyWeight(0, 7)).toBe(1);
    expect(recencyWeight(7, 7)).toBeCloseTo(0.5, 10);
    expect(recencyWeight(14, 7)).toBeCloseTo(0.25, 10);
  });
  it("treats future and same-day alike", () => {
    expect(recencyWeight(-3, 7)).toBe(1);
  });
});

describe("scoreConfidence", () => {
  it("scores a single store at zero no matter how much it traded", () => {
    const c = scoreConfidence({
      tradeCount: 500,
      storeCount: 1,
      relSpread: 0.01,
      stalenessDays: 0,
    });
    expect(c.breadth).toBe(0);
    expect(c.score).toBe(0);
  });

  it("scores an empty window at zero", () => {
    expect(
      scoreConfidence({ tradeCount: 0, storeCount: 5, relSpread: null, stalenessDays: 0 }).score
    ).toBe(0);
    expect(
      scoreConfidence({ tradeCount: 5, storeCount: 5, relSpread: 0.1, stalenessDays: Infinity })
        .score
    ).toBe(0);
  });

  it("caps below certainty even for a perfect window", () => {
    const c = scoreConfidence({
      tradeCount: 200,
      storeCount: 10,
      relSpread: 0.05,
      stalenessDays: 0,
      verifiedShare: 1,
    });
    expect(c.score).toBe(DEFAULT_BLEND_CONFIG.maxConfidence);
  });

  it("rises with the share of card-verified volume", () => {
    const at = (verifiedShare: number) =>
      scoreConfidence({
        tradeCount: 20,
        storeCount: 4,
        relSpread: 0.2,
        stalenessDays: 0,
        verifiedShare,
      }).score;
    expect(at(0)).toBeLessThan(at(0.5));
    expect(at(0.5)).toBeLessThan(at(1));
  });

  it("does not write off an all-cash window", () => {
    // Plenty of honest stores run mostly cash. They should score lower than a
    // card-heavy store, not be treated as having contributed nothing.
    const cash = scoreConfidence({
      tradeCount: 30,
      storeCount: 5,
      relSpread: 0.1,
      stalenessDays: 0,
      verifiedShare: 0,
    });
    const cards = scoreConfidence({
      tradeCount: 30,
      storeCount: 5,
      relSpread: 0.1,
      stalenessDays: 0,
      verifiedShare: 1,
    });
    expect(cash.attestation).toBe(DEFAULT_BLEND_CONFIG.unverifiedFloor);
    expect(cash.score).toBeGreaterThan(0.5);
    expect(cash.score).toBeLessThan(cards.score);
  });

  it("treats a missing attestation share as fully self-reported", () => {
    const omitted = scoreConfidence({
      tradeCount: 20,
      storeCount: 4,
      relSpread: 0.2,
      stalenessDays: 0,
    });
    const explicit = scoreConfidence({
      tradeCount: 20,
      storeCount: 4,
      relSpread: 0.2,
      stalenessDays: 0,
      verifiedShare: 0,
    });
    expect(omitted.score).toBe(explicit.score);
  });

  it("rises with trade count", () => {
    const at = (tradeCount: number) =>
      scoreConfidence({ tradeCount, storeCount: 3, relSpread: 0.2, stalenessDays: 0 }).score;
    expect(at(2)).toBeLessThan(at(8));
    expect(at(8)).toBeLessThan(at(40));
  });

  it("rises with store breadth", () => {
    const at = (storeCount: number) =>
      scoreConfidence({ tradeCount: 20, storeCount, relSpread: 0.2, stalenessDays: 0 }).score;
    expect(at(2)).toBeLessThan(at(4));
    expect(at(4)).toBeLessThan(at(12));
  });

  it("falls as the trades disagree with each other", () => {
    const at = (relSpread: number) =>
      scoreConfidence({ tradeCount: 20, storeCount: 4, relSpread, stalenessDays: 0 }).score;
    expect(at(0.05)).toBeGreaterThan(at(0.3));
    expect(at(0.3)).toBeGreaterThan(at(0.55));
    expect(at(0.6)).toBe(0); // spread at the ceiling means the trades tell us nothing
    expect(at(2)).toBe(0);
  });

  it("falls as the window goes stale", () => {
    const at = (stalenessDays: number) =>
      scoreConfidence({ tradeCount: 20, storeCount: 4, relSpread: 0.2, stalenessDays }).score;
    expect(at(0)).toBeGreaterThan(at(5));
    expect(at(5)).toBeGreaterThan(at(20));
  });

  it("penalises an unmeasurable spread rather than assuming agreement", () => {
    const unknown = scoreConfidence({
      tradeCount: 20,
      storeCount: 4,
      relSpread: null,
      stalenessDays: 0,
    });
    const tight = scoreConfidence({
      tradeCount: 20,
      storeCount: 4,
      relSpread: 0.02,
      stalenessDays: 0,
    });
    expect(unknown.score).toBeLessThan(tight.score);
    expect(unknown.score).toBeGreaterThan(0);
  });

  it("lets one weak axis drag the whole score down", () => {
    // Geometric, not arithmetic: 200 trades cannot buy their way past a
    // two-store sample the way an average would let them.
    const lopsided = scoreConfidence({
      tradeCount: 200,
      storeCount: 2,
      relSpread: 0.05,
      stalenessDays: 0,
    });
    const balanced = scoreConfidence({
      tradeCount: 12,
      storeCount: 6,
      relSpread: 0.15,
      stalenessDays: 1,
    });
    expect(lopsided.score).toBeLessThan(balanced.score);
  });
});

describe("rollupWindow", () => {
  it("returns nothing for an empty window", () => {
    const r = rollupWindow([]);
    expect(r.streetPrice).toBeNull();
    expect(r.sampleTrades).toBe(0);
    expect(r.confidence.score).toBe(0);
    expect(r.stalenessDays).toBe(Infinity);
  });

  it("ignores days with no usable price", () => {
    const r = rollupWindow([day({ ageDays: 0, vwap: 0 }), day({ ageDays: 1, vwap: 10 })]);
    expect(r.streetPrice).toBe(10);
    expect(r.sampleTrades).toBe(1);
  });

  it("weights recent days over old ones", () => {
    // 7-day half-life: a 14-day-old day carries a quarter of yesterday's vote.
    const r = rollupWindow([day({ ageDays: 0, vwap: 20 }), day({ ageDays: 14, vwap: 10 })]);
    expect(r.streetPrice).toBe(18);
  });

  it("weights busy days over quiet ones", () => {
    const r = rollupWindow([
      day({ ageDays: 0, vwap: 10, unitCount: 10 }),
      day({ ageDays: 0, vwap: 20, unitCount: 1 }),
    ]);
    expect(r.streetPrice).toBe(10.91);
  });

  it("sums the sample across the window", () => {
    const r = rollupWindow([thick(0, 10), thick(2, 11), thick(5, 12)]);
    expect(r.sampleTrades).toBe(12);
    expect(r.sampleUnits).toBe(12);
    expect(r.stalenessDays).toBe(0);
  });

  it("uses the caller's distinct-store count when it has one", () => {
    const days = [thick(0, 10), thick(1, 10)];
    expect(rollupWindow(days).sampleStores).toBe(4); // busiest single day
    expect(rollupWindow(days, { distinctStores: 9 }).sampleStores).toBe(9);
    expect(rollupWindow(days, { distinctStores: 9 }).confidence.score).toBeGreaterThan(
      rollupWindow(days).confidence.score
    );
  });

  it("measures spread only on days thick enough to have one", () => {
    // Every day here is a single trade, so p25 === p75 — which would read as
    // perfect agreement if we counted it.
    const thin = rollupWindow([
      day({ ageDays: 0, vwap: 10 }),
      day({ ageDays: 1, vwap: 30 }),
      day({ ageDays: 2, vwap: 20 }),
    ]);
    expect(thin.relSpread).toBeNull();

    const measured = rollupWindow([
      day({ ageDays: 0, vwap: 10, tradeCount: 6, p25: 9, p75: 11, median: 10 }),
    ]);
    expect(measured.relSpread).toBeCloseTo(0.2, 4);
  });

  it("carries the attested share through as a unit-weighted average", () => {
    const r = rollupWindow([
      day({ ageDays: 0, vwap: 10, unitCount: 3, verifiedShare: 1 }),
      day({ ageDays: 1, vwap: 10, unitCount: 1, verifiedShare: 0 }),
    ]);
    expect(r.verifiedShare).toBe(0.75);
    expect(r.confidence.attestation).toBeGreaterThan(DEFAULT_BLEND_CONFIG.unverifiedFloor);
  });

  it("reports staleness from the freshest day in the window", () => {
    expect(rollupWindow([thick(4, 10), thick(9, 10)]).stalenessDays).toBe(4);
  });

  it("gives a thin, one-store window almost no confidence", () => {
    const r = rollupWindow([day({ ageDays: 3, vwap: 42 })]);
    expect(r.streetPrice).toBe(42);
    expect(r.confidence.score).toBe(0);
  });
});

describe("blendPrices", () => {
  it("falls all the way back to the reference at zero confidence", () => {
    const b = blendPrices(50, 10, 0);
    expect(b.blendedPrice).toBe(10);
  });

  it("publishes the street price at full confidence", () => {
    expect(blendPrices(50, 10, 1).blendedPrice).toBe(50);
  });

  it("interpolates in between", () => {
    expect(blendPrices(12, 10, 0.5).blendedPrice).toBe(11);
    expect(blendPrices(12, 10, 0.25).blendedPrice).toBe(10.5);
    expect(blendPrices(20, 10, 0.85).blendedPrice).toBe(18.5);
  });

  it("clamps confidence into range rather than extrapolating", () => {
    expect(blendPrices(12, 10, 4).blendedPrice).toBe(12);
    expect(blendPrices(12, 10, -2).blendedPrice).toBe(10);
  });

  it("reports divergence as a signed percentage of the reference", () => {
    expect(blendPrices(12, 10, 0.5).divergencePct).toBe(20);
    expect(blendPrices(8, 10, 0.5).divergencePct).toBe(-20);
    expect(blendPrices(10, 10, 0.5).divergencePct).toBe(0);
  });

  it("only calls a divergence a signal when we believe the sample", () => {
    expect(blendPrices(12, 10, 0.6).signal).toBe("street_premium");
    expect(blendPrices(8, 10, 0.6).signal).toBe("street_discount");
    expect(blendPrices(10.5, 10, 0.6).signal).toBe("aligned");
    // Same 20% gap, but from a sample we do not trust.
    expect(blendPrices(12, 10, 0.1).signal).toBe("insufficient");
  });

  it("publishes the street price alone when there is no reference", () => {
    const b = blendPrices(12, null, 0.4);
    expect(b.blendedPrice).toBe(12);
    expect(b.divergencePct).toBeNull();
    expect(b.signal).toBe("insufficient");
  });

  it("publishes the reference alone when nothing sold at the counter", () => {
    const b = blendPrices(null, 10, 0);
    expect(b.blendedPrice).toBe(10);
    expect(b.streetPrice).toBeNull();
  });

  it("publishes nothing when it has nothing", () => {
    expect(blendPrices(null, null, 0.5).blendedPrice).toBeNull();
  });

  it("treats junk prices as absent", () => {
    expect(blendPrices(0, 10, 0.9).blendedPrice).toBe(10);
    expect(blendPrices(-5, 10, 0.9).blendedPrice).toBe(10);
    expect(blendPrices(12, 0, 0.9).blendedPrice).toBe(12);
    expect(blendPrices(NaN, 10, 0.9).blendedPrice).toBe(10);
  });

  it("rounds to cents", () => {
    expect(blendPrices(10.005, 10.004, 0.5).blendedPrice).toBe(10.0);
    expect(blendPrices(3.333, 6.667, 0.5).blendedPrice).toBe(5);
  });
});

describe("rollup into blend — the path the job actually takes", () => {
  it("keeps a thin week near the marketplace price", () => {
    const r = rollupWindow([day({ ageDays: 2, vwap: 60, storeCount: 1 })]);
    const b = blendPrices(r.streetPrice, 40, r.confidence.score);
    expect(b.blendedPrice).toBe(40);
    expect(b.signal).toBe("insufficient");
  });

  it("lets a thick, broad, consistent week move the price", () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      day({
        ageDays: i,
        vwap: 60,
        tradeCount: 9,
        unitCount: 11,
        storeCount: 6,
        p25: 58,
        p75: 62,
        median: 60,
      })
    );
    const r = rollupWindow(days, { distinctStores: 14 });
    const b = blendPrices(r.streetPrice, 40, r.confidence.score);

    expect(r.streetPrice).toBe(60);
    expect(r.confidence.score).toBeGreaterThan(0.6);
    expect(b.blendedPrice!).toBeGreaterThan(52);
    expect(b.signal).toBe("street_premium");
    expect(b.divergencePct).toBe(50);
  });
});
