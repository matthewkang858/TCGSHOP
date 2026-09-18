import { describe, expect, it } from "vitest";
import {
  aggregateTrades,
  DEFAULT_CONFIG,
  median,
  quantile,
  type Trade,
} from "./aggregate";

let seq = 0;
/** A self-reported (cash) trade: a clerk typed the number in. */
function trade(storeId: string, unitPrice: number, quantity = 1): Trade {
  seq += 1;
  return { transactionId: `t${seq}`, storeId, unitPrice, quantity, verified: false };
}
/** A processor-attested trade: a card was really run for this amount. */
function card(storeId: string, unitPrice: number, quantity = 1): Trade {
  return { ...trade(storeId, unitPrice, quantity), verified: true };
}

const reasons = (o: ReturnType<typeof aggregateTrades>) => o.excluded.map((e) => e.reason);

describe("quantile", () => {
  it("interpolates between neighbours", () => {
    expect(quantile([10, 20], 0.5)).toBe(15);
    expect(quantile([0, 10, 20, 30], 0.25)).toBeCloseTo(7.5, 10);
  });
  it("handles degenerate inputs", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([7], 0.9)).toBe(7);
  });
  it("median does not mutate its input", () => {
    const values = [3, 1, 2];
    expect(median(values)).toBe(2);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("aggregateTrades — the honest case", () => {
  it("volume-weights four agreeing trades from four stores", () => {
    const o = aggregateTrades(
      [trade("a", 10), trade("b", 10.5), trade("c", 11), trade("d", 10.25)],
      10.5
    );
    expect(o.excluded).toEqual([]);
    expect(o.tradeCount).toBe(4);
    expect(o.unitCount).toBe(4);
    expect(o.storeCount).toBe(4);
    expect(o.vwap).toBe(10.44);
    expect(o.median).toBe(10.38);
    expect(o.low).toBe(10);
    expect(o.high).toBe(11);
    expect(o.p25).toBeLessThan(o.median!);
    expect(o.p75).toBeGreaterThan(o.median!);
    expect(o.publishable).toBe(true);
  });

  it("weights by quantity, not by row count", () => {
    // Same two prices, but the cheap side moved ten copies.
    const even = aggregateTrades([trade("a", 5), trade("b", 20)], null);
    const skewed = aggregateTrades([trade("a", 5, 10), trade("b", 20, 1)], null);
    expect(even.vwap).toBe(12.5);
    expect(skewed.vwap!).toBeLessThan(even.vwap!);
    expect(skewed.unitCount).toBe(11);
  });

  it("is order-independent", () => {
    const trades = [trade("a", 10), trade("b", 12), trade("c", 11), trade("d", 13)];
    const forward = aggregateTrades(trades, 11);
    const backward = aggregateTrades([...trades].reverse(), 11);
    expect(backward.vwap).toBe(forward.vwap);
    expect(backward.median).toBe(forward.median);
    expect(backward.storeCount).toBe(forward.storeCount);
  });

  it("accounts for every input row", () => {
    const o = aggregateTrades(
      [trade("a", 30), trade("b", 31), trade("c", 29), trade("d", 3000), trade("e", -1)],
      30
    );
    expect(o.tradeCount + o.excluded.length).toBe(o.rawTradeCount);
    expect(o.rawTradeCount).toBe(5);
  });
});

describe("aggregateTrades — defense 1: plausibility vs the reference", () => {
  it("drops a fat-fingered price that is an order of magnitude off", () => {
    const o = aggregateTrades([trade("a", 30), trade("b", 31), trade("c", 3000)], 30);
    expect(reasons(o)).toEqual(["implausible_vs_reference"]);
    expect(o.vwap).toBe(30.5);
  });

  it("drops a decimal-slip price far below the reference", () => {
    const o = aggregateTrades([trade("a", 30), trade("b", 31), trade("c", 0.3)], 30);
    expect(reasons(o)).toEqual(["implausible_vs_reference"]);
  });

  it("keeps genuine discounts and premiums inside the fences", () => {
    // 2x and 0.4x the reference: unusual, but these are real counter prices.
    const o = aggregateTrades([trade("a", 60), trade("b", 12), trade("c", 30)], 30);
    expect(o.excluded).toEqual([]);
    expect(o.tradeCount).toBe(3);
  });

  it("skips the gate entirely when we have no reference", () => {
    const o = aggregateTrades([trade("a", 30), trade("b", 3000)], null);
    expect(o.excluded).toEqual([]);
    expect(o.tradeCount).toBe(2);
  });

  it("records why a trade was dropped", () => {
    const o = aggregateTrades([trade("a", 300)], 30);
    expect(o.excluded[0].detail).toContain("10.00x");
    expect(o.excluded[0].unitPrice).toBe(300);
  });

  it("rejects structurally broken rows", () => {
    const o = aggregateTrades(
      [trade("a", 0), trade("b", -5), trade("c", NaN), trade("d", 10, 0), trade("e", 10)],
      null
    );
    expect(reasons(o)).toEqual([
      "non_positive_price",
      "non_positive_price",
      "non_positive_price",
      "non_positive_price",
    ]);
    expect(o.tradeCount).toBe(1);
  });
});

describe("aggregateTrades — defense 2: IQR fences", () => {
  it("trims a tail outlier once there is a distribution to measure", () => {
    const o = aggregateTrades(
      [trade("a", 29), trade("b", 30), trade("c", 31), trade("d", 3000)],
      null
    );
    expect(reasons(o)).toEqual(["price_outlier"]);
    expect(o.tradeCount).toBe(3);
    expect(o.high).toBe(31);
  });

  it("leaves fewer than four trades alone — three points have no tails", () => {
    const o = aggregateTrades([trade("a", 29), trade("b", 30), trade("c", 900)], null);
    expect(o.excluded).toEqual([]);
    expect(o.tradeCount).toBe(3);
  });

  it("does not trim when every trade agrees exactly", () => {
    // iqr === 0 would make the fences collapse onto the median and exclude
    // everything that is not exactly it.
    const o = aggregateTrades(
      [trade("a", 20), trade("b", 20), trade("c", 20), trade("d", 20), trade("e", 21)],
      null
    );
    expect(o.excluded).toEqual([]);
    expect(o.tradeCount).toBe(5);
  });

  it("keeps a wide-but-plausible spread", () => {
    const o = aggregateTrades(
      [trade("a", 10), trade("b", 14), trade("c", 18), trade("d", 22), trade("e", 26)],
      null
    );
    expect(o.excluded).toEqual([]);
  });

  it("reports the fence it used", () => {
    const o = aggregateTrades(
      [trade("a", 10), trade("b", 10), trade("c", 11), trade("d", 99)],
      null
    );
    expect(o.excluded[0].reason).toBe("price_outlier");
    expect(o.excluded[0].detail).toMatch(/^outside \[/);
  });
});

describe("aggregateTrades — defense 3: store concentration", () => {
  it("stops one loud store from outvoting the rest of the market", () => {
    const loud = Array.from({ length: 20 }, () => trade("loud", 50));
    const quiet = [trade("b", 30), trade("c", 30)];
    const o = aggregateTrades([...loud, ...quiet], 30);

    expect(o.excluded).toEqual([]); // the trades are real, only their weight is capped
    expect(o.tradeCount).toBe(22);
    expect(o.storeCount).toBe(3);

    const uncapped = (20 * 50 + 2 * 30) / 22; // 48.18
    expect(o.vwap!).toBeLessThan(uncapped);
    expect(o.vwap!).toBeGreaterThan(30);
    expect(o.vwap).toBe(46.92);
  });

  it("caps at the configured share, not below an equal split", () => {
    // With 10 stores an equal split is 10% each, but the cap floor is
    // maxStoreWeightShare (50%) — we never punish a store for merely being
    // busier than average in a thin bucket.
    const trades = [
      ...Array.from({ length: 4 }, () => trade("a", 10)),
      ...Array.from({ length: 9 }, (_, i) => trade(`s${i}`, 10)),
    ];
    const o = aggregateTrades(trades, 10);
    expect(o.vwap).toBe(10);
    expect(o.storeCount).toBe(10);
  });

  it("does not cap a single-store bucket into nonsense", () => {
    const o = aggregateTrades([trade("a", 12), trade("a", 12), trade("a", 12)], 12);
    expect(o.vwap).toBe(12);
    expect(o.storeCount).toBe(1);
  });

  it("caps weight when there are too few stores to fence on", () => {
    // Three stores is below the fence threshold, so concentration capping is
    // the only thing standing between one loud store and the printed price.
    const loud = Array.from({ length: 30 }, () => trade("loud", 90));
    const o = aggregateTrades([...loud, trade("b", 30), trade("c", 31)], 30);
    expect(o.excluded).toEqual([]);
    expect(o.vwap!).toBeLessThan((30 * 90 + 61) / 32);
  });
});

describe("aggregateTrades — manipulation", () => {
  it("throws out a store whose whole price level is out of line", () => {
    // 60 reports at 2x the honest price. Volume buys nothing: the store-level
    // fence gives each business one vote, so the spammer is one voice in four.
    const spam = Array.from({ length: 60 }, () => trade("evil", 60));
    const honest = [trade("b", 30), trade("c", 31), trade("d", 29)];
    const o = aggregateTrades([...spam, ...honest], 30);

    expect(o.excluded).toHaveLength(60);
    expect(new Set(reasons(o))).toEqual(new Set(["store_outlier"]));
    expect(o.excluded[0].detail).toContain("store median 60");
    expect(o.tradeCount).toBe(3);
    expect(o.storeCount).toBe(3);
    expect(o.vwap).toBe(30);
  });

  it("is not fooled by a spammer who hides behind a zero raw IQR", () => {
    // The spam is dense enough to own both raw quartiles, so the raw fence
    // sees a perfectly tight distribution. The store-level fence still fires.
    const spam = Array.from({ length: 40 }, () => trade("evil", 75));
    const honest = [trade("b", 25), trade("c", 25), trade("d", 26), trade("e", 24)];
    const o = aggregateTrades([...spam, ...honest], 25);
    expect(o.tradeCount).toBe(4);
    expect(o.vwap).toBe(25);
  });

  it("needs collusion, not volume: two of five stores can still move it", () => {
    // Manipulation is not impossible, it is just priced in businesses. Two
    // colluding stores out of five widen the fence enough to survive it —
    // which is exactly what the confidence model's spread term is for.
    const o = aggregateTrades(
      [
        trade("evil1", 60),
        trade("evil2", 58),
        trade("c", 30),
        trade("d", 31),
        trade("e", 29),
      ],
      30
    );
    expect(o.tradeCount).toBe(5);
    expect(o.vwap!).toBeGreaterThan(30);
    // The damage shows up as a wide spread, which downstream scores as low
    // agreement and keeps the published price near the reference.
    expect((o.p75! - o.p25!) / o.median!).toBeGreaterThan(0.5);
  });

  it("does not punish a store for being the only one with a thick day", () => {
    const o = aggregateTrades(
      [
        ...Array.from({ length: 12 }, () => trade("busy", 30)),
        trade("b", 31),
        trade("c", 29),
        trade("d", 30),
      ],
      30
    );
    expect(o.excluded).toEqual([]);
    expect(o.vwap).toBe(30);
    expect(o.storeCount).toBe(4);
  });
});

describe("aggregateTrades — payment attestation", () => {
  it("lets card sales set the standard that cash sales are judged against", () => {
    // The scenario the whole defense exists for: a pile of cash sales at three
    // times the going rate, sitting next to card sales that say otherwise.
    const cards = [card("b", 30), card("c", 30), card("d", 31), card("e", 29)];
    const cash = Array.from({ length: 10 }, () => trade("evil", 90));
    const o = aggregateTrades([...cards, ...cash], 30);

    expect(o.fencedOnVerified).toBe(true);
    expect(o.excluded).toHaveLength(10);
    expect(o.excluded[0].reason).toBe("price_outlier");
    expect(o.excluded[0].detail).toContain("card-verified fence");
    expect(o.vwap).toBe(30);
    expect(o.verifiedShare).toBe(1);
  });

  it("catches colluding stores that the one-vote-per-store fence cannot", () => {
    // Three colluding businesses are enough to bend a store-median fence —
    // they become a third of the votes. Attestation does not care how many of
    // them there are, only that none of them ran a card.
    const honest = [card("b", 30), card("c", 30), card("d", 31), card("e", 29)];
    const colluders = ["x", "y", "z"].flatMap((s) => [trade(s, 90), trade(s, 90)]);

    const withCards = aggregateTrades([...honest, ...colluders], 30);
    expect(withCards.tradeCount).toBe(4);
    expect(withCards.vwap).toBe(30);

    // Same trades, but nobody ran a card: the colluders survive every fence
    // and drag the price most of the way to their number.
    const allCash = aggregateTrades(
      [...honest.map((t) => ({ ...t, verified: false })), ...colluders],
      30
    );
    expect(allCash.fencedOnVerified).toBe(false);
    expect(allCash.excluded).toEqual([]);
    expect(allCash.vwap).toBe(66);
  });

  it("will not let one store's cards fence out everyone else", () => {
    // Four attested trades, but all from the same business. Eating processor
    // fees on your own cards does not buy you the right to define the market.
    const o = aggregateTrades(
      [
        card("evil", 90),
        card("evil", 90),
        card("evil", 91),
        card("evil", 89),
        trade("b", 30),
        trade("c", 30),
      ],
      30
    );
    expect(o.fencedOnVerified).toBe(false);
    expect(o.tradeCount).toBe(6);
  });

  it("discounts a self-reported price without discarding it", () => {
    const mixed = aggregateTrades([card("a", 10), trade("b", 20)], null);
    const bothCash = aggregateTrades([trade("a", 10), trade("b", 20)], null);

    expect(mixed.tradeCount).toBe(2);
    expect(bothCash.vwap).toBe(15);
    // 1.0 vs 0.35 of a vote: the attested price carries most of the weight.
    expect(mixed.vwap).toBe(12.59);
  });

  it("is unchanged when every trade is attested the same way", () => {
    const cash = aggregateTrades([trade("a", 10), trade("b", 20), trade("c", 30)], null);
    const cards = aggregateTrades([card("a", 10), card("b", 20), card("c", 30)], null);
    expect(cash.vwap).toBe(cards.vwap);
    expect(cash.verifiedShare).toBe(0);
    expect(cards.verifiedShare).toBe(1);
  });

  it("reports the attested share of the bucket", () => {
    const o = aggregateTrades([card("a", 10, 3), trade("b", 10, 1)], null);
    expect(o.verifiedTradeCount).toBe(1);
    expect(o.unitCount).toBe(4);
    expect(o.verifiedShare).toBe(0.75);
  });

  it("stacks with the concentration cap instead of cancelling it", () => {
    // One store with a lot of cash volume: the cap limits its share, and the
    // discount then limits what that share is worth.
    const loud = Array.from({ length: 20 }, () => trade("loud", 50));
    const o = aggregateTrades([...loud, card("b", 30), card("c", 30)], 30);
    expect(o.vwap!).toBeLessThan(46.92); // the same bucket, all self-reported
    expect(o.storeCount).toBe(3);
  });
});

describe("aggregateTrades — publication gate", () => {
  it("withholds a bucket that only one store contributed to", () => {
    const o = aggregateTrades([trade("a", 12), trade("a", 13)], 12);
    expect(o.vwap).toBeCloseTo(12.5, 2);
    expect(o.publishable).toBe(false);
  });

  it("publishes once a second store agrees", () => {
    const o = aggregateTrades([trade("a", 12), trade("b", 13)], 12);
    expect(o.publishable).toBe(true);
  });

  it("respects a stricter minStores", () => {
    const o = aggregateTrades([trade("a", 12), trade("b", 13)], 12, {
      ...DEFAULT_CONFIG,
      minStores: 3,
    });
    expect(o.publishable).toBe(false);
  });

  it("returns an empty observation when nothing survives", () => {
    const o = aggregateTrades([trade("a", 3000), trade("b", 4000)], 30);
    expect(o).toMatchObject({
      tradeCount: 0,
      unitCount: 0,
      storeCount: 0,
      vwap: null,
      median: null,
      low: null,
      high: null,
      publishable: false,
      rawTradeCount: 2,
    });
    expect(o.excluded).toHaveLength(2);
  });

  it("returns an empty observation for an empty day", () => {
    const o = aggregateTrades([], 30);
    expect(o.rawTradeCount).toBe(0);
    expect(o.vwap).toBeNull();
    expect(o.publishable).toBe(false);
  });
});
