import { MAX_MSG_LENGTH } from './constants.js';

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

/** Strip ANSI escape codes (CSI sequences: colors, cursor movement, erase, etc.) */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}
