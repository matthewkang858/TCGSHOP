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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import type { RuleScope } from "@/db/schema";
import {
  createRunAction,
  deleteRuleAction,
  toggleRuleActiveAction,
} from "./actions";
import { ConfirmButton } from "./confirm-button";

function scopeSummary(scope: RuleScope): string {
  const parts: string[] = [];
  if (scope.product_type?.length) parts.push(scope.product_type.join("+"));
  if (scope.category_ids?.length) parts.push(`${scope.category_ids.length} game(s)`);
  if (scope.group_ids?.length) parts.push(`${scope.group_ids.length} set(s)`);
  if (scope.rarity?.length) parts.push(scope.rarity.join("/"));
  if (scope.price_min != null || scope.price_max != null)
    parts.push(`$${scope.price_min ?? 0}–${scope.price_max ?? "∞"}`);
  if (scope.tags?.length) parts.push(`tags: ${scope.tags.join(",")}`);
  if (scope.condition?.length) parts.push(scope.condition.join("/"));
  if (scope.printing) parts.push(scope.printing);
  return parts.length ? parts.join(" · ") : "everything";
}

const BASIS_LABEL: Record<string, string> = {
  tcg_market: "TCG Market",
  tcg_low: "TCG Low",
  sales_median_7d: "7d sales median",
  ck_buylist: "CK Buylist",
  cardmarket_trend: "CM Trend",
};

export default async function RepricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStore();
  const { error } = z
    .object({ error: z.string().max(300).optional() })
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Repricing"
        description="First matching rule prices each card. Preview before anything changes."
      >
        <Button asChild variant="outline">
          <Link href="/repricing/rules/new">
            <Plus />
            New rule
          </Link>
        </Button>
      </PageHeader>

      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {rules.length === 0 ? (
        <EmptyState
          icon={<Tags className="h-8 w-8" />}
          title="No repricing rules yet"
          description='Create your first rule — e.g. "Singles: TCG Market ×1.0, floor $0.25, psychological rounding" or "Sealed: TCG Market ×1.05, min 15% margin over cost, dollar rounding".'
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
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createRunAction}>
              <Table className="min-w-[820px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Run</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Basis</TableHead>
                    <TableHead>Formula</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          name="ruleIds"
                          value={r.id}
                          defaultChecked={r.active}
                          disabled={!r.active}
                        />
                      </TableCell>
                      <TableCell className="tabular-nums">{r.priority}</TableCell>
                      <TableCell>
                        <Link
                          href={`/repricing/rules/${r.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {r.name}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-muted-foreground">
                        {scopeSummary(r.scope)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{BASIS_LABEL[r.basis] ?? r.basis}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        ×{Number(r.multiplier)}
                        {Number(r.offset) !== 0
                          ? ` ${Number(r.offset) > 0 ? "+" : "−"}$${Math.abs(Number(r.offset)).toFixed(2)}`
                          : ""}{" "}
                        · {r.rounding}
                        {r.respectCostBasis ? ` · ≥cost+${Number(r.minMarginPct)}%` : ""}
                        {r.maxChangePct != null ? ` · flag>±${Number(r.maxChangePct)}%` : ""}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.active ? "success" : "outline"}>
                          {r.active ? "active" : "off"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {/* buttons target the per-rule forms rendered after the
                            run form via form="<id>" — nesting forms is invalid HTML */}
                        <div className="flex items-center justify-end gap-1">
                          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                            <Link href={`/repricing/rules/${r.id}`}>Edit</Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            type="submit"
                            form={`toggle-rule-${r.id}`}
                          >
                            {r.active ? "Disable" : "Enable"}
                          </Button>
                          <ConfirmButton
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            type="submit"
                            form={`delete-rule-${r.id}`}
                            message={`Delete rule "${r.name}"? This can't be undone.`}
                          >
                            Delete
                          </ConfirmButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4 flex justify-end border-t pt-4">
                <Button type="submit">
                  <Play />
                  Preview reprice run
                </Button>
              </div>
            </form>
            {/* action-column targets: rendered outside the run form so forms never nest */}
            {rules.map((r) => (
              <div key={r.id} className="hidden">
                <form id={`toggle-rule-${r.id}`} action={toggleRuleActiveAction}>
                  <input type="hidden" name="ruleId" value={r.id} />
                  <input type="hidden" name="active" value={r.active ? "false" : "true"} />
                </form>
                <form id={`delete-rule-${r.id}`} action={deleteRuleAction}>
                  <input type="hidden" name="ruleId" value={r.id} />
                </form>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Run history</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No runs yet. Select rules above and preview a run.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Flagged</TableHead>
                  <TableHead className="text-right">Applied</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{formatDateTime(run.createdAt)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          run.status === "applied"
                            ? "success"
                            : run.status === "previewing"
                              ? "warning"
                              : "outline"
                        }
                      >
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{run.itemCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{run.flaggedCount}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.status === "applied" ? run.appliedCount : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/repricing/runs/${run.id}`}
                        className="text-sm text-primary hover:underline"
                      >
                        {run.status === "previewing" ? "Review & apply" : "View"}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
