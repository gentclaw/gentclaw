import type { HookAction, InboundMsg } from '../types.js';

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?prior\s+instructions/i,
  /you\s+are\s+now\s+/i,
  /system\s*:\s*override/i,
  /act\s+as\s+if\s+/i,
  /new\s+system\s+prompt/i,
  /disregard\s+(all\s+)?instructions/i,
];

/** Wrap suspicious content rather than blocking — agents decide how to handle it. */
export function checkContentGuard(msg: InboundMsg): HookAction {
  const suspicious = INJECTION_PATTERNS.some(pat => pat.test(msg.message));
  if (!suspicious) return { action: 'allow' };

  return {
    action: 'transform',
    message: `<<<UNTRUSTED_USER_INPUT>>>\n${msg.message}\n<<<END_UNTRUSTED_USER_INPUT>>>`,
  };
}
