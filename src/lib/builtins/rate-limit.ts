import type { HookAction, InboundMsg } from '../types.js';

type Window = { timestamps: number[] };
type Config = { max: number; windowSec: number };

const DEFAULT_CONFIG: Config = { max: 10, windowSec: 60 };

/** Per-sender sliding window. Key = senderId. */
const windows = new Map<string, Window>();
let lastEvictAt = 0;

/** Evict stale senders with no recent activity. Runs inline during check. */
function evictStaleSenders(cutoff: number): void {
  for (const [key, win] of windows) {
    if (win.timestamps.length === 0 || (win.timestamps.at(-1) ?? 0) <= cutoff) {
      windows.delete(key);
    }
  }
  lastEvictAt = Date.now();
}

/** Evict expired timestamps and check if sender is over limit. */
export function checkRateLimit(
  msg: InboundMsg,
  config?: Record<string, unknown>,
): HookAction {
  const max = typeof config?.max === 'number' ? config.max : DEFAULT_CONFIG.max;
  const windowSec = typeof config?.windowSec === 'number' ? config.windowSec : DEFAULT_CONFIG.windowSec;
  const now = Date.now();
  const cutoff = now - windowSec * 1000;
  const sender = msg.sender;

  // Evict stale senders: by count threshold or every 5 min
  const EVICT_INTERVAL_MS = 5 * 60 * 1_000;
  if (windows.size > 50 || (now - lastEvictAt > EVICT_INTERVAL_MS && windows.size > 0)) {
    evictStaleSenders(cutoff);
  }

  let win = windows.get(sender);
  if (!win) {
    win = { timestamps: [] };
    windows.set(sender, win);
  }

  // Evict expired
  win.timestamps = win.timestamps.filter(t => t > cutoff);

  if (win.timestamps.length >= max) {
    return { action: 'block', reason: `Rate limited: max ${max} messages per ${windowSec}s` };
  }

  win.timestamps.push(now);
  return { action: 'allow' };
}

/** Reset all windows (for testing). */
export function resetRateLimits(): void {
  windows.clear();
  lastEvictAt = 0;
}

/** @internal Test-only — number of tracked senders. */
export function getWindowCount(): number {
  return windows.size;
}
