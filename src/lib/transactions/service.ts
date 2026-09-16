import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems, transactions } from "@/db/schema";

/**
 * The in-person transaction ledger. Recording a transaction optionally keeps
 * the store's working inventory in sync:
 *  - sale: decrements the matching inventory line (never below zero)
 *  - purchase: increments it, or creates the line with the buy price as
 *    cost basis (latest buy wins as the cost basis - simple over clever)
 *
 * A sale with no matching line still records - the ledger is the source of
 * truth for the price tape; inventory sync is a best-effort convenience.
 */

export type RecordTransactionInput = {
  productId: number;
  side: "sale" | "purchase";
  condition: string;
  printing: string | null;
  language: string;
  quantity: number;
  unitPrice: number;
  occurredAt?: Date;
  notes?: string | null;
  adjustInventory: boolean;
  source?: string;
};

export async function recordTransaction(
  storeId: string,
  userId: string | null,
  input: RecordTransactionInput
): Promise<{ transactionId: string; inventoryAdjusted: boolean }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(transactions)
      .values({
        storeId,
        productId: input.productId,
        side: input.side,
        condition: input.condition,
        printing: input.printing,
        language: input.language,
        quantity: input.quantity,
        unitPrice: input.unitPrice.toFixed(2),
        occurredAt: input.occurredAt ?? new Date(),
        source: input.source ?? "manual",
        notes: input.notes ?? null,
        recordedBy: userId,
      })
      .returning();

    let inventoryAdjusted = false;
    if (input.adjustInventory) {
      if (input.side === "sale") {
        const res = await tx
          .update(inventoryItems)
          .set({
            quantity: sql`greatest(0, ${inventoryItems.quantity} - ${input.quantity})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(inventoryItems.storeId, storeId),
              eq(inventoryItems.productId, input.productId),
              eq(inventoryItems.condition, input.condition),
              input.printing === null
                ? sql`${inventoryItems.printing} is null`
                : eq(inventoryItems.printing, input.printing),
              eq(inventoryItems.language, input.language)
            )
          );
        inventoryAdjusted = (res.rowCount ?? 0) > 0;
      } else {
        await tx
          .insert(inventoryItems)
          .values({
            storeId,
            productId: input.productId,
            condition: input.condition,
            printing: input.printing,
            language: input.language,
            quantity: input.quantity,
            costBasis: input.unitPrice.toFixed(2),
            tags: [],
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              inventoryItems.storeId,
              inventoryItems.productId,
              inventoryItems.condition,
              inventoryItems.printing,
              inventoryItems.language,
            ],
            set: {
              quantity: sql`${inventoryItems.quantity} + excluded.quantity`,
              costBasis: sql`excluded.cost_basis`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
        inventoryAdjusted = true;
      }
    }

    return { transactionId: row.id, inventoryAdjusted };
  });
}

/** Realized sale stats for a product at one store (the "street price"). */
export async function realizedSaleStats(
  storeId: string,
  productId: number,
  days = 30
): Promise<{ count: number; avgPrice: number | null; lastAt: Date | null }> {
  const res = await db.execute<{ count: string; avg: string | null; last: Date | null }>(sql`
    select count(*)::int as count,
           round(sum(unit_price * quantity) / nullif(sum(quantity), 0), 2) as avg,
           max(occurred_at) as last
    from transactions
    where store_id = ${storeId}
      and product_id = ${productId}
      and side = 'sale'
      and occurred_at >= now() - make_interval(days => ${days})
  `);
  const row = res.rows[0];
  return {
    count: Number(row?.count ?? 0),
    avgPrice: row?.avg != null ? Number(row.avg) : null,
    lastAt: row?.last ? new Date(row.last) : null,
  };
}
