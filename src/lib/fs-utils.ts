import { writeFileSync, mkdirSync, renameSync } from 'node:fs';
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

/** Ensure all required directories exist. */
export function ensureDirectories(): void {
  for (const dir of ALL_DIRS) {
    mkdirSync(dir, { recursive: true });
  }
}
