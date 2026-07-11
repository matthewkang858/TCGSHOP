import { env } from "@/lib/env";

/**
 * P1 billing stub - ships behind BILLING_ENABLED=false.
 *
 * When enabled, Stripe checkout/portal wiring goes here (STRIPE_SECRET_KEY,
 * STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER/PRO). Until then every store
 * runs as an unlimited free preview and no Stripe code paths execute.
 */

export type PlanTier = "starter" | "pro";

export const PLANS: Record<PlanTier, { name: string; priceUsd: number; limits: { inventoryLines: number; alertRules: number } }> = {
  starter: {
    name: "Starter",
    priceUsd: 29,
    limits: { inventoryLines: 5_000, alertRules: 10 },
  },
  pro: {
    name: "Pro",
    priceUsd: 79,
    limits: { inventoryLines: 100_000, alertRules: 100 },
  },
};

export function billingEnabled(): boolean {
  return env.BILLING_ENABLED;
}

/** Effective limits for a store. Free preview = Pro limits while billing is off. */
export function planLimits(tier: PlanTier | undefined) {
  if (!billingEnabled()) return PLANS.pro.limits;
  return PLANS[tier ?? "starter"].limits;
}
