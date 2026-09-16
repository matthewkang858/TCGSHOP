"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { repriceRules, repriceRunItems, repriceRuns } from "@/db/schema";
import { assertMembership, requireStore } from "@/lib/tenancy";
import {
  applyRepriceRun,
  createRepriceRun,
  discardRepriceRun,
} from "@/lib/repricing/service";

// --- rule CRUD -----------------------------------------------------------------

const csvList = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const numOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${s}`);
  return n;
};

const ruleFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  priority: z.coerce.number().int().min(1).max(9999),
  active: z.boolean(),
  basis: z.enum(["tcg_market", "tcg_low", "sales_median_7d", "cardmarket_trend", "ck_buylist"]),
  multiplier: z.coerce.number().positive().max(100),
  offset: z.coerce.number().min(-10000).max(10000),
  floor: z.number().nonnegative().nullable(),
  ceiling: z.number().nonnegative().nullable(),
  minPrice: z.coerce.number().nonnegative().max(100000),
  maxChangePct: z.number().positive().nullable(),
  rounding: z.enum(["psychological", "quarter", "dollar", "cents"]),
  respectCostBasis: z.boolean(),
  minMarginPct: z.coerce.number().min(0).max(1000),
  scope: z.object({
    product_type: z.array(z.enum(["single", "sealed"])).optional(),
    category_ids: z.array(z.number().int()).optional(),
    group_ids: z.array(z.number().int()).optional(),
    rarity: z.array(z.string()).optional(),
    price_min: z.number().nonnegative().optional(),
    price_max: z.number().nonnegative().optional(),
    tags: z.array(z.string()).optional(),
    condition: z.array(z.string()).optional(),
    printing: z.enum(["normal", "foil"]).optional(),
  }),
  conditionMultipliers: z.record(z.string(), z.number().positive()).nullable(),
});

function parseRuleForm(formData: FormData) {
  const productTypes = formData.getAll("scope_product_type").map(String) as (
    | "single"
    | "sealed"
  )[];
  const categoryIds = formData.getAll("scope_category_ids").map((v) => Number(v));
  const groupIds = formData.getAll("scope_group_ids").map((v) => Number(v));
  const conditionsScope = formData.getAll("scope_condition").map(String);
  const printing = String(formData.get("scope_printing") ?? "");

  const scope: Record<string, unknown> = {};
  if (productTypes.length) scope.product_type = productTypes;
  if (categoryIds.length) scope.category_ids = categoryIds.filter((n) => Number.isInteger(n));
  if (groupIds.length) scope.group_ids = groupIds.filter((n) => Number.isInteger(n));
  const rarity = csvList(formData.get("scope_rarity"));
  if (rarity.length) scope.rarity = rarity;
  const priceMin = numOrNull(formData.get("scope_price_min"));
  const priceMax = numOrNull(formData.get("scope_price_max"));
  if (priceMin !== null) scope.price_min = priceMin;
  if (priceMax !== null) scope.price_max = priceMax;
  const tags = csvList(formData.get("scope_tags"));
  if (tags.length) scope.tags = tags;
  if (conditionsScope.length) scope.condition = conditionsScope;
  if (printing === "normal" || printing === "foil") scope.printing = printing;

  // optional per-condition multiplier overrides "Lightly Played:0.9, Damaged:0.5"
  let conditionMultipliers: Record<string, number> | null = null;
  const cmRaw = String(formData.get("condition_multipliers") ?? "").trim();
  if (cmRaw) {
    conditionMultipliers = {};
    for (const pair of cmRaw.split(",")) {
      const [k, v] = pair.split(":").map((s) => s.trim());
      const n = Number(v);
      if (!k || !Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid condition multiplier entry: "${pair.trim()}"`);
      }
      conditionMultipliers[k] = n;
    }
  }

  return ruleFormSchema.parse({
    name: formData.get("name"),
    priority: formData.get("priority") || 100,
    active: formData.get("active") === "on",
    basis: formData.get("basis"),
    multiplier: formData.get("multiplier") || 1,
    offset: formData.get("offset") || 0,
    floor: numOrNull(formData.get("floor")),
    ceiling: numOrNull(formData.get("ceiling")),
    minPrice: formData.get("min_price") || 0.25,
    maxChangePct: numOrNull(formData.get("max_change_pct")),
    rounding: formData.get("rounding"),
    respectCostBasis: formData.get("respect_cost_basis") === "on",
    minMarginPct: formData.get("min_margin_pct") || 0,
    scope,
    conditionMultipliers,
  });
}

