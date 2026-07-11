import Link from "next/link";
import { and, asc, count, desc, eq, ilike, sql, sum, type SQL } from "drizzle-orm";
import { Boxes, Upload } from "lucide-react";
import { z } from "zod";
import { db } from "@/db";
import { expansions, inventoryItems, products } from "@/db/schema";
import { requireStore } from "@/lib/tenancy";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { RowEditor } from "./row-editor";

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
          icon={<Boxes className="h-8 w-8" />}
          title="No inventory yet"
          description="Import your TCGplayer inventory export (or any CSV) to get started. Singles and sealed product both work."
          action={
            <Button asChild>
              <Link href="/inventory/import">
                <Upload />
                Import CSV
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
            <div className="w-64">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Search
              </label>
              <Input name="q" placeholder="Product name…" defaultValue={params.q ?? ""} />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
              <Select name="type" defaultValue={params.type ?? ""}>
                <option value="">All</option>
                <option value="single">Singles</option>
                <option value="sealed">Sealed</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div className="w-40">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Condition
              </label>
              <Select name="condition" defaultValue={params.condition ?? ""}>
                <option value="">All</option>
                {conditions.map((c) => (
                  <option key={c.condition} value={c.condition}>
                    {c.condition}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-36">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Sort</label>
              <Select name="sort" defaultValue={params.sort}>
                <option value="name">Name</option>
                <option value="quantity">Quantity</option>
                <option value="price">Price</option>
                <option value="value">Line value</option>
                <option value="updated">Last updated</option>
              </Select>
            </div>
            <div className="w-28">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Dir</label>
              <Select name="dir" defaultValue={params.dir}>
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </Select>
            </div>
            <Button type="submit" variant="secondary">
              Apply
            </Button>
          </form>

          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Set</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="text-right">Qty / Price / Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link
                        href={`/products/${item.productId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {item.productName}
                      </Link>
                      {item.printing === "Foil" ? (
                        <span className="ml-1 text-xs text-warning">✦ foil</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.expansionName}</TableCell>
                    <TableCell className="text-muted-foreground">{item.condition}</TableCell>
                    <TableCell>
                      <Badge variant={item.productType === "sealed" ? "warning" : "secondary"}>
                        {item.productType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-36 flex-wrap gap-1">
                        {item.tags.map((t) => (
                          <Badge key={t} variant="outline">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <RowEditor
                        item={{
                          id: item.id,
                          quantity: item.quantity,
                          currentPrice: item.currentPrice,
                          costBasis: item.costBasis,
                          tags: item.tags,
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No inventory matches these filters.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          <Pagination page={params.page} total={total} params={params} />
        </>
      )}
    </div>
  );
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
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={qs(page - 1)} className="text-primary hover:underline">
            ← Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={qs(page + 1)} className="text-primary hover:underline">
            Next →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
