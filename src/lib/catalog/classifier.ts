/**
 * Sealed-product classifier, run at catalog ingest.
 *
 * Rule: a product is `sealed` when it has NO collector number and NO rarity
 * AND its name matches a sealed-product keyword. Products with a number or
 * rarity are `single`. Everything else (art series, code cards, supplies
 * without keywords) is `other`.
 *
 * A `product_type_override` column exists for manual correction; callers
 * should prefer the override when present (see effectiveProductType).
 */

export type ProductType = "single" | "sealed" | "other";

const SEALED_KEYWORDS: RegExp[] = [
  /\bbooster box\b/i,
  /\bbooster pack\b/i,
  /\bbooster display\b/i,
  /\bbooster case\b/i,
  /\bbooster bundle\b/i,
  /\belite trainer box\b/i,
  /\bbundle\b/i,
  /\bcollection\b/i,
  /\bcollector booster\b/i,
  /\bblister\b/i,
  /\btin\b/i,
  /\bprecon\b/i,
  /\bcommander deck\b/i,
  /\bstarter deck\b/i,
  /\btheme deck\b/i,
  /\bfat pack\b/i,
  /\bbuild & battle\b/i,
  /\bpremium collection\b/i,
  // pragmatic extras seen constantly on LGS walls
  /\bstarter set\b/i,
  /\bprerelease pack\b/i,
  /\bdraft booster\b/i,
  /\bset booster\b/i,
  /\bplay booster\b/i,
];

export function matchesSealedKeyword(name: string): boolean {
  return SEALED_KEYWORDS.some((re) => re.test(name));
}

export function classifyProduct(input: {
  name: string;
  number?: string | null;
  rarity?: string | null;
}): ProductType {
  const hasNumber = !!input.number && input.number.trim() !== "";
  const hasRarity = !!input.rarity && input.rarity.trim() !== "";
  if (!hasNumber && !hasRarity) {
    return matchesSealedKeyword(input.name) ? "sealed" : "other";
  }
  return "single";
}

/** Manual override wins over the classifier. */
export function effectiveProductType(row: {
  productType: ProductType;
  productTypeOverride?: ProductType | null;
}): ProductType {
  return row.productTypeOverride ?? row.productType;
}
