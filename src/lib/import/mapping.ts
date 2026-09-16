/**
 * CSV column mapping for inventory import.
 * A mapping assigns our logical fields to CSV header names. The TCGplayer
 * export preset is auto-detected from its distinctive headers; anything else
 * falls back to best-effort auto-mapping the user can correct in the wizard.
 */

export const IMPORT_FIELDS = [
  "productId",
  "game",
  "setName",
  "productName",
  "number",
  "rarity",
  "condition",
  "printing",
  "language",
  "quantity",
  "price",
  "costBasis",
  "tags",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** logical field -> CSV header (null = not mapped) */
export type ColumnMapping = Partial<Record<ImportField, string | null>>;

export const FIELD_LABELS: Record<ImportField, string> = {
  productId: "TCGplayer / Product ID",
  game: "Game / Product line",
  setName: "Set name",
  productName: "Product name",
  number: "Collector number",
  rarity: "Rarity",
  condition: "Condition",
  printing: "Printing (Normal/Foil)",
  language: "Language",
  quantity: "Quantity",
  price: "Current price",
  costBasis: "Cost basis",
  tags: "Tags (comma separated)",
};

export const REQUIRED_FIELDS: ImportField[] = ["productName", "quantity"];

// TCGplayer inventory export headers (both Live and Staged exports)
const TCGPLAYER_MAPPING: ColumnMapping = {
  productId: "TCGplayer Id",
  game: "Product Line",
  setName: "Set Name",
  productName: "Product Name",
  number: "Number",
  rarity: "Rarity",
  condition: "Condition",
  quantity: "Total Quantity",
  price: "TCG Marketplace Price",
};

/** header aliases for generic auto-mapping (lowercased, punctuation stripped) */
const FIELD_ALIASES: Record<ImportField, string[]> = {
  productId: ["tcgplayer id", "tcgplayerid", "product id", "productid", "tcg id"],
  game: ["product line", "game", "category"],
  setName: ["set name", "set", "expansion", "edition", "group"],
  productName: ["product name", "name", "card name", "title", "product"],
  number: ["number", "card number", "collector number", "no"],
  rarity: ["rarity"],
  condition: ["condition", "cond"],
  printing: ["printing", "finish", "foil", "variant"],
  language: ["language", "lang"],
  quantity: ["total quantity", "quantity", "qty", "add to quantity", "count", "stock"],
  price: [
    "tcg marketplace price",
    "marketplace price",
    "price",
    "my price",
    "sell price",
    "list price",
  ],
  costBasis: ["cost basis", "cost", "buy price", "acquisition cost", "invoice price"],
  tags: ["tags", "labels"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export type DetectedMapping = {
  preset: "tcgplayer" | "generic";
  mapping: ColumnMapping;
};

/**
 * Detect the best mapping for a set of CSV headers.
 * TCGplayer preset wins when its signature headers are present.
 */
export function detectMapping(headers: string[]): DetectedMapping {
  const normalized = new Map(headers.map((h) => [normalizeHeader(h), h]));

  const isTcgplayer =
    normalized.has("tcgplayer id") &&
    (normalized.has("set name") || normalized.has("product line"));

  if (isTcgplayer) {
    // resolve preset headers against the actual header spelling in the file
    const mapping: ColumnMapping = {};
    for (const [field, header] of Object.entries(TCGPLAYER_MAPPING) as [
      ImportField,
      string,
    ][]) {
      const actual = normalized.get(normalizeHeader(header));
      if (actual) mapping[field] = actual;
    }
    // TCGplayer exports have no cost column, but map it if the user added one
    const cost = FIELD_ALIASES.costBasis.find((a) => normalized.has(a));
    if (cost) mapping.costBasis = normalized.get(cost);
    return { preset: "tcgplayer", mapping };
  }

  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    for (const alias of FIELD_ALIASES[field]) {
      const actual = normalized.get(alias);
      if (actual && !Object.values(mapping).includes(actual)) {
        mapping[field] = actual;
        break;
      }
    }
  }
  return { preset: "generic", mapping };
}

// --- row normalization ------------------------------------------------------

export type MappedRow = {
  rowIndex: number;
  productId?: number;
  game?: string;
  setName?: string;
  productName: string;
  number?: string;
  rarity?: string;
  condition?: string;
  printing?: string;
  language?: string;
  quantity: number;
  price?: number;
  costBasis?: number;
  tags: string[];
  sourceRow: Record<string, string>;
};

export type RowError = { rowIndex: number; error: string };

function parseNumber(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

const CONDITION_CANON: Record<string, string> = {
  "near mint": "Near Mint",
  nm: "Near Mint",
  mint: "Near Mint",
  "lightly played": "Lightly Played",
  lp: "Lightly Played",
  "moderately played": "Moderately Played",
  mp: "Moderately Played",
  "heavily played": "Heavily Played",
  hp: "Heavily Played",
  damaged: "Damaged",
  dmg: "Damaged",
  unopened: "Unopened",
  sealed: "Unopened",
  new: "Unopened",
};

export function canonicalCondition(raw: string | undefined): string | undefined {
  if (!raw || raw.trim() === "") return undefined;
  const key = raw.toLowerCase().trim();
  // TCGplayer style "Near Mint Foil" / "Lightly Played Holofoil"
  for (const [alias, canon] of Object.entries(CONDITION_CANON)) {
    if (key === alias || key.startsWith(alias + " ")) return canon;
  }
  return raw.trim();
}

export function extractPrinting(condition: string | undefined, printing: string | undefined) {
  if (printing && printing.trim() !== "") {
    const p = printing.toLowerCase();
    if (p.includes("foil") || p.includes("holo")) return "Foil";
    return "Normal";
  }
  if (condition && /foil|holo/i.test(condition)) return "Foil";
  return undefined;
}

/**
 * Apply a column mapping to raw CSV records.
 * Rows with no product name or an invalid quantity are returned as errors.
 */
export function applyMapping(
  rows: Record<string, string>[],
  mapping: ColumnMapping
): { rows: MappedRow[]; errors: RowError[] } {
  const get = (row: Record<string, string>, field: ImportField): string | undefined => {
    const header = mapping[field];
    if (!header) return undefined;
    return row[header];
  };

  const out: MappedRow[] = [];
  const errors: RowError[] = [];

  rows.forEach((row, rowIndex) => {
    const productName = get(row, "productName")?.trim();
    if (!productName) {
      errors.push({ rowIndex, error: "Missing product name" });
      return;
    }
    const quantity = parseNumber(get(row, "quantity"));
    if (quantity === undefined || quantity < 0 || !Number.isInteger(quantity)) {
      errors.push({ rowIndex, error: `Invalid quantity "${get(row, "quantity") ?? ""}"` });
      return;
    }
    const rawCondition = get(row, "condition");
    const productIdRaw = parseNumber(get(row, "productId"));

    out.push({
      rowIndex,
      productId:
        productIdRaw !== undefined && Number.isInteger(productIdRaw) && productIdRaw > 0
          ? productIdRaw
          : undefined,
      game: get(row, "game")?.trim() || undefined,
      setName: get(row, "setName")?.trim() || undefined,
      productName,
      number: get(row, "number")?.trim() || undefined,
      rarity: get(row, "rarity")?.trim() || undefined,
      condition: canonicalCondition(rawCondition),
      printing: extractPrinting(rawCondition, get(row, "printing")),
      language: get(row, "language")?.trim() || undefined,
      quantity,
      price: parseNumber(get(row, "price")),
      costBasis: parseNumber(get(row, "costBasis")),
      tags:
        get(row, "tags")
          ?.split(",")
          .map((t) => t.trim())
          .filter(Boolean) ?? [],
      sourceRow: row,
    });
  });

  return { rows: out, errors };
}
