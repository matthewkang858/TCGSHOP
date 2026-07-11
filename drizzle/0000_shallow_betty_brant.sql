CREATE TYPE "public"."alert_type" AS ENUM('threshold_cross', 'pct_change', 'velocity', 'buylist_arb', 'restock_velocity');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."listing" AS ENUM('retail', 'buylist');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('single', 'sealed', 'other');--> statement-breakpoint
CREATE TYPE "public"."reprice_basis" AS ENUM('tcg_market', 'tcg_low', 'sales_median_7d', 'cardmarket_trend', 'ck_buylist');--> statement-breakpoint
CREATE TYPE "public"."reprice_run_status" AS ENUM('previewing', 'applied', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."rounding_mode" AS ENUM('psychological', 'quarter', 'dollar', 'cents');--> statement-breakpoint
CREATE TYPE "public"."stats_window" AS ENUM('24h', '7d', '30d');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"product_id" integer NOT NULL,
	"fired_at" timestamp DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delivered" jsonb,
	"read_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "alert_type" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cooldown_hours" integer DEFAULT 24 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expansions" (
	"group_id" integer PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"abbreviation" text,
	"published_on" timestamp
);
--> statement-breakpoint
CREATE TABLE "games" (
	"category_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" integer NOT NULL,
	"condition" text DEFAULT 'Near Mint' NOT NULL,
	"printing" text,
	"language" text DEFAULT 'English' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"current_price" numeric(12, 2),
	"cost_basis" numeric(12, 2),
	"tags" text[] DEFAULT '{}' NOT NULL,
	"source_row" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "job_status" DEFAULT 'running' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_store_id_pk" PRIMARY KEY("user_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" integer NOT NULL,
	"provider" text NOT NULL,
	"listing" "listing" DEFAULT 'retail' NOT NULL,
	"finish" text,
	"price" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"product_id" integer PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"clean_name" text NOT NULL,
	"number" text,
	"rarity" text,
	"image_url" text,
	"product_type" "product_type" DEFAULT 'other' NOT NULL,
	"product_type_override" "product_type",
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reprice_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"basis" "reprice_basis" DEFAULT 'tcg_market' NOT NULL,
	"multiplier" numeric(8, 4) DEFAULT '1' NOT NULL,
	"offset" numeric(12, 2) DEFAULT '0' NOT NULL,
	"condition_multipliers" jsonb,
	"floor" numeric(12, 2),
	"ceiling" numeric(12, 2),
	"min_price" numeric(12, 2) DEFAULT '0.25' NOT NULL,
	"max_change_pct" numeric(8, 2),
	"rounding" "rounding_mode" DEFAULT 'cents' NOT NULL,
	"respect_cost_basis" boolean DEFAULT false NOT NULL,
	"min_margin_pct" numeric(8, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reprice_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"rule_id" uuid,
	"basis_value" numeric(12, 2),
	"old_price" numeric(12, 2),
	"new_price" numeric(12, 2),
	"pct_change" numeric(10, 2),
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"excluded" boolean DEFAULT false NOT NULL,
	"approved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reprice_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"status" "reprice_run_status" DEFAULT 'previewing' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"flagged_count" integer DEFAULT 0 NOT NULL,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"rule_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"applied_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sales_stats" (
	"product_id" integer NOT NULL,
	"window" "stats_window" NOT NULL,
	"sale_count" integer DEFAULT 0 NOT NULL,
	"median_price" numeric(12, 2),
	"avg_price" numeric(12, 2),
	"trend" text,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_stats_product_id_window_pk" PRIMARY KEY("product_id","window")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"sku_id" integer PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"condition" text NOT NULL,
	"printing" text,
	"language" text DEFAULT 'English' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_product_id_products_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expansions" ADD CONSTRAINT "expansions_category_id_games_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."games"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_product_id_products_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_product_id_products_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_group_id_expansions_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."expansions"("group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_games_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."games"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reprice_rules" ADD CONSTRAINT "reprice_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reprice_run_items" ADD CONSTRAINT "reprice_run_items_run_id_reprice_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reprice_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reprice_run_items" ADD CONSTRAINT "reprice_run_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reprice_run_items" ADD CONSTRAINT "reprice_run_items_rule_id_reprice_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."reprice_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reprice_runs" ADD CONSTRAINT "reprice_runs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reprice_runs" ADD CONSTRAINT "reprice_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stats" ADD CONSTRAINT "sales_stats_product_id_products_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_product_id_products_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_product_id_products_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_alert_idx" ON "alert_events" USING btree ("alert_id","product_id","fired_at");--> statement-breakpoint
CREATE INDEX "alert_events_fired_idx" ON "alert_events" USING btree ("fired_at");--> statement-breakpoint
CREATE INDEX "alerts_store_idx" ON "alerts" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "expansions_category_idx" ON "expansions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "inventory_store_idx" ON "inventory_items" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "inventory_product_idx" ON "inventory_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_identity_uq" ON "inventory_items" USING btree ("store_id","product_id","condition","printing","language");--> statement-breakpoint
CREATE INDEX "job_runs_name_idx" ON "job_runs" USING btree ("name","started_at");--> statement-breakpoint
CREATE INDEX "snapshots_product_captured_idx" ON "price_snapshots" USING btree ("product_id","captured_at");--> statement-breakpoint
CREATE INDEX "snapshots_lookup_idx" ON "price_snapshots" USING btree ("product_id","provider","listing","captured_at");--> statement-breakpoint
CREATE INDEX "products_group_idx" ON "products" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_clean_name_idx" ON "products" USING btree ("clean_name");--> statement-breakpoint
CREATE INDEX "products_type_idx" ON "products" USING btree ("product_type");--> statement-breakpoint
CREATE INDEX "rules_store_idx" ON "reprice_rules" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "run_items_run_idx" ON "reprice_run_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_store_idx" ON "reprice_runs" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "skus_product_idx" ON "skus" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_uq" ON "watchlist_items" USING btree ("store_id","product_id");