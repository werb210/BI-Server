// BI_SERVER_v789_ATTEMPT_COUNTER - small in-memory fixed-window counter keyed by
// an arbitrary string (an email, a phone, an IP). Process-local: a restart or a
// second instance starts from zero, which is acceptable for these abuse
// ceilings (each instance still enforces its own window).

export type AttemptCounter = {
  /** Count one attempt for `key`. allowed=false once `max` attempts are already in the window. */
  hit(key: string, now?: number): { allowed: boolean; retryAfterMs: number; count: number };
  reset(key?: string): void;
  size(): number;
};

export function createAttemptCounter(opts: { max: number; windowMs: number; maxKeys?: number }): AttemptCounter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const maxKeys = opts.maxKeys ?? 50_000;

  function prune(now: number) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    // Still too many live keys: drop the oldest insertions.
    while (buckets.size > maxKeys) {
      const first = buckets.keys().next().value;
      if (first === undefined) break;
      buckets.delete(first);
    }
  }

  return {
    hit(key, now = Date.now()) {
      let b = buckets.get(key);
      if (!b || b.resetAt <= now) {
        if (buckets.size >= maxKeys) prune(now);
        b = { count: 0, resetAt: now + opts.windowMs };
        buckets.set(key, b);
      }
      if (b.count >= opts.max) return { allowed: false, retryAfterMs: b.resetAt - now, count: b.count };
      b.count += 1;
      return { allowed: true, retryAfterMs: 0, count: b.count };
    },
    reset(key) {
      if (key === undefined) buckets.clear();
      else buckets.delete(key);
    },
    size() {
      return buckets.size;
    },
  };
}
