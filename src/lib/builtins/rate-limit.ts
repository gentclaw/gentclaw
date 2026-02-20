import type { HookAction, InboundMsg } from '../types.js';

type Window = { timestamps: number[] };
type Config = { max: number; windowSec: number };

const DEFAULT_CONFIG: Config = { max: 10, windowSec: 60 };

/** Per-sender sliding window. Key = senderId. */
const windows = new Map<string, Window>();

/** Evict expired timestamps and check if sender is over limit. */
export function checkRateLimit(
  msg: InboundMsg,
  config?: Partial<Config>,
): HookAction {
  const { max, windowSec } = { ...DEFAULT_CONFIG, ...config };
  const now = Date.now();
  const cutoff = now - windowSec * 1000;
  const sender = msg.sender;

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
}
