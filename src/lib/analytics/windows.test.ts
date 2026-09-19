import { describe, expect, it } from "vitest";
import { pctDelta, splitWeeks, sumWindow, type DayPoint } from "./windows";

function day(date: string, partial: Partial<DayPoint> = {}): DayPoint {
  return {
    date,
    revenue: 0,
    units: 0,
    sales: 0,
    profit: 0,
    costedRevenue: 0,
    uncostedSales: 0,
    ...partial,
  };
}

describe("sumWindow", () => {
  it("totals every field and rounds money to cents", () => {
    const t = sumWindow([
      day("2026-09-01", { revenue: 10.005, units: 2, sales: 1, profit: 3.333, costedRevenue: 10.005 }),
      day("2026-09-02", { revenue: 5, units: 1, sales: 1, profit: 1, costedRevenue: 5, uncostedSales: 2 }),
    ]);
    expect(t.revenue).toBe(15.01);
    expect(t.units).toBe(3);
    expect(t.sales).toBe(2);
    expect(t.profit).toBe(4.33);
    expect(t.uncostedSales).toBe(2);
  });

  it("computes margin over costed revenue only", () => {
    // $100 of sales, but only $40 of it had a cost basis; $10 profit on that.
    const t = sumWindow([day("2026-09-01", { revenue: 100, profit: 10, costedRevenue: 40 })]);
    expect(t.marginPct).toBe(25);
  });

  it("reports no margin when nothing was costed", () => {
    expect(sumWindow([day("2026-09-01", { revenue: 100 })]).marginPct).toBeNull();
    expect(sumWindow([]).marginPct).toBeNull();
  });
});

describe("pctDelta", () => {
  it("is the signed change from the prior period", () => {
    expect(pctDelta(120, 100)).toBe(20);
    expect(pctDelta(75, 100)).toBe(-25);
    expect(pctDelta(100, 100)).toBe(0);
  });
  it("has nothing to say without a prior", () => {
    expect(pctDelta(50, 0)).toBeNull();
    expect(pctDelta(0, 0)).toBeNull();
  });
});

describe("splitWeeks", () => {
  it("takes the last seven days and the seven before, regardless of input order", () => {
    const days = Array.from({ length: 14 }, (_, i) =>
      day(`2026-09-${String(i + 1).padStart(2, "0")}`)
    ).reverse();
    const { last7, prior7 } = splitWeeks(days);
    expect(last7.map((d) => d.date)).toEqual([
      "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14",
    ]);
    expect(prior7[0].date).toBe("2026-09-01");
    expect(prior7).toHaveLength(7);
  });
  it("copes with a short series", () => {
    const { last7, prior7 } = splitWeeks([day("2026-09-01"), day("2026-09-02")]);
    expect(last7).toHaveLength(2);
    expect(prior7).toHaveLength(0);
  });
});
