/** Shared secret-detection patterns — single source of truth for log.ts and secrets-scan.ts */

/** Source patterns used to build per-call regexes. Non-global — no shared lastIndex state. */
export const SECRET_PATTERNS: readonly string[] = [
  'xoxb-[0-9A-Za-z-]+',                                           // Slack bot token
  'xapp-[0-9A-Za-z-]+',                                           // Slack app token
  'sk-[A-Za-z0-9]{20,}',                                          // OpenAI/Anthropic API key
  'ghp_[A-Za-z0-9]{36,}',                                         // GitHub personal access token
  'gho_[A-Za-z0-9]{36,}',                                         // GitHub OAuth token
  'glpat-[A-Za-z0-9-]{20,}',                                      // GitLab personal access token
  '\\b[A-Za-z0-9]{24}\\.[A-Za-z0-9_-]{6}\\.[A-Za-z0-9_-]{27,}\\b', // Discord bot token
  'AIza[A-Za-z0-9_-]{35}',                                        // Google/Gemini API key
];

/**
 * Pre-compiled combined regex — safe as module-level /g because String.prototype.replace()
 * always starts matching from index 0 regardless of lastIndex state.
 */
const COMBINED_RE = new RegExp(SECRET_PATTERNS.join('|'), 'g');

const REDACTED = '[REDACTED]';

/** Replace all secret patterns in a string. */
export function redactSecrets(text: string): string {
  return text.replace(COMBINED_RE, REDACTED);
}
