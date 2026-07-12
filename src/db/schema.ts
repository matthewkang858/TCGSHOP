import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const productTypeEnum = pgEnum("product_type", ["single", "sealed", "other"]);
export const listingEnum = pgEnum("listing", ["retail", "buylist"]);
export const statsWindowEnum = pgEnum("stats_window", ["24h", "7d", "30d"]);
export const repriceBasisEnum = pgEnum("reprice_basis", [
  "tcg_market",
  "tcg_low",
  "sales_median_7d",
  "cardmarket_trend",
  "ck_buylist",
]);
export const roundingEnum = pgEnum("rounding_mode", [
  "psychological",
  "quarter",
  "dollar",
  "cents",
]);
export const repriceRunStatusEnum = pgEnum("reprice_run_status", [
  "previewing",
  "applied",
  "discarded",
]);
export const alertTypeEnum = pgEnum("alert_type", [
  "threshold_cross",
  "pct_change",
  "velocity",
  "buylist_arb",
  "restock_velocity",
]);
export const membershipRoleEnum = pgEnum("membership_role", ["owner", "member"]);
export const jobStatusEnum = pgEnum("job_status", ["running", "succeeded", "failed"]);

// ---------------------------------------------------------------------------
// Auth.js tables (users/accounts/sessions/verification tokens)
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })]
);

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export type StoreSettings = {
  discord_webhook_url?: string;
  default_rounding?: "psychological" | "quarter" | "dollar" | "cents";
  tier?: "starter" | "pro";
  /** editable CSV export column mappings, keyed by preset name */
  export_mappings?: Record<string, Record<string, string>>;
  /** staleness threshold (hours) before a reprice run requests a fresh sweep */
  snapshot_staleness_hours?: number;
  /** min item price for sales-stats refresh during nightly sweep */
  sales_stats_min_price?: number;
  /** email alert delivery on/off */
  email_alerts?: boolean;
};

export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  settings: jsonb("settings").$type<StoreSettings>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.storeId] })]
);

// ---------------------------------------------------------------------------
// Catalog cache (TCGplayer keyspace via TCGAPIs)
// ---------------------------------------------------------------------------

export const games = pgTable("games", {
  categoryId: integer("category_id").primaryKey(),
  name: text("name").notNull(), // ASCII name used in URLs ("Pokemon")
  displayName: text("display_name").notNull(),
});

export const expansions = pgTable(
  "expansions",
  {
    groupId: integer("group_id").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => games.categoryId),
    name: text("name").notNull(),
    abbreviation: text("abbreviation"),
    publishedOn: timestamp("published_on", { mode: "date" }),
  },
  (t) => [index("expansions_category_idx").on(t.categoryId)]
);

export const products = pgTable(
  "products",
  {
    productId: integer("product_id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => expansions.groupId),
    categoryId: integer("category_id")
      .notNull()
      .references(() => games.categoryId),
    name: text("name").notNull(),
    cleanName: text("clean_name").notNull(),
    number: text("number"),
    rarity: text("rarity"),
    imageUrl: text("image_url"),
    productType: productTypeEnum("product_type").notNull().default("other"),
    /** manual override; when set, wins over the classifier */
    productTypeOverride: productTypeEnum("product_type_override"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("products_group_idx").on(t.groupId),
    index("products_category_idx").on(t.categoryId),
    index("products_clean_name_idx").on(t.cleanName),
    index("products_type_idx").on(t.productType),
  ]
);

export const skus = pgTable(
  "skus",
  {
    skuId: integer("sku_id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.productId),
    condition: text("condition").notNull(),
    printing: text("printing"),
    language: text("language").notNull().default("English"),
  },
  (t) => [index("skus_product_idx").on(t.productId)]
);

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.productId),
    condition: text("condition").notNull().default("Near Mint"),
    printing: text("printing"),
    language: text("language").notNull().default("English"),
    quantity: integer("quantity").notNull().default(0),
    currentPrice: numeric("current_price", { precision: 12, scale: 2 }),
    costBasis: numeric("cost_basis", { precision: 12, scale: 2 }),
    /** price on the physical shelf sticker, recorded when staff mark it updated */
    stickerPrice: numeric("sticker_price", { precision: 12, scale: 2 }),
    stickerUpdatedAt: timestamp("sticker_updated_at"),
    tags: text("tags").array().notNull().default([]),
    sourceRow: jsonb("source_row").$type<Record<string, string>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("inventory_store_idx").on(t.storeId),
    index("inventory_product_idx").on(t.productId),
    // idempotent import key: one row per store/product/condition/printing/language.
    // NULLS NOT DISTINCT so sealed items (printing NULL) upsert correctly.
    unique("inventory_identity_uq")
      .on(t.storeId, t.productId, t.condition, t.printing, t.language)
      .nullsNotDistinct(),
  ]
);

// ---------------------------------------------------------------------------
// Price data (our own history - pages/alerts read this, never the API)
// ---------------------------------------------------------------------------

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.productId),
    provider: text("provider").notNull(), // tcgplayer | cardkingdom | ...
    listing: listingEnum("listing").notNull().default("retail"),
    finish: text("finish"), // normal | foil | etched | null
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
  },
  (t) => [
    index("snapshots_product_captured_idx").on(t.productId, t.capturedAt),
    index("snapshots_lookup_idx").on(t.productId, t.provider, t.listing, t.capturedAt),
  ]
);

