import { globalSingleton } from "./singleton";

// In-memory token buckets keyed by caller (IP, user, token). Good for one web process; the
// first consumer is the upload route, later the public campaign and appointment entry points.
// A multi-instance deployment swaps the store for Postgres or Redis behind the same call.

export interface RateLimitOptions {
  /** Bucket size: how many requests may burst. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

export interface RateLimitDecision {
  ok: boolean;
  remaining: number;
  /** Milliseconds until one token is available again (0 when ok). */
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    readonly name: string,
    readonly options: RateLimitOptions,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  take(key: string, cost = 1): RateLimitDecision {
    const now = this.clock();
    const { capacity, refillPerSecond } = this.options;
    const bucket = this.buckets.get(key) ?? { tokens: capacity, updatedAt: now };
    const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSecond);
    bucket.updatedAt = now;
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.buckets.set(key, bucket);
      return { ok: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }
    this.buckets.set(key, bucket);
    const deficit = cost - bucket.tokens;
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: refillPerSecond > 0 ? Math.ceil((deficit / refillPerSecond) * 1000) : -1,
    };
  }

  /** Drops buckets idle for longer than `idleMs` (call from a sweep, or rely on the cap). */
  prune(idleMs: number): number {
    const cutoff = this.clock() - idleMs;
    let n = 0;
    for (const [key, b] of this.buckets) {
      if (b.updatedAt < cutoff) {
        this.buckets.delete(key);
        n++;
      }
    }
    return n;
  }

  get size(): number {
    return this.buckets.size;
  }

  reset(): void {
    this.buckets.clear();
  }
}

const limiters = globalSingleton("rate-limiters", () => new Map<string, RateLimiter>());

/** A named, process-wide limiter (created on first use with the given options). */
export function rateLimiter(name: string, options: RateLimitOptions): RateLimiter {
  let l = limiters.get(name);
  if (!l) {
    l = new RateLimiter(name, options);
    limiters.set(name, l);
  }
  // one sweep per 1000 buckets keeps memory bounded without a timer
  if (l.size > 1000) l.prune(10 * 60_000);
  return l;
}

/** The client address as seen behind the compose/prod proxy. */
export function clientKey(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : (headers.get("x-real-ip") ?? "unknown");
  return `ip:${ip}`;
}
