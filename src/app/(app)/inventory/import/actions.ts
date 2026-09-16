"use server";

import Papa from "papaparse";
import { z } from "zod";
import { requireStore } from "@/lib/tenancy";
import {
  applyMapping,
  detectMapping,
  IMPORT_FIELDS,
  REQUIRED_FIELDS,
  type ColumnMapping,
  type MappedRow,
} from "@/lib/import/mapping";
import { commitImport, matchRows, toCommitItem } from "@/lib/import/service";
import { db } from "@/db";
import { expansions, products } from "@/db/schema";
import { eq, ilike, inArray } from "drizzle-orm";
import { MAX_IMPORT_ROWS } from "@/lib/import/limits";

// --- step 1: parse ----------------------------------------------------------

export type ParseResult =
  | {
      ok: true;
      headers: string[];
      rows: Record<string, string>[];
      preset: "tcgplayer" | "generic";
      mapping: ColumnMapping;
    }
  | { ok: false; error: string };

export async function parseCsvAction(formData: FormData): Promise<ParseResult> {
  await requireStore();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded" };
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: "File too large (max 15MB)" };

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return { ok: false, error: `Could not parse CSV: ${parsed.errors[0].message}` };
  }
  if (parsed.data.length === 0) return { ok: false, error: "The CSV contains no data rows" };
  if (parsed.data.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `Too many rows (${parsed.data.length}). Split the file below ${MAX_IMPORT_ROWS} rows.`,
    };
  }

  const headers = parsed.meta.fields ?? Object.keys(parsed.data[0]);
  const detected = detectMapping(headers);
  return { ok: true, headers, rows: parsed.data, preset: detected.preset, mapping: detected.mapping };
}

// --- step 2/3: map + match --------------------------------------------------

const mappingSchema = z.record(
  z.enum(IMPORT_FIELDS),
  z.string().nullable().optional()
);

const mappedRowSchema: z.ZodType<MappedRow> = z.object({
  rowIndex: z.number().int(),
  productId: z.number().int().positive().optional(),
  game: z.string().optional(),
  setName: z.string().optional(),
  productName: z.string().min(1),
  number: z.string().optional(),
  rarity: z.string().optional(),
  condition: z.string().optional(),
  printing: z.string().optional(),
  language: z.string().optional(),
  quantity: z.number().int().min(0),
  price: z.number().nonnegative().optional(),
  costBasis: z.number().nonnegative().optional(),
  tags: z.array(z.string()),
  sourceRow: z.record(z.string(), z.string()),
});

export type SerializedCandidate = {
  productId: number;
  name: string;
  number: string | null;
  rarity: string | null;
  productType: "single" | "sealed" | "other";
  expansionName: string | null;
};

export type MatchResponse =
  | {
      ok: true;
      matched: { row: MappedRow; product: SerializedCandidate; via: "exact_id" | "fuzzy" }[];
      ambiguous: { row: MappedRow; candidates: SerializedCandidate[] }[];
      unmatched: { row: MappedRow; reason: string }[];
      rowErrors: { rowIndex: number; error: string }[];
    }
  | { ok: false; error: string };

export async function matchRowsAction(input: {
  mapping: ColumnMapping;
  rows: Record<string, string>[];
}): Promise<MatchResponse> {
  await requireStore();
  const mapping = mappingSchema.parse(input.mapping);
  for (const f of REQUIRED_FIELDS) {
    if (!mapping[f]) return { ok: false, error: `Map the "${f}" column before matching` };
  }
  if (!Array.isArray(input.rows) || input.rows.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: "Invalid rows payload" };
  }

  const { rows: mappedRows, errors: rowErrors } = applyMapping(input.rows, mapping);
  const results = await matchRows(mappedRows);

  const slim = (c: {
    productId: number;
    name: string;
    number: string | null;
    rarity: string | null;
    productType: "single" | "sealed" | "other";
    expansionName?: string | null;
  }): SerializedCandidate => ({
    productId: c.productId,
    name: c.name,
    number: c.number,
    rarity: c.rarity,
    productType: c.productType,
    expansionName: c.expansionName ?? null,
  });

  const matched: Extract<MatchResponse, { ok: true }>["matched"] = [];
  const ambiguous: Extract<MatchResponse, { ok: true }>["ambiguous"] = [];
  const unmatched: Extract<MatchResponse, { ok: true }>["unmatched"] = [];
  for (const r of results) {
    if (r.status === "matched") matched.push({ row: r.row, product: slim(r.product), via: r.via });
    else if (r.status === "ambiguous")
      ambiguous.push({ row: r.row, candidates: r.candidates.map(slim) });
    else unmatched.push({ row: r.row, reason: r.reason });
  }

  return { ok: true, matched, ambiguous, unmatched, rowErrors };
}

// --- step 4: commit -----------------------------------------------------------

const commitSchema = z.object({
  items: z
    .array(z.object({ row: mappedRowSchema, productId: z.number().int().positive() }))
    .max(MAX_IMPORT_ROWS),
});

export type CommitResponse = { ok: true; count: number } | { ok: false; error: string };

export async function commitImportAction(input: unknown): Promise<CommitResponse> {
  const ctx = await requireStore();
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid commit payload" };

  const ids = [...new Set(parsed.data.items.map((i) => i.productId))];
  const productRows = ids.length
    ? await db
        .select({
          productId: products.productId,
          productType: products.productType,
          productTypeOverride: products.productTypeOverride,
        })
        .from(products)
        .where(inArray(products.productId, ids))
    : [];
  const typeById = new Map(
    productRows.map((p) => [p.productId, p.productTypeOverride ?? p.productType])
  );

  const items = [];
  for (const { row, productId } of parsed.data.items) {
    const productType = typeById.get(productId);
    if (!productType) return { ok: false, error: `Product ${productId} not in catalog` };
    items.push(toCommitItem(row, { productId, productType }));
  }

  const count = await commitImport(ctx.storeId, items);
  return { ok: true, count };
}

// --- helper for the ambiguous picker ----------------------------------------

export async function productSearchAction(query: string): Promise<SerializedCandidate[]> {
  await requireStore();
  const q = z.string().min(2).max(120).parse(query);
  const res = await db
    .select({
      productId: products.productId,
      name: products.name,
      number: products.number,
      rarity: products.rarity,
      productType: products.productType,
      productTypeOverride: products.productTypeOverride,
      expansionName: expansions.name,
    })
    .from(products)
    .innerJoin(expansions, eq(expansions.groupId, products.groupId))
    .where(ilike(products.name, `%${q}%`))
    .limit(20);
  return res.map((c) => ({
    productId: c.productId,
    name: c.name,
    number: c.number,
    rarity: c.rarity,
    productType: c.productTypeOverride ?? c.productType,
    expansionName: c.expansionName,
  }));
}