function ruleToDbValues(parsed: ReturnType<typeof parseRuleForm>) {
  return {
    name: parsed.name,
    priority: parsed.priority,
    active: parsed.active,
    scope: parsed.scope,
    basis: parsed.basis,
    multiplier: String(parsed.multiplier),
    offset: String(parsed.offset),
    conditionMultipliers: parsed.conditionMultipliers,
    floor: parsed.floor !== null ? parsed.floor.toFixed(2) : null,
    ceiling: parsed.ceiling !== null ? parsed.ceiling.toFixed(2) : null,
    minPrice: parsed.minPrice.toFixed(2),
    maxChangePct: parsed.maxChangePct !== null ? String(parsed.maxChangePct) : null,
    rounding: parsed.rounding,
    respectCostBasis: parsed.respectCostBasis,
    minMarginPct: String(parsed.minMarginPct),
    updatedAt: new Date(),
  };
}

export async function createRuleAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const parsed = parseRuleForm(formData);
  await db.insert(repriceRules).values({ storeId: ctx.storeId, ...ruleToDbValues(parsed) });
  revalidatePath("/repricing");
  redirect("/repricing");
}

export async function updateRuleAction(ruleId: string, formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const id = z.string().uuid().parse(ruleId);
  const parsed = parseRuleForm(formData);
  await db
    .update(repriceRules)
    .set(ruleToDbValues(parsed))
    .where(and(eq(repriceRules.id, id), eq(repriceRules.storeId, ctx.storeId)));
  revalidatePath("/repricing");
  redirect("/repricing");
}

export async function deleteRuleAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const id = z.string().uuid().parse(formData.get("ruleId"));
  await db
    .delete(repriceRules)
    .where(and(eq(repriceRules.id, id), eq(repriceRules.storeId, ctx.storeId)));
  revalidatePath("/repricing");
}

export async function toggleRuleActiveAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const id = z.string().uuid().parse(formData.get("ruleId"));
  await db
    .update(repriceRules)
    .set({ active: formData.get("active") === "true", updatedAt: new Date() })
    .where(and(eq(repriceRules.id, id), eq(repriceRules.storeId, ctx.storeId)));
  revalidatePath("/repricing");
}

// --- run lifecycle ----------------------------------------------------------------

export async function createRunAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const ruleIds = z
    .array(z.string().uuid())
    .min(1, "Select at least one rule")
    .parse(formData.getAll("ruleIds").map(String));

  const result = await createRepriceRun(ctx.storeId, ctx.userId, ruleIds);
  if (!result.ok) {
    redirect(`/repricing?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/repricing/runs/${result.runId}`);
}

export async function applyRunAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const runId = z.string().uuid().parse(formData.get("runId"));
  const result = await applyRepriceRun(ctx.storeId, runId);
  if (!result.ok) redirect(`/repricing/runs/${runId}?error=${encodeURIComponent(result.error)}`);
  revalidatePath(`/repricing/runs/${runId}`);
  revalidatePath("/inventory");
  redirect(`/repricing/runs/${runId}`);
}

export async function discardRunAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const runId = z.string().uuid().parse(formData.get("runId"));
  await discardRepriceRun(ctx.storeId, runId);
  revalidatePath("/repricing");
  redirect("/repricing");
}

// --- preview row toggles -------------------------------------------------------------

const runItemToggleSchema = z.object({
  runId: z.string().uuid(),
  itemId: z.string().uuid(),
  field: z.enum(["excluded", "approved"]),
  value: z.boolean(),
});

export async function toggleRunItemAction(input: unknown) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const { runId, itemId, field, value } = runItemToggleSchema.parse(input);

  // scope through the run's store before touching the row
  const [run] = await db
    .select({ id: repriceRuns.id, status: repriceRuns.status })
    .from(repriceRuns)
    .where(and(eq(repriceRuns.id, runId), eq(repriceRuns.storeId, ctx.storeId)));
  if (!run || run.status !== "previewing") return { ok: false as const };

  await db
    .update(repriceRunItems)
    .set(field === "excluded" ? { excluded: value } : { approved: value })
    .where(and(eq(repriceRunItems.id, itemId), eq(repriceRunItems.runId, runId)));
  revalidatePath(`/repricing/runs/${runId}`);
  return { ok: true as const };
}

export async function approveAllFlaggedAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);
  const runId = z.string().uuid().parse(formData.get("runId"));
  const [run] = await db
    .select({ id: repriceRuns.id, status: repriceRuns.status })
    .from(repriceRuns)
    .where(and(eq(repriceRuns.id, runId), eq(repriceRuns.storeId, ctx.storeId)));
  if (run && run.status === "previewing") {
    await db
      .update(repriceRunItems)
      .set({ approved: true })
      .where(
        and(
          eq(repriceRunItems.runId, runId),
          eq(repriceRunItems.flagged, true),
          eq(repriceRunItems.excluded, false)
        )
      );
  }
  revalidatePath(`/repricing/runs/${runId}`);
}
