// Background worker entrypoint: `pnpm worker`
// Runs pg-boss handlers + cron schedules against the same Postgres as the app.
import { registerJobs } from "./jobs";

async function main() {
  console.log("[worker] starting Countertop worker…");
  await registerJobs();
  console.log("[worker] ready. Waiting for jobs (ctrl-c to stop).");
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
