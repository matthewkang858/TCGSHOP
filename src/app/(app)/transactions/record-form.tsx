"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Banknote,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  Loader2,
  Wallet,
} from "lucide-react";
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
 * The four tenders a counter actually sees. `other`/`unknown` exist in the
 * schema for imports and older rows - a clerk never has to pick them.
 */
const PAYMENT_OPTIONS = [
  { key: "card", label: "Card", icon: CreditCard },
  { key: "cash", label: "Cash", icon: Banknote },
  { key: "store_credit", label: "Credit", icon: Wallet },
  { key: "trade", label: "Trade", icon: ArrowLeftRight },
] as const;

type CounterPaymentMethod = (typeof PAYMENT_OPTIONS)[number]["key"];

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
  // Card is the common counter tender, so it is the default - but it is still
  // only what the clerk says, never proof of anything.
  const [paymentMethod, setPaymentMethod] =
    React.useState<CounterPaymentMethod>("card");
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
        paymentMethod,
      });
      if (!res.ok) return setError(res.error);
      const paymentLabel =
        PAYMENT_OPTIONS.find((o) => o.key === paymentMethod)?.label ?? "";
      setFlash(
        `${side === "sale" ? "Sale" : "Buy"} recorded: ${quantity} × ${formatMoney(price)} ${product.label} = ${formatMoney(Number(price) * Number(quantity))}` +
          (paymentLabel ? ` · ${paymentLabel.toLowerCase()}` : "") +
          (res.inventoryAdjusted ? " · stock updated" : "")
      );
      setTimeout(() => setFlash(null), 4000);
      suggestRef.current++;
      setProduct(null);
      setSuggestion(null);
      setSuggesting(false);
      setQuantity("1");
      setPrice("");
      // back to the default: a tender carried over from the last customer
      // would quietly mislabel this one
      setPaymentMethod("card");
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

  const priceLabel = side === "sale" ? "Sold at ($ each)" : "Paid ($ each)";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a transaction</CardTitle>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          camera scanning coming soon — search works today
        </span>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {error ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <CircleAlert className="size-4 shrink-0" />
              {error}
            </div>
          ) : null}
          {flash ? (
            <div className="flex items-center gap-2 rounded-md border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
              <CheckCircle2 className="size-4 shrink-0" />
              {flash}
            </div>
          ) : null}

          {/* 1 — what kind of entry, and what card */}
          <div className="space-y-1.5">
            <SideToggle side={side} onChange={setSide} />
            <ProductPicker value={product} onChange={onPick} autoFocus />
          </div>

          {/* 2 — how it grades and how many */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="record-condition">Condition</Label>
              <Select
                id="record-condition"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="record-printing">Printing</Label>
              <Select
                id="record-printing"
                value={printing}
                onChange={(e) => setPrinting(e.target.value as "" | "Normal" | "Foil")}
              >
                <option value="">—</option>
                <option value="Normal">Normal</option>
                <option value="Foil">Foil</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="record-qty">Qty</Label>
              <Input
                id="record-qty"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="tabular-nums"
                required
              />
            </div>
          </div>

          {/* 3 — how the customer paid: one tap, pre-answered as Card */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Label id="record-payment-label">Paid with</Label>
              <span className="hidden text-xs text-muted-foreground sm:block">
                card sales become verifiable once you connect a POS
              </span>
            </div>
            <PaymentToggle value={paymentMethod} onChange={setPaymentMethod} />
          </div>

          {/* 4 — the money, and the one action that closes the sale */}
          <div className="rounded-md border border-border/60 bg-surface-subtle p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Label htmlFor="record-price">{priceLabel}</Label>
              {suggesting ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  looking up your shelf price…
                </span>
              ) : suggestion ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {[
                    suggestion.stickerPrice != null
                      ? `Shelf sticker ${formatMoney(suggestion.stickerPrice)}`
                      : null,
                    suggestion.currentPrice != null
                      ? `Your price ${formatMoney(suggestion.currentPrice)}`
                      : null,
                    suggestion.marketPrice != null
                      ? `TCG market ${formatMoney(suggestion.marketPrice)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "no market snapshot yet"}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="record-price"
                  ref={priceRef}
                  type="number"
                  step="0.01"
                  min="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="h-12 pl-7 font-medium tabular-nums md:h-12"
                  required
                />
              </div>
              <Button
                type="submit"
                size="lg"
                className="h-12 sm:w-40"
                disabled={busy || !product}
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                Record {side === "sale" ? "sale" : "buy"}
              </Button>
            </div>
            <label className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={adjustInventory}
                onChange={(e) => setAdjustInventory(e.target.checked)}
                className="size-4 accent-primary"
              />
              {side === "sale" ? "Deduct from inventory" : "Add to inventory (records cost)"}
            </label>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Tender is one tap, never a dropdown: the clerk is mid-sale, one-handed, on a
 * phone. Four 44px targets in a row, Card already chosen, so the fast path is
 * still "price → Record" with nothing extra to answer.
 *
 * What it records is a claim by the store, not a verified fact — so nothing
 * here says "verified". Card entries only become verifiable once a POS is
 * connected and the processor's charge id lands on the row.
 */
function PaymentToggle({
  value,
  onChange,
}: {
  value: CounterPaymentMethod;
  onChange: (m: CounterPaymentMethod) => void;
}) {
  return (
    <div
      role="group"
      aria-labelledby="record-payment-label"
      className="grid grid-cols-4 gap-1 rounded-md border border-input bg-muted/60 p-1"
    >
      {PAYMENT_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.key)}
            className={cn(
              "flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[5px] px-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              active
                ? "border border-border bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Sale/Buy is a mode, not two competing actions — so it is one segmented control. */
function SideToggle({
  side,
  onChange,
}: {
  side: "sale" | "purchase";
  onChange: (s: "sale" | "purchase") => void;
}) {
  return (
    <div
      role="group"
      aria-label="Transaction type"
      className="inline-flex h-11 w-full max-w-[320px] items-center rounded-md border border-input bg-muted/60 p-1 md:h-9"
    >
      {(
        [
          { key: "sale", label: "Sold a card" },
          { key: "purchase", label: "Bought a card" },
        ] as const
      ).map((opt) => (
        <button
          key={opt.key}
          type="button"
          aria-pressed={side === opt.key}
          onClick={() => onChange(opt.key)}
          className={cn(
            "h-full flex-1 rounded-[5px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            side === opt.key
              ? "border border-border bg-card text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
