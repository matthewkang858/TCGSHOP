// The ONLY module that talks to TCGAPIs. Pages never import this - all calls
// happen inside background jobs. Offline mode (no API key) serves bundled
// fixtures so the whole app runs without network access.
import { backoffMs, TokenBucket, type Sleeper } from "./rate-limiter";
import type {
  ApiExpansion,
  ApiGame,
  ApiProduct,
  ApiProductPrices,
  ApiSalesBucket,
  ApiSalesHistory,
  ApiSkuPrice,
  ApiTrendPrice,
  CatalogRow,
  ListEnvelope,
  TrendListing,
  TrendProvider,
} from "./types";
import {
  FIXTURE_EXPANSIONS,
  FIXTURE_GAMES,
  FIXTURE_PRODUCTS,
  fixtureFullSalesHistory,
  fixtureSalesHistory,
  fixtureTrendPrice,
} from "./fixtures";

export type Tier = "hobby" | "business" | "unlimited";

const TIER_RANK: Record<Tier, number> = { hobby: 0, business: 1, unlimited: 2 };

export class TcgApisError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "TcgApisError";
  }
}

export class TierError extends TcgApisError {
  constructor(feature: string, required: Tier, actual: Tier) {
    super(`Feature "${feature}" requires the ${required} plan (current: ${actual})`);
    this.name = "TierError";
  }
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export type TcgApisClientOptions = {
  apiKey?: string;
  tier?: Tier;
  rpm?: number;
  baseUrl?: string;
  fetchFn?: FetchLike;
  sleep?: Sleeper;
  maxRetries?: number;
  random?: () => number;
};

const MAX_PAGE_LIMIT = 100;
export const BULK_TRENDPRICE_MAX = 200;

export class TcgApisClient {
  readonly tier: Tier;
  readonly offline: boolean;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly bucket: TokenBucket;
  private readonly fetchFn: FetchLike;
  private readonly sleep: Sleeper;
  private readonly maxRetries: number;
  private readonly random: () => number;

  constructor(opts: TcgApisClientOptions = {}) {
    this.apiKey = opts.apiKey || undefined;
    this.offline = !this.apiKey;
    this.tier = opts.tier ?? "hobby";
    this.baseUrl = (opts.baseUrl ?? "https://api.tcgapis.com").replace(/\/$/, "");
    this.bucket = new TokenBucket({ rpm: opts.rpm ?? 300, sleep: opts.sleep });
    this.fetchFn = opts.fetchFn ?? (fetch as unknown as FetchLike);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 5;
    this.random = opts.random ?? Math.random;
  }

  supports(feature: "prices" | "sales" | "trendprices" | "skuprices" | "livelistings"): boolean {
    if (this.offline) return true; // fixtures cost nothing - full demo offline
    const required: Tier =
      feature === "skuprices" || feature === "livelistings" ? "unlimited" : "business";
    return TIER_RANK[this.tier] >= TIER_RANK[required];
  }

  private assertTier(feature: string, required: Tier) {
    if (this.offline) return; // fixture mode is never tier-gated
    if (TIER_RANK[this.tier] < TIER_RANK[required]) {
      throw new TierError(feature, required, this.tier);
    }
  }

