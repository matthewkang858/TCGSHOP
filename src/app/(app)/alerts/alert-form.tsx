"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createAlertAction } from "./actions";
import { productSearchAction, type SerializedCandidate } from "../inventory/import/actions";

const TYPE_INFO: Record<string, { label: string; hint: string }> = {
  pct_change: {
    label: "% price move",
    hint: "Fires when a product moves more than X% over a window. Scope it to your whole inventory or just your watchlist.",
  },
  threshold_cross: {
    label: "Price threshold",
    hint: "Fires when a specific product crosses above/below a dollar amount.",
  },
  velocity: {
    label: "Sales velocity",
    hint: "Fires when a watchlist product sells at least N copies in 24h.",
  },
  buylist_arb: {
    label: "Buylist arbitrage",
    hint: "Fires when Card Kingdom's buylist reaches X% of TCG market — a sell-to-buylist spread signal. Magic only (Card Kingdom doesn't buy other games).",
  },
  restock_velocity: {
    label: "Restock signal",
    hint: "Fires when your stock is at/below N while the market sold at least M in 24h. Built for the sealed wall.",
  },
};

function ProductPicker({
  value,
  onChange,
}: {
  value: { id: number; label: string } | null;
  onChange: (v: { id: number; label: string } | null) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SerializedCandidate[]>([]);
  const [searching, setSearching] = React.useState(false);

  async function search() {
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      setResults(await productSearchAction(query.trim()));
    } finally {
      setSearching(false);
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <span className="flex-1 truncate">{value.label}</span>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)} type="button">
          change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the catalog…"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={search} disabled={searching}>
          {searching ? <Loader2 className="animate-spin" /> : <Search />}
        </Button>
      </div>
      {results.length > 0 ? (
        <div className="max-h-44 overflow-y-auto rounded-md border">
          {results.map((r) => (
            <button
              key={r.productId}
              type="button"
              className="block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent"
              onClick={() =>
                onChange({
                  id: r.productId,
                  label: `${r.name}${r.expansionName ? ` · ${r.expansionName}` : ""}`,
                })
              }
            >
              {r.name}
              <span className="text-muted-foreground">
                {r.number ? ` #${r.number}` : ""}
                {r.expansionName ? ` · ${r.expansionName}` : ""}
                {r.productType === "sealed" ? " · sealed" : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AlertForm() {
  const router = useRouter();
  const [type, setType] = React.useState<string>("pct_change");
  const [name, setName] = React.useState("");
  const [product, setProduct] = React.useState<{ id: number; label: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<Record<string, string>>({
    direction: "above",
    window: "7d",
    scope: "inventory",
    cooldownHours: "24",
  });

  const set = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: name || TYPE_INFO[type].label,
        type,
        cooldownHours: fields.cooldownHours || "24",
      };
      if (product) payload.product_id = product.id;
      for (const k of [
        "direction",
        "threshold",
        "pct",
        "window",
        "scope",
        "min_sales_24h",
        "spread_pct",
        "max_quantity",
        "min_market_sales_24h",
      ]) {
        if (fields[k] !== undefined && fields[k] !== "") payload[k] = fields[k];
      }
      // only send fields relevant to the chosen type
      const keep: Record<string, string[]> = {
        threshold_cross: ["product_id", "direction", "threshold"],
        pct_change: ["pct", "window", "scope"],
        velocity: ["product_id", "min_sales_24h"],
        buylist_arb: ["spread_pct"],
        restock_velocity: ["product_id", "max_quantity", "min_market_sales_24h"],
      };
      for (const key of Object.keys(payload)) {
        if (["name", "type", "cooldownHours"].includes(key)) continue;
        if (!keep[type].includes(key)) delete payload[key];
      }

      const res = await createAlertAction(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      setProduct(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New alert</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {error ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <CircleAlert className="h-4 w-4" />
              {error}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(TYPE_INFO).map(([value, info]) => (
                  <option key={value} value={value}>
                    {info.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">{TYPE_INFO[type].hint}</p>
            </div>
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={TYPE_INFO[type].label}
                maxLength={120}
              />
            </div>
          </div>

          {["threshold_cross", "velocity", "restock_velocity"].includes(type) ? (
            <div className="space-y-1">
              <Label>
                Product{type === "velocity" ? " (optional — blank = whole watchlist)" : ""}
              </Label>
              <ProductPicker value={product} onChange={setProduct} />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {type === "threshold_cross" ? (
              <>
                <div className="space-y-1">
                  <Label>Direction</Label>
                  <Select
                    value={fields.direction}
                    onChange={(e) => set("direction", e.target.value)}
                  >
                    <option value="above">crosses above</option>
                    <option value="below">crosses below</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Threshold ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={fields.threshold ?? ""}
                    onChange={(e) => set("threshold", e.target.value)}
                    required
                  />
                </div>
              </>
            ) : null}

            {type === "pct_change" ? (
              <>
                <div className="space-y-1">
                  <Label>Move ≥ (%)</Label>
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    value={fields.pct ?? ""}
                    onChange={(e) => set("pct", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Window</Label>
                  <Select value={fields.window} onChange={(e) => set("window", e.target.value)}>
                    <option value="24h">24 hours</option>
                    <option value="7d">7 days</option>
                    <option value="30d">30 days</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Scope</Label>
                  <Select value={fields.scope} onChange={(e) => set("scope", e.target.value)}>
                    <option value="inventory">Whole inventory</option>
                    <option value="watchlist">Watchlist only</option>
                  </Select>
                </div>
              </>
            ) : null}

            {type === "velocity" ? (
              <div className="space-y-1">
                <Label>Sales in 24h ≥</Label>
                <Input
                  type="number"
                  min="1"
                  value={fields.min_sales_24h ?? ""}
                  onChange={(e) => set("min_sales_24h", e.target.value)}
                  required
                />
              </div>
            ) : null}

            {type === "buylist_arb" ? (
              <div className="space-y-1">
                <Label>Buylist ≥ (% of market)</Label>
                <Input
                  type="number"
                  min="1"
                  value={fields.spread_pct ?? ""}
                  onChange={(e) => set("spread_pct", e.target.value)}
                  required
                />
              </div>
            ) : null}

            {type === "restock_velocity" ? (
              <>
                <div className="space-y-1">
                  <Label>Stock ≤</Label>
                  <Input
                    type="number"
                    min="0"
                    value={fields.max_quantity ?? ""}
                    onChange={(e) => set("max_quantity", e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Market sales 24h ≥</Label>
                  <Input
                    type="number"
                    min="1"
                    value={fields.min_market_sales_24h ?? ""}
                    onChange={(e) => set("min_market_sales_24h", e.target.value)}
                    required
                  />
                </div>
              </>
            ) : null}

            <div className="space-y-1">
              <Label>Cooldown (hours)</Label>
              <Input
                type="number"
                min="1"
                value={fields.cooldownHours}
                onChange={(e) => set("cooldownHours", e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              Create alert
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
