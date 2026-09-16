import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Receipt, Trash2 } from "lucide-react";
import { db } from "@/db";
import { expansions, products, transactions } from "@/db/schema";
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
import { cn, formatDateTime, formatMoney } from "@/lib/utils";
import { RecordForm } from "./record-form";
import { deleteTransactionAction } from "./actions";

export default async function TransactionsPage() {
  const ctx = await requireStore();

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
      expansionName: expansions.name,
    })
    .from(transactions)
    .innerJoin(products, eq(products.productId, transactions.productId))
    .innerJoin(expansions, eq(expansions.groupId, products.groupId))
    .where(eq(transactions.storeId, ctx.storeId))
    .orderBy(desc(transactions.occurredAt))
    .limit(100);

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

      <RecordForm />

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
                  <TableHead></TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Each</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(t.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.side === "sale" ? "success" : "secondary"}>
                        {t.side === "sale" ? "sold" : "bought"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/products/${t.productId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {t.productName}
                      </Link>
                      <span className="ml-1 text-xs text-muted-foreground">
                        {t.expansionName}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.condition}
                      {t.printing === "Foil" ? " · foil" : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
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
                      <form action={deleteTransactionAction}>
                        <input type="hidden" name="transactionId" value={t.id} />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          type="submit"
                          title="Delete entry (does not restore stock)"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </form>
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
