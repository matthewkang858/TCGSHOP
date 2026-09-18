CREATE TYPE "public"."exclusion_reason" AS ENUM('price_outlier', 'store_outlier', 'implausible_vs_reference', 'non_positive_price');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'cash', 'store_credit', 'trade', 'other', 'unknown');--> statement-breakpoint
ALTER TYPE "public"."reprice_basis" ADD VALUE 'street_blended';--> statement-breakpoint
CREATE TABLE "market_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" integer NOT NULL,
	"condition" text NOT NULL,
	"printing" text,
	"language" text DEFAULT 'English' NOT NULL,
	"bucket_date" timestamp NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"unit_count" integer DEFAULT 0 NOT NULL,
	"store_count" integer DEFAULT 0 NOT NULL,
	"vwap" numeric(12, 2),
	"median_price" numeric(12, 2),
	"p25" numeric(12, 2),
	"p75" numeric(12, 2),
	"low_price" numeric(12, 2),
	"high_price" numeric(12, 2),
	"raw_trade_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"verified_trade_count" integer DEFAULT 0 NOT NULL,
	"verified_share" numeric(5, 4) DEFAULT '0' NOT NULL,
	"fenced_on_verified" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "market_obs_identity_uq" UNIQUE NULLS NOT DISTINCT("product_id","condition","printing","language","bucket_date")
);
--> statement-breakpoint
CREATE TABLE "street_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" integer NOT NULL,
	"condition" text NOT NULL,
	"printing" text,
	"language" text DEFAULT 'English' NOT NULL,
	"as_of" timestamp NOT NULL,
	"street_price" numeric(12, 2),
	"sample_trades" integer DEFAULT 0 NOT NULL,
	"sample_stores" integer DEFAULT 0 NOT NULL,
	"verified_share" numeric(5, 4) DEFAULT '0' NOT NULL,
	"confidence" numeric(5, 4) DEFAULT '0' NOT NULL,
	"confidence_breakdown" jsonb,
	"reference_price" numeric(12, 2),
	"blended_price" numeric(12, 2),
	"divergence_pct" numeric(10, 2),
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "street_price_identity_uq" UNIQUE NULLS NOT DISTINCT("product_id","condition","printing","language","as_of")
);
--> statement-breakpoint
CREATE TABLE "tape_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"product_id" integer NOT NULL,
	"bucket_date" timestamp NOT NULL,
	"reason" "exclusion_reason" NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"was_verified" boolean DEFAULT false NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "payment_method" "payment_method" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "payment_ref" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "payment_processor" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "market_observations" ADD CONSTRAINT "market_observations_product_id_products_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "street_prices" ADD CONSTRAINT "street_prices_product_id_products_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tape_exclusions" ADD CONSTRAINT "tape_exclusions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tape_exclusions" ADD CONSTRAINT "tape_exclusions_product_id_products_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_obs_product_date_idx" ON "market_observations" USING btree ("product_id","bucket_date");--> statement-breakpoint
CREATE INDEX "market_obs_date_idx" ON "market_observations" USING btree ("bucket_date");--> statement-breakpoint
CREATE INDEX "street_price_product_idx" ON "street_prices" USING btree ("product_id","as_of");--> statement-breakpoint
CREATE INDEX "street_price_divergence_idx" ON "street_prices" USING btree ("as_of","divergence_pct");--> statement-breakpoint
CREATE INDEX "tape_exclusions_date_idx" ON "tape_exclusions" USING btree ("bucket_date");--> statement-breakpoint
CREATE INDEX "tape_exclusions_reason_idx" ON "tape_exclusions" USING btree ("reason");--> statement-breakpoint
CREATE INDEX "transactions_occurred_product_idx" ON "transactions" USING btree ("occurred_at","product_id");