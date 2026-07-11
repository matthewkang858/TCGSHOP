"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { inventoryItems } from "@/db/schema";
import { assertMembership, requireStore } from "@/lib/tenancy";

const updateSchema = z.object({
  id: z.string().uuid(),
  quantity: z.coerce.number().int().min(0).optional(),
  currentPrice: z
    .union([z.coerce.number().nonnegative(), z.literal(""), z.null()])
    .optional(),
  costBasis: z
    .union([z.coerce.number().nonnegative(), z.literal(""), z.null()])
    .optional(),
  tags: z.string().optional(),
});

export async function updateInventoryItemAction(input: unknown) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const parsed = updateSchema.parse(input);

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.quantity !== undefined) set.quantity = parsed.quantity;
  if (parsed.currentPrice !== undefined) {
    set.currentPrice =
      parsed.currentPrice === "" || parsed.currentPrice === null
        ? null
        : parsed.currentPrice.toFixed(2);
  }
  if (parsed.costBasis !== undefined) {
    set.costBasis =
      parsed.costBasis === "" || parsed.costBasis === null
        ? null
        : parsed.costBasis.toFixed(2);
  }
  if (parsed.tags !== undefined) {
    set.tags = parsed.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  await db
    .update(inventoryItems)
    .set(set)
    // store scoping is part of the WHERE, not just the lookup - tenant isolation
    .where(and(eq(inventoryItems.id, parsed.id), eq(inventoryItems.storeId, ctx.storeId)));

  revalidatePath("/inventory");
  return { ok: true as const };
}

export async function deleteInventoryItemAction(input: { id: string }) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const { id } = z.object({ id: z.string().uuid() }).parse(input);
  await db
    .delete(inventoryItems)
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.storeId, ctx.storeId)));
  revalidatePath("/inventory");
  return { ok: true as const };
}
