import { describe, expect, it, vi } from "vitest";
import { BULK_TRENDPRICE_MAX, TcgApisClient, TierError, type FetchLike } from "./client";
import { backoffMs, TokenBucket } from "./rate-limiter";

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("TokenBucket", () => {
  it("allows a burst up to capacity without sleeping", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const bucket = new TokenBucket({
      rpm: 5,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    for (let i = 0; i < 5; i++) await bucket.acquire();
    expect(sleeps).toEqual([]);
  });

  it("sleeps once the bucket is drained and refills over time", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const bucket = new TokenBucket({
      rpm: 60, // 1 token/sec
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms; // advancing the clock refills the bucket
      },
    });
    for (let i = 0; i < 60; i++) await bucket.acquire();
    expect(sleeps).toEqual([]);
    await bucket.acquire(); // 61st in the same instant must wait ~1s
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1000);
  });

  it("refills to capacity but never beyond", async () => {
    let now = 0;
    const bucket = new TokenBucket({ rpm: 10, now: () => now, sleep: async () => {} });
    await bucket.acquire();
    now += 600_000; // ten minutes
    expect(bucket.available()).toBe(10);
  });
});

describe("backoffMs", () => {
  it("grows exponentially and respects the cap", () => {
    const r = () => 1; // no jitter
    expect(backoffMs(0, { baseMs: 500, random: r })).toBe(500);
    expect(backoffMs(1, { baseMs: 500, random: r })).toBe(1000);
    expect(backoffMs(3, { baseMs: 500, random: r })).toBe(4000);
    expect(backoffMs(10, { baseMs: 500, maxMs: 30_000, random: r })).toBe(30_000);
  });

  it("applies full jitter", () => {
    expect(backoffMs(2, { baseMs: 500, random: () => 0.5 })).toBe(1000);
    expect(backoffMs(2, { baseMs: 500, random: () => 0 })).toBe(0);
  });
});

