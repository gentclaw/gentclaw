import { writeFileSync, mkdirSync, renameSync, appendFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ALL_DIRS } from './paths.js';

/**
 * Atomically write JSON to a file using tmp+rename.
 * Guarantees readers never see a partial write.
 */
export function atomicWriteJson(filePath: string, data: unknown): void {
  const tmp = join(dirname(filePath), `.tmp-${randomBytes(6).toString('hex')}`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, filePath);
}

/** Append a JSON record as a JSONL line (mode 0o600). Best-effort, never throws. */
export function appendJsonl(filePath: string, record: unknown): void {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(filePath, JSON.stringify(record) + '\n', { mode: 0o600 });
  } catch {
    // Best-effort — never break caller flow
  }
}

/** Ensure all required directories exist. */
export function ensureDirectories(): void {
  for (const dir of ALL_DIRS) {
    mkdirSync(dir, { recursive: true });
  }
}
