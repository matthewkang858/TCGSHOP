"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { memberships, stores, users } from "@/db/schema";
import { assertMembership, requireStore } from "@/lib/tenancy";
import { EXPORT_FIELDS } from "@/lib/repricing/export";

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  discordWebhook: z
    .string()
    .trim()
    .url()
    .startsWith("https://discord.com/api/webhooks/")
    .or(z.literal("")),
  emailAlerts: z.boolean(),
  dashboardAnalytics: z.boolean(),
  stalenessHours: z.coerce.number().int().min(1).max(24 * 14),
  defaultRounding: z.enum(["psychological", "quarter", "dollar", "cents"]),
});

export async function updateStoreSettingsAction(formData: FormData) {
  const ctx = await requireStore();
  const { role } = await assertMembership(ctx.storeId);
  if (role !== "owner") throw new Error("Only owners can change store settings");

  const parsed = settingsSchema.parse({
    name: formData.get("name"),
    discordWebhook: formData.get("discordWebhook") ?? "",
    emailAlerts: formData.get("emailAlerts") === "on",
    dashboardAnalytics: formData.get("dashboardAnalytics") === "on",
    stalenessHours: formData.get("stalenessHours") || 24,
    defaultRounding: formData.get("defaultRounding") ?? "psychological",
  });

  const [store] = await db.select().from(stores).where(eq(stores.id, ctx.storeId));
  await db
    .update(stores)
    .set({
      name: parsed.name,
      settings: {
        ...store.settings,
        discord_webhook_url: parsed.discordWebhook || undefined,
        email_alerts: parsed.emailAlerts,
        dashboard_analytics: parsed.dashboardAnalytics,
        snapshot_staleness_hours: parsed.stalenessHours,
        default_rounding: parsed.defaultRounding,
      },
    })
    .where(eq(stores.id, ctx.storeId));
  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

const mappingSchema = z
  .array(
    z.object({
      header: z.string().trim().min(1).max(80),
      field: z.enum(EXPORT_FIELDS),
    })
  )
  .min(1)
  .max(30);

export async function updateExportMappingAction(formData: FormData) {
  const ctx = await requireStore();
  await assertMembership(ctx.storeId);

  const headers = formData.getAll("map_header").map(String);
  const fields = formData.getAll("map_field").map(String);
  const pairs = headers
    .map((h, i) => ({ header: h.trim(), field: fields[i] }))
    .filter((p) => p.header !== "" && p.field !== "");

  const parsed = mappingSchema.parse(pairs);
  const mapping: Record<string, string> = {};
  for (const { header, field } of parsed) mapping[header] = field;

  const [store] = await db.select().from(stores).where(eq(stores.id, ctx.storeId));
  await db
    .update(stores)
    .set({
      settings: {
        ...store.settings,
        export_mappings: { ...store.settings.export_mappings, tcgplayer: mapping },
      },
    })
    .where(eq(stores.id, ctx.storeId));
  revalidatePath("/settings");
}

export async function inviteMemberAction(formData: FormData) {
  const ctx = await requireStore();
  const { role } = await assertMembership(ctx.storeId);
  if (role !== "owner") throw new Error("Only owners can invite members");

  const email = z.string().email().parse(formData.get("email"));
  const memberRole = z.enum(["owner", "member"]).parse(formData.get("role") ?? "member");

  // create the user shell if needed; they sign in later via magic link
  let [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    [user] = await db.insert(users).values({ email }).returning();
  }
  await db
    .insert(memberships)
    .values({ userId: user.id, storeId: ctx.storeId, role: memberRole })
    .onConflictDoNothing();
  revalidatePath("/settings");
}

export async function removeMemberAction(formData: FormData) {
  const ctx = await requireStore();
  const { role, userId } = await assertMembership(ctx.storeId);
  if (role !== "owner") throw new Error("Only owners can remove members");
  const targetId = z.string().uuid().parse(formData.get("userId"));
  if (targetId === userId) throw new Error("You can't remove yourself");
  await db
    .delete(memberships)
    .where(and(eq(memberships.userId, targetId), eq(memberships.storeId, ctx.storeId)));
  revalidatePath("/settings");
}
