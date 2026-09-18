import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const stats = await db
    .select()
    .from(salesStats)
    .where(eq(salesStats.productId, productId));
  const statByWindow = new Map(stats.map((s) => [s.window, s]));

  const productSkus =
    type === "sealed"
      ? [] // printings suppressed for sealed
      : await db.select().from(skus).where(eq(skus.productId, productId));

  const myInventory = await db
    .select()
    .from(inventoryItems)
    .where(
      and(eq(inventoryItems.storeId, ctx.storeId), eq(inventoryItems.productId, productId))
    )
    .orderBy(asc(inventoryItems.condition));

  const [watching] = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(
      and(eq(watchlistItems.storeId, ctx.storeId), eq(watchlistItems.productId, productId))
    );

  // Card Kingdom only buys Magic - show the buylist card there only
  const isMagic = product.categoryId === 1;
  const spread =
    isMagic && latestMarket && latestBuylist
      ? (Number(latestBuylist.price) / Number(latestMarket.price)) * 100
      : null;

  // 30-day market range for the non-Magic third card
  const marketValues = chartData.map((p) => p.market).filter((v): v is number => v != null);
  const range30 =
    marketValues.length > 0
      ? { low: Math.min(...marketValues), high: Math.max(...marketValues) }
      : null;

  // the store's own realized street price - the data the platform builds on
  const realized = await realizedSaleStats(ctx.storeId, productId, 30);

  // contract 1: transactions form prefills from these params
  const recordSaleHref = `/transactions?productId=${product.productId}&side=sale&condition=${encodeURIComponent(
    type === "sealed" ? "Unopened" : "Near Mint"
  )}&printing=`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap items-start gap-5">
          <ProductImage
            productId={product.productId}
            imageUrl={product.imageUrl}
            name={product.name}
            className="h-56 w-40 shrink-0 rounded-lg shadow-sm"
          />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {product.gameName} · {product.expansionName}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {product.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {[product.number ? `#${product.number}` : null, product.rarity]
                .filter(Boolean)
                .join(" · ") || " "}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Badge variant={type === "sealed" ? "warning" : "secondary"}>{type}</Badge>
              {product.productTypeOverride ? (
                <Badge variant="outline">manual override</Badge>
              ) : null}
            </div>
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
            <Button type="submit" variant={watching ? "secondary" : "outline"}>
              {watching ? <EyeOff /> : <Eye />}
              {watching ? "Unwatch" : "Add to watchlist"}
            </Button>
          </form>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">TCG Market</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatMoney(latestMarket?.price ?? null)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {latestMarket ? `as of ${formatDateTime(latestMarket.capturedAt)}` : "no snapshot yet"}
            </p>
          </CardContent>
        </Card>
        {isMagic ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                CK Buylist <span className="font-normal">(Magic only)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {formatMoney(latestBuylist?.price ?? null)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {spread !== null ? `${spread.toFixed(0)}% of market` : "no snapshot yet"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">30-day range</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {range30 ? `${formatMoney(range30.low)} – ${formatMoney(range30.high)}` : "—"}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">market low / high</p>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Sales velocity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {statByWindow.get("24h")?.saleCount ?? "—"}
              <span className="ml-1 text-sm font-normal text-muted-foreground">/ 24h</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              7d median {formatMoney(statByWindow.get("7d")?.medianPrice ?? null)} · trend{" "}
              {statByWindow.get("24h")?.trend ?? "—"}
            </p>
            {realized.count > 0 ? (
              <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                  Street price (your counter)
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-xl font-semibold tabular-nums">
                    {formatMoney(realized.avgPrice)}
                  </span>
                  {realized.avgPrice != null && latestMarket ? (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                        realized.avgPrice >= Number(latestMarket.price)
                          ? "bg-success/10 text-success"
                          : "bg-warning/10 text-warning"
                      )}
                    >
                      {formatPct(
                        ((realized.avgPrice - Number(latestMarket.price)) /
                          Number(latestMarket.price)) *
                          100
                      )}{" "}
                      vs market
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {realized.count} sold in 30d
                  {realized.lastAt ? ` · last ${formatDateTime(realized.lastAt)}` : ""}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Price history (local snapshots)</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceHistoryChart data={chartData} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your inventory</CardTitle>
          </CardHeader>
          <CardContent>
            {myInventory.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You don&apos;t stock this product.{" "}
                <Link href="/inventory/import" className="text-primary hover:underline">
                  Import inventory
                </Link>
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
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
                      <TableCell>{i.condition}</TableCell>
                      <TableCell>{i.printing ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(i.currentPrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatMoney(i.costBasis)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{type === "sealed" ? "Product settings" : "Printings & settings"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {type !== "sealed" ? (
              productSkus.length > 0 ? (
                <div>
                  <h4 className="mb-1 text-sm font-medium">Known SKUs</h4>
                  <div className="flex flex-wrap gap-1">
                    {productSkus.map((s) => (
                      <Badge key={s.skuId} variant="outline">
                        {s.condition}
                        {s.printing ? ` · ${s.printing}` : ""}
                      </Badge>
                    ))}
                  </div>
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

            <form action={setProductTypeOverrideAction} className="space-y-2 border-t pt-4">
              <label className="text-sm font-medium">Product type override</label>
              <p className="text-xs text-muted-foreground">
                Classifier said <strong>{product.productType}</strong>. Override if wrong —
                this affects rule scoping and condition handling.
              </p>
              <input type="hidden" name="productId" value={productId} />
              <div className="flex gap-2">
                <Select
                  name="override"
                  defaultValue={product.productTypeOverride ?? ""}
                  className="w-44"
                >
                  <option value="">No override</option>
                  <option value="single">single</option>
                  <option value="sealed">sealed</option>
                  <option value="other">other</option>
                </Select>
                <Button type="submit" variant="outline">
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
