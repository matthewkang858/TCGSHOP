import { describe, expect, it } from "vitest";
import { needsResticker, suggestedStickerPrice } from "./sticker";

describe("suggestedStickerPrice", () => {
  it("rounds to the nearest $5 at $20 and above", () => {
    expect(suggestedStickerPrice(22.4)).toBe(20);
    expect(suggestedStickerPrice(22.5)).toBe(25);
    expect(suggestedStickerPrice(399.99)).toBe(400);
    expect(suggestedStickerPrice(5865)).toBe(5865);
    expect(suggestedStickerPrice(20)).toBe(20);
  });

  it("rounds to the nearest dollar between $5 and $20", () => {
    expect(suggestedStickerPrice(5.4)).toBe(5);
    expect(suggestedStickerPrice(17.99)).toBe(18);
    expect(suggestedStickerPrice(19.6)).toBe(20);
  });

  it("keeps exact cents under $5 (cheap singles keep .49/.99)", () => {
    expect(suggestedStickerPrice(0.49)).toBe(0.49);
    expect(suggestedStickerPrice(3.99)).toBe(3.99);
  });

  it("handles junk input", () => {
    expect(suggestedStickerPrice(0)).toBe(0);
    expect(suggestedStickerPrice(-3)).toBe(0);
    expect(suggestedStickerPrice(NaN)).toBe(0);
  });
});

describe("needsResticker", () => {
  it("never-stickered items need a first sticker", () => {
    expect(needsResticker(12, null)).toBe(true);
  });
  it("matching sticker needs nothing", () => {
    expect(needsResticker(22.4, 20)).toBe(false);
    expect(needsResticker(3.99, 3.99)).toBe(false);
  });
  it("price drift beyond the rounding step resurfaces the item", () => {
    expect(needsResticker(28, 20)).toBe(true); // suggested 30 != stickered 20
    expect(needsResticker(102, 100)).toBe(false); // 102 -> 100, sticker still right
    expect(needsResticker(103, 100)).toBe(true); // 103 -> 105
  });
  it("unpriced items are skipped", () => {
    expect(needsResticker(null, 20)).toBe(false);
  });
});
