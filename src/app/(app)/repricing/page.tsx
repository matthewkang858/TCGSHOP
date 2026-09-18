import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { CircleAlert, Play, Plus, Tags } from "lucide-react";
import { z } from "zod";
import { db } from "@/db";
import { repriceRules, repriceRuns } from "@/db/schema";
import { requireStore } from "@/lib/tenancy";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";
import type { RuleScope } from "@/db/schema";
import { createRunAction, deleteRuleAction } from "./actions";
import { RuleActiveSwitch, RuleOverflowMenu } from "./rule-controls";

type Rule = typeof repriceRules.$inferSelect;

const RUN_HISTORY_PREVIEW = 5;

const BASIS_LABEL: Record<string, string> = {
  tcg_market: "TCG Market",
  tcg_low: "TCG Low",
  sales_median_7d: "7d sales median",
  ck_buylist: "CK Buylist",
  cardmarket_trend: "CM Trend",
};

const ROUNDING_LABEL: Record<string, string> = {
  psychological: ".49/.99 endings",
  quarter: "nearest quarter",
  dollar: "whole dollars",
  cents: "exact cents",
};

const TYPE_LABEL: Record<string, string> = { single: "singles", sealed: "sealed" };

function scopeSummary(scope: RuleScope): string {
  const parts: string[] = [];
  if (scope.product_type?.length)
    parts.push(scope.product_type.map((t) => TYPE_LABEL[t] ?? t).join(" + "));
  if (scope.category_ids?.length) parts.push(`${scope.category_ids.length} game(s)`);
  if (scope.group_ids?.length) parts.push(`${scope.group_ids.length} set(s)`);
  if (scope.rarity?.length) parts.push(scope.rarity.join("/"));
  if (scope.price_min != null || scope.price_max != null)
    parts.push(`$${scope.price_min ?? 0}–${scope.price_max ?? "∞"}`);
  if (scope.tags?.length) parts.push(scope.tags.join(", "));
  if (scope.condition?.length) parts.push(scope.condition.join("/"));
  if (scope.printing) parts.push(scope.printing);
  return parts.length ? parts.join(" · ") : "all inventory";
}

/** "TCG Market × 1.05 → whole dollars" — the formula as a sentence, not symbols. */
function pricingSummary(rule: Rule): string {
  const offset = Number(rule.offset);
  const basis = `${BASIS_LABEL[rule.basis] ?? rule.basis} × ${Number(rule.multiplier)}`;
  const withOffset =
    offset !== 0
      ? `${basis} ${offset > 0 ? "+" : "−"} ${formatMoney(Math.abs(offset))}`
      : basis;
  return `${withOffset} → ${ROUNDING_LABEL[rule.rounding] ?? rule.rounding}`;
}

/** The guards that stop a bad price — second line under the formula. */
function guardSummary(rule: Rule): string {
  const parts: string[] = [];
  if (rule.floor != null) parts.push(`floor ${formatMoney(rule.floor)}`);
  if (rule.ceiling != null) parts.push(`ceiling ${formatMoney(rule.ceiling)}`);
  if (Number(rule.minPrice) > 0) parts.push(`min ${formatMoney(rule.minPrice)}`);
  if (rule.respectCostBasis)
    parts.push(`never below cost + ${Number(rule.minMarginPct)}%`);
  if (rule.maxChangePct != null)
    parts.push(`flag moves over ±${Number(rule.maxChangePct)}%`);
  return parts.length ? parts.join(" · ") : "no guards";
}

