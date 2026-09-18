import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, gte } from "drizzle-orm";
import { Banknote, Eye, EyeOff } from "lucide-react";
import { z } from "zod";
import { db } from "@/db";
import {
  expansions,
  games,
  inventoryItems,
  priceSnapshots,
  products,
  salesStats,
  skus,
  watchlistItems,
} from "@/db/schema";
import { requireStore } from "@/lib/tenancy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataRow } from "@/components/ui/data-row";
import { Section } from "@/components/ui/section";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PriceHistoryChart, type PricePoint } from "@/components/price-history-chart";
import { ProductImage } from "@/components/product-image";
import { realizedSaleStats } from "@/lib/transactions/service";
import { cn, formatDateTime, formatMoney, formatPct } from "@/lib/utils";
import { setProductTypeOverrideAction, toggleWatchlistAction } from "./actions";

/** One supporting price fact in the strip — label / value / sub, T3 / T4 / T5. */
function PriceFact({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3.5">
      <p className="truncate text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 truncate text-sm font-medium tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const ctx = await requireStore();
  const productId = z.coerce.number().int().positive().parse((await params).productId);

  const [product] = await db
    .select({
      productId: products.productId,
      name: products.name,
      number: products.number,
      rarity: products.rarity,
      imageUrl: products.imageUrl,
      productType: products.productType,
      productTypeOverride: products.productTypeOverride,
      expansionName: expansions.name,
      gameName: games.displayName,
      groupId: products.groupId,
      categoryId: products.categoryId,
    })
    .from(products)
    .innerJoin(expansions, eq(expansions.groupId, products.groupId))
    .innerJoin(games, eq(games.categoryId, products.categoryId))
    .where(eq(products.productId, productId));

  if (!product) notFound();
  const type = product.productTypeOverride ?? product.productType;

  // 90 days of local snapshot history, folded to one point per day per series
  const since = new Date(Date.now() - 90 * 86_400_000);
  const snapshots = await db
    .select()
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.productId, productId), gte(priceSnapshots.capturedAt, since)))
    .orderBy(asc(priceSnapshots.capturedAt));

  const byDay = new Map<string, PricePoint>();
  for (const s of snapshots) {
    const day = s.capturedAt.toISOString().slice(0, 10);
    const point = byDay.get(day) ?? { date: day };
    if (s.provider === "tcgplayer" && s.listing === "retail") point.market = Number(s.price);
    if (s.provider === "cardkingdom" && s.listing === "buylist") point.buylist = Number(s.price);
    byDay.set(day, point);
  }
  const chartData = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

  const latestMarket = [...snapshots]
    .reverse()
    .find((s) => s.provider === "tcgplayer" && s.listing === "retail");
  const latestBuylist = [...snapshots]
    .reverse()
    .find((s) => s.provider === "cardkingdom" && s.listing === "buylist");

  const stats = await db.select().from(salesStats).where(eq(salesStats.productId, productId));
  const statByWindow = new Map(stats.map((s) => [s.window, s]));

  const productSkus =
    type === "sealed"
      ? [] // printings suppressed for sealed
      : await db.select().from(skus).where(eq(skus.productId, productId));

  const myInventory = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.storeId, ctx.storeId), eq(inventoryItems.productId, productId)))
    .orderBy(asc(inventoryItems.condition));

  const [watching] = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(and(eq(watchlistItems.storeId, ctx.storeId), eq(watchlistItems.productId, productId)));

  // Card Kingdom only buys Magic - show the buylist fact there only
  const isMagic = product.categoryId === 1;
  const spread =
    isMagic && latestMarket && latestBuylist
      ? (Number(latestBuylist.price) / Number(latestMarket.price)) * 100
      : null;

  // 30-day market range for the non-Magic supporting fact
  const marketValues = chartData.map((p) => p.market).filter((v): v is number => v != null);
  const range30 =
    marketValues.length > 0
      ? { low: Math.min(...marketValues), high: Math.max(...marketValues) }
      : null;

  // the store's own realized street price - the data the platform builds on
  const realized = await realizedSaleStats(ctx.storeId, productId, 30);
  const marketNow = latestMarket ? Number(latestMarket.price) : null;
  const streetDelta =
    realized.avgPrice != null && marketNow
      ? ((realized.avgPrice - marketNow) / marketNow) * 100
      : null;

  const onHand = myInventory.reduce((sum, i) => sum + i.quantity, 0);
  const identityFacts = [
    product.number ? `#${product.number}` : null,
    product.rarity,
    onHand > 0 ? `${onHand} in stock` : "not stocked",
  ]
    .filter(Boolean)
    .join(" · ");

  // contract 1: transactions form prefills from these params
  const recordSaleHref = `/transactions?productId=${product.productId}&side=sale&condition=${encodeURIComponent(
    type === "sealed" ? "Unopened" : "Near Mint"
  )}&printing=`;

  return (
    <div className="space-y-4">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4 md:gap-5">
          <ProductImage
            productId={product.productId}
            imageUrl={product.imageUrl}
            name={product.name}
            className="h-[154px] w-[110px] shrink-0 border-border/70 bg-muted md:h-56 md:w-40"
          />
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              {product.gameName} · {product.expansionName}
            </p>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2">
              <h1 className="min-w-0 break-words text-xl font-semibold tracking-[-0.015em] text-foreground">
                {product.name}
              </h1>
              {type === "sealed" ? <Badge variant="neutral">sealed</Badge> : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{identityFacts}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <Link href={recordSaleHref}>
              <Banknote />
              Record sale
            </Link>
          </Button>
          <form
            action={async () => {
              "use server";
              await toggleWatchlistAction({ productId });
            }}
          >
            <Button type="submit" variant="outline">
              {watching ? <EyeOff /> : <Eye />}
              {watching ? "Unwatch" : "Add to watchlist"}
            </Button>
          </form>
        </div>
      </div>

      {/* Price strip: the street price is the hero number on this page — the
          supporting facts stay at row-money size so the eye lands once. */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <div className="border-b border-border/60 px-4 py-3.5 md:border-b-0 md:border-r">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Street price (your counter)
            </p>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
              <span className="text-2xl font-semibold tracking-[-0.02em] tabular-nums text-foreground">
                {formatMoney(realized.avgPrice)}
              </span>
              {streetDelta !== null ? (
                <span
                  className={cn(
                    "text-xs font-medium tabular-nums",
                    streetDelta >= 0 ? "text-success" : "text-destructive"
                  )}
                >
                  {formatPct(streetDelta)} vs market
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {realized.count > 0
                ? `${realized.count} sold in 30d${
                    realized.lastAt ? ` · last ${formatDateTime(realized.lastAt)}` : ""
                  }`
                : "No counter sales in the last 30 days"}
            </p>
          </div>

          <div className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <PriceFact
              label="TCG market"
              value={formatMoney(latestMarket?.price ?? null)}
              sub={
                latestMarket ? `as of ${formatDateTime(latestMarket.capturedAt)}` : "no snapshot yet"
              }
            />
            {isMagic ? (
              <PriceFact
                label="CK buylist"
                value={formatMoney(latestBuylist?.price ?? null)}
                sub={spread !== null ? `${spread.toFixed(0)}% of market` : "no snapshot yet"}
              />
            ) : (
              <PriceFact
                label="30-day range"
                value={
                  range30 ? `${formatMoney(range30.low)} – ${formatMoney(range30.high)}` : "—"
                }
                sub="market low / high"
              />
            )}
            <PriceFact
              label="Sales velocity"
              value={`${statByWindow.get("24h")?.saleCount ?? "—"} / 24h`}
              sub={`7d median ${formatMoney(
                statByWindow.get("7d")?.medianPrice ?? null
              )} · ${statByWindow.get("24h")?.trend ?? "—"}`}
            />
          </div>
        </div>
      </Card>

      <Section title="Price history" subtitle="90 days · local snapshots" padded>
        <PriceHistoryChart data={chartData} />
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section
          title="Your inventory"
          subtitle={myInventory.length > 0 ? `${onHand} on hand` : undefined}
        >
          {myInventory.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              You don&apos;t stock this product.{" "}
              <Link href="/inventory/import" className="text-primary hover:underline">
                Import inventory
              </Link>
            </p>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <colgroup>
                    <col />
                    <col className="w-[22%]" />
                    <col className="w-[14%]" />
                    <col className="w-[18%]" />
                    <col className="w-[18%]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow className="h-9 hover:bg-transparent">
                      <TableHead>Condition</TableHead>
                      <TableHead>Printing</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {myInventory.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="truncate text-sm font-medium text-foreground">
                          {i.condition}
                        </TableCell>
                        <TableCell className="truncate text-xs text-muted-foreground">
                          {i.printing ?? "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium tabular-nums text-foreground">
                          {i.quantity}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium tabular-nums text-foreground">
                          {formatMoney(i.currentPrice)}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                          {formatMoney(i.costBasis)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="md:hidden">
                {myInventory.map((i) => (
                  <DataRow
                    key={i.id}
                    title={i.condition}
                    meta={[i.printing ?? "Normal", `${i.quantity} in stock`].join(" · ")}
                    value={formatMoney(i.currentPrice)}
                    valueMeta={`cost ${formatMoney(i.costBasis)}`}
                  />
                ))}
              </div>
            </>
          )}
        </Section>

        <Section
          title={type === "sealed" ? "Product settings" : "Printings & settings"}
          padded
          contentClassName="space-y-4"
        >
          {type !== "sealed" ? (
            productSkus.length > 0 ? (
              <div>
                <p className="text-sm font-medium text-foreground">Known SKUs</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {productSkus
                    .map((s) => [s.condition, s.printing].filter(Boolean).join(" "))
                    .join(" · ")}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                SKU-level variants populate lazily on Unlimited-tier plans.
              </p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Sealed product — single <code>Unopened</code> condition, printings suppressed.
            </p>
          )}

          <form action={setProductTypeOverrideAction} className="border-t border-border/60 pt-4">
            <label
              htmlFor="product-type-override"
              className="text-sm font-medium text-foreground"
            >
              Product type override
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Classifier said {product.productType}
              {product.productTypeOverride
                ? ` · overridden to ${product.productTypeOverride}`
                : ""}
              . Overriding affects rule scoping and condition handling.
            </p>
            <input type="hidden" name="productId" value={productId} />
            <div className="mt-2 flex gap-2">
              <Select
                id="product-type-override"
                name="override"
                defaultValue={product.productTypeOverride ?? ""}
                className="w-44"
              >
                <option value="">No override</option>
                <option value="single">single</option>
                <option value="sealed">sealed</option>
                <option value="other">other</option>
              </Select>
              <Button type="submit" variant="outline" className="h-11 shrink-0 md:h-9">
                Save
              </Button>
            </div>
          </form>
        </Section>
      </div>
    </div>
  );
}
