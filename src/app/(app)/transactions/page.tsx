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
import { DataRow, dataRowThumbClass } from "@/components/ui/data-row";
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

/** "1 × Near Mint · Foil" — condition, printing and qty are one fact, not three columns. */
function lineDetail(t: {
  quantity: number;
  condition: string | null;
  printing: string | null;
}): string {
  const detail = `${t.quantity} × ${t.condition ?? "—"}`;
  return t.printing === "Foil" ? `${detail} · Foil` : detail;
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

  const revenue7d = Number(stats?.revenue_7d ?? 0);
  const spend7d = Number(stats?.spend_7d ?? 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transactions"
        description={`${rows.length} recent ${rows.length === 1 ? "entry" : "entries"} · ${formatMoney(revenue7d)} in · ${formatMoney(spend7d)} out over 7 days`}
      />

      <RecordForm
        initialPick={prefill.initialPick}
        initialSide={prefill.side}
        initialCondition={prefill.condition}
        initialPrinting={prefill.printing}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatCard
          label="Sales today"
          value={String(stats?.sales_today ?? 0)}
          sub={formatMoney(stats?.revenue_today ?? 0)}
        />
        <StatCard
          label="Sales · 7 days"
          value={String(stats?.sales_7d ?? 0)}
          sub={formatMoney(revenue7d)}
        />
        <StatCard
          label="Buys · 7 days"
          value={String(stats?.buys_7d ?? 0)}
          sub={`${formatMoney(spend7d)} paid out`}
        />
        <StatCard
          label="Net · 7 days"
          value={formatMoney(revenue7d - spend7d)}
          sub="revenue − buylist spend"
        />
      </div>

      <Section title="Ledger" subtitle={rows.length > 0 ? String(rows.length) : undefined}>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Receipt />}
              title="No transactions yet"
              description="Record your first sale or buy above. Each entry updates inventory and builds your store's realized-price history."
            />
          </div>
        ) : (
          <>
            {/* Desktop: fixed-rhythm table. */}
            <div className="hidden md:block">
              <Table>
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[44%]" />
                  <col className="w-[20%]" />
                  <col className="w-[18%]" />
                  <col className="w-[56px]" />
                </colgroup>
                <TableHeader>
                  <TableRow className="h-9 hover:bg-transparent">
                    <TableHead>When</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Qty · condition</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => (
                    <React.Fragment key={g.label}>
                      <TableRow className="h-8 bg-surface-subtle hover:bg-surface-subtle">
                        <TableCell
                          colSpan={5}
                          className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground"
                        >
                          {g.label}
                        </TableCell>
                      </TableRow>
                      {g.rows.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="text-xs tabular-nums text-muted-foreground">
                            {formatTime(t.occurredAt)}
                          </TableCell>
                          <TableCell>
                            <div className="flex min-w-0 items-center gap-3">
                              <ProductImage
                                productId={t.productId}
                                imageUrl={t.productImageUrl}
                                name={t.productName}
                                className="h-10 w-[29px] shrink-0 rounded-[3px] border-border/70 bg-muted"
                              />
                              <div className="min-w-0">
                                <Link
                                  href={`/products/${t.productId}`}
                                  className="block truncate text-sm font-medium text-foreground hover:underline"
                                  title={t.productName}
                                >
                                  {t.productName}
                                </Link>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                  {t.expansionName}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <span className="block truncate">{lineDetail(t)}</span>
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right text-sm font-medium tabular-nums",
                              t.side === "sale" ? "text-success" : "text-destructive"
                            )}
                          >
                            {t.side === "sale" ? "+" : "−"}
                            {formatMoney(Number(t.unitPrice) * t.quantity)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                              <DeleteTransactionButton
                                id={t.id}
                                label={`${t.quantity} × ${formatMoney(t.unitPrice)} ${t.productName}`}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Phone: the shared 64px list row, never a sideways table. */}
            <div className="md:hidden">
              {groups.map((g) => (
                <React.Fragment key={g.label}>
                  <div className="flex h-8 items-center border-b border-border/60 bg-surface-subtle px-4 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                    {g.label}
                  </div>
                  {g.rows.map((t) => (
                    <DataRow
                      key={t.id}
                      href={`/products/${t.productId}`}
                      image={
                        <ProductImage
                          productId={t.productId}
                          imageUrl={t.productImageUrl}
                          name={t.productName}
                          className={dataRowThumbClass}
                        />
                      }
                      title={t.productName}
                      meta={`${formatTime(t.occurredAt)} · ${t.expansionName} · ${lineDetail(t)}`}
                      value={
                        <span
                          className={
                            t.side === "sale" ? "text-success" : "text-destructive"
                          }
                        >
                          {t.side === "sale" ? "+" : "−"}
                          {formatMoney(Number(t.unitPrice) * t.quantity)}
                        </span>
                      }
                      actions={
                        <DeleteTransactionButton
                          id={t.id}
                          label={`${t.quantity} × ${formatMoney(t.unitPrice)} ${t.productName}`}
                        />
                      }
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
