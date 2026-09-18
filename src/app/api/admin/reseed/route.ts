import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { seedDemoData } from "@/db/seed";
import { runTapeAggregate } from "@/jobs/tape-aggregate";
import { env } from "@/lib/env";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Rebuild the demo store on a hosted deployment, so refreshing the demo does
 * not require a laptop with a terminal. Destructive: it deletes and recreates
 * the demo store's inventory, ledger, and price history.
 *
 * Guarded twice — only on demo deployments (DEMO_LOGIN=true) and only with
 * CRON_SECRET. Real deployments leave DEMO_LOGIN off, which disables this
 * route entirely.
 */
async function reseed(request: Request) {
  if (!env.DEMO_LOGIN) {
    return NextResponse.json({ error: "Not a demo deployment" }, { status: 404 });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const url = new URL(request.url);
  const supplied =
    url.searchParams.get("secret") ??
    request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (supplied !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  try {
    await seedDemoData();

    // Fresh transactions mean a stale tape, and the ops surface reads only
    // the tape. Failing to rebuild it should not fail the reseed, though -
    // the store-facing demo is still correct without it.
    let tape: Record<string, unknown> | { error: string };
    try {
      tape = await runTapeAggregate();
    } catch (e) {
      console.error("[reseed] tape aggregation failed:", e);
      tape = { error: e instanceof Error ? e.message : String(e) };
    }

    const [stats] = await db
      .execute<{ lines: number; value: string | null; transactions: number }>(sql`
        select
          (select count(*)::int from inventory_items) as lines,
          (select sum(coalesce(current_price, 0) * quantity) from inventory_items) as value,
          (select count(*)::int from transactions) as transactions
      `)
      .then((r) => r.rows);
    return NextResponse.json({
      ok: true,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      inventoryLines: stats?.lines ?? 0,
      inventoryValue: stats?.value ? Number(stats.value).toFixed(2) : "0.00",
      transactions: stats?.transactions ?? 0,
      tape,
    });
  } catch (e) {
    console.error("[reseed] failed:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export const GET = reseed;
export const POST = reseed;
