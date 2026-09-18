import * as React from "react";
import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Receipt } from "lucide-react";
import { z } from "zod";
import { db } from "@/db";
import { expansions, products, transactions } from "@/db/schema";
import { requireStore } from "@/lib/tenancy";
import { EmptyState, PageHeader } from "@/components/page-header";
import { ProductImage } from "@/components/product-image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PickedProduct } from "@/components/product-picker";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { RecordForm } from "./record-form";
import { DeleteTransactionButton } from "./delete-button";

// Quick-sell prefill params (cross-team contract): garbage values are ignored,
// the form just renders empty.
const prefillSchema = z.object({
  productId: z.coerce.number().int().positive().optional().catch(undefined),
  side: z.enum(["sale", "purchase"]).optional().catch(undefined),
  condition: z.string().trim().min(1).max(40).optional().catch(undefined),
  printing: z.enum(["", "Normal", "Foil"]).optional().catch(undefined),
});

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function resolvePrefill(sp: Record<string, string | string[] | undefined>): Promise<{
  initialPick: PickedProduct | null;
  side?: "sale" | "purchase";
  condition?: string;
  printing?: "" | "Normal" | "Foil";
}> {
  const parsed = prefillSchema.parse({
    productId: firstParam(sp.productId),
    side: firstParam(sp.side),
    condition: firstParam(sp.condition),
    printing: firstParam(sp.printing),
  });
  let initialPick: PickedProduct | null = null;
  if (parsed.productId != null) {
    const [p] = await db
      .select({
        productId: products.productId,
        name: products.name,
        productType: products.productType,
        productTypeOverride: products.productTypeOverride,
        expansionName: expansions.name,
      })
      .from(products)
      .innerJoin(expansions, eq(expansions.groupId, products.groupId))
      .where(eq(products.productId, parsed.productId))
      .limit(1);
    if (p) {
      initialPick = {
        id: p.productId,
        label: `${p.name} · ${p.expansionName}`,
        productType: p.productTypeOverride ?? p.productType,
      };
    }
  }
  return {
    initialPick,
    side: parsed.side,
    condition: parsed.condition,
    printing: parsed.printing,
  };
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function dayLabel(d: Date, now: Date): string {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return formatDate(d);
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireStore();
  const prefill = await resolvePrefill(await searchParams);

  const [stats] = await db.execute<{
    sales_7d: string;
    revenue_7d: string | null;
    buys_7d: string;
    spend_7d: string | null;
    sales_today: string;
    revenue_today: string | null;
  }>(sql`
    select
      count(*) filter (where side = 'sale' and occurred_at >= now() - interval '7 days')::int sales_7d,
      sum(unit_price * quantity) filter (where side = 'sale' and occurred_at >= now() - interval '7 days') revenue_7d,
      count(*) filter (where side = 'purchase' and occurred_at >= now() - interval '7 days')::int buys_7d,
      sum(unit_price * quantity) filter (where side = 'purchase' and occurred_at >= now() - interval '7 days') spend_7d,
      count(*) filter (where side = 'sale' and occurred_at >= now()::date)::int sales_today,
      sum(unit_price * quantity) filter (where side = 'sale' and occurred_at >= now()::date) revenue_today
    from transactions where store_id = ${ctx.storeId}
  `).then((r) => r.rows);

  const rows = await db
    .select({
      id: transactions.id,
      side: transactions.side,
      condition: transactions.condition,
      printing: transactions.printing,
      quantity: transactions.quantity,
      unitPrice: transactions.unitPrice,
      occurredAt: transactions.occurredAt,
      source: transactions.source,
      productId: products.productId,
      productName: products.name,
      productImageUrl: products.imageUrl,
      expansionName: expansions.name,
    })
    .from(transactions)
    .innerJoin(products, eq(products.productId, transactions.productId))
    .innerJoin(expansions, eq(expansions.groupId, products.groupId))
    .where(eq(transactions.storeId, ctx.storeId))
    .orderBy(desc(transactions.occurredAt))
    .limit(100);

  // rows are already newest-first, so contiguous day runs form the groups
  const now = new Date();
  const groups: { label: string; rows: typeof rows }[] = [];
  for (const t of rows) {
    const label = dayLabel(t.occurredAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(t);
    else groups.push({ label, rows: [t] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description="Every counter sale and buy, recorded in seconds. This ledger is the realized-price data the whole platform builds on."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Sales today" value={String(stats?.sales_today ?? 0)} sub={formatMoney(stats?.revenue_today ?? 0)} />
        <StatCard label="Sales · 7 days" value={String(stats?.sales_7d ?? 0)} sub={formatMoney(stats?.revenue_7d ?? 0)} />
        <StatCard label="Buys · 7 days" value={String(stats?.buys_7d ?? 0)} sub={`${formatMoney(stats?.spend_7d ?? 0)} paid out`} />
        <StatCard
          label="Net · 7 days"
          value={formatMoney(Number(stats?.revenue_7d ?? 0) - Number(stats?.spend_7d ?? 0))}
          sub="revenue − buylist spend"
        />
      </div>

      <RecordForm
        initialPick={prefill.initialPick}
        initialSide={prefill.side}
        initialCondition={prefill.condition}
        initialPrinting={prefill.printing}
      />

      <Card>
        <CardHeader>
          <CardTitle>Ledger</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Receipt className="h-8 w-8" />}
                title="No transactions yet"
                description="Record your first sale or buy above. Each entry updates inventory and builds your store's realized-price history."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden md:table-cell">Condition</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Qty</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Each</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <React.Fragment key={g.label}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell
                        colSpan={7}
                        className="py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                      >
                        {g.label}
                      </TableCell>
                    </TableRow>
                    {g.rows.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatTime(t.occurredAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-3">
                            <ProductImage
                              productId={t.productId}
                              imageUrl={t.productImageUrl}
                              name={t.productName}
                              className="h-14 w-10 shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Link
                                  href={`/products/${t.productId}`}
                                  className="truncate font-medium text-primary hover:underline"
                                >
                                  {t.productName}
                                </Link>
                                <Badge
                                  variant={t.side === "sale" ? "success" : "secondary"}
                                  className="hidden shrink-0 sm:inline-flex"
                                >
                                  {t.side === "sale" ? "sold" : "bought"}
                                </Badge>
                              </div>
                              <p className="truncate text-xs text-muted-foreground">
                                {t.expansionName}
                                <span className="sm:hidden">
                                  {" · "}
                                  {t.quantity} × {formatMoney(t.unitPrice)} · {t.condition}
                                  {t.printing === "Foil" ? " · foil" : ""}
                                </span>
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {t.condition}
                          {t.printing === "Foil" ? " · foil" : ""}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          {t.quantity}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          {formatMoney(t.unitPrice)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-medium tabular-nums",
                            t.side === "sale" ? "text-success" : ""
                          )}
                        >
                          {t.side === "sale" ? "+" : "−"}
                          {formatMoney(Number(t.unitPrice) * t.quantity)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DeleteTransactionButton
                            id={t.id}
                            label={`${t.quantity} × ${formatMoney(t.unitPrice)} ${t.productName}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}
