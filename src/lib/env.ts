import { z } from "zod";

/**
 * Server-side env access, validated once with zod.
 * NEVER import this from a client component - secrets stay server-side.
 */
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgres://countertop:countertop@localhost:5432/countertop"),
  AUTH_SECRET: z.string().default("dev-only-insecure-secret"),
  APP_URL: z.string().default("http://localhost:3000"),

  // TCGAPIs - optional; unset key => offline fixture mode
  TCGAPIS_API_KEY: z.string().optional(),
  TCGAPIS_TIER: z.enum(["hobby", "business", "unlimited"]).default("hobby"),
  TCGAPIS_RPM: z.coerce.number().int().positive().default(300),

  // Email - optional; unset => console fallback
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Countertop <notifications@localhost>"),

  // Billing stub (P1)
  BILLING_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

function normalize(value: string | undefined) {
  // treat empty strings in .env as unset
  return value === "" ? undefined : value;
}

export const env = envSchema.parse(
  Object.fromEntries(
    Object.entries(process.env).map(([k, v]) => [k, normalize(v)])
  )
);

export type TcgApisTier = typeof env.TCGAPIS_TIER;

/** true when no TCGAPIs key is configured - client serves bundled fixtures */
export const OFFLINE_MODE = !env.TCGAPIS_API_KEY;
