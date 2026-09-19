import { describe, expect, it } from "vitest";
import { niceStep, niceTicks } from "./ticks";

describe("niceStep", () => {
  it("lands on 1-2-5 steps", () => {
    expect(niceStep(340)).toBe(100); // rough 85 -> 100
    expect(niceStep(40)).toBe(10); // rough 10 -> 10
    expect(niceStep(7)).toBe(2); // rough 1.75 -> 2
    expect(niceStep(3)).toBe(1); // rough 0.75 -> 1
  });
  it("allows 2.5 only once the step is money-sized", () => {
    expect(niceStep(1150)).toBe(500); // rough 287.5 -> 500 (250 < 287.5)
    expect(niceStep(900)).toBe(250); // rough 225 -> 250
    expect(niceStep(9)).toBe(5); // rough 2.25 -> 5, never 2.5
  });
  it("degrades safely", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
    expect(niceStep(NaN)).toBe(1);
  });
});

describe("niceTicks", () => {
  it("replaces recharts' even division with readable numbers", () => {
    expect(niceTicks(0, 340)).toEqual([0, 100, 200, 300, 400]);
    expect(niceTicks(0, 1150)).toEqual([0, 500, 1000, 1500]);
  });
  it("always includes zero, even when every value is positive", () => {
    expect(niceTicks(120, 340)[0]).toBe(0);
  });
  it("extends below zero for a loss-making day", () => {
    expect(niceTicks(-60, 340)).toEqual([-100, 0, 100, 200, 300, 400]);
  });
  it("copes with an empty range", () => {
    expect(niceTicks(0, 0)).toEqual([0]);
  });
});
