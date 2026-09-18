import { desc, eq, isNull, and, count } from "drizzle-orm";
import {
  ArrowLeftRight,
  Bell,
  CheckCheck,
  DollarSign,
  Flame,
  PackagePlus,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { db } from "@/db";
import { alertEvents, alerts, expansions, products } from "@/db/schema";
import { requireStore } from "@/lib/tenancy";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { DataRow, type RowTone } from "@/components/ui/data-row";
import { Section } from "@/components/ui/section";
import { formatDateTime, formatMoney, formatPct } from "@/lib/utils";
import { AlertForm } from "./alert-form";
import { AlertRowActions } from "./alert-row-actions";
import { markEventsReadAction } from "./actions";

const TYPE_LABEL: Record<string, string> = {
  threshold_cross: "Price threshold",
  pct_change: "% move",
  velocity: "Sales velocity",
  buylist_arb: "Buylist arb",
  restock_velocity: "Restock",
};

const TYPE_ICON: Record<string, LucideIcon> = {
  threshold_cross: DollarSign,
  pct_change: TrendingUp,
  velocity: Flame,
  buylist_arb: ArrowLeftRight,
  restock_velocity: PackagePlus,
};

/** Alert type is carried by this icon in the row's leading rail — not a badge. */
function TypeIcon({ type }: { type: string }) {
  const Icon = TYPE_ICON[type] ?? Bell;
  return <Icon className="size-4 text-muted-foreground" aria-hidden />;
}

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

const FEED_LIMIT = 50;

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
    .limit(FEED_LIMIT);

  const [{ value: unread }] = await db
    .select({ value: count() })
    .from(alertEvents)
    .innerJoin(alerts, eq(alerts.id, alertEvents.alertId))
    .where(and(eq(alerts.storeId, ctx.storeId), isNull(alertEvents.readAt)));

  const activeCount = storeAlerts.filter((a) => a.active).length;
  const facts = [
    `${storeAlerts.length} rule${storeAlerts.length === 1 ? "" : "s"}`,
    activeCount < storeAlerts.length ? `${activeCount} active` : null,
    `${unread.toLocaleString()} unread`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <PageHeader title="Alerts" description={facts}>
        {unread > 0 ? (
          <form action={markEventsReadAction}>
            <Button variant="outline" type="submit">
              <CheckCheck />
              Mark {unread} read
            </Button>
          </form>
        ) : null}
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <AlertForm />

          <Section
            title="Your alerts"
            subtitle={storeAlerts.length ? String(storeAlerts.length) : undefined}
          >
            {storeAlerts.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No alerts yet. Try a 7-day 20% move across your inventory, or a restock signal
                on a booster box.
              </p>
            ) : (
              storeAlerts.map((a) => (
                <DataRow
                  key={a.id}
                  image={<TypeIcon type={a.type} />}
                  title={
                    a.active ? (
                      a.name
                    ) : (
                      <span className="text-muted-foreground">{a.name}</span>
                    )
                  }
                  meta={[
                    a.active ? null : "Paused",
                    TYPE_LABEL[a.type],
                    configSummary(a.type, a.config as Record<string, unknown>),
                    `cooldown ${a.cooldownHours}h`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  actions={
                    <AlertRowActions alertId={a.id} alertName={a.name} active={a.active} />
                  }
                />
              ))
            )}
          </Section>
        </div>

        <Section
          title="Event feed"
          subtitle={events.length ? `last ${events.length}` : undefined}
        >
          {events.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<Bell />}
                title="No alerts have fired yet"
                description="Events appear here once a price sweep detects movement matching your alerts. Run the worker so the hourly and nightly sweeps happen."
              />
            </div>
          ) : (
            events.map((e) => {
              const p = e.payload as Record<string, unknown>;
              const market = p.market != null ? Number(p.market) : null;
              const pct = p.pct_change != null ? Number(p.pct_change) : null;

              let valueMeta: string | null = null;
              let tone: RowTone = "neutral";
              if (pct != null) {
                valueMeta = `${formatPct(pct)} ${String(p.window ?? "")}`.trim();
                tone = pct >= 0 ? "positive" : "negative";
              } else if (p.sales_24h != null) {
                valueMeta = `${p.sales_24h} sold/24h`;
              } else if (p.spread_pct != null) {
                valueMeta = `${p.spread_pct}% spread`;
              }

              const failed =
                e.delivered?.discord?.ok === false || e.delivered?.email?.ok === false;

              return (
                <DataRow
                  key={e.id}
                  href={`/products/${e.productId}`}
                  image={<TypeIcon type={e.alertType} />}
                  title={
                    e.readAt ? (
                      <span className="text-muted-foreground">{e.alertName}</span>
                    ) : (
                      e.alertName
                    )
                  }
                  meta={[
                    e.productName,
                    e.setName,
                    p.quantity != null ? `${p.quantity} left in stock` : null,
                    formatDateTime(e.firedAt),
                    failed ? "delivery failed" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  value={
                    market != null ? (
                      formatMoney(market)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )
                  }
                  valueMeta={valueMeta ?? undefined}
                  tone={tone}
                />
              );
            })
          )}
        </Section>
      </div>
    </div>
  );
}
