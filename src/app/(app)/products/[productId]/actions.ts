"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products, watchlistItems } from "@/db/schema";
import { assertMembership, requireStore } from "@/lib/tenancy";

const idSchema = z.object({ productId: z.coerce.number().int().positive() });

export async function toggleWatchlistAction(input: { productId: number }) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const { productId } = idSchema.parse(input);

  const [existing] = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(
      and(eq(watchlistItems.storeId, ctx.storeId), eq(watchlistItems.productId, productId))
    );

  if (existing) {
    await db.delete(watchlistItems).where(eq(watchlistItems.id, existing.id));
  } else {
    await db
      .insert(watchlistItems)
      .values({ storeId: ctx.storeId, productId })
      .onConflictDoNothing();
  }
  revalidatePath(`/products/${productId}`);
  return { ok: true as const, watching: !existing };
}

const overrideSchema = z.object({
  productId: z.coerce.number().int().positive(),
  override: z.enum(["single", "sealed", "other", ""]),
});

/** Manual product-type override (classifier correction). Catalog is shared; any member may fix it. */
export async function setProductTypeOverrideAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const parsed = overrideSchema.parse({
    productId: formData.get("productId"),
    override: formData.get("override") ?? "",
  });
  await db
    .update(products)
    .set({ productTypeOverride: parsed.override === "" ? null : parsed.override })
    .where(eq(products.productId, parsed.productId));
  revalidatePath(`/products/${parsed.productId}`);
}
