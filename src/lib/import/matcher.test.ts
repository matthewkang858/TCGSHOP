import { describe, expect, it } from "vitest";
import { applyMapping, canonicalCondition, detectMapping, type MappedRow } from "./mapping";
import {
  matchRow,
  nameSimilarity,
  normalizeName,
  type CandidateProduct,
} from "./matcher";

function candidate(over: Partial<CandidateProduct>): CandidateProduct {
  return {
    productId: 1,
    name: "Charizard",
    cleanName: "Charizard",
    number: "4/102",
    rarity: "Rare Holo",
    groupId: 604,
    categoryId: 3,
    productType: "single",
    expansionName: "Base Set",
    expansionAbbreviation: "BS",
    ...over,
  };
}

function row(over: Partial<MappedRow>): MappedRow {
  return {
    rowIndex: 0,
    productName: "Charizard",
    quantity: 1,
    tags: [],
    sourceRow: {},
    ...over,
  };
}

describe("detectMapping", () => {
  it("detects the TCGplayer export preset", () => {
    const { preset, mapping } = detectMapping([
      "TCGplayer Id",
      "Product Line",
      "Set Name",
      "Product Name",
      "Number",
      "Rarity",
      "Condition",
      "Total Quantity",
      "TCG Marketplace Price",
    ]);
    expect(preset).toBe("tcgplayer");
    expect(mapping.productId).toBe("TCGplayer Id");
    expect(mapping.quantity).toBe("Total Quantity");
    expect(mapping.price).toBe("TCG Marketplace Price");
  });

  it("auto-maps generic headers by alias", () => {
    const { preset, mapping } = detectMapping(["Card Name", "Qty", "Cond", "Buy Price", "Set"]);
    expect(preset).toBe("generic");
    expect(mapping.productName).toBe("Card Name");
    expect(mapping.quantity).toBe("Qty");
    expect(mapping.condition).toBe("Cond");
    expect(mapping.costBasis).toBe("Buy Price");
    expect(mapping.setName).toBe("Set");
  });
});

describe("applyMapping", () => {
  const mapping = {
    productName: "Name",
    quantity: "Qty",
    price: "Price",
    condition: "Condition",
  };

  it("normalizes conditions, prices, and rejects bad rows", () => {
    const { rows, errors } = applyMapping(
      [
        { Name: "Pikachu", Qty: "3", Price: "$1,234.56", Condition: "NM" },
        { Name: "", Qty: "1", Price: "1", Condition: "NM" },
        { Name: "Abra", Qty: "not-a-number", Price: "1", Condition: "LP" },
        { Name: "Squirtle", Qty: "2", Price: "", Condition: "Lightly Played Foil" },
      ],
      mapping
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      productName: "Pikachu",
      quantity: 3,
      price: 1234.56,
      condition: "Near Mint",
    });
    expect(rows[1]).toMatchObject({
      productName: "Squirtle",
      condition: "Lightly Played",
      printing: "Foil",
      price: undefined,
    });
    expect(errors).toHaveLength(2);
    expect(errors[0].error).toMatch(/product name/i);
    expect(errors[1].error).toMatch(/quantity/i);
  });

  it("canonicalizes condition aliases", () => {
    expect(canonicalCondition("nm")).toBe("Near Mint");
    expect(canonicalCondition("Sealed")).toBe("Unopened");
    expect(canonicalCondition("Heavily Played Holofoil")).toBe("Heavily Played");
    expect(canonicalCondition(undefined)).toBeUndefined();
  });
});

describe("nameSimilarity", () => {
  it("is 1 for equal names after normalization", () => {
    expect(nameSimilarity("Farfetch'd", "Farfetchd")).toBe(1);
    expect(normalizeName("  Blue-Eyes  White   Dragon! ")).toBe("blue eyes white dragon");
  });
  it("is high for near-identical names and low for different ones", () => {
    expect(nameSimilarity("Charizard", "Charizard ex")).toBeGreaterThan(0.7);
    expect(nameSimilarity("Charizard", "Blastoise")).toBeLessThan(0.4);
  });
});

describe("matchRow", () => {
  const charizard = candidate({ productId: 42304, name: "Charizard", number: "4/102" });
  const charmander = candidate({
    productId: 42346,
    name: "Charmander",
    number: "46/102",
    rarity: "Common",
  });
  const boosterBox = candidate({
    productId: 42481,
    name: "Base Set Booster Box",
    cleanName: "Base Set Booster Box",
    number: null,
    rarity: null,
    productType: "sealed",
  });
  const boosterPack = candidate({
    productId: 42482,
    name: "Base Set Booster Pack",
    cleanName: "Base Set Booster Pack",
    number: null,
    rarity: null,
    productType: "sealed",
  });

  const pool = [charizard, charmander, boosterBox, boosterPack];

  it("matches by exact productId first", () => {
    const r = matchRow(row({ productId: 42346, productName: "wrong name entirely" }), pool);
    expect(r.status).toBe("matched");
    if (r.status === "matched") {
      expect(r.product.productId).toBe(42346);
      expect(r.via).toBe("exact_id");
    }
  });

  it("reports unknown productIds as unmatched instead of falling back to fuzzy", () => {
    const r = matchRow(row({ productId: 999999, productName: "Charizard" }), pool);
    expect(r.status).toBe("unmatched");
  });

  it("fuzzy-matches on name + collector number", () => {
    const r = matchRow(row({ productName: "charizard", number: "004/102" }), pool);
    expect(r.status).toBe("matched");
    if (r.status === "matched") expect(r.product.productId).toBe(42304);
  });

  it("penalizes conflicting collector numbers", () => {
    const r = matchRow(row({ productName: "Charizard", number: "99/102" }), pool);
    expect(r.status).not.toBe("matched");
  });

  it("routes close sealed candidates to the ambiguous queue rather than guessing", () => {
    const r = matchRow(row({ productName: "Base Set Booster" }), pool);
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") {
      const ids = r.candidates.map((c) => c.productId);
      expect(ids).toContain(42481);
      expect(ids).toContain(42482);
    }
  });

  it("matches sealed rows only against sealed products", () => {
    const r = matchRow(row({ productName: "Base Set Booster Box" }), pool);
    expect(r.status).toBe("matched");
    if (r.status === "matched") {
      expect(r.product.productId).toBe(42481);
      expect(r.product.productType).toBe("sealed");
    }
  });

  it("returns unmatched when nothing resembles the name", () => {
    const r = matchRow(row({ productName: "Some Completely Unknown Widget" }), pool);
    expect(r.status).toBe("unmatched");
  });

  it("uses set name agreement as a signal", () => {
    const otherSet = candidate({
      productId: 777,
      name: "Charizard",
      number: null,
      expansionName: "Stormfront",
      expansionAbbreviation: "SF",
    });
    const r = matchRow(row({ productName: "Charizard", setName: "Base Set" }), [
      candidate({ productId: 42304, name: "Charizard", number: null }),
      otherSet,
    ]);
    // identical names in two sets - set name must break the tie
    expect(r.status).toBe("matched");
    if (r.status === "matched") expect(r.product.productId).toBe(42304);
  });
});
