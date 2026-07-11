/**
 * Token-bucket rate limiter for the TCGAPIs client.
 * Capacity = requests-per-minute; refills continuously.
 * Clock + sleep are injectable so tests can run instantly.
 */
export type Clock = () => number;
export type Sleeper = (ms: number) => Promise<void>;

const realSleep: Sleeper = (ms) => new Promise((r) => setTimeout(r, ms));

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: Clock;
  private readonly sleep: Sleeper;
  /** serializes waiters so a burst can't all sleep and wake simultaneously */
  private queue: Promise<void> = Promise.resolve();

  constructor(opts: { rpm: number; now?: Clock; sleep?: Sleeper }) {
    this.capacity = Math.max(1, opts.rpm);
    this.tokens = this.capacity;
    this.refillPerMs = this.capacity / 60_000;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
    this.lastRefill = this.now();
  }

  private refill() {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = t;
    }
  }

  /** Resolves when a token is available; consumes it. FIFO-fair. */
  acquire(): Promise<void> {
    const turn = this.queue.then(async () => {
      this.refill();
      while (this.tokens < 1) {
        const deficitMs = Math.ceil((1 - this.tokens) / this.refillPerMs);
        await this.sleep(Math.max(deficitMs, 1));
        this.refill();
      }
      this.tokens -= 1;
    });
    // subsequent acquires wait behind this one, even if it's still sleeping
    this.queue = turn.catch(() => {});
    return turn;
  }

  /** current token count (test helper) */
  available(): number {
    this.refill();
    return this.tokens;
  }
}

/** Exponential backoff with full jitter, capped. */
export function backoffMs(
  attempt: number,
  opts: { baseMs?: number; maxMs?: number; random?: () => number } = {}
): number {
  const { baseMs = 500, maxMs = 30_000, random = Math.random } = opts;
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(random() * exp);
}
