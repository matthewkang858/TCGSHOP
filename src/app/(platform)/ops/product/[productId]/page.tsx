import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { db } from "@/db";
import {
  expansions,
  games,
  marketObservations,
  priceSnapshots,
  products,
  streetPrices,
  tapeExclusions,
} from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatDate, formatDateTime, formatMoney, formatPct } from "@/lib/utils";
import { ObservationHistoryChart, type ObservationPoint } from "../../charts";
import {
  AggregateNote,
  AttestationBar,
  AxisBar,
  FactCell,
  NoTapeYet,
  formatCount,
  formatShare,
  pluralize,
  safeDivide,
} from "../../ui";

/**
 * One product, all the way down: the day-by-day tape, the published street
 * price with the confidence that produced it, and every trade the filters
 * rejected. This is the page you open when a divergence row looks too good.
 */

const WINDOW_DAYS = 90;

const searchSchema = z.object({
  condition: z.string().max(40).optional().catch(undefined),
  printing: z.string().max(40).optional().catch(undefined),
});

const reasonLabels: Record<string, string> = {
  price_outlier: "Price outlier",
  store_outlier: "Store outlier",
  implausible_vs_reference: "Implausible vs reference",
  non_positive_price: "Non-positive price",
};

const axisHints: Record<string, string> = {
  sample: "enough trades to average",
  breadth: "stores beyond the first — one store scores zero",
  agreement: "how tightly the trades agree",
  recency: "how fresh the newest trade is",
  attestation: "how much a processor vouched for",
};

type IdentityKey = { condition: string; printing: string | null; language: string };

function keyOf(i: IdentityKey): string {
  return `${i.condition}|${i.printing ?? ""}|${i.language}`;
}

