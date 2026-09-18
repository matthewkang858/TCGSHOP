import { NextResponse } from "next/server";
import { runInventorySweep } from "@/jobs/price-sweep";
import { runTapeAggregate } from "@/jobs/tape-aggregate";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Serverless daily sweep for hosted deployments with no worker process
 * (Vercel Cron hits this per vercel.json). Runs the inventory-wide price
 * sweep and alert evaluation in-process, so the hosted demo's snapshots,
 * sticker queue, and alert feed stay fresh without pg-boss.
 *
 * Secured with CRON_SECRET when set (Vercel sends it as a Bearer token).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const started = Date.now();
  try {
    await runInventorySweep({ inlineAlertEval: true });
    // The tape measures itself against the references the sweep just
    // refreshed, so it runs second and in the same invocation - hosted
    // deployments get one cron slot, not two.
    const tape = await runTapeAggregate();
    return NextResponse.json({ ok: true, ms: Date.now() - started, tape });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
