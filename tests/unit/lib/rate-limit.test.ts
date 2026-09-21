import { describe, expect, it } from "vitest";
import { clientKey, RateLimiter, rateLimiter } from "@/lib/rate-limit";

describe("RateLimiter", () => {
  it("allows a burst up to the capacity, then refuses with a retry hint, then refills", () => {
    let now = 0;
    const l = new RateLimiter("t", { capacity: 3, refillPerSecond: 1 }, () => now);
    expect(l.take("a").ok).toBe(true);
    expect(l.take("a").ok).toBe(true);
    expect(l.take("a")).toMatchObject({ ok: true, remaining: 0 });
    const refused = l.take("a");
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterMs).toBe(1000);
    // an unrelated key has its own bucket
    expect(l.take("b").ok).toBe(true);
    now = 2500; // 2.5 tokens back
    expect(l.take("a", 2).ok).toBe(true);
    expect(l.take("a").ok).toBe(false);
    now = 100_000; // never above capacity
    expect(l.take("a", 4).ok).toBe(false);
    expect(l.take("a", 3).ok).toBe(true);
  });

  it("prunes idle buckets and shares named limiters process-wide", () => {
    let now = 0;
    const l = new RateLimiter("t", { capacity: 1, refillPerSecond: 1 }, () => now);
    l.take("a");
    now = 5_000;
    l.take("b");
    expect(l.prune(1_000)).toBe(1);
    expect(l.size).toBe(1);
    const shared = rateLimiter("unit-test", { capacity: 2, refillPerSecond: 0 });
    expect(rateLimiter("unit-test", { capacity: 99, refillPerSecond: 0 })).toBe(shared);
    shared.take("x");
    shared.take("x");
    expect(shared.take("x")).toMatchObject({ ok: false, retryAfterMs: -1 });
    shared.reset();
    expect(shared.take("x").ok).toBe(true);
  });

  it("derives the client key from the forwarded address", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "10.0.0.9, 10.0.0.1" }))).toBe("ip:10.0.0.9");
    expect(clientKey(new Headers({ "x-real-ip": "10.0.0.7" }))).toBe("ip:10.0.0.7");
    expect(clientKey(new Headers())).toBe("ip:unknown");
  });
});