  /** Core request with rate limiting + 429/5xx retry (exp backoff + jitter). */
  private async request<T>(
    path: string,
    init?: { method?: string; body?: unknown }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    for (let attempt = 0; ; attempt++) {
      await this.bucket.acquire();
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await this.fetchFn(url, {
          method: init?.method ?? "GET",
          headers: {
            "x-api-key": this.apiKey ?? "",
            ...(init?.body ? { "content-type": "application/json" } : {}),
          },
          body: init?.body ? JSON.stringify(init.body) : undefined,
        });
      } catch (e) {
        // network error - retryable
        if (attempt >= this.maxRetries) {
          throw new TcgApisError(
            `Network error after ${attempt + 1} attempts: ${e instanceof Error ? e.message : e}`
          );
        }
        await this.sleep(backoffMs(attempt, { random: this.random }));
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt >= this.maxRetries) {
          throw new TcgApisError(`HTTP ${res.status} after ${attempt + 1} attempts`, res.status);
        }
        await this.sleep(backoffMs(attempt, { random: this.random }));
        continue;
      }

      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;
      if (!res.ok || json === null) {
        throw new TcgApisError(json?.error ?? `HTTP ${res.status}`, res.status);
      }
      if (json.success === false) {
        throw new TcgApisError(json.error ?? "Unknown API error", res.status);
      }
      return json as T;
    }
  }

  /** Fetch every page of a list endpoint. */
  private async fetchAll<T>(pathWithoutPaging: string): Promise<T[]> {
    const sep = pathWithoutPaging.includes("?") ? "&" : "?";
    const out: T[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.request<ListEnvelope<T>>(
        `${pathWithoutPaging}${sep}limit=${MAX_PAGE_LIMIT}&offset=${offset}`
      );
      out.push(...(page.data ?? []));
      offset += page.data?.length ?? 0;
      if (!page.data?.length || offset >= (page.total ?? out.length)) break;
    }
    return out;
  }

  // --- catalog ---------------------------------------------------------

  async listGames(): Promise<ApiGame[]> {
    if (this.offline) return FIXTURE_GAMES;
    const res = await this.request<{ data?: ApiGame[] } & Partial<ListEnvelope<ApiGame>>>(
      "/api/v2/games"
    );
    return res.data ?? [];
  }

  async listExpansions(categoryId: number): Promise<ApiExpansion[]> {
    if (this.offline) {
      return FIXTURE_EXPANSIONS.filter((e) => e.categoryId === categoryId);
    }
    return this.fetchAll<ApiExpansion>(`/api/v2/expansions/${categoryId}`);
  }

  /** Products in an expansion. Sealed rows lack number/rarity. */
  async listProducts(groupId: number, opts: { search?: string } = {}): Promise<ApiProduct[]> {
    if (this.offline) {
      let rows = FIXTURE_PRODUCTS.filter((p) => p.groupId === groupId);
      if (opts.search) {
        const q = opts.search.toLowerCase();
        rows = rows.filter((p) => p.name.toLowerCase().includes(q));
      }
      return rows;
    }
    const search = opts.search ? `?search=${encodeURIComponent(opts.search)}` : "";
    return this.fetchAll<ApiProduct>(`/api/v2/cards/${groupId}${search}`);
  }

  /**
   * Full catalog rows for a game, used by catalog-sync.
   * Live: paginates v2 expansions + products. (The /csv bulk endpoint is
   * faster for very large games but its column set is undocumented; we keep
   * to the well-specified v2 endpoints and chunk politely instead.)
   */
  async *catalogRows(game: { categoryId: number; name: string }): AsyncGenerator<CatalogRow> {
    const expansions = await this.listExpansions(game.categoryId);
    for (const exp of expansions) {
      const products = await this.listProducts(exp.groupId);
      for (const p of products) {
        yield {
          categoryId: game.categoryId,
          groupId: exp.groupId,
          expansionName: exp.name,
          expansionAbbreviation: exp.abbreviation ?? null,
          expansionPublishedOn: exp.publishedOn ?? null,
          productId: p.productId,
          name: p.name,
          cleanName: p.cleanName || p.name,
          number: p.number ?? null,
          rarity: p.rarity ?? null,
          imageUrl: p.imageUrl ?? p.image ?? null,
        };
      }
    }
  }

  // --- prices ------------------------------------------------------------

  async getProductPrices(productId: number): Promise<ApiProductPrices> {
    this.assertTier("prices", "business");
    if (this.offline) {
      const t = fixtureTrendPrice(productId, "tcgplayer", "retail");
      return {
        productId,
        prices: [
          {
            subTypeName: "Normal",
            marketPrice: t.price,
            lowPrice: t.price === null ? null : Math.round(t.price * 0.9 * 100) / 100,
          },
        ],
      };
    }
    const res = await this.request<{ data: ApiProductPrices }>(`/api/v2/prices/${productId}`);
    return res.data;
  }

  async getSkuPrices(productId: number): Promise<ApiSkuPrice[]> {
    this.assertTier("skuprices", "unlimited");
    if (this.offline) return [];
    const res = await this.request<{ data: ApiSkuPrice[] }>(
      `/api/v1/skuprices/product/${productId}`
    );
    return res.data ?? [];
  }

  /**
   * Bulk trend prices - the workhorse for sweeps. Enforces the 200-id-per-call
   * API limit; callers pass any number of ids and we chunk.
   */
  async bulkTrendPrices(
    productIds: number[],
    opts: { provider: TrendProvider; listing: TrendListing }
  ): Promise<ApiTrendPrice[]> {
    this.assertTier("trendprices", "business");
    if (this.offline) {
      return productIds.map((id) => fixtureTrendPrice(id, opts.provider, opts.listing));
    }
    const out: ApiTrendPrice[] = [];
    for (let i = 0; i < productIds.length; i += BULK_TRENDPRICE_MAX) {
      const chunk = productIds.slice(i, i + BULK_TRENDPRICE_MAX);
      const res = await this.request<{ data: ApiTrendPrice[] }>("/api/v2/trendprices/bulk", {
        method: "POST",
        body: { productIds: chunk, provider: opts.provider, listing: opts.listing },
      });
      out.push(...(res.data ?? []));
    }
    return out;
  }

  // --- sales ---------------------------------------------------------------

  /** v1 recent sales + stats. Upstream cache is 4h - callers must not refetch sooner. */
  async getSalesHistory(productId: number): Promise<ApiSalesHistory> {
    this.assertTier("sales", "business");
    if (this.offline) return fixtureSalesHistory(productId);
    const res = await this.request<{ data?: ApiSalesHistory } & Partial<ApiSalesHistory>>(
      `/api/v1/sales-history/${productId}`
    );
    return (res.data ?? res) as ApiSalesHistory;
  }

  async getFullSalesHistory(
    productId: number,
    filters: {
      condition?: string;
      variant?: string;
      language?: string;
      from?: string;
      to?: string;
      salesOnly?: boolean;
    } = {}
  ): Promise<ApiSalesBucket[]> {
    this.assertTier("sales", "business");
    if (this.offline) return fixtureFullSalesHistory(productId);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.size ? `?${params}` : "";
    const res = await this.request<{ data: ApiSalesBucket[] }>(
      `/api/v2/sales-history/${productId}/full${qs}`
    );
    return res.data ?? [];
  }
}

// --- singleton for jobs ------------------------------------------------

let clientSingleton: TcgApisClient | null = null;

/** Server-side singleton configured from env. Import ONLY from jobs/server code. */
export async function getTcgApisClient(): Promise<TcgApisClient> {
  if (!clientSingleton) {
    // dynamic import keeps env parsing out of unit tests that construct clients directly
    const { env } = await import("@/lib/env");
    clientSingleton = new TcgApisClient({
      apiKey: env.TCGAPIS_API_KEY,
      tier: env.TCGAPIS_TIER,
      rpm: env.TCGAPIS_RPM,
    });
  }
  return clientSingleton;
}
