interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  allow(key: string): boolean {
    const t = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      this.buckets.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    if (bucket.count >= this.limit) return false;
    bucket.count += 1;
    return true;
  }

  sweep(): void {
    const t = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= t) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}
