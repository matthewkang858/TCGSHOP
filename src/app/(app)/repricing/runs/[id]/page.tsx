import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { CircleAlert, Download } from "lucide-react";
import { z } from "zod";
import { db } from "@/db";
import {
  expansions,
  inventoryItems,
  products,
  repriceRules,
  repriceRunItems,
  repriceRuns,
} from "@/db/schema";
import { requireStore } from "@/lib/tenancy";
import { PageHeader } from "@/components/page-header";
import { ProductImage } from "@/components/product-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatDateTime, formatMoney, formatPct } from "@/lib/utils";
import { applyRunAction, approveAllFlaggedAction, discardRunAction } from "../../actions";
import { ConfirmButton } from "../../confirm-button";
import { ApproveButton, ExcludeToggle } from "./run-item-toggles";

const searchSchema = z.object({
  sort: z.enum(["pct", "name", "old", "new", "flag"]).default("pct"),
  error: z.string().max(300).optional(),
});

const SORT_OPTIONS = [
  { value: "pct", label: "Move %" },
  { value: "flag", label: "Flagged" },
  { value: "name", label: "Name" },
  { value: "old", label: "Old $" },
  { value: "new", label: "New $" },
] as const;

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStore();
  const id = z.string().uuid().parse((await params).id);
  const { sort, error } = searchSchema.parse(await searchParams);

  const [run] = await db
    .select()
    .from(repriceRuns)
    .where(and(eq(repriceRuns.id, id), eq(repriceRuns.storeId, ctx.storeId)));
  if (!run) notFound();

  const orderBy = {
    pct: desc(sql`abs(coalesce(${repriceRunItems.pctChange}, 0))`),
    name: asc(products.cleanName),
    old: desc(repriceRunItems.oldPrice),
    new: desc(repriceRunItems.newPrice),
    flag: desc(repriceRunItems.flagged),
  }[sort];

  const items = await db
    .select({
      id: repriceRunItems.id,
      basisValue: repriceRunItems.basisValue,
      oldPrice: repriceRunItems.oldPrice,
      newPrice: repriceRunItems.newPrice,
      pctChange: repriceRunItems.pctChange,
      flagged: repriceRunItems.flagged,
      flagReason: repriceRunItems.flagReason,
      excluded: repriceRunItems.excluded,
      approved: repriceRunItems.approved,
      ruleName: repriceRules.name,
      productId: products.productId,
      productName: products.name,
      expansionName: expansions.name,
      condition: inventoryItems.condition,
      printing: inventoryItems.printing,
      quantity: inventoryItems.quantity,
      productType: sql<string>`coalesce(${products.productTypeOverride}, ${products.productType})`,
    })
    .from(repriceRunItems)
    .innerJoin(inventoryItems, eq(inventoryItems.id, repriceRunItems.inventoryItemId))
    .innerJoin(products, eq(products.productId, inventoryItems.productId))
    .innerJoin(expansions, eq(expansions.groupId, products.groupId))
    .leftJoin(repriceRules, eq(repriceRules.id, repriceRunItems.ruleId))
    .where(eq(repriceRunItems.runId, id))
    .orderBy(orderBy);

  const previewing = run.status === "previewing";
  const eligible = items.filter(
    (i) => !i.excluded && i.newPrice !== null && (!i.flagged || i.approved)
  ).length;
  const pendingFlags = items.filter(
    (i) => i.flagged && !i.approved && !i.excluded && i.newPrice !== null
  ).length;

  const pcts = items
    .filter((i) => i.pctChange !== null)
    .map((i) => Number(i.pctChange));
  const summary = {
    increases: pcts.filter((p) => p > 0).length,
    decreases: pcts.filter((p) => p < 0).length,
    flagged: items.filter((i) => i.flagged && i.newPrice !== null).length,
    noData: items.filter((i) => i.newPrice === null).length,
    avgChange: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
  };
  const priced = items.length - summary.noData;
  const share = (n: number) =>
    priced > 0 ? `${Math.round((n / priced) * 100)}% of priced` : "—";

  const headerFacts = previewing
    ? [
        "Preview — nothing changes until you apply",
        `${run.itemCount} lines`,
        `${eligible} ready`,
        pendingFlags > 0 ? `${pendingFlags} awaiting approval` : null,
        formatDateTime(run.createdAt),
      ]
        .filter(Boolean)
        .join(" · ")
    : run.status === "applied"
      ? `Applied ${run.appliedCount} of ${run.itemCount} lines · ${formatDateTime(run.appliedAt)}`
      : `Discarded — no shelf price changed · ${formatDateTime(run.createdAt)}`;

  const sortLink = (s: string) => `/repricing/runs/${id}?sort=${s}`;

  // Row identity meta: set · condition · printing · qty, plus the outgoing price.
  const rowMeta = (item: (typeof items)[number]) =>
    [
      item.expansionName,
      item.productType === "sealed" ? "Sealed" : item.condition,
      item.printing === "Foil" ? "Foil" : null,
      `×${item.quantity}`,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="space-y-4">
      <PageHeader title="Reprice run" description={headerFacts}>
        <Button asChild variant="outline">
          <a href={`/repricing/runs/${run.id}/export`} download>
            <Download />
            Export CSV
          </a>
        </Button>
        {previewing ? (
          <form action={applyRunAction}>
            <input type="hidden" name="runId" value={run.id} />
            <Button type="submit" disabled={eligible === 0}>
              Apply {eligible} changes
            </Button>
          </form>
        ) : null}
      </PageHeader>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-4">
        <StatCard
          label="Increases"
          value={summary.increases}
          sub={share(summary.increases)}
        />
        <StatCard
          label="Decreases"
          value={summary.decreases}
          sub={share(summary.decreases)}
        />
        <StatCard
          label="Flagged"
          value={summary.flagged}
          sub={
            pendingFlags > 0
              ? `${pendingFlags} awaiting approval`
              : summary.flagged > 0
                ? "all approved"
                : "—"
          }
          tone={pendingFlags > 0 ? "negative" : "neutral"}
        />
        <StatCard
          label="No data"
          value={summary.noData}
          sub={summary.noData > 0 ? "skipped on apply" : "—"}
        />
        <StatCard
          className="col-span-2 md:col-span-1"
          label="Avg change"
          value={formatPct(summary.avgChange)}
          sub={`across ${pcts.length} lines`}
        />
      </div>

      {items.length > 1 ? (
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <div className="inline-flex rounded-md border border-border/60 bg-card p-0.5">
            {SORT_OPTIONS.map((s) => (
              <Link
                key={s.value}
                href={sortLink(s.value)}
                aria-current={sort === s.value ? "true" : undefined}
                className={cn(
                  "flex h-8 items-center rounded-sm px-2.5 text-xs whitespace-nowrap transition-colors",
                  sort === s.value
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex min-w-0 items-baseline gap-2">
            <CardTitle>Changes</CardTitle>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {items.length}
            </span>
          </div>
          {previewing && pendingFlags > 0 ? (
            <form action={approveAllFlaggedAction} className="shrink-0">
              <input type="hidden" name="runId" value={run.id} />
              <button
                type="submit"
                className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Approve all {pendingFlags} flagged
              </button>
            </form>
          ) : null}
        </CardHeader>

        <CardContent className="p-0">
          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-muted-foreground">
              This run matched no inventory lines.
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <colgroup>
                    <col className="w-[44px]" />
                    <col className="w-[36%]" />
                    <col className="w-[13%]" />
                    <col className="w-[13%]" />
                    <col className="w-[14%]" />
                    <col className="w-[12%]" />
                    <col className="w-[96px]" />
                  </colgroup>
                  <TableHeader sticky={items.length > 20}>
                    <TableRow className="h-9 hover:bg-transparent">
                      <TableHead aria-label="Include in apply" />
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Basis</TableHead>
                      <TableHead className="text-right">Old</TableHead>
                      <TableHead className="text-right">New</TableHead>
                      <TableHead className="text-right">Δ%</TableHead>
                      <TableHead aria-label="Actions" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const pct = item.pctChange !== null ? Number(item.pctChange) : null;
                      const isFlagged = item.flagged && item.newPrice !== null;
                      const needsOk = isFlagged && !item.approved && !item.excluded;
                      return (
                        <TableRow
                          key={item.id}
                          className={cn("group", item.excluded && "opacity-45")}
                          title={item.ruleName ?? undefined}
                        >
                          <TableCell>
                            <ExcludeToggle
                              runId={run.id}
                              itemId={item.id}
                              excluded={item.excluded}
                              disabled={!previewing || item.newPrice === null}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex min-w-0 items-center gap-3">
                              <ProductImage
                                productId={item.productId}
                                name={item.productName}
                                className="h-10 w-[29px] shrink-0 rounded-[3px] border border-border/70 bg-muted"
                              />
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center">
                                  <Link
                                    href={`/products/${item.productId}`}
                                    title={item.productName}
                                    className="truncate text-sm font-medium text-foreground hover:underline"
                                  >
                                    {item.productName}
                                  </Link>
                                  {isFlagged ? (
                                    <span className="ml-2 shrink-0">
                                      <Badge
                                        variant="attention"
                                        title={item.flagReason ?? undefined}
                                      >
                                        flagged
                                      </Badge>
                                    </span>
                                  ) : item.newPrice === null ? (
                                    <span className="ml-2 shrink-0">
                                      <Badge
                                        variant="neutral"
                                        title={item.flagReason ?? undefined}
                                      >
                                        no data
                                      </Badge>
                                    </span>
                                  ) : null}
                                </div>
                                <p
                                  className="truncate text-xs text-muted-foreground"
                                  title={
                                    isFlagged
                                      ? (item.flagReason ?? undefined)
                                      : rowMeta(item)
                                  }
                                >
                                  {isFlagged && item.flagReason
                                    ? item.flagReason
                                    : rowMeta(item)}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {formatMoney(item.basisValue)}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                            {formatMoney(item.oldPrice)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium tabular-nums text-foreground">
                            {formatMoney(item.newPrice)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right text-xs font-medium tabular-nums",
                              pct === null && "text-muted-foreground",
                              pct !== null && pct > 0 && "text-success",
                              pct !== null && pct < 0 && "text-destructive"
                            )}
                          >
                            {formatPct(item.pctChange)}
                          </TableCell>
                          <TableCell className="text-right">
                            {isFlagged ? (
                              <div
                                className={cn(
                                  "flex justify-end transition-opacity",
                                  // A flagged row keeps its control at rest — it is
                                  // the one thing the clerk has to decide.
                                  !needsOk &&
                                    ""
                                )}
                              >
                                <ApproveButton
                                  runId={run.id}
                                  itemId={item.id}
                                  approved={item.approved}
                                  disabled={!previewing || item.excluded}
                                />
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Phone: the same rows at 64px, no horizontal scroll. */}
              <div className="md:hidden">
                {items.map((item) => {
                  const pct = item.pctChange !== null ? Number(item.pctChange) : null;
                  const isFlagged = item.flagged && item.newPrice !== null;
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "flex h-16 items-center gap-3 border-b border-border/60 px-4 last:border-0",
                        item.excluded && "opacity-45"
                      )}
                    >
                      <div className="flex w-4 shrink-0 items-center justify-center">
                        <ExcludeToggle
                          runId={run.id}
                          itemId={item.id}
                          excluded={item.excluded}
                          disabled={!previewing || item.newPrice === null}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center">
                          <Link
                            href={`/products/${item.productId}`}
                            className="truncate text-sm font-medium text-foreground hover:underline"
                          >
                            {item.productName}
                          </Link>
                          {isFlagged ? (
                            <span className="ml-2 shrink-0">
                              <Badge variant="attention">flagged</Badge>
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.newPrice === null
                            ? (item.flagReason ?? "no price data")
                            : `${rowMeta(item)} · was ${formatMoney(item.oldPrice)}`}
                        </p>
                      </div>
                      <div className="w-[76px] shrink-0 text-right">
                        <p className="truncate text-sm font-medium tabular-nums text-foreground">
                          {formatMoney(item.newPrice)}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 truncate text-xs font-medium tabular-nums",
                            pct === null && "text-muted-foreground",
                            pct !== null && pct > 0 && "text-success",
                            pct !== null && pct < 0 && "text-destructive"
                          )}
                        >
                          {formatPct(item.pctChange)}
                        </p>
                      </div>
                      {isFlagged ? (
                        <div className="flex w-[84px] shrink-0 justify-end">
                          <ApproveButton
                            runId={run.id}
                            itemId={item.id}
                            approved={item.approved}
                            disabled={!previewing || item.excluded}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {previewing ? (
        <div className="flex justify-end">
          {/* Destructive lives away from the rows and still routes through confirm. */}
          <form id="discard-run" action={discardRunAction} className="hidden">
            <input type="hidden" name="runId" value={run.id} />
          </form>
          <ConfirmButton
            type="submit"
            form="discard-run"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            message="Discard this preview run? No prices were changed."
          >
            Discard this run
          </ConfirmButton>
        </div>
      ) : null}
    </div>
  );
}
