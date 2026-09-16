"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  productSearchAction,
  type SerializedCandidate,
} from "@/app/(app)/inventory/import/actions";

export type PickedProduct = {
  id: number;
  label: string;
  productType: "single" | "sealed" | "other";
};

/** Catalog search-and-pick. The search box is the manual stand-in for a scanner. */
export function ProductPicker({
  value,
  onChange,
  autoFocus,
}: {
  value: PickedProduct | null;
  onChange: (v: PickedProduct | null) => void;
  autoFocus?: boolean;
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
          autoFocus={autoFocus}
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
                  productType: r.productType,
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