export default async function RepricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStore();
  const { error, runs: runsParam } = z
    .object({
      error: z.string().max(300).optional(),
      runs: z.enum(["all"]).optional(),
    })
    .parse(await searchParams);

  const rules = await db
    .select()
    .from(repriceRules)
    .where(eq(repriceRules.storeId, ctx.storeId))
    .orderBy(asc(repriceRules.priority), asc(repriceRules.createdAt));

  const runs = await db
    .select()
    .from(repriceRuns)
    .where(eq(repriceRuns.storeId, ctx.storeId))
    .orderBy(desc(repriceRuns.createdAt))
    .limit(20);

  const activeCount = rules.filter((r) => r.active).length;
  const openRun = runs.find((r) => r.status === "previewing");
  const showAllRuns = runsParam === "all";
  const visibleRuns = showAllRuns ? runs : runs.slice(0, RUN_HISTORY_PREVIEW);

  const headerFacts = [
    `${rules.length} rule${rules.length === 1 ? "" : "s"}`,
    `${activeCount} active`,
    runs.length
      ? `last run ${formatDateTime(runs[0].createdAt)}`
      : "no runs yet",
  ].join(" · ");

  return (
    <div className="space-y-4">
      <PageHeader title="Repricing" description={headerFacts}>
        <Button asChild variant="outline">
          <Link href="/repricing/rules/new">
            <Plus />
            New rule
          </Link>
        </Button>
      </PageHeader>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {openRun ? (
        <div className="flex h-12 items-center justify-between gap-3 rounded-lg border border-warning/25 bg-warning/10 px-4">
          <p className="truncate text-sm text-warning-foreground">
            A preview from {formatDateTime(openRun.createdAt)} is still waiting on you.
          </p>
          <Link
            href={`/repricing/runs/${openRun.id}`}
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            Review →
          </Link>
        </div>
      ) : null}

      {rules.length === 0 ? (
        <EmptyState
          icon={<Tags />}
          title="No repricing rules yet"
          description="A rule pegs a slice of your inventory to a market basis — e.g. singles at TCG Market ×1.0 with .99 endings, sealed at ×1.05 never below cost."
          action={
            <Button asChild>
              <Link href="/repricing/rules/new">
                <Plus />
                Create a rule
              </Link>
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex min-w-0 items-baseline gap-2">
              <CardTitle>Rules</CardTitle>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {rules.length}
              </span>
            </div>
            <span className="hidden shrink-0 text-xs text-muted-foreground md:block">
              first match prices each line
            </span>
          </CardHeader>

          <CardContent className="p-0">
            {/* One row markup for both breakpoints: the run checkboxes must exist
                exactly once, or a hidden copy would post duplicate ruleIds. */}
            <form id="create-run" action={createRunAction}>
              <div className="hidden h-9 items-center gap-3 border-b border-border bg-surface-subtle px-4 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground md:flex">
                <span className="w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">Rule</span>
                <span className="w-[34%] shrink-0">Pricing</span>
                <span className="w-16 shrink-0">Active</span>
                <span className="w-[88px] shrink-0" aria-hidden />
              </div>

              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="group flex h-16 items-center gap-3 border-b border-border/60 px-4 transition-colors last:border-0 hover:bg-muted/40 md:h-14"
                >
                  <input
                    type="checkbox"
                    name="ruleIds"
                    value={rule.id}
                    defaultChecked={rule.active}
                    disabled={!rule.active}
                    aria-label={`Include "${rule.name}" in the next run`}
                    className="size-4 shrink-0 accent-primary"
                  />

                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/repricing/rules/${rule.id}`}
                      title={rule.name}
                      className="block truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {rule.name}
                    </Link>
                    <p
                      className="mt-0.5 truncate text-xs text-muted-foreground"
                      title={scopeSummary(rule.scope)}
                    >
                      Priority {rule.priority} · {scopeSummary(rule.scope)}
                    </p>
                  </div>

                  <div className="hidden w-[34%] shrink-0 md:block">
                    <p
                      className="truncate text-sm text-foreground"
                      title={pricingSummary(rule)}
                    >
                      {pricingSummary(rule)}
                    </p>
                    <p
                      className="mt-0.5 truncate text-xs text-muted-foreground"
                      title={guardSummary(rule)}
                    >
                      {guardSummary(rule)}
                    </p>
                  </div>

                  <div className="flex w-11 shrink-0 justify-end md:w-16 md:justify-start">
                    <RuleActiveSwitch
                      ruleId={rule.id}
                      active={rule.active}
                      name={rule.name}
                    />
                  </div>

                  <div className="flex w-[88px] shrink-0 items-center justify-end gap-1">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/repricing/rules/${rule.id}`}>Edit</Link>
                    </Button>
                    <RuleOverflowMenu ruleId={rule.id} name={rule.name} />
                  </div>
                </div>
              ))}
            </form>

            {/* Per-rule action targets live outside the run form — forms never nest. */}
            {rules.map((rule) => (
              <form
                key={rule.id}
                id={`delete-rule-${rule.id}`}
                action={deleteRuleAction}
                className="hidden"
              >
                <input type="hidden" name="ruleId" value={rule.id} />
              </form>
            ))}
          </CardContent>

          <CardFooter className="justify-end">
            <Button type="submit" form="create-run">
              <Play />
              Preview reprice run
            </Button>
          </CardFooter>
        </Card>
      )}

      <Card id="runs" className="overflow-hidden">
        <CardHeader>
          <div className="flex min-w-0 items-baseline gap-2">
            <CardTitle>Run history</CardTitle>
            {runs.length ? (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {runs.length}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-muted-foreground">
              No runs yet. Pick the rules to run above, then preview.
            </p>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <colgroup>
                    <col className="w-[28%]" />
                    <col className="w-[16%]" />
                    <col className="w-[14%]" />
                    <col className="w-[14%]" />
                    <col className="w-[14%]" />
                    <col className="w-[104px]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow className="h-9 hover:bg-transparent">
                      <TableHead>When</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Flagged</TableHead>
                      <TableHead className="text-right">Applied</TableHead>
                      <TableHead aria-label="Actions" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRuns.map((run) => (
                      <TableRow key={run.id} className="group">
                        <TableCell>
                          <Link
                            href={`/repricing/runs/${run.id}`}
                            className="block truncate text-sm font-medium text-foreground hover:underline"
                          >
                            {formatDateTime(run.createdAt)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {run.status === "previewing" ? (
                            <Badge variant="attention">needs review</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {run.status}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium tabular-nums">
                          {run.itemCount}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right text-sm tabular-nums",
                            run.flaggedCount > 0
                              ? "font-medium text-foreground"
                              : "text-muted-foreground"
                          )}
                        >
                          {run.flaggedCount || "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                          {run.status === "applied" ? run.appliedCount : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end">
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/repricing/runs/${run.id}`}>
                                {run.status === "previewing" ? "Review" : "View"}
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="md:hidden">
                {visibleRuns.map((run) => (
                  <div
                    key={run.id}
                    className="relative flex h-16 items-center gap-3 border-b border-border/60 px-4 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center">
                        <Link
                          href={`/repricing/runs/${run.id}`}
                          className="truncate text-sm font-medium text-foreground hover:underline after:absolute after:inset-0"
                        >
                          {formatDateTime(run.createdAt)}
                        </Link>
                        {run.status === "previewing" ? (
                          <span className="ml-2 shrink-0">
                            <Badge variant="attention">needs review</Badge>
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {run.itemCount} lines · {run.flaggedCount} flagged ·{" "}
                        {run.status === "applied"
                          ? `${run.appliedCount} applied`
                          : run.status}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
        {!showAllRuns && runs.length > RUN_HISTORY_PREVIEW ? (
          <Link
            href="/repricing?runs=all#runs"
            className="flex h-11 items-center justify-center border-t border-border/60 text-xs font-medium text-primary hover:bg-muted/40"
          >
            View all {runs.length} runs →
          </Link>
        ) : null}
      </Card>
    </div>
  );
}
