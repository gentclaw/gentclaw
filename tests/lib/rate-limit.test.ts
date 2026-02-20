import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, resetRateLimits } from '../../src/lib/builtins/rate-limit.js';
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
});
