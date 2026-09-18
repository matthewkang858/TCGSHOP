import Link from "next/link";
import { and, asc, count, desc, eq, ilike, sql, sum, type SQL } from "drizzle-orm";
import { Boxes, FileDown, Search, Upload } from "lucide-react";
import { z } from "zod";
import { db } from "@/db";
import { expansions, inventoryItems, products } from "@/db/schema";
import { requireStore } from "@/lib/tenancy";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { formatMoney } from "@/lib/utils";
import { InventoryListRow, InventoryRow, type InventoryRowItem } from "./row-editor";

const searchSchema = z.object({
  q: z.string().max(200).optional(),
  type: z.enum(["single", "sealed", "other"]).optional(),
  condition: z.string().max(40).optional(),
  tag: z.string().max(60).optional(),
  sort: z.enum(["name", "quantity", "price", "value", "updated"]).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
});

const PAGE_SIZE = 50;

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStore();
  const params = searchSchema.parse(await searchParams);

  const productType = sql<
    "single" | "sealed" | "other"
  >`coalesce(${products.productTypeOverride}, ${products.productType})`;

  const filters: SQL[] = [eq(inventoryItems.storeId, ctx.storeId)];
  if (params.q) filters.push(ilike(products.name, `%${params.q}%`));
  if (params.type) filters.push(eq(productType, params.type));
  if (params.condition) filters.push(eq(inventoryItems.condition, params.condition));
  if (params.tag) filters.push(sql`${params.tag} = any(${inventoryItems.tags})`);
  const where = and(...filters);

  const value = sql<string>`coalesce(${inventoryItems.currentPrice}, 0) * ${inventoryItems.quantity}`;
  const orderCol = {
    name: products.cleanName,
    quantity: inventoryItems.quantity,
    price: inventoryItems.currentPrice,
    value,
    updated: inventoryItems.updatedAt,
  }[params.sort];
  const orderBy = params.dir === "desc" ? desc(orderCol) : asc(orderCol);

  const [{ total, totalValue }] = await db
    .select({
      total: count(),
      totalValue: sum(value),
    })
    .from(inventoryItems)
    .innerJoin(products, eq(products.productId, inventoryItems.productId))
    .where(where);

  const rows = await db
    .select({
      id: inventoryItems.id,
      productId: inventoryItems.productId,
      productName: products.name,
      imageUrl: products.imageUrl,
      expansionName: expansions.name,
      productType,
      condition: inventoryItems.condition,
      printing: inventoryItems.printing,
      language: inventoryItems.language,
      quantity: inventoryItems.quantity,
      currentPrice: inventoryItems.currentPrice,
      costBasis: inventoryItems.costBasis,
      tags: inventoryItems.tags,
    })
    .from(inventoryItems)
    .innerJoin(products, eq(products.productId, inventoryItems.productId))
    .innerJoin(expansions, eq(expansions.groupId, products.groupId))
    .where(where)
    .orderBy(orderBy)
    .limit(PAGE_SIZE)
    .offset((params.page - 1) * PAGE_SIZE);

  const conditions = await db
    .selectDistinct({ condition: inventoryItems.condition })
    .from(inventoryItems)
    .where(eq(inventoryItems.storeId, ctx.storeId));

  const hasAny = total > 0 || params.q || params.type || params.condition || params.tag;

  const items: InventoryRowItem[] = rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    productName: r.productName,
    imageUrl: r.imageUrl,
    expansionName: r.expansionName,
    productType: r.productType,
    condition: r.condition,
    printing: r.printing,
    quantity: r.quantity,
    currentPrice: r.currentPrice,
    costBasis: r.costBasis,
  }));

  return (
    <div>
      <PageHeader
        title="Inventory"
        description={`${total.toLocaleString()} lines · ${formatMoney(totalValue)} at current prices`}
      >
        <Button asChild>
          <Link href="/inventory/import">
            <Upload />
            Import CSV
          </Link>
        </Button>
      </PageHeader>

      {!hasAny ? (
        <EmptyState
          icon={<Boxes />}
          title="No inventory yet"
          description="Import a TCGplayer export or any CSV to get started. Singles and sealed both work."
          action={
            <div className="flex flex-col items-center gap-3">
              <Button asChild>
                <Link href="/inventory/import">
                  <Upload />
                  Import CSV
                </Link>
              </Button>
              <a
                href="/api/sample-inventory.csv"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <FileDown className="size-4" />
                Download a sample CSV
              </a>
            </div>
          }
        />
      ) : (
        <>
          <FilterBar params={params} conditions={conditions.map((c) => c.condition)} />

          <Card className="overflow-clip">
            {/* Desktop: 5 data columns + one reserved action cell, table-fixed. */}
            <div className="hidden md:block">
              <Table>
                <colgroup>
                  <col className="w-[46%]" />
                  <col className="w-[14%]" />
                  <col className="w-[10%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[104px]" />
                </colgroup>
                <TableHeader sticky={items.length > 20}>
                  <TableRow className="h-9 hover:bg-transparent">
                    <TableHead>Product</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <InventoryRow key={item.id} item={item} sellHref={sellHref(item)} />
                  ))}
                  {items.length === 0 ? (
                    <TableRow className="h-auto hover:bg-transparent">
                      <TableCell colSpan={6} className="py-10 text-center text-xs text-muted-foreground">
                        No inventory matches these filters.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>

            {/* Phone: the shared 64px list row, never a horizontally scrolled table. */}
            <div className="md:hidden">
              {items.map((item) => (
                <InventoryListRow key={item.id} item={item} sellHref={sellHref(item)} />
              ))}
              {items.length === 0 ? (
                <p className="py-10 text-center text-xs text-muted-foreground">
                  No inventory matches these filters.
                </p>
              ) : null}
            </div>
          </Card>

          <Pagination page={params.page} total={total} params={params} />
        </>
      )}
    </div>
  );
}

