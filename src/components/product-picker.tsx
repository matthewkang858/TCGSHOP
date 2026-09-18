"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dataRowThumbClass } from "@/components/ui/data-row";
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
    const [name, ...rest] = value.label.split(" · ");
    return (
      <div className="flex h-14 items-center gap-3 rounded-md border border-input bg-card px-3">
        <ProductImage
          productId={value.id}
          name={name}
          className={`${dataRowThumbClass} shrink-0`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            {value.productType === "sealed" ? (
              <Badge variant="neutral" className="ml-2 shrink-0">
                sealed
              </Badge>
            ) : null}
          </div>
          {rest.length > 0 ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {rest.join(" · ")}
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(null)}
          type="button"
          className="shrink-0 text-muted-foreground"
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {searching && results.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">Searching…</p>
      ) : null}
      {!searching && searched && results.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">No matches</p>
      ) : null}
      {results.length > 0 ? (
        // Four rows visible at the shared 64px rhythm, the rest scroll.
        <div className="max-h-64 overflow-y-auto rounded-md border border-border/60">
          {results.map((r) => (
            <button
              key={r.productId}
              type="button"
              className="flex h-16 w-full items-center gap-3 border-b border-border/60 px-3 text-left transition-colors last:border-0 hover:bg-muted/40"
              onClick={() => pick(r)}
            >
              <ProductImage
                productId={r.productId}
                imageUrl={r.imageUrl}
                name={r.name}
                className={`${dataRowThumbClass} shrink-0`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center">
                  <span className="truncate text-sm font-medium text-foreground">
                    {r.name}
                  </span>
                  {r.productType === "sealed" ? (
                    <Badge variant="neutral" className="ml-2 shrink-0">
                      sealed
                    </Badge>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {[r.number ? `#${r.number}` : null, r.expansionName, r.rarity]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
