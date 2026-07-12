"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { inventoryItems } from "@/db/schema";
import { assertMembership, requireStore } from "@/lib/tenancy";
import { suggestedStickerPrice } from "@/lib/sticker";

/**
 * "I updated the shelf sticker" - records the suggested sticker price as
 * what's physically on the shelf. The item leaves the queue and returns
 * only when the system price drifts past the sticker rounding step again.
 */
export async function markStickerUpdatedAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const id = z.string().uuid().parse(formData.get("itemId"));

  const [item] = await db
    .select({ id: inventoryItems.id, currentPrice: inventoryItems.currentPrice })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.storeId, ctx.storeId)));
  if (!item || item.currentPrice == null) return;

  const sticker = suggestedStickerPrice(Number(item.currentPrice));
  await db
    .update(inventoryItems)
    .set({ stickerPrice: sticker.toFixed(2), stickerUpdatedAt: new Date() })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.storeId, ctx.storeId)));

  revalidatePath("/dashboard");
}
