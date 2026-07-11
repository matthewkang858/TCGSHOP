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
    <form action={action} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Rule basics</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-sm font-medium">Name</span>
            <Input
              name="name"
              required
              maxLength={120}
              defaultValue={rule?.name ?? ""}
              placeholder="Singles: peg to TCG market"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Priority</span>
            <Input
              name="priority"
              type="number"
              min={1}
              max={9999}
              defaultValue={rule?.priority ?? 100}
            />
            <span className="text-xs text-muted-foreground">lower number wins overlaps</span>
          </label>
          <label className="flex items-center gap-2 pt-6">
            <input type="checkbox" name="active" defaultChecked={rule?.active ?? true} />
            <span className="text-sm font-medium">Active</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scope</CardTitle>
          <p className="text-sm text-muted-foreground">
            All filters AND together; leave everything empty to match the whole inventory.
            Most stores run separate sealed and singles rules.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1 rounded-md border-2 border-primary/30 p-3">
            <span className="text-sm font-semibold">Product type</span>
            <div className="flex gap-4 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="scope_product_type"
                  value="single"
                  defaultChecked={scope.product_type?.includes("single")}
                />
                Singles
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="scope_product_type"
                  value="sealed"
                  defaultChecked={scope.product_type?.includes("sealed")}
                />
                Sealed
              </label>
            </div>
            <p className="text-xs text-muted-foreground">unchecked = both</p>
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Games</span>
            <select
              name="scope_category_ids"
              multiple
              size={4}
              className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
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
            <span className="text-sm font-medium">Expansions</span>
            <select
              name="scope_group_ids"
              multiple
              size={4}
              className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
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
            <span className="text-sm font-medium">Rarities (comma separated)</span>
            <Input
              name="scope_rarity"
              defaultValue={scope.rarity?.join(", ") ?? ""}
              placeholder="Rare Holo, Mythic"
            />
          </label>

          <div className="space-y-1">
            <span className="text-sm font-medium">Basis price band</span>
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
            <span className="text-sm font-medium">Tags (comma separated)</span>
            <Input
              name="scope_tags"
              defaultValue={scope.tags?.join(", ") ?? ""}
              placeholder="binder, display-case"
            />
          </label>

          <div className="space-y-1">
            <span className="text-sm font-medium">Conditions</span>
            <div className="grid grid-cols-2 gap-1 pt-1">
              {CONDITIONS.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="scope_condition"
                    value={c}
                    defaultChecked={scope.condition?.includes(c)}
                  />
                  {c}
                </label>
              ))}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Printing</span>
            <Select name="scope_printing" defaultValue={scope.printing ?? ""}>
              <option value="">Any</option>
              <option value="normal">Normal only</option>
              <option value="foil">Foil only</option>
            </Select>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pricing formula</CardTitle>
          <p className="text-sm text-muted-foreground">
            new price = rounding(clamp(basis × multiplier + offset, floor, ceiling)) with
            condition multipliers for non-NM singles, then min-price and margin guards.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Basis</span>
            <Select name="basis" defaultValue={rule?.basis ?? "tcg_market"}>
              {BASIS_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Multiplier</span>
            <Input
              name="multiplier"
              type="number"
              step="0.0001"
              min="0.0001"
              defaultValue={rule ? Number(rule.multiplier) : 1}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Offset ($)</span>
            <Input
              name="offset"
              type="number"
              step="0.01"
              defaultValue={rule ? Number(rule.offset) : 0}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Rounding</span>
            <Select name="rounding" defaultValue={rule?.rounding ?? "psychological"}>
              <option value="psychological">Psychological (.49/.99)</option>
              <option value="quarter">Nearest quarter</option>
              <option value="dollar">Nearest dollar (sealed)</option>
              <option value="cents">Exact cents</option>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Floor ($)</span>
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
            <span className="text-sm font-medium">Ceiling ($)</span>
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
            <span className="text-sm font-medium">Min price ($)</span>
            <Input
              name="min_price"
              type="number"
              step="0.01"
              min={0}
              defaultValue={rule?.minPrice != null ? Number(rule.minPrice) : 0.25}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Flag moves over (± %)</span>
            <Input
              name="max_change_pct"
              type="number"
              step="1"
              min={1}
              placeholder="never flag"
              defaultValue={rule?.maxChangePct != null ? Number(rule.maxChangePct) : ""}
            />
            <span className="text-xs text-muted-foreground">
              flagged rows need manual approval
            </span>
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-sm font-medium">Condition multiplier overrides</span>
            <Input
              name="condition_multipliers"
              placeholder="Lightly Played:0.9, Damaged:0.5 (defaults: 1/.85/.70/.55/.40)"
              defaultValue={cmString}
            />
            <span className="text-xs text-muted-foreground">
              sealed items always skip condition multipliers
            </span>
          </label>
          <div className="space-y-1 sm:col-span-2">
            <span className="text-sm font-medium">Cost-basis guard (sealed insurance)</span>
            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="respect_cost_basis"
                  defaultChecked={rule?.respectCostBasis ?? false}
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
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="submit">{rule ? "Save rule" : "Create rule"}</Button>
      </div>
    </form>
  );
}
