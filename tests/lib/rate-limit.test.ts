import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit, resetRateLimits, getWindowCount } from '../../src/lib/builtins/rate-limit.js';
import type { InboundMsg } from '../../src/lib/types.js';

function makeMsg(sender = 'user1'): InboundMsg {
  return { sender, message: 'hi', timestamp: Date.now(), messageId: `m-${Math.random()}` };
}

describe('checkRateLimit', () => {
  beforeEach(() => resetRateLimits());

  it('allows messages under the limit', () => {
    const result = checkRateLimit(makeMsg(), { max: 3, windowSec: 60 });
    expect(result.action).toBe('allow');
  });

  it('blocks after exceeding limit', () => {
    const cfg = { max: 3, windowSec: 60 };
    checkRateLimit(makeMsg(), cfg);
    checkRateLimit(makeMsg(), cfg);
    checkRateLimit(makeMsg(), cfg);
    const result = checkRateLimit(makeMsg(), cfg);
    expect(result.action).toBe('block');
    if (result.action === 'block') {
      expect(result.reason).toContain('max 3');
    }
  });

  it('isolates per sender', () => {
    const cfg = { max: 2, windowSec: 60 };
    checkRateLimit(makeMsg('alice'), cfg);
    checkRateLimit(makeMsg('alice'), cfg);
    // alice is at limit
    expect(checkRateLimit(makeMsg('alice'), cfg).action).toBe('block');
    // bob is fine
    expect(checkRateLimit(makeMsg('bob'), cfg).action).toBe('allow');
  });

  it('uses default config when none provided', () => {
    // Default is 10/60s — should allow
    const result = checkRateLimit(makeMsg());
    expect(result.action).toBe('allow');
  });

  it('evicts stale senders when map exceeds threshold', () => {
    const cfg = { max: 5, windowSec: 1 };
    const baseTime = 1_000_000;

    // Fill 51 senders at baseTime (threshold lowered to 50)
    vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    for (let i = 0; i < 51; i++) {
      checkRateLimit(makeMsg(`stale-${i}`), cfg);
    }
    expect(getWindowCount()).toBe(51);

    // Advance past window — next check triggers eviction
    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 2000);
    checkRateLimit(makeMsg('fresh'), cfg);

    // All 51 stale senders evicted, only 'fresh' remains
    expect(getWindowCount()).toBe(1);
    vi.restoreAllMocks();
  });

  it('evicts stale senders after 5 minute interval even under threshold', () => {
    const cfg = { max: 5, windowSec: 1 };
    const baseTime = 1_000_000;

    // Add only 10 senders (well under threshold of 50)
    vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    for (let i = 0; i < 10; i++) {
      checkRateLimit(makeMsg(`user-${i}`), cfg);
    }
    expect(getWindowCount()).toBe(10);

    // Advance 6 minutes — time-based eviction should trigger
    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 6 * 60 * 1000);
    checkRateLimit(makeMsg('late-arrival'), cfg);

    // All 10 stale senders evicted, only 'late-arrival' remains
    expect(getWindowCount()).toBe(1);
    vi.restoreAllMocks();
  });
});
