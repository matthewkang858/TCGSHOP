"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ProductPicker, type PickedProduct } from "@/components/product-picker";
import { cn, formatMoney } from "@/lib/utils";
import {
  priceSuggestionAction,
  recordTransactionAction,
  type PriceSuggestion,
} from "./actions";

const CONDITIONS = [
  "Near Mint",
  "Lightly Played",
  "Moderately Played",
  "Heavily Played",
  "Damaged",
  "Unopened",
];

/**
 * Counter-speed transaction entry. The product search box is the manual
 * stand-in for a scanner - the flow is already scanner-shaped: identify
 * product -> confirm price -> done.
 */
export function RecordForm({
  initialPick,
  initialSide,
  initialCondition,
  initialPrinting,
}: {
  initialPick?: PickedProduct | null;
  initialSide?: "sale" | "purchase";
  initialCondition?: string;
  initialPrinting?: "" | "Normal" | "Foil";
}) {
  const router = useRouter();
  const [side, setSide] = React.useState<"sale" | "purchase">(initialSide ?? "sale");
  const [product, setProduct] = React.useState<PickedProduct | null>(null);
  const [condition, setCondition] = React.useState(initialCondition ?? "Near Mint");
  const [printing, setPrinting] = React.useState<"" | "Normal" | "Foil">(
    initialPrinting ?? ""
  );
  const [quantity, setQuantity] = React.useState("1");
  const [price, setPrice] = React.useState("");
  const [adjustInventory, setAdjustInventory] = React.useState(true);
  const [suggestion, setSuggestion] = React.useState<PriceSuggestion | null>(null);
  const [suggesting, setSuggesting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);

  const priceRef = React.useRef<HTMLInputElement>(null);
  // monotonic counter: a stale suggestion never fills the price field
  const suggestRef = React.useRef(0);
  const prefillConsumed = React.useRef(false);

  const onPick = React.useCallback(
    async (p: PickedProduct | null) => {
      const requestId = ++suggestRef.current;
      setProduct(p);
      setSuggestion(null);
      setSuggesting(false);
      if (!p) return;
      if (p.productType === "sealed") setCondition("Unopened");
      // counter speed: hands go straight to the price field
      priceRef.current?.focus();
      setSuggesting(true);
      try {
        const s = await priceSuggestionAction({ productId: p.id });
        if (suggestRef.current !== requestId) return;
        setSuggestion(s);
        // prefill with what's on the shelf: sticker beats system price beats market -
        // but never stomp a price the vendor already typed
        const suggested = s.stickerPrice ?? s.currentPrice ?? s.marketPrice;
        const el = priceRef.current;
        if (suggested != null && el && el.value === "") {
          setPrice(String(suggested));
          setTimeout(() => el.select(), 0);
        }
      } catch {
        // suggestion is a convenience; the form still works without it
      } finally {
        if (suggestRef.current === requestId) setSuggesting(false);
      }
    },
    []
  );

  // Quick-sell URL prefill goes through the exact same path as a manual pick,
  // so the suggestion fetch and sealed->Unopened rule fire identically.
  React.useEffect(() => {
    if (prefillConsumed.current) return;
    prefillConsumed.current = true;
    if (initialPick) void onPick(initialPick);
  }, [initialPick, onPick]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return setError("Pick a product first");
    setBusy(true);
    setError(null);
    try {
      const res = await recordTransactionAction({
        productId: product.id,
        side,
        condition,
        printing,
        quantity,
        unitPrice: price,
        adjustInventory,
      });
      if (!res.ok) return setError(res.error);
      setFlash(
        `${side === "sale" ? "Sale" : "Buy"} recorded: ${quantity} × ${formatMoney(price)} ${product.label} = ${formatMoney(Number(price) * Number(quantity))}` +
          (res.inventoryAdjusted ? " · stock updated" : "")
      );
      setTimeout(() => setFlash(null), 4000);
      suggestRef.current++;
      setProduct(null);
      setSuggestion(null);
      setSuggesting(false);
      setQuantity("1");
      setPrice("");
      // clearing `product` remounts the search input, whose autoFocus refocuses it
      if (window.location.search) {
        // strip quick-sell params so a refresh doesn't resurrect the prefill
        router.replace("/transactions");
      }
      router.refresh();
    } catch {
      setError("Could not record the transaction — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Record a transaction</CardTitle>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <ScanLine className="h-3.5 w-3.5" />
          camera scanning coming soon — search works today
        </span>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {error ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <CircleAlert className="h-4 w-4" />
              {error}
            </div>
          ) : null}
          {flash ? (
            <div className="flex items-center gap-2 rounded-md border border-success/50 bg-success/10 px-3 py-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />
              {flash}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant={side === "sale" ? "default" : "outline"}
              className={cn("flex-1", side === "sale" && "bg-success hover:bg-success")}
              onClick={() => setSide("sale")}
            >
              Sold a card
            </Button>
            <Button
              type="button"
              variant={side === "purchase" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setSide("purchase")}
            >
              Bought a card
            </Button>
          </div>

          <div className="space-y-1">
            <Label>Product</Label>
            <ProductPicker value={product} onChange={onPick} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <Label>Condition</Label>
              <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Printing</Label>
              <Select
                value={printing}
                onChange={(e) => setPrinting(e.target.value as "" | "Normal" | "Foil")}
              >
                <option value="">—</option>
                <option value="Normal">Normal</option>
                <option value="Foil">Foil</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Qty</Label>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label>{side === "sale" ? "Sold at ($ each)" : "Paid ($ each)"}</Label>
              <Input
                ref={priceRef}
                type="number"
                step="0.01"
                min="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </div>
          </div>

          {suggesting ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              looking up your shelf price…
            </p>
          ) : suggestion ? (
            <p className="text-xs text-muted-foreground">
              {suggestion.stickerPrice != null
                ? `Shelf sticker: $${suggestion.stickerPrice.toFixed(2)} · `
                : ""}
              {suggestion.currentPrice != null
                ? `Your price: $${suggestion.currentPrice.toFixed(2)} · `
                : ""}
              {suggestion.marketPrice != null
                ? `TCG market: $${suggestion.marketPrice.toFixed(2)}`
                : "no market snapshot yet"}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={adjustInventory}
                onChange={(e) => setAdjustInventory(e.target.checked)}
              />
              {side === "sale" ? "Deduct from inventory" : "Add to inventory (records cost)"}
            </label>
            <Button type="submit" disabled={busy || !product}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Record {side === "sale" ? "sale" : "buy"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
