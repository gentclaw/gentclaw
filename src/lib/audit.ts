/** Append-only JSONL audit trail — logs commands and security-relevant actions */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PATHS } from './paths.js';

export type AuditStatus = 'allowed' | 'denied' | 'blocked';

export type AuditEvent = {
  ts: number;
  action: string;
  sender: string;
  detail: string;
  status: AuditStatus;
  reason?: string;
};

/** Append audit event to JSONL (mode 0o600). Best-effort, never throws. */
export function auditLog(event: Omit<AuditEvent, 'ts'>): void {
  try {
    const dir = dirname(PATHS.audit);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });

    const full: AuditEvent = { ts: Date.now(), ...event };
    appendFileSync(PATHS.audit, JSON.stringify(full) + '\n', { mode: 0o600 });
  } catch {
    // Best-effort — never break command execution
  }
}
