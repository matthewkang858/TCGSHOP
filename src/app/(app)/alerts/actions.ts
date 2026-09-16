"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { alertEvents, alerts } from "@/db/schema";
import { assertMembership, requireStore } from "@/lib/tenancy";

const alertSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: z.enum([
      "threshold_cross",
      "pct_change",
      "velocity",
      "buylist_arb",
      "restock_velocity",
    ]),
    cooldownHours: z.coerce.number().int().min(1).max(24 * 30).default(24),
    // config fields (validated per type below)
    product_id: z.coerce.number().int().positive().optional(),
    direction: z.enum(["above", "below"]).optional(),
    threshold: z.coerce.number().positive().optional(),
    pct: z.coerce.number().positive().max(10000).optional(),
    window: z.enum(["24h", "7d", "30d"]).optional(),
    scope: z.enum(["watchlist", "inventory"]).optional(),
    min_sales_24h: z.coerce.number().int().positive().optional(),
    spread_pct: z.coerce.number().positive().max(1000).optional(),
    max_quantity: z.coerce.number().int().nonnegative().optional(),
    min_market_sales_24h: z.coerce.number().int().positive().optional(),
  })
  .superRefine((v, ctx) => {
    const need = (field: keyof typeof v, msg: string) => {
      if (v[field] === undefined) ctx.addIssue({ code: "custom", message: msg, path: [field] });
    };
    switch (v.type) {
      case "threshold_cross":
        need("product_id", "Pick a product");
        need("threshold", "Set a threshold price");
        break;
      case "pct_change":
        need("pct", "Set a % change");
        break;
      case "velocity":
        need("min_sales_24h", "Set a sales minimum");
        break;
      case "buylist_arb":
        need("spread_pct", "Set a spread %");
        break;
      case "restock_velocity":
        need("max_quantity", "Set a low-stock quantity");
        need("min_market_sales_24h", "Set a market sales minimum");
        break;
    }
  });

export type CreateAlertResult = { ok: true } | { ok: false; error: string };

export async function createAlertAction(input: unknown): Promise<CreateAlertResult> {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const parsed = alertSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid alert" };
  }
  const v = parsed.data;

  const config: Record<string, unknown> = {};
  for (const key of [
    "product_id",
    "direction",
    "threshold",
    "pct",
    "window",
    "scope",
    "min_sales_24h",
    "spread_pct",
    "max_quantity",
    "min_market_sales_24h",
  ] as const) {
    if (v[key] !== undefined) config[key] = v[key];
  }

  await db.insert(alerts).values({
    storeId: ctx.storeId,
    name: v.name,
    type: v.type,
    config,
    cooldownHours: v.cooldownHours,
    active: true,
  });
  revalidatePath("/alerts");
  return { ok: true };
}

export async function toggleAlertAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const id = z.string().uuid().parse(formData.get("alertId"));
  const active = formData.get("active") === "true";
  await db
    .update(alerts)
    .set({ active })
    .where(and(eq(alerts.id, id), eq(alerts.storeId, ctx.storeId)));
  revalidatePath("/alerts");
}

export async function deleteAlertAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const id = z.string().uuid().parse(formData.get("alertId"));
  await db.delete(alerts).where(and(eq(alerts.id, id), eq(alerts.storeId, ctx.storeId)));
  revalidatePath("/alerts");
}

export async function markEventsReadAction() {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const storeAlertIds = db
    .select({ id: alerts.id })
    .from(alerts)
    .where(eq(alerts.storeId, ctx.storeId));
  await db
    .update(alertEvents)
    .set({ readAt: new Date() })
    .where(and(inArray(alertEvents.alertId, storeAlertIds), isNull(alertEvents.readAt)));
  revalidatePath("/alerts");
}