export const salesStats = pgTable(
  "sales_stats",
  {
    productId: integer("product_id")
      .notNull()
      .references(() => products.productId),
    window: statsWindowEnum("window").notNull(),
    saleCount: integer("sale_count").notNull().default(0),
    medianPrice: numeric("median_price", { precision: 12, scale: 2 }),
    avgPrice: numeric("avg_price", { precision: 12, scale: 2 }),
    trend: text("trend"), // up | down | stable
    computedAt: timestamp("computed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.window] })]
);

// ---------------------------------------------------------------------------
// Repricing
// ---------------------------------------------------------------------------

export type RuleScope = {
  product_type?: ("single" | "sealed")[];
  category_ids?: number[];
  group_ids?: number[];
  rarity?: string[];
  price_min?: number; // basis price band
  price_max?: number;
  tags?: string[];
  condition?: string[];
  printing?: "normal" | "foil";
};

export type ConditionMultipliers = Record<string, number>;

export const repriceRules = pgTable(
  "reprice_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priority: integer("priority").notNull().default(100),
    active: boolean("active").notNull().default(true),
    scope: jsonb("scope").$type<RuleScope>().notNull().default({}),
    basis: repriceBasisEnum("basis").notNull().default("tcg_market"),
    multiplier: numeric("multiplier", { precision: 8, scale: 4 }).notNull().default("1"),
    offset: numeric("offset", { precision: 12, scale: 2 }).notNull().default("0"),
    conditionMultipliers: jsonb("condition_multipliers").$type<ConditionMultipliers>(),
    floor: numeric("floor", { precision: 12, scale: 2 }),
    ceiling: numeric("ceiling", { precision: 12, scale: 2 }),
    minPrice: numeric("min_price", { precision: 12, scale: 2 }).notNull().default("0.25"),
    maxChangePct: numeric("max_change_pct", { precision: 8, scale: 2 }),
    rounding: roundingEnum("rounding").notNull().default("cents"),
    respectCostBasis: boolean("respect_cost_basis").notNull().default(false),
    minMarginPct: numeric("min_margin_pct", { precision: 8, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("rules_store_idx").on(t.storeId)]
);

export const repriceRuns = pgTable(
  "reprice_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    status: repriceRunStatusEnum("status").notNull().default("previewing"),
    itemCount: integer("item_count").notNull().default(0),
    flaggedCount: integer("flagged_count").notNull().default(0),
    appliedCount: integer("applied_count").notNull().default(0),
    ruleIds: jsonb("rule_ids").$type<string[]>().notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    appliedAt: timestamp("applied_at"),
  },
  (t) => [index("runs_store_idx").on(t.storeId)]
);

export const repriceRunItems = pgTable(
  "reprice_run_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => repriceRuns.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => repriceRules.id, { onDelete: "set null" }),
    basisValue: numeric("basis_value", { precision: 12, scale: 2 }),
    oldPrice: numeric("old_price", { precision: 12, scale: 2 }),
    newPrice: numeric("new_price", { precision: 12, scale: 2 }),
    pctChange: numeric("pct_change", { precision: 10, scale: 2 }),
    flagged: boolean("flagged").notNull().default(false),
    flagReason: text("flag_reason"),
    /** user excluded this row from apply in the preview UI */
    excluded: boolean("excluded").notNull().default(false),
    /** user manually approved a flagged row */
    approved: boolean("approved").notNull().default(false),
  },
  (t) => [index("run_items_run_idx").on(t.runId)]
);

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type AlertConfig = {
  // threshold_cross
  product_id?: number;
  direction?: "above" | "below";
  threshold?: number;
  // pct_change
  pct?: number;
  window?: "24h" | "7d" | "30d";
  scope?: "watchlist" | "inventory";
  // velocity
  min_sales_24h?: number;
  // buylist_arb
  spread_pct?: number; // fire when ck_buylist >= spread_pct% of tcg_market
  // restock_velocity
  max_quantity?: number;
  min_market_sales_24h?: number;
};

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: alertTypeEnum("type").notNull(),
    config: jsonb("config").$type<AlertConfig>().notNull().default({}),
    cooldownHours: integer("cooldown_hours").notNull().default(24),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("alerts_store_idx").on(t.storeId)]
);

export type AlertDelivered = {
  in_app: boolean;
  email?: { ok: boolean; error?: string };
  discord?: { ok: boolean; error?: string };
};

export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.productId),
    firedAt: timestamp("fired_at").notNull().defaultNow(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    delivered: jsonb("delivered").$type<AlertDelivered>(),
    readAt: timestamp("read_at"),
  },
  (t) => [
    index("alert_events_alert_idx").on(t.alertId, t.productId, t.firedAt),
    index("alert_events_fired_idx").on(t.firedAt),
  ]
);

// Watchlist: per-store product watchlist backing threshold/pct alerts + sweeps
export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.productId),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("watchlist_uq").on(t.storeId, t.productId)]
);

// ---------------------------------------------------------------------------
// Job observability
// ---------------------------------------------------------------------------

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    status: jobStatusEnum("status").notNull().default("running"),
    stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [index("job_runs_name_idx").on(t.name, t.startedAt)]
);
