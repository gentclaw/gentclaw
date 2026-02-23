/** Append-only JSONL invocation log — tracks every agent run for cost/debug visibility */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PATHS } from './paths.js';
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
  try {
    const dir = dirname(PATHS.invocations);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

    const full: InvocationRecord = { ts: Date.now(), ...record };
    appendFileSync(PATHS.invocations, JSON.stringify(full) + '\n', { mode: 0o600 });
  } catch {
    // Best-effort — never break invocation flow
  }
}
