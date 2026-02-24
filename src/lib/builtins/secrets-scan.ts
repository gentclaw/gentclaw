/** PostMessage builtin — redacts leaked secrets from agent responses before delivery. */

import type { HookAction, InboundMsg } from '../types.js';

/** Pre-compiled with global flag — avoids re-creating RegExp on every scan call */
const SECRET_PATTERNS = [
  /xoxb-[0-9A-Za-z-]+/g,      // Slack bot token
  /xapp-[0-9A-Za-z-]+/g,      // Slack app token
  /sk-[A-Za-z0-9]{20,}/g,     // OpenAI/Anthropic API key
  /ghp_[A-Za-z0-9]{36,}/g,    // GitHub personal access token
  /gho_[A-Za-z0-9]{36,}/g,    // GitHub OAuth token
  /glpat-[A-Za-z0-9-]{20,}/g, // GitLab personal access token
  /\b[A-Za-z0-9]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g, // Discord bot token
  /AIza[A-Za-z0-9_-]{35}/g,   // Google/Gemini API key
];

const REDACTED = '[REDACTED]';

export function secretsScan(msg: InboundMsg): HookAction {
  let text = msg.message;
  let found = false;

  for (const pat of SECRET_PATTERNS) {
    pat.lastIndex = 0;
    const replaced = text.replace(pat, REDACTED);
    if (replaced !== text) {
      found = true;
      text = replaced;
    }
  }

  if (!found) return { action: 'allow' };
  return { action: 'transform', message: text };
}
