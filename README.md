# Countertop

Repricing + price alerts SaaS for local game stores. Import your TCG inventory
(singles **and** sealed product), define repricing rules against live market
data, preview and apply new prices, export back to your marketplace, and get
alerts when products move — instead of spending hours a week hand-checking
TCGplayer.

## Quick start

```bash
git clone <repo> && cd countertop
docker compose up -d db
cp .env.example .env          # optional - sane defaults are baked in
pnpm i
pnpm db:migrate
pnpm seed
pnpm dev                      # web app  -> http://localhost:3000
pnpm worker                   # background jobs, in a second terminal
```

Sign in as `demo@countertop.local` — with no `RESEND_API_KEY` configured the
magic link is printed to the `pnpm dev` console. The seed creates a demo store
with 50 inventory lines (singles across conditions + 8 sealed items with cost
basis), two reprice rules, three alerts, and 30 days of price history, so the
dashboard, charts, and alert feed work immediately **without any API key**.

The demoable full loop: `/inventory/import` (upload a TCGplayer export CSV) →
`/repricing` (select rules → *Preview reprice run*) → review/approve flagged
rows → *Apply* → *Export CSV* → alert events on `/alerts` — for both a single
(Base Set Charizard) and a sealed item (Base Set Booster Box).

`pnpm test` runs the unit suite (pricing engine, sealed classifier, CSV
matching, alert evaluation, rate limiter / 429 retry).

## Environment

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | no | defaults to the docker-compose Postgres |
| `AUTH_SECRET` | prod | Auth.js signing secret (`openssl rand -base64 32`) |
| `APP_URL` | no | used in magic links + alert links |
| `TCGAPIS_API_KEY` | no | **unset = offline fixture mode** (bundled demo catalog + deterministic prices) |
| `TCGAPIS_TIER` | no | `hobby` \| `business` \| `unlimited` — gates tier-dependent features |
| `TCGAPIS_RPM` | no | client rate-limit budget (default 300 = Hobby plan) |
| `RESEND_API_KEY` | no | unset = magic links + alert emails log to console |
| `BILLING_ENABLED` | no | P1 Stripe stub, keep `false` |

### Pointing at a real key / tier

Set `TCGAPIS_API_KEY`, set `TCGAPIS_TIER` to your plan, and match
`TCGAPIS_RPM` to your plan's limit (Hobby 300 / Business 1,000 / Unlimited
2,000). Then run a catalog sync from `/products` (worker must be running).
Tier gating degrades gracefully:

- **Hobby**: catalog browsing/import only — sweeps and repricing bases that
  need price data are skipped with a note in `job_runs`.
- **Business**: everything except SKU-level condition pricing and live
  listings. This is the intended tier.
- **Unlimited**: adds SKU-exact condition prices (engine then skips condition
  multipliers for those items) and live listings (not used by the MVP).

## Architecture

- **Next.js 15 (App Router) + TypeScript**, Tailwind v4 + shadcn-style
  components, recharts, zod on every server action / route / CSV row.
- **Postgres + Drizzle**; **pg-boss** for background jobs (no Redis).
- **Auth.js** email magic links (console fallback), database sessions.
- **Tenancy**: a store is the tenant; users join via `memberships`. Every
  query is store-scoped through `requireStore()` / `assertMembership()` in
  `src/lib/tenancy.ts`; mutating actions verify membership against the DB, the
  active-store cookie is only a selector.
- **The app never calls TCGAPIs in a page request path.** All external calls
  flow through the single typed client `src/lib/tcgapis/client.ts` (token
  bucket at `TCGAPIS_RPM`, 429/5xx retry with exponential backoff + jitter,
  200-id bulk chunking) and run inside jobs. Pages read only local Postgres
  (`price_snapshots`, `sales_stats`, catalog cache).
- **Offline dev mode**: with no API key the client serves bundled fixtures —
  220 products (Pokemon Base Set + MTG Murders at Karlov Manor, including 18
  sealed SKUs) and deterministic drifting price/sales generators, so the whole
  app runs and demos with zero network. Fixture product IDs are synthetic.

### Background jobs (pg-boss, `pnpm worker`)

| Job | Schedule | What it does |
|---|---|---|
| `catalog-sync` | weekly (Mon 03:00) + manual per game | upsert games/expansions/products, sealed classifier at ingest |
| `price-sweep-watchlist` | hourly | trendprices bulk (200/call) for alert + watchlist products → `price_snapshots` |
| `price-sweep-inventory` | nightly 02:00 | same over all inventory; refreshes `sales_stats` for items ≥ $5 (respects the 4h upstream sales cache) |
| `alert-eval` | after each sweep | evaluates the 5 alert types over affected products, cooldown-deduped |

All jobs are idempotent + chunked, log to `job_runs`, and back off on 429s.
Snapshots are change-detected: a new row is written only when the price moved
or the last row is >20h old, keeping history compact.

### Repricing engine (`src/lib/repricing/engine.ts`)

