import { getBoss } from "./boss";
import { JOB } from "./names";
import { runCatalogSync } from "./catalog-sync";

/**
 * Register all job handlers + cron schedules on the worker process.
 * Schedules:
 *  - catalog-sync:          weekly (Mon 03:00) + manual per game from the UI
 *  - price-sweep-watchlist: hourly
 *  - price-sweep-inventory: nightly (02:00)
 *  - alert-eval:            enqueued by sweeps after each run
 */
export async function registerJobs() {
  const boss = await getBoss();

  await boss.work(JOB.CATALOG_SYNC, async ([job]) => {
    console.log(`[worker] ${JOB.CATALOG_SYNC}`, job.data);
    await runCatalogSync(job.data);
  });

  await boss.schedule(JOB.CATALOG_SYNC, "0 3 * * 1", {}, {});

  console.log("[worker] job handlers registered");
}
