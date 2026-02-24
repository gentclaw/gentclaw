/** PostMessage builtin — redacts leaked secrets from agent responses before delivery. */

import type { HookAction, InboundMsg } from '../types.js';
import { redactSecrets } from '../secrets.js';

export function secretsScan(msg: InboundMsg): HookAction {
  const redacted = redactSecrets(msg.message);
  if (redacted === msg.message) return { action: 'allow' };
  return { action: 'transform', message: redacted };
}