Pure functions, heavily unit-tested. Pipeline:
`basis × multiplier + offset` → clamp(floor, ceiling) → condition multiplier
(product-level basis, non-NM **singles** only — sealed always skips; SKU-level
bases skip) → rounding (`psychological` .49/.99-up, `quarter`, `dollar`,
`cents`) → guards **after** rounding so rounding can never defeat them
(`min_price`, then `cost_basis × (1 + min_margin_pct)`) → `max_change_pct`
flagging (flagged rows require manual approval in the preview, never
auto-apply).

Rule scopes AND their fields (product type, games, sets, rarity, basis price
band, tags, condition, printing); arrays OR within a field; tags match ANY
listed tag. Rules are selected first-match by ascending `priority` (lower
number wins). Runs resolve bases from local snapshots, sweeping stale products
first (default 24h threshold, per-store setting, capped at 1,000 products
inline so a huge inventory can't stall the request).

### Import matching (`src/lib/import/matcher.ts`)

Exact `TCGplayer Id` → else bigram-Dice fuzzy on normalized names with
collector-number (+set-name) signals. Sealed rows (no number + sealed
keywords) match only sealed candidates; near-misses go to the ambiguous queue
for a human pick — never guessed. Unmatched rows are downloadable. Commits are
idempotent per (store, product, condition, printing, language) via a
`UNIQUE NULLS NOT DISTINCT` key, so re-imports update rather than duplicate.

### Alerts

`threshold_cross` (true cross detection using the previous snapshot),
`pct_change` (24h/7d/30d vs closest snapshot at/before the cutoff, scoped to
watchlist or whole inventory), `velocity` (24h sale count), `buylist_arb`
(CK buylist ≥ X% of TCG market), `restock_velocity` (stock ≤ N while market
sold ≥ M/24h — built for the sealed wall). Delivery: in-app feed always,
Discord webhook embed and email to store owners per store settings; results
recorded in `alert_events.delivered`. Dedupe per (alert, product) via
`cooldown_hours`.

## Decisions made (and why)

- **Sealed classifier**: `sealed` ⇔ no collector number AND no rarity AND the
  name matches sealed keywords (booster box/pack/display/case/bundle, ETB,
  collection, collector booster, blister, tin, precon, commander/starter/theme
  deck, fat pack, build & battle, premium collection, plus prerelease pack,
  starter set, and draft/set/play booster). Manual override column
  (`product_type_override`) wins everywhere. Products with neither
  number/rarity nor keywords are `other` (code cards, art series).
- **Sealed coverage (fixture mode)**: verified empirically at ingest — the
  fixture catalog's 18 sealed products (boxes, packs, displays, ETB-style
  bundles, precon decks, theme decks) flow through the same product/price/
  sales endpoints as singles, as the TCGAPIs docs describe. **On the first
  live sync, re-verify per game** and record findings here: check
  `job_runs.stats.sealed` after `catalog-sync` — if a game reports 0 sealed,
  its sealed products may live in separate "Sealed Products" expansion groups
  (common for Yu-Gi-Oh) and still classify correctly once synced.
- **tcg_low basis**: bulk trendprices doesn't carry lowest-listing data, so
  runs using `tcg_low` fetch `GET /v2/prices/:productId` per product (capped
  at 200/run) into `tcgplayer_low` snapshots. Prefer `tcg_market` for large
  inventories.
- **Freshness sweep in the run action**: creating a reprice run sweeps stale
  products inline (capped) rather than queueing, so previews are never built
  on silently stale data. It's a mutation, not a page render — pages still
  never touch the API.
- **Offline mode ignores tier gates** — fixtures cost nothing and the spec
  wants the full demo keyless.
- **Import size**: parsed rows round-trip through server actions
  (`bodySizeLimit: 8mb`, 20k row cap). Bigger stores should split exports;
  moving to staged uploads is a straightforward follow-up.
- **Catalog seeding** uses the well-specified v2 endpoints (paginated,
  rate-limited) rather than the `/csv` bulk download whose column set is
  undocumented; for the two-set demo this is instant, and for live syncs the
  weekly cadence absorbs the extra calls.
- **P1 stubs**: Stripe billing lives behind `BILLING_ENABLED=false`
  (`src/lib/billing.ts` + Settings panel). `cardmarket_trend` exists as a rule
  basis (labeled P1) and resolves from `cardmarket` snapshots when a future EU
  sweep populates them. Card recognition intake and Cardtrader views are
  documented non-goals for this MVP cut.

## Repo map

```
src/
  app/(app)/          dashboard, inventory(+import), products, repricing, alerts, settings
  auth.ts             Auth.js config (magic links)
  db/schema.ts        full Drizzle schema · db/seed.ts demo seed
  jobs/               pg-boss worker: catalog-sync, price sweeps, alert-eval, job_runs
  lib/tcgapis/        THE client (rate limiter, retries, tiers) + fixtures
  lib/repricing/      pure engine + run service + CSV exporter
  lib/import/         column mapping, fuzzy matcher, commit service
  lib/alerts/         pure evaluators
  lib/tenancy.ts      store scoping helpers
```

## Security notes

- The API key lives only in env, is sent only via the `x-api-key` header, and
  is never logged or bundled client-side (`src/lib/env.ts` is server-only).
- Zod validates every server action, route param, and CSV row.
- Tenant isolation: all store data access goes through the store context; run
  items, exports, and toggles re-verify the row's store before mutating.
