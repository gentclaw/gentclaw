import { readFileSync, statSync } from 'node:fs';
import { PATHS } from './paths.js';
import { atomicWriteJson } from './fs-utils.js';
import { ConfigError, errMsg } from './errors.js';
import type { Settings, Agent, Team } from './types.js';

let cached: { settings: Settings; mtime: number } | null = null;

/** Read settings with mtime-based cache. Avoids re-parsing on every access. */
export function getSettings(): Settings {
  try {
    const mt = statSync(PATHS.settings).mtimeMs;
    if (cached && cached.mtime === mt) return cached.settings;
    const raw = readFileSync(PATHS.settings, 'utf-8');
    const settings = JSON.parse(raw) as Settings;
    cached = { settings, mtime: mt };
    return settings;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    const code = (err as NodeJS.ErrnoException).code;
    throw new ConfigError(`Failed to read settings${code ? ` (${code})` : ''}: ${errMsg(err)}`);
  }
}

/** Atomic read-mutate-write. */
export function updateSettings(mutator: (s: Settings) => Settings): Settings {
  const current = getSettings();
  const updated = mutator(current);
  atomicWriteJson(PATHS.settings, updated);
  cached = null; // force re-read
  return updated;
}

/** Write settings directly (for initial creation). */
export function writeSettings(settings: Settings): void {
  atomicWriteJson(PATHS.settings, settings);
  cached = null;
}

/** Check whether any agents are configured. */
export function hasAgents(): boolean {
  const s = getSettings();
  return !!s.agents && Object.keys(s.agents).length > 0;
}

/** Get configured agents. Throws ConfigError if none are configured. */
export function getAgents(): Record<string, Agent> {
  const agents = getSettings().agents;
  if (!agents || Object.keys(agents).length === 0) {
    throw new ConfigError('No agents configured. Run the setup wizard or add agents to settings.json.');
  }
  return agents;
}

/** Get configured teams (empty record if none). */
export function getTeams(): Record<string, Team> {
  return getSettings().teams ?? {};
}

/** Get the default agent ID. Falls back to first configured agent. */
export function getDefaultAgentId(): string {
  const agents = getAgents();
  const defaultId = getSettings().defaultAgent;
  if (defaultId && agents[defaultId]) return defaultId;
  return Object.keys(agents)[0]!;
}

/** Invalidate the cache (for testing or after external file changes). */
export function clearConfigCache(): void {
  cached = null;
}
