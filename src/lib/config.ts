import { readFileSync, statSync } from 'node:fs';
import { PATHS } from './paths.js';
import { atomicWriteJson } from './fs-utils.js';
import { ConfigError, errMsg } from './errors.js';
import type { Settings, Agent, Team } from './types.js';

/** Lightweight runtime check — rejects obviously corrupt settings files */
function isSettingsShape(v: unknown): v is Settings {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  if (s.agents !== undefined && (typeof s.agents !== 'object' || Array.isArray(s.agents))) return false;
  if (s.teams !== undefined && (typeof s.teams !== 'object' || Array.isArray(s.teams))) return false;
  if (s.defaultAgent !== undefined && typeof s.defaultAgent !== 'string') return false;
  return true;
}

let cached: { settings: Settings; mtime: number } | null = null;

/** Read settings with mtime-based cache. Avoids re-parsing on every access. */
export function getSettings(): Settings {
  try {
    const mt = statSync(PATHS.settings).mtimeMs;
    if (cached && cached.mtime === mt) return cached.settings;
    const raw = readFileSync(PATHS.settings, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isSettingsShape(parsed)) {
      throw new ConfigError('Settings file has invalid structure');
    }
    const settings = parsed;
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

/** Get the default agent ID. Falls back to first configured agent. Single getSettings() call — avoids redundant stat via getAgents(). */
export function getDefaultAgentId(): string {
  const s = getSettings();
  const agents = s.agents;
  if (!agents || Object.keys(agents).length === 0) {
    throw new ConfigError('No agents configured. Run the setup wizard or add agents to settings.json.');
  }
  if (s.defaultAgent && agents[s.defaultAgent]) return s.defaultAgent;
  const first = Object.keys(agents)[0];
  if (!first) throw new ConfigError('No agents configured (unreachable).');
  return first;
}

/** Invalidate the cache (for testing or after external file changes). */
export function clearConfigCache(): void {
  cached = null;
}
