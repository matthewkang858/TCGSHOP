import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { expansions, games, products } from "@/db/schema";
import { classifyProduct } from "@/lib/catalog/classifier";
import { getTcgApisClient } from "@/lib/tcgapis/client";
import type { CatalogRow } from "@/lib/tcgapis/types";
import { withJobRun } from "./job-run";

export const catalogSyncInput = z.object({
  /** sync a single game; omit to sync every game already in the games table */
  categoryId: z.number().int().positive().optional(),
});

const UPSERT_CHUNK = 500;

/**
 * catalog-sync: upsert games -> expansions -> products for a game,
 * running the sealed classifier at ingest. Idempotent and chunked;
 * safe to re-run at any time.
 */
export async function runCatalogSync(rawInput: unknown): Promise<void> {
  const input = catalogSyncInput.parse(rawInput ?? {});
  await withJobRun("catalog-sync", async (stats) => {
    const client = await getTcgApisClient();

    const apiGames = await client.listGames();
    stats.games = apiGames.length;
    if (apiGames.length > 0) {
      await db
        .insert(games)
        .values(
          apiGames.map((g) => ({
            categoryId: g.categoryId,
            name: g.name,
            displayName: g.displayName ?? g.name,
          }))
        )
        .onConflictDoUpdate({
          target: games.categoryId,
          set: {
            name: sql`excluded.name`,
            displayName: sql`excluded.display_name`,
          },
        });
    }

    const targets = input.categoryId
      ? apiGames.filter((g) => g.categoryId === input.categoryId)
      : apiGames;
    if (input.categoryId && targets.length === 0) {
      throw new Error(`Unknown categoryId ${input.categoryId}`);
    }

    let productCount = 0;
    let sealedCount = 0;
    const seenGroups = new Set<number>();

    for (const game of targets) {
      let batch: CatalogRow[] = [];
      const flush = async () => {
        if (batch.length === 0) return;
        // expansions first (products FK them)
        const expRows = new Map<number, CatalogRow>();
        for (const row of batch) {
          if (!seenGroups.has(row.groupId)) expRows.set(row.groupId, row);
        }
        if (expRows.size > 0) {
          await db
            .insert(expansions)
            .values(
              [...expRows.values()].map((r) => ({
                groupId: r.groupId,
                categoryId: r.categoryId,
                name: r.expansionName,
                abbreviation: r.expansionAbbreviation ?? null,
                publishedOn: r.expansionPublishedOn ? new Date(r.expansionPublishedOn) : null,
              }))
            )
            .onConflictDoUpdate({
              target: expansions.groupId,
              set: {
                name: sql`excluded.name`,
                abbreviation: sql`excluded.abbreviation`,
                publishedOn: sql`excluded.published_on`,
              },
            });
          for (const gid of expRows.keys()) seenGroups.add(gid);
        }

        await db
          .insert(products)
          .values(
            batch.map((r) => {
              const productType = classifyProduct({
                name: r.name,
                number: r.number,
                rarity: r.rarity,
              });
              if (productType === "sealed") sealedCount++;
              return {
                productId: r.productId,
                groupId: r.groupId,
                categoryId: r.categoryId,
                name: r.name,
                cleanName: r.cleanName,
                number: r.number ?? null,
                rarity: r.rarity ?? null,
                imageUrl: r.imageUrl ?? null,
                productType,
                updatedAt: new Date(),
              };
            })
          )
          .onConflictDoUpdate({
            target: products.productId,
            set: {
              name: sql`excluded.name`,
              cleanName: sql`excluded.clean_name`,
              number: sql`excluded.number`,
              rarity: sql`excluded.rarity`,
              imageUrl: sql`excluded.image_url`,
              productType: sql`excluded.product_type`,
              updatedAt: sql`excluded.updated_at`,
              // product_type_override is intentionally never touched by sync
            },
          });
        productCount += batch.length;
        batch = [];
      };

      for await (const row of client.catalogRows({
        categoryId: game.categoryId,
        name: game.name,
      })) {
        batch.push(row);
        if (batch.length >= UPSERT_CHUNK) await flush();
      }
      await flush();
    }

    stats.products = productCount;
    stats.sealed = sealedCount;
    stats.categories = targets.map((t) => t.categoryId);
  });
}
