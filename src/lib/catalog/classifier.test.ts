import { describe, expect, it } from "vitest";
import {
  classifyProduct,
  effectiveProductType,
  matchesSealedKeyword,
} from "./classifier";

describe("classifyProduct", () => {
  it("classifies singles when a collector number is present", () => {
    expect(
      classifyProduct({ name: "Charizard", number: "4/102", rarity: "Rare Holo" })
    ).toBe("single");
  });

  it("classifies singles when only rarity is present", () => {
    expect(classifyProduct({ name: "Deduce", number: null, rarity: "Common" })).toBe(
      "single"
    );
  });

  it.each([
    "Base Set Booster Box",
    "Scarlet & Violet Booster Pack",
    "Paldea Evolved Booster Display",
    "Obsidian Flames Booster Case",
    "MTG Booster Bundle",
    "Paradox Rift Elite Trainer Box",
    "Charizard ex Premium Collection",
    "151 Bundle",
    "Crown Zenith Collection",
    "Murders at Karlov Manor Collector Booster Display",
    "Pikachu Blister",
    "Celebrations Tin",
    "Modern Horizons Precon",
    "Murders at Karlov Manor Commander Deck - Deadly Disguise",
    "Base Set Starter Deck",
    "Zap Theme Deck",
    "Khans of Tarkir Fat Pack",
    "Build & Battle Box",
  ])("classifies '%s' as sealed (no number/rarity)", (name) => {
    expect(classifyProduct({ name, number: null, rarity: null })).toBe("sealed");
  });

  it("treats empty-string number/rarity as missing", () => {
    expect(classifyProduct({ name: "Celebrations Tin", number: "", rarity: " " })).toBe(
      "sealed"
    );
  });

  it("does NOT classify keyword matches as sealed when number/rarity present", () => {
    // e.g. a single literally named after a sealed keyword stays a single
    expect(
      classifyProduct({ name: "Booster Tutor", number: "37", rarity: "Uncommon" })
    ).toBe("single");
  });

  it("classifies keyword-less, number-less products as other", () => {
    expect(classifyProduct({ name: "Art Series: Plains", number: null, rarity: null })).toBe(
      "other"
    );
    expect(classifyProduct({ name: "Code Card", number: null, rarity: null })).toBe("other");
  });

  it("keyword matching is case-insensitive and word-bounded", () => {
    expect(matchesSealedKeyword("ELITE TRAINER BOX")).toBe(true);
    expect(matchesSealedKeyword("Tintagel Castle")).toBe(false); // 'tin' must be a word
  });
});

describe("effectiveProductType", () => {
  it("prefers the manual override", () => {
    expect(
      effectiveProductType({ productType: "other", productTypeOverride: "sealed" })
    ).toBe("sealed");
  });
  it("falls back to the classifier result", () => {
    expect(effectiveProductType({ productType: "single", productTypeOverride: null })).toBe(
      "single"
    );
  });
});
