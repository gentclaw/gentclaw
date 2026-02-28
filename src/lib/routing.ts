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

/** Parse leading @mention directive via character-level scan. */
function parseDirective(text: string): Directive {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('@')) return { kind: 'plain', body: text };
  let i = 1;
  while (i < trimmed.length && !/\s/.test(trimmed[i] ?? '')) i++;
  const ref = trimmed.slice(1, i);
  if (!ref) return { kind: 'plain', body: text };
  return { kind: 'mention', agentRef: ref, body: trimmed.slice(i).trimStart() };
}

/** Fingerprint-based cached index — rebuilds only when data changes. Fetch supplies data to both fingerprint and build to avoid double-fetching. */
function createCachedIndex<D, T>(
  fetch: () => D,
  fingerprint: (data: D) => string,
  build: (data: D) => Map<string, T>,
): () => Map<string, T> {
  let cached: Map<string, T> | null = null;
  let fp = '';
  return () => {
    const data = fetch();
    const newFp = fingerprint(data);
    if (cached && fp === newFp) return cached;
    cached = build(data);
    fp = newFp;
    return cached;
  };
}

const getNameIndex = createCachedIndex(
  getAgents,
  (agents) => Object.entries(agents).map(([id, c]) => `${id}:${c.name}`).sort().join('|'),
  (agents) => {
    const idx = new Map<string, string>();
    for (const [id, cfg] of Object.entries(agents)) {
      idx.set(id.toLowerCase(), id);
      if (cfg.name) idx.set(cfg.name.toLowerCase(), id);
    }
    return idx;
  },
);

type TeamEntry = { teamId: string; leaderId: string };

/** IDs take priority over display names (names inserted first, IDs override on collision). */
const getTeamIndex = createCachedIndex(
  getTeams,
  (teams) => Object.entries(teams).map(([id, t]) => `${id}:${t.name}:${t.leader}:${t.agents.join(',')}`).sort().join('|'),
  (teams) => {
    const idx = new Map<string, TeamEntry>();
    for (const [id, t] of Object.entries(teams)) idx.set(t.name.toLowerCase(), { teamId: id, leaderId: t.leader });
    for (const [id, t] of Object.entries(teams)) idx.set(id.toLowerCase(), { teamId: id, leaderId: t.leader });
    return idx;
  },
);

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
    const agentId = getNameIndex().get(ref);
    if (agentId) {
      L.debug('mention-routed', { agentId, ref: directive.agentRef });
      return { agentId, message: directive.body, routeType: 'mention' };
    }

    // Team match — resolve to leader. Team mentions are one-shot (no sticky session) — pipeline.ts skips setSessionAgent when teamId is set.
    const entry = getTeamIndex().get(ref);
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
