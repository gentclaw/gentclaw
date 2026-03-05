import { MAX_MSG_LENGTH } from './constants.js';

/** Split string on whitespace, dropping empties. */
export function splitArgs(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** Try to parse JSON, returning undefined on failure. */
export function tryParseJson(s: string): unknown {
  try { return JSON.parse(s) as unknown; } catch { return undefined; }
}

/** Try to parse JSON as a non-null object. Returns undefined for non-object values (arrays, primitives). */
export function tryParseJsonObj(s: string): Record<string, unknown> | undefined {
  const v = tryParseJson(s);
  return (v !== null && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : undefined;
}

/**
 * Split text into chunks of maxLen characters.
 * Tries to split at newlines first, then at spaces.
 */
export function splitMessage(text: string, maxLen: number = MAX_MSG_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline within the limit
    let splitIdx = remaining.lastIndexOf('\n', maxLen);

    // If no newline, try a space
    if (splitIdx <= 0) {
      splitIdx = remaining.lastIndexOf(' ', maxLen);
    }

    // If still nothing, hard-split at maxLen
    if (splitIdx <= 0) {
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

/** Seconds elapsed since a timestamp, rounded. */
export function elapsedSec(since: number): number {
  return Math.round((Date.now() - since) / 1000);
}

/** Format milliseconds as rounded seconds string (e.g. 1500 → "2s"). */
export function formatDurationSec(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

/** CSI sequence pattern — colors, cursor movement, erase, etc. Module-level to avoid re-creation per call. */
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

/** Strip ANSI escape codes */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// ─── Reference / command parsing ──────────────────────────────────

/** Strip @-prefix, lowercase, and sanitize to safe ID chars. */
export function parseRef(raw: string): string {
  return raw.replace(/^@/, '').toLowerCase();
}

/** parseRef + strip non-alphanumeric (for new entity creation). */
export function parseSafeId(raw: string): string {
  return parseRef(raw).replace(/[^a-z0-9_-]/g, '');
}

/** Extract --force flag from args string, return cleaned args + flag state. */
export function parseForceFlag(args: string): { cleanArgs: string; force: boolean } {
  const force = /--force\b/.test(args);
  return { cleanArgs: args.replace(/--force\s*/g, '').trim(), force };
}

/** Split "subcommand rest of args" into parts. */
export function parseSubcommand(args: string): { sub: string; subArgs: string } {
  const parts = args.trim().split(/\s+/);
  const sub = (parts[0] ?? '').toLowerCase();
  const subArgs = parts.slice(1).join(' ');
  return { sub, subArgs };
}
