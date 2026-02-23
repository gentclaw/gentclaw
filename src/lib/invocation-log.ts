/** Append-only JSONL invocation log — tracks every agent run for cost/debug visibility */

import { PATHS } from './paths.js';
import { appendJsonl } from './fs-utils.js';
import type { TokenUsage } from './types.js';

export type InvocationRecord = {
  ts: number;
  agentId: string;
  provider: string;
  model: string;
  durationMs: number;
  success: boolean;
  tokens?: TokenUsage;
  errorType?: string;
  channel?: string;
  sender?: string;
};

/** Append invocation record to JSONL (mode 0o600). Best-effort, never throws. */
export function logInvocation(record: Omit<InvocationRecord, 'ts'>): void {
  appendJsonl(PATHS.invocations, { ts: Date.now(), ...record });
}
