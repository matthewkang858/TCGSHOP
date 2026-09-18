import Link from "next/link";
import { desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { marketObservations, products, tapeExclusions } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";
import { RejectedPriceChart, type PriceBucket } from "../charts";
import {
  AggregateNote,
  AttestationBar,
  NoTapeYet,
  formatCount,
  formatShare,
  safeDivide,
} from "../ui";

/**
 * Data quality: what the tape threw away, and why.
 *
 * The number to read first is the was-verified split. Card-attested trades
 * carry processor fees and a chargeback trail, so a store cannot cheaply
 * fabricate one — if the filters are doing their job, rejections should
 * cluster heavily in the self-reported column. A rejection profile that looks
 * the same for card and cash means the fences are measuring noise, not fraud.
 */

const WINDOW_DAYS = 30;
const RECENT_LIMIT = 50;

const reasonLabels: Record<string, string> = {
  price_outlier: "Price outlier",
  store_outlier: "Store outlier",
  implausible_vs_reference: "Implausible vs reference",
  non_positive_price: "Non-positive price",
};

const reasonNotes: Record<string, string> = {
  price_outlier: "Outside the IQR fence for its bucket — a typo or a one-off odd price.",
  store_outlier: "The store's whole price level for the bucket sat outside the fence.",
  implausible_vs_reference: "Too far from the marketplace reference to be a real trade.",
  non_positive_price: "Structurally invalid: a zero, negative or non-finite price.",
};

const bucketLabels = [
  "<$1",
  "$1–5",
  "$5–10",
  "$10–25",
  "$25–50",
  "$50–100",
  "$100–250",
  "$250–1k",
  "$1k+",
];

export default async function OpsQualityPage() {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  const byReason = await db
    .execute<{
      reason: string;
      total: number;
      verified: number;
      min_price: number | null;
      max_price: number | null;
      median_price: number | null;
    }>(sql`
      select ${tapeExclusions.reason}::text as reason,
             (count(*))::int as total,
             (count(*) filter (where ${tapeExclusions.wasVerified}))::int as verified,
             (min(${tapeExclusions.unitPrice}))::float8 as min_price,
             (max(${tapeExclusions.unitPrice}))::float8 as max_price,
             (percentile_cont(0.5) within group (
               order by ${tapeExclusions.unitPrice}
             ))::float8 as median_price
      from ${tapeExclusions}
      where ${tapeExclusions.bucketDate} >= ${since}
      group by 1
      order by 2 desc
    `)
    .then((r) => r.rows);

  const histogram = await db
    .execute<{ bucket: number; verified: number; unverified: number }>(sql`
      select b as bucket,
             (count(*) filter (where was_verified))::int as verified,
             (count(*) filter (where not was_verified))::int as unverified
      from (
        select was_verified,
               case
                 when unit_price < 1 then 0
                 when unit_price < 5 then 1
                 when unit_price < 10 then 2
                 when unit_price < 25 then 3
                 when unit_price < 50 then 4
                 when unit_price < 100 then 5
                 when unit_price < 250 then 6
                 when unit_price < 1000 then 7
                 else 8
               end as b
        from ${tapeExclusions}
        where ${tapeExclusions.bucketDate} >= ${since}
      ) s
      group by 1
      order by 1
    `)
    .then((r) => r.rows);

  const [ingest] = await db
    .select({
      rawTrades: sql<number>`(coalesce(sum(${marketObservations.rawTradeCount}), 0))::int`,
      excluded: sql<number>`(coalesce(sum(${marketObservations.excludedCount}), 0))::int`,
      observations: sql<number>`(count(*))::int`,
    })
    .from(marketObservations)
    .where(gte(marketObservations.bucketDate, since));

  const recent = await db
    .select({
      id: tapeExclusions.id,
      productId: tapeExclusions.productId,
      productName: products.name,
      bucketDate: tapeExclusions.bucketDate,
      reason: tapeExclusions.reason,
      unitPrice: tapeExclusions.unitPrice,
      wasVerified: tapeExclusions.wasVerified,
      detail: tapeExclusions.detail,
    })
    .from(tapeExclusions)
    .innerJoin(products, eq(products.productId, tapeExclusions.productId))
    .where(gte(tapeExclusions.bucketDate, since))
    .orderBy(desc(tapeExclusions.bucketDate), desc(tapeExclusions.createdAt))
    .limit(RECENT_LIMIT);

  const totalRejected = byReason.reduce((sum, r) => sum + Number(r.total), 0);
  const totalVerifiedRejected = byReason.reduce((sum, r) => sum + Number(r.verified), 0);
  // Rate comes from the exclusion log, the same source as every other number
  // on this page. `market_observations.excluded_count` is a redundant counter
  // written by the same job pass, so a mismatch is itself worth surfacing.
  const rejectionRate = safeDivide(totalRejected, ingest?.rawTrades ?? 0);
  const counterSkew = (ingest?.excluded ?? 0) !== totalRejected;
  const selfReportedShare = safeDivide(totalRejected - totalVerifiedRejected, totalRejected);

  const bucketByIndex = new Map(histogram.map((h) => [Number(h.bucket), h]));
  const chartData: PriceBucket[] = bucketLabels.map((label, i) => {
    const row = bucketByIndex.get(i);
    return {
      label,
      verified: Number(row?.verified ?? 0),
      unverified: Number(row?.unverified ?? 0),
    };
  });
  const chartHasData = chartData.some((b) => b.verified + b.unverified > 0);

  const hasWindow = (ingest?.observations ?? 0) > 0 || totalRejected > 0;

  return (
    <div>
      <PageHeader
        title="Data quality"
        description={`Last ${WINDOW_DAYS} days · ${formatCount(
          totalRejected
        )} trades rejected out of ${formatCount(ingest?.rawTrades ?? 0)} ingested`}
      />

      <AggregateNote>
        Rejections are logged per trade with the reason and the offending
        price. The log deliberately carries no store identity — the point is to
        audit the filters, not to build a case against a store.
      </AggregateNote>

      {!hasWindow ? (
        <NoTapeYet
          what="nothing has been aggregated in this window"
          detail={`The aggregation job has produced no observations in the last ${WINDOW_DAYS} days, so there is nothing to have rejected.`}
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Rejection rate"
              value={formatShare(rejectionRate)}
              sub={`${formatCount(totalRejected)} of ${formatCount(
                ingest?.rawTrades ?? 0
              )} ingested trades`}
            />
            <StatCard
              label="Rejections logged"
              value={formatCount(totalRejected)}
              sub={`across ${formatCount(byReason.length)} reasons`}
            />
            <StatCard
              label="Self-reported"
              value={formatShare(selfReportedShare)}
              sub={`${formatCount(
                totalRejected - totalVerifiedRejected
              )} rejections with no charge id`}
            />
            <StatCard
              label="Card-verified"
              value={formatShare(safeDivide(totalVerifiedRejected, totalRejected))}
              sub={`${formatCount(totalVerifiedRejected)} rejections a processor had attested`}
            />
          </div>

          <Section
            title="By reason"
            subtitle={`last ${WINDOW_DAYS} days`}
            className="mb-4"
          >
            {byReason.length === 0 ? (
              <p className="px-4 py-10 text-center text-xs text-muted-foreground">
                Nothing was rejected in this window.
              </p>
            ) : (
              <>
                <div className="hidden md:block">
                  <Table>
                    <colgroup>
                      <col className="w-[30%]" />
                      <col className="w-[10%]" />
                      <col className="w-[22%]" />
                      <col className="w-[12%]" />
                      <col className="w-[26%]" />
                    </colgroup>
                    <TableHeader>
                      <TableRow className="h-9 hover:bg-transparent">
                        <TableHead>Reason</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                        <TableHead>Card-verified split</TableHead>
                        <TableHead className="text-right">Median price</TableHead>
                        <TableHead className="text-right">Rejected range</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byReason.map((r) => {
                        const total = Number(r.total);
                        const verified = Number(r.verified);
                        const verifiedShare = safeDivide(verified, total);
                        return (
                          <TableRow key={r.reason} className="h-16">
                            <TableCell className="overflow-hidden">
                              <p className="truncate text-sm font-medium text-foreground">
                                {reasonLabels[r.reason] ?? r.reason}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {reasonNotes[r.reason] ?? ""}
                              </p>
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium tabular-nums">
                              {formatCount(total)}
                            </TableCell>
                            <TableCell>
                              <AttestationBar share={verifiedShare} />
                              <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                                {formatCount(verified)} card · {formatCount(total - verified)}{" "}
                                cash/other
                              </p>
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums text-foreground">
                              {formatMoney(r.median_price)}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                              {formatMoney(r.min_price)} – {formatMoney(r.max_price)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div className="md:hidden">
                  {byReason.map((r) => {
                    const total = Number(r.total);
                    const verified = Number(r.verified);
                    return (
                      <div
                        key={r.reason}
                        className="border-b border-border/60 px-4 py-3 last:border-0"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium text-foreground">
                            {reasonLabels[r.reason] ?? r.reason}
                          </p>
                          <p className="shrink-0 text-sm tabular-nums text-foreground">
                            {formatCount(total)}
                          </p>
                        </div>
                        <AttestationBar
                          share={safeDivide(verified, total)}
                          className="mt-2"
                        />
                        <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                          {formatCount(verified)} card · {formatCount(total - verified)}{" "}
                          cash/other · median {formatMoney(r.median_price)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Section>

          <Section
            title="Rejected price distribution"
            subtitle={chartHasData ? `${formatCount(totalRejected)} trades` : undefined}
            padded
            className="mb-4"
          >
            <RejectedPriceChart data={chartHasData ? chartData : []} />
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              If the filters are working, the self-reported band dominates every
              bucket and the card-verified band stays thin — a store can type any
              number into a form, but it has to pay processor fees to fake a
              charge id.
            </p>
          </Section>

          <Section
            title="Recent rejections"
            subtitle={`${formatCount(recent.length)} most recent`}
          >
            {recent.length === 0 ? (
              <p className="px-4 py-10 text-center text-xs text-muted-foreground">
                Nothing was rejected in this window.
              </p>
            ) : (
              <>
                <div className="hidden md:block">
                  <Table>
                    <colgroup>
                      <col className="w-[28%]" />
                      <col className="w-[12%]" />
                      <col className="w-[18%]" />
                      <col className="w-[12%]" />
                      <col className="w-[13%]" />
                      <col className="w-[17%]" />
                    </colgroup>
                    <TableHeader sticky={recent.length > 20}>
                      <TableRow className="h-9 hover:bg-transparent">
                        <TableHead>Product</TableHead>
                        <TableHead>Day</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead>Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recent.map((e) => (
                        <TableRow key={e.id} className="h-12">
                          <TableCell className="overflow-hidden">
                            <Link
                              href={`/ops/product/${e.productId}`}
                              className="block truncate text-sm font-medium text-foreground hover:underline"
                            >
                              {e.productName}
                            </Link>
                          </TableCell>
                          <TableCell className="text-xs tabular-nums text-muted-foreground">
                            {formatDate(e.bucketDate)}
                          </TableCell>
                          <TableCell className="overflow-hidden text-xs text-foreground">
                            <span className="block truncate">
                              {reasonLabels[e.reason] ?? e.reason}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-foreground">
                            {formatMoney(e.unitPrice)}
                          </TableCell>
                          <TableCell>
                            {e.wasVerified ? (
                              <Badge variant="neutral">Card</Badge>
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
                  {recent.map((e) => (
                    <div
                      key={e.id}
                      className="border-b border-border/60 px-4 py-3 last:border-0"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <Link
                          href={`/ops/product/${e.productId}`}
                          className="truncate text-sm font-medium text-foreground hover:underline"
                        >
                          {e.productName}
                        </Link>
                        <p className="shrink-0 text-sm tabular-nums text-foreground">
                          {formatMoney(e.unitPrice)}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {reasonLabels[e.reason] ?? e.reason} · {formatDate(e.bucketDate)} ·{" "}
                        {e.wasVerified ? "card" : "self-reported"}
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

          <Card className="mt-4 px-4 py-3">
            <p className="text-xs font-semibold text-foreground">Reading this page</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              A rising rejection rate is not automatically bad — it usually means
              volume arrived faster than breadth, so the fences had more to work
              with. What matters is the split: rejections concentrated in
              self-reported trades are the filters doing their job, while a
              card-verified rejection is worth opening, because someone paid real
              processor fees for a price the tape still did not believe.
            </p>
            {counterSkew ? (
              <p className="mt-2 text-[11px] leading-relaxed text-destructive">
                Counter mismatch: the exclusion log holds{" "}
                {formatCount(totalRejected)} rejections for this window while the
                daily observations report {formatCount(ingest?.excluded ?? 0)}. The
                two are written by the same job pass, so a gap means one side was
                persisted without the other.
              </p>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