describe("TcgApisClient retry behavior", () => {
  function makeClient(fetchFn: FetchLike, opts: Partial<ConstructorParameters<typeof TcgApisClient>[0]> = {}) {
    return new TcgApisClient({
      apiKey: "test-key",
      tier: "business",
      rpm: 100_000, // never rate-limit inside tests
      fetchFn,
      sleep: async () => {},
      random: () => 0.5,
      ...opts,
    });
  }

  it("retries 429s with backoff and eventually succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchFn: FetchLike = async () => {
      calls++;
      if (calls <= 3) return jsonResponse(429, { success: false, error: "Rate limit exceeded" });
      return jsonResponse(200, { success: true, data: [{ categoryId: 3, name: "Pokemon" }] });
    };
    const client = new TcgApisClient({
      apiKey: "k",
      rpm: 100_000,
      fetchFn,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 1,
    });
    const games = await client.listGames();
    expect(calls).toBe(4);
    expect(games).toHaveLength(1);
    // exponential: 500, 1000, 2000 with random=1
    expect(sleeps).toEqual([500, 1000, 2000]);
  });

  it("gives up after maxRetries and surfaces the status", async () => {
    const fetchFn: FetchLike = async () => jsonResponse(429, { success: false, error: "Rate limit exceeded" });
    const client = makeClient(fetchFn, { maxRetries: 2 });
    await expect(client.listGames()).rejects.toThrow(/HTTP 429/);
  });

  it("retries 5xx errors", async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      if (calls === 1) return jsonResponse(500, {});
      return jsonResponse(200, { success: true, data: [] });
    };
    const client = makeClient(fetchFn);
    await client.listGames();
    expect(calls).toBe(2);
  });

  it("does NOT retry 4xx API errors and surfaces the message", async () => {
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls++;
      return jsonResponse(401, { success: false, error: "API key is required" });
    };
    const client = makeClient(fetchFn);
    await expect(client.listGames()).rejects.toThrow("API key is required");
    expect(calls).toBe(1);
  });

  it("sends the API key in the x-api-key header and never in the URL", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const fetchFn: FetchLike = async (url, init) => {
      seenUrl = url;
      seenHeaders = init?.headers ?? {};
      return jsonResponse(200, { success: true, data: [] });
    };
    const client = makeClient(fetchFn);
    await client.listGames();
    expect(seenHeaders["x-api-key"]).toBe("test-key");
    expect(seenUrl).not.toContain("test-key");
  });

  it("chunks bulk trendprice calls at 200 ids", async () => {
    const bodies: number[][] = [];
    const fetchFn: FetchLike = async (_url, init) => {
      const parsed = JSON.parse(init?.body ?? "{}");
      bodies.push(parsed.productIds);
      return jsonResponse(200, { success: true, data: [] });
    };
    const client = makeClient(fetchFn);
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    await client.bulkTrendPrices(ids, { provider: "tcgplayer", listing: "retail" });
    expect(bodies.map((b) => b.length)).toEqual([200, 200, 50]);
    expect(bodies.flat()).toEqual(ids);
    expect(BULK_TRENDPRICE_MAX).toBe(200);
  });

  it("paginates list endpoints until total is reached", async () => {
    const pageSize = 100;
    const total = 250;
    const fetchFn: FetchLike = async (url) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      const count = Math.min(pageSize, total - offset);
      const data = Array.from({ length: count }, (_, i) => ({
        groupId: offset + i + 1,
        name: `Set ${offset + i + 1}`,
      }));
      return jsonResponse(200, { success: true, count, total, offset, limit: pageSize, data });
    };
    const client = makeClient(fetchFn);
    const expansions = await client.listExpansions(3);
    expect(expansions).toHaveLength(250);
    expect(expansions[249].groupId).toBe(250);
  });

  it("gates tier-locked features", async () => {
    const fetchFn: FetchLike = async () => jsonResponse(200, { success: true, data: [] });
    const hobby = makeClient(fetchFn, { tier: "hobby" });
    await expect(hobby.getProductPrices(1)).rejects.toThrow(TierError);
    await expect(hobby.bulkTrendPrices([1], { provider: "tcgplayer", listing: "retail" })).rejects.toThrow(
      TierError
    );
    const business = makeClient(fetchFn, { tier: "business" });
    await expect(business.getSkuPrices(1)).rejects.toThrow(TierError);
    expect(business.supports("trendprices")).toBe(true);
    expect(business.supports("skuprices")).toBe(false);
  });

  it("serves fixtures offline without touching fetch", async () => {
    const fetchFn = vi.fn<FetchLike>();
    const client = new TcgApisClient({ tier: "business", fetchFn, sleep: async () => {} });
    expect(client.offline).toBe(true);
    const games = await client.listGames();
    expect(games.length).toBeGreaterThan(0);
    const expansions = await client.listExpansions(3);
    expect(expansions).toHaveLength(1);
    const products = await client.listProducts(expansions[0].groupId);
    expect(products.length).toBeGreaterThan(100);
    const trends = await client.bulkTrendPrices(
      products.slice(0, 5).map((p) => p.productId),
      { provider: "tcgplayer", listing: "retail" }
    );
    expect(trends).toHaveLength(5);
    expect(trends.every((t) => (t.price ?? 0) > 0)).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fixture prices are deterministic per (product, provider, listing, date)", async () => {
    const client = new TcgApisClient({ tier: "business" });
    const [a] = await client.bulkTrendPrices([42304], { provider: "tcgplayer", listing: "retail" });
    const [b] = await client.bulkTrendPrices([42304], { provider: "tcgplayer", listing: "retail" });
    expect(a.price).toBe(b.price);
    const [buy] = await client.bulkTrendPrices([42304], { provider: "cardkingdom", listing: "buylist" });
    expect(buy.price).not.toBe(a.price);
  });
});
