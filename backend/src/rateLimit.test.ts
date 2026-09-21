import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rateLimit.ts';

describe('RateLimiter', () => {
  it('allows up to the limit per window, then resets', () => {
    let now = 0;
    const limiter = new RateLimiter(3, 100, () => now);
    expect([limiter.allow('a'), limiter.allow('a'), limiter.allow('a'), limiter.allow('a')]).toEqual([true, true, true, false]);
    expect(limiter.allow('b')).toBe(true);
    now = 100;
    expect(limiter.allow('a')).toBe(true);
  });

  it('sweeps expired buckets', () => {
    let now = 0;
    const limiter = new RateLimiter(1, 10, () => now);
    limiter.allow('a');
    limiter.allow('b');
    expect(limiter.size).toBe(2);
    now = 10;
    limiter.sweep();
    expect(limiter.size).toBe(0);
  });
});
