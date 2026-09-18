import Link from "next/link";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Library, RefreshCw, SlidersHorizontal } from "lucide-react";
import { z } from "zod";
import { db } from "@/db";
import { expansions, games, jobRuns, priceSnapshots, products } from "@/db/schema";
import { requireStore } from "@/lib/tenancy";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataRow, dataRowThumbClass } from "@/components/ui/data-row";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatMoney } from "@/lib/utils";
import { ProductImage } from "@/components/product-image";
import { triggerCatalogSync } from "./actions";

const searchSchema = z.object({
  category: z.coerce.number().int().optional(),
  group: z.coerce.number().int().optional(),
  q: z.string().max(200).optional(),
  type: z.enum(["single", "sealed", "other"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

const PAGE_SIZE = 50;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStore();
  const params = searchSchema.parse(await searchParams);

  const allGames = await db.select().from(games).orderBy(asc(games.categoryId));
  const gameExpansions = params.category
    ? await db
        .select()
        .from(expansions)
        .where(eq(expansions.categoryId, params.category))
        .orderBy(desc(expansions.publishedOn))
    : [];

  const filters: SQL[] = [];
  if (params.category) filters.push(eq(products.categoryId, params.category));
  if (params.group) filters.push(eq(products.groupId, params.group));
  if (params.q) {
    filters.push(
      or(ilike(products.name, `%${params.q}%`), ilike(products.cleanName, `%${params.q}%`))!
    );
  }
  if (params.type) {
    filters.push(
      eq(sql`coalesce(${products.productTypeOverride}, ${products.productType})`, params.type)
    );
  }
  const where = filters.length ? and(...filters) : undefined;

  const [{ value: total }] = await db.select({ value: count() }).from(products).where(where);
  const rows = await db
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
    })
    .from(products)
    .innerJoin(expansions, eq(expansions.groupId, products.groupId))
    .innerJoin(games, eq(games.categoryId, products.categoryId))
    .where(where)
    .orderBy(asc(products.cleanName))
    .limit(PAGE_SIZE)
    .offset((params.page - 1) * PAGE_SIZE);

  // Latest retail snapshot per visible product — the column that makes the
  // catalog worth scanning now that Game/Type carry no signal.
  const pageIds = rows.map((r) => r.productId);
  const priceRows = pageIds.length
    ? await db
        .selectDistinctOn([priceSnapshots.productId], {
          productId: priceSnapshots.productId,
          price: priceSnapshots.price,
        })
        .from(priceSnapshots)
        .where(
          and(
            inArray(priceSnapshots.productId, pageIds),
            eq(priceSnapshots.provider, "tcgplayer"),
            eq(priceSnapshots.listing, "retail")
          )
        )
        .orderBy(asc(priceSnapshots.productId), desc(priceSnapshots.capturedAt))
    : [];
  const marketByProduct = new Map(priceRows.map((p) => [p.productId, Number(p.price)]));

  const [lastSync] = await db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.name, "catalog-sync"))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1);

  const catalogEmpty = total === 0 && !params.q && !params.type && !params.category;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const facts = [
    `${total.toLocaleString()} product${total === 1 ? "" : "s"}`,
    pages > 1 ? `page ${params.page} of ${pages}` : null,
    lastSync
      ? `synced ${formatDateTime(lastSync.startedAt)}${
          lastSync.status === "succeeded" ? "" : ` (${lastSync.status})`
        }`
      : "never synced",
  ]
    .filter(Boolean)
    .join(" · ");

  const describe = (p: (typeof rows)[number]) =>
    [p.expansionName, p.number ? `#${p.number}` : null, p.rarity].filter(Boolean).join(" · ");

  return (
    <div>
      <PageHeader title="Catalog" description={facts}>
        <form action={triggerCatalogSync}>
          {params.category ? (
            <input type="hidden" name="categoryId" value={params.category} />
          ) : null}
          <Button type="submit">
            <RefreshCw />
            {params.category ? "Sync this game" : "Sync catalog"}
          </Button>
        </form>
      </PageHeader>

      {/* Quiet toolbar: search is always there, the selects fold behind
          "Filters" on phones (CSS-only disclosure, no client JS). */}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <input id="catalog-filters" type="checkbox" className="peer sr-only" />
        <Input
          name="q"
          placeholder="Search products…"
          aria-label="Search products"
          defaultValue={params.q ?? ""}
          className="min-w-0 flex-1 sm:w-64 sm:flex-none"
        />
        <label
          htmlFor="catalog-filters"
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:hidden"
        >
          <SlidersHorizontal className="size-4" />
          Filters
        </label>
        <Button type="submit" variant="outline" className="h-11 shrink-0 sm:order-last md:h-9">
          Apply
        </Button>
        <div className="order-last hidden w-full flex-wrap items-end gap-2 peer-checked:flex sm:order-none sm:flex sm:w-auto">
          <Select
            name="category"
            aria-label="Game"
            defaultValue={params.category ?? ""}
            className="sm:w-40"
          >
            <option value="">All games</option>
            {allGames.map((g) => (
              <option key={g.categoryId} value={g.categoryId}>
                {g.displayName}
              </option>
            ))}
          </Select>
          <Select
            name="group"
            aria-label="Expansion"
            defaultValue={params.group ?? ""}
            className="sm:w-52"
          >
            <option value="">All expansions</option>
            {gameExpansions.map((e) => (
              <option key={e.groupId} value={e.groupId}>
                {e.name}
              </option>
            ))}
          </Select>
          <Select
            name="type"
            aria-label="Product type"
            defaultValue={params.type ?? ""}
            className="sm:w-36"
          >
            <option value="">All types</option>
            <option value="single">Singles</option>
            <option value="sealed">Sealed</option>
            <option value="other">Other</option>
          </Select>
        </div>
      </form>

      {catalogEmpty ? (
        <EmptyState
          icon={<Library />}
          title="No catalog yet"
          description="Run a catalog sync to pull games, expansions, and products into the local cache. With no API key configured the sync loads bundled demo fixtures — make sure the worker is running."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Library />}
          title="No products match these filters"
          description="Widen the search, or clear the game and type filters to see the whole catalog."
        />
      ) : (
        <>
          {/* overflow-clip (not hidden) so the rounded corners still clip the
              table while the sticky header keeps the page as its scrollport. */}
          <Card className="overflow-clip">
            <div className="hidden md:block">
              <Table>
                <colgroup>
                  <col />
                  <col className="w-[160px]" />
                </colgroup>
                <TableHeader sticky>
                  <TableRow className="h-9 hover:bg-transparent">
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Market</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => {
                    const type = p.productTypeOverride ?? p.productType;
                    const market = marketByProduct.get(p.productId);
                    return (
                      <TableRow key={p.productId}>
                        <TableCell className="min-w-0">
                          <div className="flex min-w-0 items-center gap-3">
                            <ProductImage
                              productId={p.productId}
                              imageUrl={p.imageUrl}
                              name={p.name}
                              className="h-10 w-[29px] shrink-0 rounded-[3px] border-border/70 bg-muted"
                            />
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center">
                                <Link
                                  href={`/products/${p.productId}`}
                                  title={p.name}
                                  className="truncate text-sm font-medium text-foreground hover:underline"
                                >
                                  {p.name}
                                </Link>
                                {type === "sealed" ? (
                                  <Badge variant="neutral" className="ml-2 shrink-0">
                                    sealed
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {describe(p)}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {market != null ? (
                            <span className="text-sm font-medium tabular-nums text-foreground">
                              {formatMoney(market)}
                            </span>
                          ) : (
                            <span className="text-sm tabular-nums text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="md:hidden">
              {rows.map((p) => {
                const type = p.productTypeOverride ?? p.productType;
                const market = marketByProduct.get(p.productId);
                return (
                  <DataRow
                    key={p.productId}
                    href={`/products/${p.productId}`}
                    image={
                      <ProductImage
                        productId={p.productId}
                        imageUrl={p.imageUrl}
                        name={p.name}
                        className={dataRowThumbClass}
                      />
                    }
                    title={p.name}
                    badge={
                      type === "sealed" ? <Badge variant="neutral">sealed</Badge> : undefined
                    }
                    meta={describe(p)}
                    value={
                      market != null ? (
                        formatMoney(market)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )
                    }
                  />
                );
              })}
            </div>
          </Card>
          <Pagination page={params.page} pages={pages} params={params} />
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  pages,
  params,
}: {
  page: number;
  pages: number;
  params: { category?: number; group?: number; q?: string; type?: string };
}) {
  if (pages <= 1) return null;
  const qs = (p: number) => {
    const sp = new URLSearchParams();
    if (params.category) sp.set("category", String(params.category));
    if (params.group) sp.set("group", String(params.group));
    if (params.q) sp.set("q", params.q);
    if (params.type) sp.set("type", params.type);
    sp.set("page", String(p));
    return `/products?${sp}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between gap-4">
      <span className="text-xs tabular-nums text-muted-foreground">
        Page {page} of {pages}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={qs(page - 1)}>Previous</Link>
          </Button>
        ) : null}
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={qs(page + 1)}>Next</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