export default async function OpsProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsedId = z.coerce.number().int().positive().safeParse((await params).productId);
  if (!parsedId.success) notFound();
  const productId = parsedId.data;
  const query = searchSchema.parse(await searchParams);

  const [product] = await db
    .select({
      productId: products.productId,
      name: products.name,
      number: products.number,
      rarity: products.rarity,
      expansionName: expansions.name,
      gameName: games.displayName,
    })
    .from(products)
    .innerJoin(expansions, eq(expansions.groupId, products.groupId))
    .innerJoin(games, eq(games.categoryId, products.categoryId))
    .where(eq(products.productId, productId));

  if (!product) notFound();

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  const observations = await db
    .select({
      condition: marketObservations.condition,
      printing: marketObservations.printing,
      language: marketObservations.language,
      bucketDate: marketObservations.bucketDate,
      tradeCount: marketObservations.tradeCount,
      unitCount: marketObservations.unitCount,
      storeCount: marketObservations.storeCount,
      rawTradeCount: marketObservations.rawTradeCount,
      excludedCount: marketObservations.excludedCount,
      vwap: marketObservations.vwap,
      medianPrice: marketObservations.medianPrice,
      p25: marketObservations.p25,
      p75: marketObservations.p75,
      verifiedShare: marketObservations.verifiedShare,
      fencedOnVerified: marketObservations.fencedOnVerified,
    })
    .from(marketObservations)
    .where(
      and(
        eq(marketObservations.productId, productId),
        gte(marketObservations.bucketDate, since)
      )
    )
    .orderBy(asc(marketObservations.bucketDate));

  // Latest published day for this product (may lag the global latest day).
  const [latestRow] = await db
    .select({ asOf: streetPrices.asOf })
    .from(streetPrices)
    .where(eq(streetPrices.productId, productId))
    .orderBy(desc(streetPrices.asOf))
    .limit(1);

  const priced = latestRow
    ? await db
        .select({
          condition: streetPrices.condition,
          printing: streetPrices.printing,
          language: streetPrices.language,
          asOf: streetPrices.asOf,
          streetPrice: streetPrices.streetPrice,
          referencePrice: streetPrices.referencePrice,
          blendedPrice: streetPrices.blendedPrice,
          divergencePct: streetPrices.divergencePct,
          confidence: streetPrices.confidence,
          confidenceBreakdown: streetPrices.confidenceBreakdown,
          sampleTrades: streetPrices.sampleTrades,
          sampleStores: streetPrices.sampleStores,
          verifiedShare: streetPrices.verifiedShare,
          computedAt: streetPrices.computedAt,
        })
        .from(streetPrices)
        .where(
          and(eq(streetPrices.productId, productId), eq(streetPrices.asOf, latestRow.asOf))
        )
    : [];

  const exclusions = await db
    .select({
      id: tapeExclusions.id,
      bucketDate: tapeExclusions.bucketDate,
      reason: tapeExclusions.reason,
      unitPrice: tapeExclusions.unitPrice,
      wasVerified: tapeExclusions.wasVerified,
      detail: tapeExclusions.detail,
      createdAt: tapeExclusions.createdAt,
    })
    .from(tapeExclusions)
    .where(eq(tapeExclusions.productId, productId))
    .orderBy(desc(tapeExclusions.bucketDate), desc(tapeExclusions.createdAt))
    .limit(50);

  // ---- identities -------------------------------------------------------
  type Identity = {
    key: string;
    condition: string;
    printing: string | null;
    language: string;
    trades: number;
    units: number;
    days: number;
    priced: (typeof priced)[number] | null;
  };

  const identityMap = new Map<string, Identity>();
  const touch = (i: IdentityKey): Identity => {
    const k = keyOf(i);
    let entry = identityMap.get(k);
    if (!entry) {
      entry = {
        key: k,
        condition: i.condition,
        printing: i.printing,
        language: i.language,
        trades: 0,
        units: 0,
        days: 0,
        priced: null,
      };
      identityMap.set(k, entry);
    }
    return entry;
  };

  for (const o of observations) {
    const entry = touch(o);
    entry.trades += o.tradeCount;
    entry.units += o.unitCount;
    entry.days += 1;
  }
  for (const p of priced) {
    const entry = touch(p);
    entry.priced = p;
    if (entry.trades === 0) entry.trades = p.sampleTrades;
  }

  const identities = [...identityMap.values()].sort(
    (a, b) => b.trades - a.trades || a.condition.localeCompare(b.condition)
  );

  // The URL names condition + printing; language is not a selector, so an
  // exact match wins and a condition-only match is the fallback.
  const wanted = query.condition;
  const selected: Identity | null =
    identities.find(
      (i) =>
        wanted !== undefined &&
        i.condition === wanted &&
        (i.printing ?? "") === (query.printing ?? "")
    ) ??
    identities.find((i) => wanted !== undefined && i.condition === wanted) ??
    (identities.length > 0 ? identities[0] : null);

  // ---- chart series for the selected identity ---------------------------
  const snapshots = selected
    ? await db
        .select({
          capturedAt: priceSnapshots.capturedAt,
          price: priceSnapshots.price,
        })
        .from(priceSnapshots)
        .where(
          and(
            eq(priceSnapshots.productId, productId),
            eq(priceSnapshots.provider, "tcgplayer"),
            eq(priceSnapshots.listing, "retail"),
            gte(priceSnapshots.capturedAt, since)
          )
        )
        .orderBy(asc(priceSnapshots.capturedAt))
    : [];

  const referenceByDay = new Map<string, number>();
  for (const s of snapshots) {
    referenceByDay.set(s.capturedAt.toISOString().slice(0, 10), Number(s.price));
  }

  const selectedObservations = selected
    ? observations.filter((o) => keyOf(o) === selected.key)
    : [];

  const chartData: ObservationPoint[] = selectedObservations.map((o) => {
    const day = o.bucketDate.toISOString().slice(0, 10);
    return {
      day,
      vwap: o.vwap === null ? null : Number(o.vwap),
      median: o.medianPrice === null ? null : Number(o.medianPrice),
      reference: referenceByDay.get(day) ?? null,
      trades: o.tradeCount,
    };
  });

  const selectedTotals = selectedObservations.reduce(
    (acc, o) => {
      acc.trades += o.tradeCount;
      acc.units += o.unitCount;
      acc.raw += o.rawTradeCount;
      acc.excluded += o.excludedCount;
      acc.verifiedUnits += o.unitCount * Number(o.verifiedShare);
      acc.fenced += o.fencedOnVerified ? 1 : 0;
      acc.maxStores = Math.max(acc.maxStores, o.storeCount);
      return acc;
    },
    { trades: 0, units: 0, raw: 0, excluded: 0, verifiedUnits: 0, fenced: 0, maxStores: 0 }
  );

  const sp = selected?.priced ?? null;
  const breakdown = sp?.confidenceBreakdown ?? null;
  const confidenceValue = sp ? Number(sp.confidence) : null;

  const hasTape = observations.length > 0 || priced.length > 0;

  return (
    <div>
      <Link
        href="/ops/divergence"
        className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Divergence
      </Link>

      <PageHeader
        title={product.name}
        description={[
          product.gameName,
          product.expansionName,
          product.number ? `#${product.number}` : null,
          product.rarity,
          `product ${product.productId}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <AggregateNote>
        Everything below is pooled across contributing stores. Day rows count
        stores, never name them; the exclusion log records the trade and the
        reason, not who reported it.
      </AggregateNote>

      {!hasTape ? (
        <NoTapeYet
          what="this product has no observations"
          detail="No in-person trades for this product have been aggregated in the last 90 days. It may simply not have crossed a counter yet."
        />
      ) : (
        <>
          {identities.length > 1 ? (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Identity
              </span>
              {identities.map((i) => {
                const active = selected?.key === i.key;
                const href = `/ops/product/${productId}?${new URLSearchParams(
                  i.printing
                    ? { condition: i.condition, printing: i.printing }
                    : { condition: i.condition }
                )}`;
                return (
                  <Link
                    key={i.key}
                    href={href}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {i.condition}
                    {i.printing ? ` · ${i.printing}` : ""}
                    <span className="ml-1.5 tabular-nums opacity-70">
                      {formatCount(i.trades)}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : null}

          <Section
            title="Daily tape"
            subtitle={
              selected
                ? `${selected.condition}${selected.printing ? ` · ${selected.printing}` : ""} · last ${WINDOW_DAYS} days`
                : undefined
            }
            padded
            className="mb-4"
          >
            <ObservationHistoryChart data={chartData} />
          </Section>

          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.25fr_1fr]">
            <Card className="overflow-hidden">
              <div className="flex h-12 items-center justify-between gap-3 border-b border-border/60 px-4">
                <p className="text-sm font-semibold text-foreground">Published price</p>
                <p className="text-xs text-muted-foreground">
                  {sp ? `as of ${formatDate(sp.asOf)}` : "not published"}
                </p>
              </div>
              {sp ? (
                <>
                  <div className="grid grid-cols-2 gap-px bg-border/60 lg:grid-cols-4">
                    <FactCell
                      label="Street"
                      value={formatMoney(sp.streetPrice)}
                      sub="in-person trades"
                      className="bg-card"
                    />
                    <FactCell
                      label="Reference"
                      value={formatMoney(sp.referencePrice)}
                      sub="marketplace retail"
                      className="bg-card"
                    />
                    <FactCell
                      label="Blended"
                      value={formatMoney(sp.blendedPrice)}
                      sub="confidence-weighted"
                      className="bg-card"
                    />
                    <FactCell
                      label="Divergence"
                      value={
                        <span
                          className={cn(
                            sp.divergencePct === null
                              ? "text-muted-foreground"
                              : Number(sp.divergencePct) > 0
                                ? "text-success"
                                : "text-destructive"
                          )}
                        >
                          {formatPct(sp.divergencePct)}
                        </span>
                      }
                      sub="street vs reference"
                      className="bg-card"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-px border-t border-border/60 bg-border/60 lg:grid-cols-4">
                    <FactCell
                      label="Sample"
                      value={`${formatCount(sp.sampleTrades)} / ${formatCount(sp.sampleStores)}`}
                      sub="trades / stores"
                      className="bg-card"
                    />
                    <FactCell
                      label="Attested"
                      value={formatShare(sp.verifiedShare)}
                      sub="units with a charge id"
                      className="bg-card"
                    />
                    <FactCell
                      label="Confidence"
                      value={confidenceValue === null ? "—" : confidenceValue.toFixed(3)}
                      sub="0 to 0.85"
                      className="bg-card"
                    />
                    <FactCell
                      label="Computed"
                      value={formatDateTime(sp.computedAt)}
                      sub="last job pass"
                      className="bg-card"
                    />
                  </div>
                  <div className="border-t border-border/60 px-4 py-3">
                    <AttestationBar share={Number(sp.verifiedShare)} />
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                      The blend sits {formatShare(confidenceValue ?? 0, 0)} of the way from
                      the marketplace reference toward the street price. Confidence is a
                      weighted geometric mean, so the weakest axis below is what is
                      holding it back.
                    </p>
                  </div>
                </>
              ) : (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm font-medium text-foreground">
                    Nothing published for this identity
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Observations exist but no street price has been written — usually
                    because fewer than two stores contributed.
                  </p>
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <div className="flex h-12 items-center border-b border-border/60 px-4">
                <p className="text-sm font-semibold text-foreground">Confidence breakdown</p>
              </div>
              <div className="px-4 py-2">
                {breakdown ? (
                  (["sample", "breadth", "agreement", "recency", "attestation"] as const).map(
                    (axis) => {
                      const value = Number(breakdown[axis]);
                      return (
                        <AxisBar
                          key={axis}
                          label={axis[0].toUpperCase() + axis.slice(1)}
                          value={Number.isFinite(value) ? value : null}
                          hint={axisHints[axis]}
                          weak={Number.isFinite(value) && value < 0.25}
                        />
                      );
                    }
                  )
                ) : (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No breakdown recorded for this identity.
                  </p>
                )}
              </div>
            </Card>
          </div>

          <Card className="mb-4 overflow-hidden">
            <div className="grid grid-cols-2 gap-px bg-border/60 lg:grid-cols-4">
              <FactCell
                label="Days observed"
                value={formatCount(selectedObservations.length)}
                sub={`last ${WINDOW_DAYS} days`}
                className="bg-card"
              />
              <FactCell
                label="Trades counted"
                value={formatCount(selectedTotals.trades)}
                sub={`${formatCount(selectedTotals.raw)} ingested · ${formatCount(
                  selectedTotals.excluded
                )} rejected`}
                className="bg-card"
              />
              <FactCell
                label="Attested units"
                value={formatShare(
                  safeDivide(selectedTotals.verifiedUnits, selectedTotals.units)
                )}
                sub={pluralize(selectedTotals.units, "unit")}
                className="bg-card"
              />
              <FactCell
                label="Card-fenced days"
                value={formatCount(selectedTotals.fenced)}
                sub={`peak ${pluralize(selectedTotals.maxStores, "store")} in a day`}
                className="bg-card"
              />
            </div>
          </Card>

          <Section
            title="Rejected trades"
            subtitle={`${formatCount(exclusions.length)} most recent`}
          >
            {exclusions.length === 0 ? (
              <p className="px-4 py-10 text-center text-xs text-muted-foreground">
                Nothing for this product has been rejected by the quality filters.
              </p>
            ) : (
              <>
                <div className="hidden md:block">
                  <Table>
                    <colgroup>
                      <col className="w-[16%]" />
                      <col className="w-[22%]" />
                      <col className="w-[14%]" />
                      <col className="w-[14%]" />
                      <col className="w-[34%]" />
                    </colgroup>
                    <TableHeader>
                      <TableRow className="h-9 hover:bg-transparent">
                        <TableHead>Day</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead className="text-right">Rejected price</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead>Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exclusions.map((e) => (
                        <TableRow key={e.id} className="h-12">
                          <TableCell className="text-xs tabular-nums text-muted-foreground">
                            {formatDate(e.bucketDate)}
                          </TableCell>
                          <TableCell className="text-xs text-foreground">
                            {reasonLabels[e.reason] ?? e.reason}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-foreground">
                            {formatMoney(e.unitPrice)}
                          </TableCell>
                          <TableCell>
                            {e.wasVerified ? (
                              <Badge variant="neutral">Card-verified</Badge>
                            ) : (
                              <Badge variant="attention">Self-reported</Badge>
                            )}
                          </TableCell>
                          <TableCell className="overflow-hidden text-xs text-muted-foreground">
                            <span className="block truncate" title={e.detail ?? ""}>
                              {e.detail ?? "—"}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="md:hidden">
                  {exclusions.map((e) => (
                    <div key={e.id} className="border-b border-border/60 px-4 py-3 last:border-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {reasonLabels[e.reason] ?? e.reason}
                        </p>
                        <p className="shrink-0 text-sm tabular-nums text-foreground">
                          {formatMoney(e.unitPrice)}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(e.bucketDate)} ·{" "}
                        {e.wasVerified ? "card-verified" : "self-reported"}
                      </p>
                      {e.detail ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">{e.detail}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
