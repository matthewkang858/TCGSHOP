import PgBoss from "pg-boss";
import { env } from "@/lib/env";
import { ALL_JOBS, type JobName } from "./names";

const globalForBoss = globalThis as unknown as {
  pgBoss?: PgBoss;
  pgBossStarting?: Promise<PgBoss>;
};

/**
 * Shared pg-boss instance (Postgres-backed queue - no Redis).
 * The Next.js server uses it only to SEND jobs; the worker process
 * (`pnpm worker`) registers handlers and cron schedules.
 */
export async function getBoss(): Promise<PgBoss> {
  if (globalForBoss.pgBoss) return globalForBoss.pgBoss;
  if (!globalForBoss.pgBossStarting) {
    globalForBoss.pgBossStarting = (async () => {
      const boss = new PgBoss({ connectionString: env.DATABASE_URL });
      boss.on("error", (err) => console.error("[pg-boss]", err));
      await boss.start();
      // pg-boss v10 requires queues to exist before send/work
      for (const name of ALL_JOBS) {
        await boss.createQueue(name).catch(() => {});
      }
      globalForBoss.pgBoss = boss;
      return boss;
    })();
  }
  return globalForBoss.pgBossStarting;
}

/** Enqueue a job (used by server actions for manual triggers). */
export async function enqueueJob(name: JobName, data: object = {}): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(name, data);
}
