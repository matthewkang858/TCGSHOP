"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductImage } from "@/components/product-image";
import {
  searchProductsAction,
  type ProductHit,
} from "@/app/(app)/transactions/actions";

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
  const [results, setResults] = React.useState<ProductHit[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [searched, setSearched] = React.useState(false);
  // monotonic counter so a slow earlier response never overwrites a newer one
  const requestRef = React.useRef(0);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      requestRef.current++;
      setResults([]);
      setSearching(false);
      setSearched(false);
      return;
    }
    const requestId = ++requestRef.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const hits = await searchProductsAction(q);
        if (requestRef.current !== requestId) return;
        setResults(hits);
        setSearched(true);
      } catch {
        if (requestRef.current === requestId) setResults([]);
      } finally {
        if (requestRef.current === requestId) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  function pick(r: ProductHit) {
    requestRef.current++;
    setQuery("");
    setResults([]);
    setSearched(false);
    setSearching(false);
    onChange({
      id: r.productId,
      label: `${r.name}${r.expansionName ? ` · ${r.expansionName}` : ""}`,
      productType: r.productType,
    });
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
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or collector number…"
          className="pl-9"
          onKeyDown={(e) => {
            // Enter grabs the top hit - fastest path at the counter
            if (e.key === "Enter") {
              e.preventDefault();
              if (results[0]) pick(results[0]);
            }
          }}
        />
        {searching ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {searching && results.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Searching…</p>
      ) : null}
      {!searching && searched && results.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">No matches</p>
      ) : null}
      {results.length > 0 ? (
        <div className="max-h-60 overflow-y-auto rounded-md border">
          {results.map((r) => (
            <button
              key={r.productId}
              type="button"
              className="flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent"
              onClick={() => pick(r)}
            >
              <ProductImage
                productId={r.productId}
                imageUrl={r.imageUrl}
                name={r.name}
                className="h-12 w-9 shrink-0"
              />
              <span className="min-w-0">
                <span className="block truncate">{r.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {r.number ? `#${r.number} · ` : ""}
                  {r.expansionName ?? ""}
                  {r.productType === "sealed" ? " · sealed" : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
