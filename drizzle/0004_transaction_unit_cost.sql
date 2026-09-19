ALTER TABLE "transactions" ADD COLUMN "unit_cost" numeric(12, 2);--> statement-breakpoint
-- One-time backfill: sales recorded before the snapshot existed take the
-- line's cost as of now. From here on recordTransaction writes unit_cost at
-- the moment of sale, so later cost edits never rewrite profit history.
update "transactions" t
   set "unit_cost" = i."cost_basis"
  from "inventory_items" i
 where t."side" = 'sale'
   and t."unit_cost" is null
   and i."store_id" = t."store_id"
   and i."product_id" = t."product_id"
   and i."condition" = t."condition"
   and i."printing" is not distinct from t."printing"
   and i."language" = t."language"
   and i."cost_basis" is not null;
