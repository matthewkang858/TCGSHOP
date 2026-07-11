import Link from "next/link";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { Library, RefreshCw } from "lucide-react";
import { z } from "zod";
import { db } from "@/db";
import { expansions, games, jobRuns, products } from "@/db/schema";
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
import { formatDateTime } from "@/lib/utils";
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

  const [lastSync] = await db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.name, "catalog-sync"))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1);

  const catalogEmpty = total === 0 && !params.q && !params.type && !params.category;

  return (
    <div>
      <PageHeader
        title="Catalog"
        description={
          lastSync
            ? `Local product catalog. Last sync: ${formatDateTime(lastSync.startedAt)} (${lastSync.status}).`
            : "Local product catalog synced from TCGAPIs."
        }
      >
        <form action={triggerCatalogSync}>
          {params.category ? (
            <input type="hidden" name="categoryId" value={params.category} />
          ) : null}
          <Button type="submit" variant="outline">
            <RefreshCw />
            {params.category ? "Sync this game" : "Sync catalog"}
          </Button>
        </form>
      </PageHeader>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Game</label>
          <Select name="category" defaultValue={params.category ?? ""}>
            <option value="">All games</option>
            {allGames.map((g) => (
              <option key={g.categoryId} value={g.categoryId}>
                {g.displayName}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-56">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Expansion
          </label>
          <Select name="group" defaultValue={params.group ?? ""}>
            <option value="">All expansions</option>
            {gameExpansions.map((e) => (
              <option key={e.groupId} value={e.groupId}>
                {e.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
          <Select name="type" defaultValue={params.type ?? ""}>
            <option value="">All types</option>
            <option value="single">Singles</option>
            <option value="sealed">Sealed</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div className="w-64">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Search</label>
          <Input name="q" placeholder="Product name…" defaultValue={params.q ?? ""} />
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {catalogEmpty ? (
        <EmptyState
          icon={<Library className="h-8 w-8" />}
          title="No catalog yet"
          description="Run a catalog sync to pull games, expansions, and products (singles + sealed) into the local cache. With no API key configured, the sync loads bundled demo fixtures. Make sure the worker is running: pnpm worker."
        />
      ) : (
        <>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Game</TableHead>
                  <TableHead>Expansion</TableHead>
                  <TableHead>#</TableHead>
                  <TableHead>Rarity</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const type = p.productTypeOverride ?? p.productType;
                  return (
                    <TableRow key={p.productId}>
                      <TableCell>
                        <Link
                          href={`/products/${p.productId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.gameName}</TableCell>
                      <TableCell className="text-muted-foreground">{p.expansionName}</TableCell>
                      <TableCell className="text-muted-foreground">{p.number ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{p.rarity ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            type === "sealed"
                              ? "warning"
                              : type === "single"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {type}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No products match these filters.
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
  params: { category?: number; group?: number; q?: string; type?: string };
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
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
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Page {page} of {pages} · {total.toLocaleString()} products
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
