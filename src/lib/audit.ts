/** Append-only JSONL audit trail — logs commands and security-relevant actions */

import { PATHS } from './paths.js';
import { appendJsonlWithTs } from './fs-utils.js';
import { redactSecrets } from './secrets.js';

export type AuditStatus = 'allowed' | 'denied' | 'blocked';

export type AuditEvent = {
  ts: number;
  action: string;
  sender: string;
  detail: string;
  status: AuditStatus;
  reason?: string;
};

/** Cap free-form audit strings — `/bash`, `/agent add`, blockReason can carry arbitrary user input.
 *  Without a bound a single pasted megabyte fills audit.jsonl forever. */
const MAX_AUDIT_FIELD = 1000;

/** Redact known secret patterns and cap length. Defends against API keys / tokens
 *  landing verbatim in audit.jsonl from `/bash echo sk-...`, denied commands, or hook block reasons. */
function safe(value: string): string {
  const redacted = redactSecrets(value);
  return redacted.length > MAX_AUDIT_FIELD ? redacted.slice(0, MAX_AUDIT_FIELD) + '…' : redacted;
}

/** Append audit event to JSONL (mode 0o600). Best-effort, never throws.
 *  `detail` and `reason` are redacted + truncated — they're the only fields with user-controlled content. */
export function auditLog(event: Omit<AuditEvent, 'ts'>): void {
  appendJsonlWithTs(PATHS.audit, {
    ...event,
    detail: safe(event.detail),
    ...(event.reason !== undefined ? { reason: safe(event.reason) } : {}),
  });
}
