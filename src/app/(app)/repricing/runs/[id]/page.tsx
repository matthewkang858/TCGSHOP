import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { CircleAlert, Download, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { ApproveButton, ExcludeToggle } from "./run-item-toggles";

const searchSchema = z.object({
  sort: z.enum(["pct", "name", "old", "new", "flag"]).default("pct"),
  error: z.string().max(300).optional(),
});

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

  const sortLink = (s: string) => `/repricing/runs/${id}?sort=${s}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Reprice run · ${formatDateTime(run.createdAt)}`}
        description={
          previewing
            ? `Preview — nothing has been applied yet. ${eligible} of ${run.itemCount} rows will apply.`
            : run.status === "applied"
              ? `Applied ${run.appliedCount} price changes on ${formatDateTime(run.appliedAt)}.`
              : "This run was discarded."
        }
      >
        <Badge
          variant={
            run.status === "applied" ? "success" : previewing ? "warning" : "outline"
          }
        >
          {run.status}
        </Badge>
      </PageHeader>

      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {previewing ? (
          <>
            <form action={applyRunAction}>
              <input type="hidden" name="runId" value={run.id} />
              <Button type="submit" disabled={eligible === 0}>
                Apply {eligible} changes
              </Button>
            </form>
            {pendingFlags > 0 ? (
              <form action={approveAllFlaggedAction}>
                <input type="hidden" name="runId" value={run.id} />
                <Button type="submit" variant="outline">
                  Approve all {pendingFlags} flagged
                </Button>
              </form>
            ) : null}
            <form action={discardRunAction}>
              <input type="hidden" name="runId" value={run.id} />
              <Button type="submit" variant="ghost" className="text-destructive">
                <Trash2 />
                Discard
              </Button>
            </form>
          </>
        ) : null}
        <Button asChild variant="outline">
          <a href={`/repricing/runs/${run.id}/export`} download>
            <Download />
            Export CSV
          </a>
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">
          Sort:{" "}
          {(["pct", "flag", "name", "old", "new"] as const).map((s, i) => (
            <span key={s}>
              {i > 0 ? " · " : ""}
              <Link
                href={sortLink(s)}
                className={cn("hover:underline", sort === s && "font-semibold text-foreground")}
              >
                {s === "pct" ? "Δ%" : s}
              </Link>
            </span>
          ))}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Apply</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Basis</TableHead>
                <TableHead className="text-right">Old</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Δ%</TableHead>
                <TableHead>Rule / flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const pct = item.pctChange !== null ? Number(item.pctChange) : null;
                return (
                  <TableRow key={item.id} className={cn(item.excluded && "opacity-45")}>
                    <TableCell>
                      <ExcludeToggle
                        runId={run.id}
                        itemId={item.id}
                        excluded={item.excluded}
                        disabled={!previewing || item.newPrice === null}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/products/${item.productId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {item.productName}
                      </Link>
                      <span className="ml-1 text-xs text-muted-foreground">
                        {item.expansionName}
                        {item.productType === "sealed" ? " · sealed" : ""}
                        {item.printing === "Foil" ? " · foil" : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.condition}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatMoney(item.basisValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(item.oldPrice)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(item.newPrice)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        pct !== null && pct > 0 && "text-success",
                        pct !== null && pct < 0 && "text-destructive"
                      )}
                    >
                      {formatPct(item.pctChange)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {item.flagged && item.newPrice !== null ? (
                          <>
                            <Badge variant="warning" title={item.flagReason ?? undefined}>
                              flagged
                            </Badge>
                            <ApproveButton
                              runId={run.id}
                              itemId={item.id}
                              approved={item.approved}
                              disabled={!previewing || item.excluded}
                            />
                          </>
                        ) : item.newPrice === null ? (
                          <Badge variant="outline" title={item.flagReason ?? undefined}>
                            no data
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">{item.ruleName}</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
