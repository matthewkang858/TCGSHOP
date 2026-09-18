import { sql } from "drizzle-orm";
import { BadgeCheck, Layers, Receipt, Store } from "lucide-react";
import { db } from "@/db";
import { marketObservations, transactions } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { StatCard } from "@/components/ui/stat-card";
import { formatDate } from "@/lib/utils";
import { TradesTrendChart, type TradesDay } from "./charts";
import {
  AggregateNote,
  AttestationBar,
  FactCell,
  NoTapeYet,
  formatCount,
  formatShare,
  pluralize,
  safeDivide,
} from "./ui";

/**
 * Coverage: how much tape do we have, and how much of it is worth anything?
 *
 * The headline is deliberately not "how many trades" — volume is easy and
 * cheap to fake. The credibility number is the share of volume a payment
 * processor attested, because that is the part of the dataset an attacker
 * would have to pay real processor fees to move.
 */
export default async function OpsCoveragePage() {
  const [tape] = await db
    .select({
      observations: sql<number>`(count(*))::int`,
      identities: sql<number>`(count(distinct (
        ${marketObservations.productId},
        ${marketObservations.condition},
        coalesce(${marketObservations.printing}, ''),
        ${marketObservations.language}
      )))::int`,
      productCount: sql<number>`(count(distinct ${marketObservations.productId}))::int`,
      ingestedTrades: sql<number>`(coalesce(sum(${marketObservations.rawTradeCount}), 0))::int`,
      countedTrades: sql<number>`(coalesce(sum(${marketObservations.tradeCount}), 0))::int`,
      excludedTrades: sql<number>`(coalesce(sum(${marketObservations.excludedCount}), 0))::int`,
      units: sql<number>`(coalesce(sum(${marketObservations.unitCount}), 0))::int`,
      verifiedUnits: sql<number>`(coalesce(sum(${marketObservations.unitCount} * ${marketObservations.verifiedShare}), 0))::float8`,
      publishable: sql<number>`(count(*) filter (where ${marketObservations.storeCount} >= 2))::int`,
      publishableIdentities: sql<number>`(count(distinct (
        ${marketObservations.productId},
        ${marketObservations.condition},
        coalesce(${marketObservations.printing}, ''),
        ${marketObservations.language}
      )) filter (where ${marketObservations.storeCount} >= 2))::int`,
      fencedOnVerified: sql<number>`(count(*) filter (where ${marketObservations.fencedOnVerified}))::int`,
      widestDay: sql<number>`(coalesce(max(${marketObservations.storeCount}), 0))::int`,
      firstDay: sql<string | null>`min(${marketObservations.bucketDate})::date::text`,
      lastDay: sql<string | null>`max(${marketObservations.bucketDate})::date::text`,
    })
    .from(marketObservations);

  // Distinct contributing stores can only be counted at the ledger, because
  // the tape tables deliberately carry no store identity at all.
  const [contributors] = await db
    .select({
      stores: sql<number>`(count(distinct ${transactions.storeId}))::int`,
      storesRecent: sql<number>`(count(distinct ${transactions.storeId}) filter (
        where ${transactions.occurredAt} >= now() - interval '30 days'
      ))::int`,
      ledgerTrades: sql<number>`(count(*))::int`,
      ledgerAttested: sql<number>`(count(*) filter (where ${transactions.paymentRef} is not null))::int`,
    })
    .from(transactions);

  const trend = await db
    .execute<{ day: string; counted: number; excluded: number }>(sql`
      select d::date::text as day,
             (coalesce(sum(o.trade_count), 0))::int as counted,
             (coalesce(sum(o.excluded_count), 0))::int as excluded
      from generate_series(
        (now() - interval '29 days')::date, now()::date, interval '1 day'
      ) d
      left join market_observations o on o.bucket_date::date = d::date
      group by 1
      order by 1
    `)
    .then((r) => r.rows);

  const hasTape = (tape?.observations ?? 0) > 0;
  const attestedShare = safeDivide(tape?.verifiedUnits ?? 0, tape?.units ?? 0);
  const publishableShare = safeDivide(tape?.publishable ?? 0, tape?.observations ?? 0);
  const exclusionRate = safeDivide(tape?.excludedTrades ?? 0, tape?.ingestedTrades ?? 0);
  const ledgerAttestedShare = safeDivide(
    contributors?.ledgerAttested ?? 0,
    contributors?.ledgerTrades ?? 0
  );

  const trendData: TradesDay[] = trend.map((r) => ({
    day: r.day,
    counted: Number(r.counted),
    excluded: Number(r.excluded),
  }));
  const trendTotal = trendData.reduce((sum, d) => sum + d.counted + d.excluded, 0);

  const coveredRange =
    tape?.firstDay && tape?.lastDay
      ? `${formatDate(tape.firstDay)} – ${formatDate(tape.lastDay)}`
      : "no days covered";

  return (
    <div>
      <PageHeader
        title="Coverage"
        description={`${formatCount(tape?.observations ?? 0)} daily observations · ${coveredRange}`}
      />

      <AggregateNote>
        Cross-store aggregate. Counts below span every contributing store at
        once; no row on this page can be attributed to a particular store, and
        store names and ids are never read into this surface.
      </AggregateNote>

      {!hasTape ? (
        <>
          <NoTapeYet
            what="nothing has been aggregated"
            detail={
              (contributors?.ledgerTrades ?? 0) > 0
                ? `${pluralize(
                    contributors?.ledgerTrades,
                    "counter trade"
                  )} recorded across ${pluralize(
                    contributors?.stores,
                    "contributing store"
                  )}, but the aggregation job has not turned any of them into observations yet.`
                : "No counter transactions have been recorded yet, so there is nothing for the aggregation job to work from."
            }
          />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatCard
              label="Contributing stores"
              value={formatCount(contributors?.stores ?? 0)}
              sub={`${formatCount(contributors?.storesRecent ?? 0)} active in last 30 days`}
            />
            <StatCard
              label="Ledger trades recorded"
              value={formatCount(contributors?.ledgerTrades ?? 0)}
              sub={`${formatShare(ledgerAttestedShare)} carry a processor charge id`}
            />
          </div>
        </>
      ) : (
        <>
          {/* The credibility metric gets the largest number on the page. */}
          <Card className="mb-4 overflow-hidden">
            <div className="grid grid-cols-1 gap-px bg-border/60 md:grid-cols-[1.35fr_1fr]">
              <div className="bg-card px-5 py-5">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  <BadgeCheck className="size-3.5 text-primary" />
                  Card-verified share of volume
                </div>
                <p className="mt-2 text-5xl font-semibold tracking-[-0.03em] tabular-nums text-foreground">
                  {formatShare(attestedShare)}
                </p>
                <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
                  {formatCount(Math.round(tape.verifiedUnits))} of{" "}
                  {formatCount(tape.units)} units on the tape are backed by a payment
                  processor charge id. This is the number that decides whether the
                  dataset is worth licensing: anyone can type a price into a form, but
                  a charge id means a card was really run for that amount.
                </p>
                <AttestationBar share={attestedShare} className="mt-4" />
                <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted-foreground">
                  <span>Attested {formatShare(attestedShare)}</span>
                  <span>Self-reported {formatShare(1 - attestedShare)}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-2 md:grid-cols-1">
                <FactCell
                  label="Attested at the ledger"
                  value={formatShare(ledgerAttestedShare)}
                  sub={`${formatCount(contributors?.ledgerAttested ?? 0)} of ${formatCount(
                    contributors?.ledgerTrades ?? 0
                  )} recorded trades`}
                  className="bg-card"
                />
                <FactCell
                  label="Buckets fenced on card data"
                  value={formatShare(safeDivide(tape.fencedOnVerified, tape.observations))}
                  sub={`${formatCount(tape.fencedOnVerified)} observations where attested trades set the fences`}
                  className="bg-card"
                />
              </div>
            </div>
          </Card>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Distinct skus observed"
              value={formatCount(tape.identities)}
              sub={`${formatCount(tape.productCount)} products`}
            />
            <StatCard
              label="Trades ingested"
              value={formatCount(tape.ingestedTrades)}
              sub={`${formatCount(tape.countedTrades)} counted · ${formatShare(exclusionRate)} rejected`}
            />
            <StatCard
              label="Publishable share"
              value={formatShare(publishableShare)}
              sub={`${formatCount(tape.publishable)} of ${formatCount(
                tape.observations
              )} buckets reached 2+ stores`}
            />
            <StatCard
              label="Contributing stores"
              value={formatCount(contributors?.stores ?? 0)}
              sub={`${formatCount(contributors?.storesRecent ?? 0)} active in last 30 days`}
            />
          </div>

          <Section
            title="Trades per day"
            subtitle={`last 30 days · ${formatCount(trendTotal)} ingested`}
            padded
            className="mb-4"
          >
            <TradesTrendChart data={trendData} />
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Column height is everything the tape saw that day. The lighter band
              is what the quality filters threw out before anything was priced.
            </p>
          </Section>

          <Card className="overflow-hidden">
            <div className="grid grid-cols-2 gap-px bg-border/60 lg:grid-cols-4">
              <FactCell
                label="Most recent bucket"
                value={formatDate(tape.lastDay)}
                sub="latest day the job aggregated"
                className="bg-card"
              />
              <FactCell
                label="Publishable skus"
                value={formatCount(tape.publishableIdentities)}
                sub={`of ${formatCount(tape.identities)} observed`}
                className="bg-card"
              />
              <FactCell
                label="Units on the tape"
                value={formatCount(tape.units)}
                sub={`${formatCount(tape.countedTrades)} counted trades`}
                className="bg-card"
              />
              <FactCell
                label="Widest single day"
                value={pluralize(tape.widestDay, "store")}
                sub="most stores in one bucket"
                className="bg-card"
              />
            </div>
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <LegendNote
              icon={<Layers className="size-3.5" />}
              title="Publishable"
              body="A bucket only publishes once two or more distinct stores contributed to it. Below that it stays private — k-anonymity, not a quality judgement."
            />
            <LegendNote
              icon={<Receipt className="size-3.5" />}
              title="Ingested vs counted"
              body="Ingested is every trade the job looked at. Counted is what survived the plausibility gate, the IQR fences and the per-store fence."
            />
            <LegendNote
              icon={<Store className="size-3.5" />}
              title="Contributing stores"
              body="Counted from the ledger, never joined into the tape. The tape tables hold no store identity, which is what makes them safe to publish."
            />
          </div>
        </>
      )}
    </div>
  );
}

function LegendNote({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{body}</p>
    </Card>
  );
}
