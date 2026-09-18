import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { expansions, games, repriceRules } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Rule = typeof repriceRules.$inferSelect;

const CONDITIONS = [
  "Near Mint",
  "Lightly Played",
  "Moderately Played",
  "Heavily Played",
  "Damaged",
  "Unopened",
];

// ck_buylist stays in the schema/engine but is hidden while the MVP is
// Pokemon-only (Card Kingdom buys Magic exclusively)
const BASIS_OPTIONS: { value: Rule["basis"]; label: string; hint?: string }[] = [
  { value: "tcg_market", label: "TCG Market (default)" },
  { value: "tcg_low", label: "TCG Low", hint: "lowest current listing" },
  { value: "sales_median_7d", label: "7-day sales median" },
  { value: "cardmarket_trend", label: "Cardmarket trend (P1 - EU)", hint: "stub" },
];

const labelClass = "text-sm font-medium text-foreground";
const helpClass = "text-xs text-muted-foreground";
const checkboxClass = "size-4 shrink-0 accent-primary";
const multiSelectClass =
  "w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

/** Shared create/edit rule form (server component; plain form posts). */
export async function RuleForm({
  rule,
  action,
}: {
  rule?: Rule;
  action: (formData: FormData) => Promise<void>;
}) {
  const allGames = await db.select().from(games).orderBy(asc(games.categoryId));
  const allExpansions = await db
    .select()
    .from(expansions)
    .orderBy(asc(expansions.categoryId), asc(expansions.name));
  const gameNames = new Map(allGames.map((g) => [g.categoryId, g.displayName]));

  const scope = rule?.scope ?? {};
  const cmString = rule?.conditionMultipliers
    ? Object.entries(rule.conditionMultipliers)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ")
    : "";

  return (
    <form action={action} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Rule basics</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-1 sm:col-span-2">
            <span className={labelClass}>Name</span>
            <Input
              name="name"
              required
              maxLength={120}
              defaultValue={rule?.name ?? ""}
              placeholder="Singles: peg to TCG market"
            />
          </label>
          <label className="block space-y-1">
            <span className={labelClass}>Priority</span>
            <Input
              name="priority"
              type="number"
              min={1}
              max={9999}
              defaultValue={rule?.priority ?? 100}
            />
            <span className={helpClass}>lower numbers go first when rules overlap</span>
          </label>
          <label className="flex items-center gap-2 sm:pt-6">
            <input
              type="checkbox"
              name="active"
              defaultChecked={rule?.active ?? true}
              className={checkboxClass}
            />
            <span className={labelClass}>Active</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What this rule covers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className={helpClass}>
            Every filter narrows the match — leave everything blank to cover your whole
            inventory. Most stores run separate sealed and singles rules.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1 rounded-md border border-border/60 p-3">
              <span className={labelClass}>Product type</span>
              <div className="flex gap-4 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="scope_product_type"
                    value="single"
                    defaultChecked={scope.product_type?.includes("single")}
                    className={checkboxClass}
                  />
                  Singles
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="scope_product_type"
                    value="sealed"
                    defaultChecked={scope.product_type?.includes("sealed")}
                    className={checkboxClass}
                  />
                  Sealed
                </label>
              </div>
              <p className={helpClass}>unchecked = both</p>
            </div>

            <label className="block space-y-1">
              <span className={labelClass}>Games</span>
              <select
                name="scope_category_ids"
                multiple
                size={4}
                className={multiSelectClass}
                defaultValue={(scope.category_ids ?? []).map(String)}
              >
                {allGames.map((g) => (
                  <option key={g.categoryId} value={g.categoryId}>
                    {g.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className={labelClass}>Expansions</span>
              <select
                name="scope_group_ids"
                multiple
                size={4}
                className={multiSelectClass}
                defaultValue={(scope.group_ids ?? []).map(String)}
              >
                {allExpansions.map((e) => (
                  <option key={e.groupId} value={e.groupId}>
                    {gameNames.get(e.categoryId)}: {e.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className={labelClass}>Rarities</span>
              <Input
                name="scope_rarity"
                defaultValue={scope.rarity?.join(", ") ?? ""}
                placeholder="Rare Holo, Mythic"
              />
              <span className={helpClass}>comma separated</span>
            </label>

            <div className="space-y-1">
              <span className={labelClass}>Basis price band</span>
              <div className="flex items-center gap-2">
                <Input
                  name="scope_price_min"
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="min $"
                  defaultValue={scope.price_min ?? ""}
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  name="scope_price_max"
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="max $"
                  defaultValue={scope.price_max ?? ""}
                />
              </div>
            </div>

            <label className="block space-y-1">
              <span className={labelClass}>Tags</span>
              <Input
                name="scope_tags"
                defaultValue={scope.tags?.join(", ") ?? ""}
                placeholder="binder, display-case"
              />
              <span className={helpClass}>comma separated</span>
            </label>

            <div className="space-y-1">
              <span className={labelClass}>Conditions</span>
              <div className="grid grid-cols-2 gap-1 pt-1">
                {CONDITIONS.map((c) => (
                  <label key={c} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="scope_condition"
                      value={c}
                      defaultChecked={scope.condition?.includes(c)}
                      className={checkboxClass}
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>

            <label className="block space-y-1">
              <span className={labelClass}>Printing</span>
              <Select name="scope_printing" defaultValue={scope.printing ?? ""}>
                <option value="">Any</option>
                <option value="normal">Normal only</option>
                <option value="foil">Foil only</option>
              </Select>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How the price is set</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className={helpClass}>
            New price = market basis × multiplier + offset, kept between floor and ceiling,
            then rounded. Played singles get condition discounts; min-price and margin
            guards apply last.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block space-y-1">
              <span className={labelClass}>Basis</span>
              <Select name="basis" defaultValue={rule?.basis ?? "tcg_market"}>
                {BASIS_OPTIONS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1">
              <span className={labelClass}>Multiplier</span>
              <Input
                name="multiplier"
                type="number"
                step="0.0001"
                min="0.0001"
                defaultValue={rule ? Number(rule.multiplier) : 1}
              />
            </label>
            <label className="block space-y-1">
              <span className={labelClass}>Offset ($)</span>
              <Input
                name="offset"
                type="number"
                step="0.01"
                defaultValue={rule ? Number(rule.offset) : 0}
              />
            </label>
            <label className="block space-y-1">
              <span className={labelClass}>Rounding</span>
              <Select name="rounding" defaultValue={rule?.rounding ?? "psychological"}>
                <option value="psychological">Psychological (.49/.99)</option>
                <option value="quarter">Nearest quarter</option>
                <option value="dollar">Nearest dollar (sealed)</option>
                <option value="cents">Exact cents</option>
              </Select>
            </label>
            <label className="block space-y-1">
              <span className={labelClass}>Floor ($)</span>
              <Input
                name="floor"
                type="number"
                step="0.01"
                min={0}
                placeholder="none"
                defaultValue={rule?.floor != null ? Number(rule.floor) : ""}
              />
            </label>
            <label className="block space-y-1">
              <span className={labelClass}>Ceiling ($)</span>
              <Input
                name="ceiling"
                type="number"
                step="0.01"
                min={0}
                placeholder="none"
                defaultValue={rule?.ceiling != null ? Number(rule.ceiling) : ""}
              />
            </label>
            <label className="block space-y-1">
              <span className={labelClass}>Min price ($)</span>
              <Input
                name="min_price"
                type="number"
                step="0.01"
                min={0}
                defaultValue={rule?.minPrice != null ? Number(rule.minPrice) : 0.25}
              />
            </label>
            <label className="block space-y-1">
              <span className={labelClass}>Flag moves over (± %)</span>
              <Input
                name="max_change_pct"
                type="number"
                step="1"
                min={1}
                placeholder="never flag"
                defaultValue={rule?.maxChangePct != null ? Number(rule.maxChangePct) : ""}
              />
              <span className={helpClass}>flagged rows wait for your OK before applying</span>
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className={labelClass}>Condition multiplier overrides</span>
              <Input
                name="condition_multipliers"
                placeholder="Lightly Played:0.9, Damaged:0.5 (defaults: 1/.85/.70/.55/.40)"
                defaultValue={cmString}
              />
              <span className={helpClass}>sealed items always skip condition multipliers</span>
            </label>
            <div className="space-y-1 sm:col-span-2">
              <span className={labelClass}>Cost-basis guard (sealed insurance)</span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="respect_cost_basis"
                    defaultChecked={rule?.respectCostBasis ?? false}
                    className={checkboxClass}
                  />
                  Never price below cost
                </label>
                <label className="flex items-center gap-2 text-sm">
                  + margin
                  <Input
                    name="min_margin_pct"
                    type="number"
                    step="1"
                    min={0}
                    className="w-20"
                    defaultValue={rule?.minMarginPct != null ? Number(rule.minMarginPct) : 0}
                  />
                  %
                </label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline" size="lg" className="md:h-9 md:px-3.5">
          <Link href="/repricing">Cancel</Link>
        </Button>
        <Button type="submit" size="lg" className="md:h-9 md:px-3.5">
          {rule ? "Save rule" : "Create rule"}
        </Button>
      </div>
    </form>
  );
}