/**
 * One quiet toolbar. The selects are always rendered: a closed <details>
 * hides its children even under `display: contents`, which silently made the
 * filters unreachable on desktop. They simply wrap onto a second line on
 * phones instead.
 */
function FilterBar({
  params,
  conditions,
}: {
  params: z.infer<typeof searchSchema>;
  conditions: string[];
}) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
      {params.tag ? <input type="hidden" name="tag" value={params.tag} /> : null}
      <div className="flex w-full min-w-0 items-center gap-2 md:w-auto">
        <Input
          name="q"
          placeholder="Search products…"
          aria-label="Search products"
          defaultValue={params.q ?? ""}
          className="h-9 min-w-0 flex-1 md:w-64 md:flex-none"
        />
        {/* Phone-only submit; on desktop the toolbar's Apply button is visible. */}
        <Button type="submit" variant="outline" size="icon" className="md:hidden" aria-label="Search">
          <Search />
        </Button>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
        <Select
            name="type"
            aria-label="Product type"
            defaultValue={params.type ?? ""}
            className="h-9 w-[calc(50%-0.25rem)] md:w-32"
          >
            <option value="">All types</option>
            <option value="single">Singles</option>
            <option value="sealed">Sealed</option>
            <option value="other">Other</option>
          </Select>
          <Select
            name="condition"
            aria-label="Condition"
            defaultValue={params.condition ?? ""}
            className="h-9 w-[calc(50%-0.25rem)] md:w-40"
          >
            <option value="">All conditions</option>
            {conditions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select
            name="sort"
            aria-label="Sort by"
            defaultValue={params.sort}
            className="h-9 w-[calc(50%-0.25rem)] md:w-36"
          >
            <option value="name">Name</option>
            <option value="quantity">Quantity</option>
            <option value="price">Price</option>
            <option value="value">Line value</option>
            <option value="updated">Last updated</option>
          </Select>
          <Select
            name="dir"
            aria-label="Sort direction"
            defaultValue={params.dir}
            className="h-9 w-[calc(50%-0.25rem)] md:w-28"
          >
            <option value="asc">Asc</option>
            <option value="desc">Desc</option>
          </Select>
          <Button type="submit" variant="outline" className="w-full md:w-auto">
            Apply
          </Button>
      </div>
    </form>
  );
}

/** Quick-sell link per the transactions prefill contract (printing: Normal|Foil|''). */
function sellHref(item: { productId: number; condition: string; printing: string | null }) {
  const sp = new URLSearchParams({
    productId: String(item.productId),
    side: "sale",
    condition: item.condition,
    printing: item.printing === "Foil" || item.printing === "Normal" ? item.printing : "",
  });
  return `/transactions?${sp}`;
}

function Pagination({
  page,
  total,
  params,
}: {
  page: number;
  total: number;
  params: z.infer<typeof searchSchema>;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  const qs = (p: number) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.type) sp.set("type", params.type);
    if (params.condition) sp.set("condition", params.condition);
    if (params.tag) sp.set("tag", params.tag);
    sp.set("sort", params.sort);
    sp.set("dir", params.dir);
    sp.set("page", String(p));
    return `/inventory?${sp}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
      <span className="tabular-nums">
        Page {page} of {pages}
      </span>
      <div className="flex gap-4">
        {page > 1 ? (
          <Link href={qs(page - 1)} className="font-medium text-primary hover:underline">
            ← Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={qs(page + 1)} className="font-medium text-primary hover:underline">
            Next →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
