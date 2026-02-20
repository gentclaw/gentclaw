import { resolve } from 'node:path';
import { homedir } from 'node:os';

const home = process.env['GENTCLAW_HOME'] || resolve(homedir(), '.gentclaw');

export const PATHS = {
  home,
  settings: resolve(home, 'settings.json'),
  env: resolve(home, '.env'),
  logs: resolve(home, 'logs'),
  sessions: resolve(home, 'sessions'),
  flags: resolve(home, 'flags'),
} as const;

/** All directories that must exist for the system to function. */
export const ALL_DIRS = [
  PATHS.home,
  PATHS.logs,
  PATHS.sessions,
  PATHS.flags,
] as const;
