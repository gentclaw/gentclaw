import { getAgents, getDefaultAgentId, getTeams } from './config.js';
import { getSessionAgent } from './sessions.js';
import { RoutingError } from './errors.js';
import type { InboundMsg } from './types.js';
import { log } from './log.js';

const L = log('routing');

type Directive =
  | { kind: 'mention'; agentRef: string; body: string }
  | { kind: 'plain'; body: string };

export type RouteResult = {
  agentId: string;
  message: string; // cleaned message (mention stripped if applicable)
  routeType: 'pre-routed' | 'mention' | 'sticky' | 'default';
  teamId?: string; // set when routed via team mention — value is the matched team ID
};

/** Parse leading @mention directive. */
function parseDirective(text: string): Directive {
  const match = text.trimStart().match(/^@(\S+)\s*([\s\S]*)$/);
  if (!match) return { kind: 'plain', body: text };
  return { kind: 'mention', agentRef: match[1], body: match[2].trimStart() };
}

/** Fingerprint-based cache — rebuilds index only when source data changes. */
function createFpCache<T>(buildFp: () => string, buildIndex: () => Map<string, T>): { get: () => Map<string, T>; clear: () => void } {
  let fp = '';
  let idx: Map<string, T> | null = null;
  return {
    get(): Map<string, T> {
      const newFp = buildFp();
      if (idx && fp === newFp) return idx;
      idx = buildIndex();
      fp = newFp;
      return idx;
    },
    clear(): void { fp = ''; idx = null; },
  };
}

type TeamEntry = { teamId: string; leaderId: string };

const agentNameCache = createFpCache<string>(
  () => Object.entries(getAgents()).map(([id, c]) => `${id}:${c.name}`).sort().join('|'),
  () => {
    const idx = new Map<string, string>();
    for (const [id, cfg] of Object.entries(getAgents())) {
      idx.set(id.toLowerCase(), id);
      if (cfg.name) idx.set(cfg.name.toLowerCase(), id);
    }
    return idx;
  },
);

/** IDs take priority over display names (names inserted first, IDs override on collision). */
const teamNameCache = createFpCache<TeamEntry>(
  () => Object.entries(getTeams()).map(([id, t]) => `${id}:${t.name}:${t.leader}:${t.agents.join(',')}`).sort().join('|'),
  () => {
    const idx = new Map<string, TeamEntry>();
    for (const [id, t] of Object.entries(getTeams())) idx.set(t.name.toLowerCase(), { teamId: id, leaderId: t.leader });
    for (const [id, t] of Object.entries(getTeams())) idx.set(id.toLowerCase(), { teamId: id, leaderId: t.leader });
    return idx;
  },
);

/** Reset routing caches (for testing). */
export function clearRoutingCache(): void {
  agentNameCache.clear();
  teamNameCache.clear();
}

/** 4-priority routing: pre-routed → @mention (agent/team) → sticky session → default */
export function resolveRoute(msg: InboundMsg): RouteResult {
  const agents = getAgents();

  // 1. Pre-routed
  if (msg.agent && agents[msg.agent]) {
    L.debug('pre-routed', { agentId: msg.agent });
    return { agentId: msg.agent, message: msg.message, routeType: 'pre-routed' };
  }

  // 2. @mention (agent first, then team)
  const directive = parseDirective(msg.message);
  if (directive.kind === 'mention') {
    const ref = directive.agentRef.toLowerCase();

    // Agent match takes priority
    const agentId = agentNameCache.get().get(ref);
    if (agentId) {
      L.debug('mention-routed', { agentId, ref: directive.agentRef });
      return { agentId, message: directive.body, routeType: 'mention' };
    }

    // Team match — resolve to leader. Team mentions are one-shot (no sticky session) — pipeline.ts skips setSessionAgent when teamId is set.
    const entry = teamNameCache.get().get(ref);
    if (entry && agents[entry.leaderId]) {
      L.debug('team-routed', { agentId: entry.leaderId, teamId: entry.teamId });
      return { agentId: entry.leaderId, message: directive.body, routeType: 'mention', teamId: entry.teamId };
    }

    L.warn('unrecognized @mention, falling through', { ref: directive.agentRef });
  }

  // 3. Sticky session
  if (msg.sessionKey) {
    const sticky = getSessionAgent(msg.sessionKey);
    if (sticky && agents[sticky]) {
      L.debug('sticky-routed', { agentId: sticky });
      return { agentId: sticky, message: msg.message, routeType: 'sticky' };
    }
  }

  // 4. Default
  const defaultId = getDefaultAgentId();
  if (!agents[defaultId]) {
    throw new RoutingError('No agents configured');
  }
  L.debug('default-routed', { agentId: defaultId });
  return { agentId: defaultId, message: msg.message, routeType: 'default' };
}
