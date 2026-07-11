import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { expansions, games, inventoryItems, products } from "@/db/schema";
import type { MappedRow } from "./mapping";
import { matchRow, type CandidateProduct, type MatchResult } from "./matcher";

/**
 * DB-backed side of the import pipeline: candidate retrieval + idempotent
 * commit. The pure matching logic lives in matcher.ts.
 */

const candidateColumns = {
  productId: products.productId,
  name: products.name,
  cleanName: products.cleanName,
  number: products.number,
  rarity: products.rarity,
  groupId: products.groupId,
  categoryId: products.categoryId,
  productType: sql<
    "single" | "sealed" | "other"
  >`coalesce(${products.productTypeOverride}, ${products.productType})`,
  expansionName: expansions.name,
  expansionAbbreviation: expansions.abbreviation,
};

async function resolveGameIds(): Promise<Map<string, number>> {
  const rows = await db.select().from(games);
  const map = new Map<string, number>();
  for (const g of rows) {
    map.set(g.name.toLowerCase(), g.categoryId);
    map.set(g.displayName.toLowerCase(), g.categoryId);
  }
  return map;
}

async function resolveExpansions(): Promise<
  Map<string, { groupId: number; categoryId: number }>
> {
  const rows = await db.select().from(expansions);
  const map = new Map<string, { groupId: number; categoryId: number }>();
  for (const e of rows) {
    map.set(e.name.toLowerCase(), { groupId: e.groupId, categoryId: e.categoryId });
    if (e.abbreviation) {
      map.set(e.abbreviation.toLowerCase(), { groupId: e.groupId, categoryId: e.categoryId });
    }
  }
  return map;
}

/** significant tokens for the ILIKE prefilter */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 3);
}

export async function matchRows(rows: MappedRow[]): Promise<MatchResult[]> {
  const gameIds = await resolveGameIds();
  const expIndex = await resolveExpansions();

  // one query for all exact-id rows
  const idRows = rows.filter((r) => r.productId).map((r) => r.productId!);
  const idProducts =
    idRows.length > 0
      ? await db
          .select(candidateColumns)
          .from(products)
          .innerJoin(expansions, eq(expansions.groupId, products.groupId))
          .where(inArray(products.productId, [...new Set(idRows)]))
      : [];
  const byId = new Map(idProducts.map((p) => [p.productId, p]));

  // group-level candidate pools, fetched once per referenced expansion
  const poolCache = new Map<number, CandidateProduct[]>();
  async function groupPool(groupId: number): Promise<CandidateProduct[]> {
    if (!poolCache.has(groupId)) {
      const pool = await db
        .select(candidateColumns)
        .from(products)
        .innerJoin(expansions, eq(expansions.groupId, products.groupId))
        .where(eq(products.groupId, groupId));
      poolCache.set(groupId, pool);
    }
    return poolCache.get(groupId)!;
  }

  const results: MatchResult[] = [];
  for (const row of rows) {
    if (row.productId) {
      const exact = byId.get(row.productId);
      results.push(
        matchRow(row, exact ? [exact] : []) // matcher handles found/not-found messaging
      );
      continue;
    }

    const exp = row.setName ? expIndex.get(row.setName.toLowerCase()) : undefined;
    let pool: CandidateProduct[];
    if (exp) {
      pool = await groupPool(exp.groupId);
    } else {
      // fall back to a token prefilter, optionally narrowed by game
      const tokens = nameTokens(row.productName);
      const categoryId = row.game ? gameIds.get(row.game.toLowerCase()) : undefined;
      const tokenFilters = tokens.map((t) => ilike(products.cleanName, `%${t}%`));
      const where = and(
        categoryId ? eq(products.categoryId, categoryId) : undefined,
        tokenFilters.length ? or(...tokenFilters) : undefined
      );
      pool = await db
        .select(candidateColumns)
        .from(products)
        .innerJoin(expansions, eq(expansions.groupId, products.groupId))
        .where(where)
        .limit(300);
    }
    results.push(matchRow(row, pool));
  }
  return results;
}

export type CommitItem = {
  productId: number;
  condition: string;
  printing: string | null;
  language: string;
  quantity: number;
  price: number | null;
  costBasis: number | null;
  tags: string[];
  sourceRow: Record<string, string>;
};

/** Normalize a matched row into its inventory identity, applying sealed defaults. */
export function toCommitItem(
  row: MappedRow,
  product: Pick<CandidateProduct, "productId" | "productType">
): CommitItem {
  const sealed = product.productType === "sealed";
  return {
    productId: product.productId,
    condition: sealed ? "Unopened" : (row.condition ?? "Near Mint"),
    printing: sealed ? null : (row.printing ?? null),
    language: row.language ?? "English",
    quantity: row.quantity,
    price: row.price ?? null,
    costBasis: row.costBasis ?? null,
    tags: row.tags,
    sourceRow: row.sourceRow,
  };
}

/**
 * Idempotent commit: one upsert per (store, product, condition, printing,
 * language). Re-imports update quantity/price/cost instead of duplicating.
 * Duplicate identities *within* one file are merged (quantities summed) first.
 */
export async function commitImport(storeId: string, items: CommitItem[]): Promise<number> {
  if (items.length === 0) return 0;

  const merged = new Map<string, CommitItem>();
  for (const item of items) {
    const key = [item.productId, item.condition, item.printing ?? "", item.language].join("|");
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.price = item.price ?? existing.price;
      existing.costBasis = item.costBasis ?? existing.costBasis;
    } else {
      merged.set(key, { ...item });
    }
  }

  const values = [...merged.values()].map((item) => ({
    storeId,
    productId: item.productId,
    condition: item.condition,
    printing: item.printing,
    language: item.language,
    quantity: item.quantity,
    currentPrice: item.price !== null ? item.price.toFixed(2) : null,
    costBasis: item.costBasis !== null ? item.costBasis.toFixed(2) : null,
    tags: item.tags,
    sourceRow: item.sourceRow,
    updatedAt: new Date(),
  }));

  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db
      .insert(inventoryItems)
      .values(values.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [
          inventoryItems.storeId,
          inventoryItems.productId,
          inventoryItems.condition,
          inventoryItems.printing,
          inventoryItems.language,
        ],
        set: {
          quantity: sql`excluded.quantity`,
          currentPrice: sql`coalesce(excluded.current_price, ${inventoryItems.currentPrice})`,
          costBasis: sql`coalesce(excluded.cost_basis, ${inventoryItems.costBasis})`,
          tags: sql`excluded.tags`,
          sourceRow: sql`excluded.source_row`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return values.length;
}
