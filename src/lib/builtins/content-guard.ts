import type { HookAction, InboundMsg } from '../types.js';

/** Single combined regex — one engine invocation instead of 7 separate .test() calls.
 *  Named groups enable per-pattern audit logging if needed later. */
const INJECTION_RE = /(?<ignorePrev>ignore\s+(all\s+)?(previous|prior)\s+instructions)|(?<youAreNow>you\s+are\s+now\s+)|(?<sysOverride>system\s*:\s*override)|(?<actAsIf>act\s+as\s+if\s+)|(?<newSysPrompt>new\s+system\s+prompt)|(?<disregard>disregard\s+(all\s+)?instructions)/i;

/** Wrap suspicious content rather than blocking — agents decide how to handle it. */
export function checkContentGuard(msg: InboundMsg): HookAction {
  const suspicious = INJECTION_RE.test(msg.message);
  if (!suspicious) return { action: 'allow' };

  return {
    action: 'transform',
    message: `<<<UNTRUSTED_USER_INPUT>>>\n${msg.message}\n<<<END_UNTRUSTED_USER_INPUT>>>`,
  };
}
