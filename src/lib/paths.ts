import { resolve } from 'node:path';
import { homedir } from 'node:os';

/** Repo root — two levels up from dist/lib/ (or src/lib/ in dev). Shared by commands.ts, service.ts, reload-worker.ts. */
export const SCRIPT_DIR = resolve(import.meta.dirname, '..', '..');

const home = process.env['GENTCLAW_HOME'] || resolve(homedir(), '.gentclaw');

export const PATHS = {
  home,
  settings: resolve(home, 'settings.json'),
  env: resolve(home, '.env'),
  logs: resolve(home, 'logs'),
  sessions: resolve(home, 'sessions'),
  flags: resolve(home, 'flags'),
  invocations: resolve(home, 'logs', 'invocations.jsonl'),
  audit: resolve(home, 'logs', 'audit.jsonl'),
  status: resolve(home, 'status.json'),
  memory: resolve(home, 'memory'),
} as const;

/** All directories that must exist for the system to function. */
export const ALL_DIRS = [
  PATHS.home,
  PATHS.logs,
  PATHS.sessions,
  PATHS.flags,
  PATHS.memory,
] as const;
