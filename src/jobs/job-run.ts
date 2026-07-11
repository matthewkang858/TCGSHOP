import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobRuns } from "@/db/schema";

/**
 * Wrap a job handler with job_runs observability.
 * The handler receives a `stats` object to mutate; it's persisted on finish.
 */
export async function withJobRun<T>(
  name: string,
  fn: (stats: Record<string, unknown>) => Promise<T>
): Promise<T> {
  const [run] = await db.insert(jobRuns).values({ name, status: "running" }).returning();
  const stats: Record<string, unknown> = {};
  try {
    const result = await fn(stats);
    await db
      .update(jobRuns)
      .set({ status: "succeeded", stats, finishedAt: new Date() })
      .where(eq(jobRuns.id, run.id));
    return result;
  } catch (e) {
    await db
      .update(jobRuns)
      .set({
        status: "failed",
        stats,
        error: e instanceof Error ? e.message : String(e),
        finishedAt: new Date(),
      })
      .where(eq(jobRuns.id, run.id));
    throw e;
  }
}
