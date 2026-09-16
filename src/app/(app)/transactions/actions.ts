"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { inventoryItems, transactions } from "@/db/schema";
import { assertMembership, requireStore } from "@/lib/tenancy";
import { recordTransaction } from "@/lib/transactions/service";

const recordSchema = z.object({
  productId: z.number().int().positive(),
  side: z.enum(["sale", "purchase"]),
  condition: z.string().trim().min(1).max(40),
  printing: z.enum(["", "Normal", "Foil"]).default(""),
  language: z.string().trim().min(1).max(40).default("English"),
  quantity: z.coerce.number().int().min(1).max(10_000),
  unitPrice: z.coerce.number().positive().max(1_000_000),
  notes: z.string().trim().max(500).optional(),
  adjustInventory: z.boolean().default(true),
});

export type RecordResult =
  | { ok: true; inventoryAdjusted: boolean }
  | { ok: false; error: string };

export async function recordTransactionAction(input: unknown): Promise<RecordResult> {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid transaction" };
  }
  const v = parsed.data;
  const result = await recordTransaction(ctx.storeId, ctx.userId, {
    productId: v.productId,
    side: v.side,
    condition: v.condition,
    printing: v.printing === "" ? null : v.printing,
    language: v.language,
    quantity: v.quantity,
    unitPrice: v.unitPrice,
    notes: v.notes,
    adjustInventory: v.adjustInventory,
  });
  revalidatePath("/transactions");
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  return { ok: true, inventoryAdjusted: result.inventoryAdjusted };
}

/** Remove a mis-entered ledger row. Does NOT reverse any inventory adjustment. */
export async function deleteTransactionAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const id = z.string().uuid().parse(formData.get("transactionId"));
  await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.storeId, ctx.storeId)));
  revalidatePath("/transactions");
}

export type PriceSuggestion = {
  stickerPrice: number | null;
  currentPrice: number | null;
  marketPrice: number | null;
};

/** Prefill helper: the store's own price for the item, plus latest market snapshot. */
export async function priceSuggestionAction(input: {
  productId: number;
}): Promise<PriceSuggestion> {
  const ctx = await requireStore();
  const productId = z.number().int().positive().parse(input.productId);

  const [item] = await db
    .select({
      stickerPrice: inventoryItems.stickerPrice,
      currentPrice: inventoryItems.currentPrice,
    })
    .from(inventoryItems)
    .where(
      and(eq(inventoryItems.storeId, ctx.storeId), eq(inventoryItems.productId, productId))
    )
    .orderBy(sql`${inventoryItems.quantity} desc`)
    .limit(1);

  const market = await db.execute<{ price: string }>(sql`
    select price from price_snapshots
    where product_id = ${productId} and provider = 'tcgplayer' and listing = 'retail'
    order by captured_at desc limit 1
  `);

  return {
    stickerPrice: item?.stickerPrice != null ? Number(item.stickerPrice) : null,
    currentPrice: item?.currentPrice != null ? Number(item.currentPrice) : null,
    marketPrice: market.rows[0]?.price != null ? Number(market.rows[0].price) : null,
  };
}
