/** PostMessage builtin — redacts leaked secrets from agent responses before delivery. */

import type { HookAction, InboundMsg } from '../types.js';

const SECRET_PATTERNS = [
  /xoxb-[0-9A-Za-z-]+/,      // Slack bot token
  /xapp-[0-9A-Za-z-]+/,      // Slack app token
  /sk-[A-Za-z0-9]{20,}/,     // OpenAI/Anthropic API key
  /ghp_[A-Za-z0-9]{36,}/,    // GitHub personal access token
  /gho_[A-Za-z0-9]{36,}/,    // GitHub OAuth token
  /glpat-[A-Za-z0-9-]{20,}/, // GitLab personal access token
  /\b[A-Za-z0-9]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/, // Discord bot token
  /AIza[A-Za-z0-9_-]{35}/,   // Google/Gemini API key
];

const REDACTED = '[REDACTED]';

export function secretsScan(msg: InboundMsg): HookAction {
  let text = msg.message;
  let found = false;

  for (const pattern of SECRET_PATTERNS) {
    const global = new RegExp(pattern.source, 'g');
    const replaced = text.replace(global, REDACTED);
    if (replaced !== text) {
      found = true;
      text = replaced;
    }
  }

  if (!found) return { action: 'allow' };
  return { action: 'transform', message: text };
}
