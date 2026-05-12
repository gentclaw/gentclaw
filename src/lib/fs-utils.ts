import { readFileSync, writeFileSync, mkdirSync, renameSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ALL_DIRS } from './paths.js';
import { log } from './log.js';

const L = log('fs-utils');

/** Atomically write text to a file using tmp+rename. Ensures parent directory exists.
 *  Writes with mode 0o600 — settings/sessions/memory may contain Slack tokens or other secrets;
 *  default umask (0o022 → 0o644) would leave them world-readable on shared systems. */
export function atomicWriteText(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = join(dirname(filePath), `.tmp-${randomBytes(6).toString('hex')}`);
  writeFileSync(tmp, content, { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, filePath);
}

/** Atomically write JSON to a file using tmp+rename. */
export function atomicWriteJson(filePath: string, data: unknown): void {
  atomicWriteText(filePath, JSON.stringify(data, null, 2) + '\n');
}

/** Append a JSON record as a JSONL line (mode 0o600). Best-effort, never throws. */
function appendJsonl(filePath: string, record: unknown): void {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(filePath, JSON.stringify(record) + '\n', { mode: 0o600 });
  } catch (err) {
    L.warn('appendJsonl failed', { filePath, error: (err as Error).message });
  }
}

/** Append a timestamped JSON record as a JSONL line (mode 0o600). Best-effort, never throws. */
export function appendJsonlWithTs(filePath: string, record: Record<string, unknown>): void {
  appendJsonl(filePath, { ts: Date.now(), ...record });
}

/** Read + parse JSON file with a type guard. Returns null on ENOENT or guard failure. Throws on other errors. */
export function readJsonSafe<T>(filePath: string, guard: (v: unknown) => v is T): T | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  return guard(parsed) ? parsed : null;
}

/** Ensure all required directories exist. */
export function ensureDirectories(): void {
  for (const dir of ALL_DIRS) {
    mkdirSync(dir, { recursive: true });
  }
}
