/** Append-only JSONL audit trail — logs commands and security-relevant actions */

import { PATHS } from './paths.js';
import { appendJsonlWithTs } from './fs-utils.js';

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
  appendJsonlWithTs(PATHS.audit, event);
}
