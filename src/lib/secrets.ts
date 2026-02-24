/** Shared secret-detection patterns — single source of truth for log.ts and secrets-scan.ts */

export const SECRET_PATTERNS: RegExp[] = [
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

/** Replace all secret patterns in a string. Resets lastIndex for global regexes. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pat of SECRET_PATTERNS) {
    pat.lastIndex = 0;
    out = out.replace(pat, REDACTED);
  }
  return out;
}
