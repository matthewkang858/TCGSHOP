import Link from "next/link";
import { and, desc, eq, gte, isNotNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expansions, products, streetPrices } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataRow } from "@/components/ui/data-row";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatDate, formatMoney, formatPct } from "@/lib/utils";
import { AggregateNote, NoTapeYet, confidenceTone, formatCount, formatShare } from "../ui";

/**
 * Divergence: where the street disagrees with the marketplace.
 *
 * This is the whole commercial argument in one table. A marketplace reference
 * only sees online sales; these rows are what a counter actually charged, and
 * the % column is the gap nobody else can measure. Rows below the signal
 * confidence floor are excluded by default because a 40% divergence on three
 * trades from two stores is noise wearing a headline.
 */

const CONFIDENCE_OPTIONS = [0.2, 0.35, 0.5, 0.65, 0.8] as const;

// Every control is a select, so anything out of range arrived by hand-editing
// the URL. Fall back to the default rather than 500 an internal console.
const searchSchema = z.object({
  dir: z.enum(["all", "premium", "discount"]).catch("all"),
  minConf: z.coerce.number().min(0).max(1).catch(0.35),
  limit: z.coerce.number().int().min(25).max(500).catch(100),
});

type SearchParams = z.infer<typeof searchSchema>;

export default async function OpsDivergencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchSchema.parse(await searchParams);

  // The tape publishes one row per identity per day; only the newest day is
  // the current picture.
  const [latest] = await db
    .select({ asOf: streetPrices.asOf })
    .from(streetPrices)
    .orderBy(desc(streetPrices.asOf))
    .limit(1);

  if (!latest) {
    return (
      <div>
        <PageHeader title="Divergence" description="Street price vs marketplace reference" />
        <NoTapeYet
          what="no street prices published"
          detail="The aggregation job has not written any street prices yet. Once it does, the widest gaps between the counter and the marketplace show up here."
        />
      </div>
    );
  }

  const asOf = latest.asOf;
  const minConf = params.minConf.toFixed(4);

  const baseFilters: SQL[] = [
    eq(streetPrices.asOf, asOf),
    gte(streetPrices.confidence, minConf),
    isNotNull(streetPrices.divergencePct),
    isNotNull(streetPrices.streetPrice),
  ];

  const dirFilter: SQL | null =
    params.dir === "premium"
      ? sql`${streetPrices.divergencePct} > 0`
      : params.dir === "discount"
        ? sql`${streetPrices.divergencePct} < 0`
        : null;

  const where = and(...baseFilters, ...(dirFilter ? [dirFilter] : []));

  // Summary spans the confidence floor but ignores the premium/discount
  // filter, so the split stays readable while you toggle sides.
  const [summary] = await db
    .select({
      total: sql<number>`(count(*))::int`,
      premium: sql<number>`(count(*) filter (where ${streetPrices.divergencePct} > 0))::int`,
      discount: sql<number>`(count(*) filter (where ${streetPrices.divergencePct} < 0))::int`,
      wide: sql<number>`(count(*) filter (where abs(${streetPrices.divergencePct}) >= 8))::int`,
      medianAbs: sql<number | null>`(percentile_cont(0.5) within group (
        order by abs(${streetPrices.divergencePct})
      ))::float8`,
      verifiedShare: sql<number | null>`(avg(${streetPrices.verifiedShare}))::float8`,
    })
    .from(streetPrices)
    .where(and(...baseFilters));

  const medianAbs = summary?.medianAbs ?? null;

  const [published] = await db
    .select({ total: sql<number>`(count(*))::int` })
    .from(streetPrices)
    .where(eq(streetPrices.asOf, asOf));

  const rows = await db
    .select({
      productId: streetPrices.productId,
      productName: products.name,
      expansionName: expansions.name,
      condition: streetPrices.condition,
      printing: streetPrices.printing,
      language: streetPrices.language,
      streetPrice: streetPrices.streetPrice,
      referencePrice: streetPrices.referencePrice,
      blendedPrice: streetPrices.blendedPrice,
      divergencePct: streetPrices.divergencePct,
      confidence: streetPrices.confidence,
      sampleTrades: streetPrices.sampleTrades,
      sampleStores: streetPrices.sampleStores,
      verifiedShare: streetPrices.verifiedShare,
    })
    .from(streetPrices)
    .innerJoin(products, eq(products.productId, streetPrices.productId))
    .innerJoin(expansions, eq(expansions.groupId, products.groupId))
    .where(where)
    .orderBy(desc(sql`abs(${streetPrices.divergencePct})`))
    .limit(params.limit);

  const items = rows.map((r) => ({
    ...r,
    street: Number(r.streetPrice),
    reference: r.referencePrice === null ? null : Number(r.referencePrice),
    divergence: Number(r.divergencePct),
    confidenceValue: Number(r.confidence),
    verified: Number(r.verifiedShare),
  }));

  return (
    <div>
      <PageHeader
        title="Divergence"
        description={`As of ${formatDate(asOf)} · ${formatCount(
          summary?.total ?? 0
        )} of ${formatCount(published?.total ?? 0)} published rows clear the confidence floor`}
      />

      <AggregateNote>
        What the marketplace cannot see. Every row is a blend of in-person
        trades from two or more stores; the sample columns count trades and
        stores, and no contributing store is identified.
      </AggregateNote>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Street premium"
          value={formatCount(summary?.premium ?? 0)}
          sub="counter above marketplace"
          tone="positive"
        />
        <StatCard
          label="Street discount"
          value={formatCount(summary?.discount ?? 0)}
          sub="counter below marketplace"
          tone="negative"
        />
        <StatCard
          label="Median gap"
          value={medianAbs === null ? "—" : `${medianAbs.toFixed(1)}%`}
          sub={`${formatCount(summary?.wide ?? 0)} beyond the 8% signal threshold`}
        />
        <StatCard
          label="Attested share"
          value={formatShare(summary?.verifiedShare ?? 0)}
          sub="mean across qualifying rows"
        />
      </div>

      <FilterBar params={params} />

      {items.length === 0 ? (
        <Card className="px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No rows match these filters</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {(published?.total ?? 0) === 0
              ? "Nothing has been published for this day yet."
              : "Try lowering the minimum confidence, or switching back to both sides."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-clip">
          <div className="hidden md:block">
            <Table>
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[11%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
                <col className="w-[7%]" />
              </colgroup>
              <TableHeader sticky={items.length > 20}>
                <TableRow className="h-9 hover:bg-transparent">
                  <TableHead>Product</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead className="text-right">Street</TableHead>
                  <TableHead className="text-right">Reference</TableHead>
                  <TableHead className="text-right">Divergence</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                  <TableHead className="text-right">Sample</TableHead>
                  <TableHead className="text-right">Attested</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={identityKey(item)}>
                    <TableCell className="overflow-hidden">
                      <Link
                        href={drilldownHref(item)}
                        className="block truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {item.productName}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.expansionName}
                      </p>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <span className="truncate text-xs text-muted-foreground">
                        {item.condition}
                      </span>
                      {item.printing ? (
                        <Badge variant="neutral" className="ml-1.5">
                          {item.printing}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {formatMoney(item.street)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {formatMoney(item.reference)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right text-sm font-semibold tabular-nums",
                        item.divergence > 0 ? "text-success" : "text-destructive"
                      )}
                    >
                      {formatPct(item.divergence)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right text-sm tabular-nums",
                        confidenceTone(item.confidenceValue)
                      )}
                    >
                      {item.confidenceValue.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {formatCount(item.sampleTrades)}/{formatCount(item.sampleStores)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {formatShare(item.verified, 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden">
            {items.map((item) => (
              <DataRow
                key={identityKey(item)}
                href={drilldownHref(item)}
                title={item.productName}
                meta={`${item.condition}${item.printing ? ` · ${item.printing}` : ""} · ${formatCount(
                  item.sampleTrades
                )} trades / ${formatCount(item.sampleStores)} stores · conf ${item.confidenceValue.toFixed(2)}`}
                value={formatMoney(item.street)}
                valueMeta={formatPct(item.divergence)}
                tone={item.divergence > 0 ? "positive" : "negative"}
              />
            ))}
          </div>
        </Card>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Sample is trades / distinct stores over the trailing window. Attested is
        the share of those units a payment processor charged a card for. A wide
        gap on a low attested share is the first thing to distrust — it is also
        exactly the shape a manipulation attempt would take.
        {items.length >= params.limit
          ? ` Showing the ${formatCount(params.limit)} widest gaps.`
          : ""}
      </p>
    </div>
  );
}

function identityKey(item: {
  productId: number;
  condition: string;
  printing: string | null;
  language: string;
}) {
  return `${item.productId}|${item.condition}|${item.printing ?? ""}|${item.language}`;
}

function drilldownHref(item: {
  productId: number;
  condition: string;
  printing: string | null;
}) {
  const sp = new URLSearchParams({ condition: item.condition });
  if (item.printing) sp.set("printing", item.printing);
  return `/ops/product/${item.productId}?${sp}`;
}

function FilterBar({ params }: { params: SearchParams }) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
      <Select
        name="dir"
        aria-label="Divergence side"
        defaultValue={params.dir}
        className="h-9 w-[calc(50%-0.25rem)] md:w-44"
      >
        <option value="all">Premium and discount</option>
        <option value="premium">Street premium only</option>
        <option value="discount">Street discount only</option>
      </Select>
      <Select
        name="minConf"
        aria-label="Minimum confidence"
        defaultValue={String(params.minConf)}
        className="h-9 w-[calc(50%-0.25rem)] md:w-44"
      >
        {CONFIDENCE_OPTIONS.map((c) => (
          <option key={c} value={c}>
            Confidence ≥ {c.toFixed(2)}
          </option>
        ))}
      </Select>
      <Select
        name="limit"
        aria-label="Row limit"
        defaultValue={String(params.limit)}
        className="h-9 w-[calc(50%-0.25rem)] md:w-32"
      >
        {[50, 100, 250, 500].map((n) => (
          <option key={n} value={n}>
            Top {n}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="outline" className="w-full md:w-auto">
        Apply
      </Button>
    </form>
  );
}
