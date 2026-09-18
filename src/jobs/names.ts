export const JOB = {
  CATALOG_SYNC: "catalog-sync",
  PRICE_SWEEP_WATCHLIST: "price-sweep-watchlist",
  PRICE_SWEEP_INVENTORY: "price-sweep-inventory",
  ALERT_EVAL: "alert-eval",
  TAPE_AGGREGATE: "tape-aggregate",
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

export const ALL_JOBS: JobName[] = Object.values(JOB);
