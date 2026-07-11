import Link from "next/link";
import { desc, eq, isNull, and, count } from "drizzle-orm";
import { Bell, CheckCheck } from "lucide-react";
import { db } from "@/db";
import { alertEvents, alerts, expansions, products } from "@/db/schema";
import { requireStore } from "@/lib/tenancy";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatDateTime } from "@/lib/utils";
import { AlertForm } from "./alert-form";
import { deleteAlertAction, markEventsReadAction, toggleAlertAction } from "./actions";

const TYPE_LABEL: Record<string, string> = {
  threshold_cross: "Price threshold",
  pct_change: "% move",
  velocity: "Sales velocity",
  buylist_arb: "Buylist arb",
  restock_velocity: "Restock",
};

function configSummary(type: string, config: Record<string, unknown>): string {
  switch (type) {
    case "threshold_cross":
      return `crosses ${config.direction} $${config.threshold}`;
    case "pct_change":
      return `|Δ| ≥ ${config.pct}% over ${config.window} (${config.scope})`;
    case "velocity":
      return `≥ ${config.min_sales_24h} sales/24h${config.product_id ? "" : " (watchlist)"}`;
    case "buylist_arb":
      return `buylist ≥ ${config.spread_pct}% of market`;
    case "restock_velocity":
      return `stock ≤ ${config.max_quantity} & market ≥ ${config.min_market_sales_24h}/24h`;
    default:
      return "";
  }
}

export default async function AlertsPage() {
  const ctx = await requireStore();

  const storeAlerts = await db
    .select()
    .from(alerts)
    .where(eq(alerts.storeId, ctx.storeId))
    .orderBy(desc(alerts.createdAt));

  const events = await db
    .select({
      id: alertEvents.id,
      firedAt: alertEvents.firedAt,
      payload: alertEvents.payload,
      delivered: alertEvents.delivered,
      readAt: alertEvents.readAt,
      alertName: alerts.name,
      alertType: alerts.type,
      productId: products.productId,
      productName: products.name,
      setName: expansions.name,
    })
    .from(alertEvents)
    .innerJoin(alerts, eq(alerts.id, alertEvents.alertId))
    .innerJoin(products, eq(products.productId, alertEvents.productId))
    .innerJoin(expansions, eq(expansions.groupId, products.groupId))
    .where(eq(alerts.storeId, ctx.storeId))
    .orderBy(desc(alertEvents.firedAt))
    .limit(100);

  const [{ value: unread }] = await db
    .select({ value: count() })
    .from(alertEvents)
    .innerJoin(alerts, eq(alerts.id, alertEvents.alertId))
    .where(and(eq(alerts.storeId, ctx.storeId), isNull(alertEvents.readAt)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        description="Watchlist and inventory triggers evaluated after every price sweep. Delivered in-app, by email, and to Discord."
      >
        {unread > 0 ? (
          <form action={markEventsReadAction}>
            <Button variant="outline" type="submit">
              <CheckCheck />
              Mark {unread} read
            </Button>
          </form>
        ) : null}
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <AlertForm />

          <Card>
            <CardHeader>
              <CardTitle>Your alerts ({storeAlerts.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {storeAlerts.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No alerts yet — create one above. Try a 7-day 20% move on your whole
                  inventory, or a restock signal on a booster box.
                </p>
              ) : (
                storeAlerts.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{a.name}</span>
                        <Badge variant="secondary">{TYPE_LABEL[a.type]}</Badge>
                        {!a.active ? <Badge variant="outline">paused</Badge> : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {configSummary(a.type, a.config as Record<string, unknown>)} · cooldown{" "}
                        {a.cooldownHours}h
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <form action={toggleAlertAction}>
                        <input type="hidden" name="alertId" value={a.id} />
                        <input type="hidden" name="active" value={a.active ? "false" : "true"} />
                        <Button variant="ghost" size="sm" type="submit" className="text-xs">
                          {a.active ? "pause" : "resume"}
                        </Button>
                      </form>
                      <form action={deleteAlertAction}>
                        <input type="hidden" name="alertId" value={a.id} />
                        <Button
                          variant="ghost"
                          size="sm"
                          type="submit"
                          className="text-xs text-destructive"
                        >
                          delete
                        </Button>
                      </form>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Event feed</CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <EmptyState
                icon={<Bell className="h-8 w-8" />}
                title="No alerts have fired yet"
                description="Events appear here after price sweeps detect movement matching your alerts. Run the worker (pnpm worker) so hourly/nightly sweeps happen."
              />
            ) : (
              <div className="max-h-[42rem] space-y-2 overflow-y-auto">
                {events.map((e) => {
                  const p = e.payload as Record<string, unknown>;
                  return (
                    <div
                      key={e.id}
                      className={cn(
                        "rounded-md border px-3 py-2",
                        !e.readAt && "border-primary/40 bg-primary/5"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {e.alertName}
                          <Badge variant="secondary" className="ml-2">
                            {TYPE_LABEL[e.alertType]}
                          </Badge>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDateTime(e.firedAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">
                        <Link
                          href={`/products/${e.productId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {e.productName}
                        </Link>{" "}
                        <span className="text-muted-foreground">· {e.setName}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {"pct_change" in p ? `Δ ${p.pct_change}% over ${p.window} · ` : ""}
                        {"market" in p && p.market != null ? `market $${p.market}` : ""}
                        {"buylist" in p && p.buylist != null
                          ? ` · buylist $${p.buylist} (${p.spread_pct}%)`
                          : ""}
                        {"sales_24h" in p ? ` · ${p.sales_24h} sales/24h` : ""}
                        {"quantity" in p ? ` · ${p.quantity} left in stock` : ""}
                        {e.delivered?.discord
                          ? e.delivered.discord.ok
                            ? " · discord ✓"
                            : " · discord ✗"
                          : ""}
                        {e.delivered?.email ? (e.delivered.email.ok ? " · email ✓" : " · email ✗") : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
