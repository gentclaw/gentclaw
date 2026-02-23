import { getAgents, getDefaultAgentId, getTeams } from './config.js';
import { getSessionAgent } from './sessions.js';
import { RoutingError } from './errors.js';
import type { InboundMsg, Agent, Team } from './types.js';
import { log } from './log.js';

const L = log('routing');

type Directive =
  | { kind: 'mention'; agentRef: string; body: string }
  | { kind: 'plain'; body: string };

export type RouteResult = {
  agentId: string;
  message: string; // cleaned message (mention stripped if applicable)
  routeType: 'pre-routed' | 'mention' | 'sticky' | 'default';
  isTeamRouted: boolean;
};

/** Parse leading @mention directive via character-level scan. */
function parseDirective(text: string): Directive {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('@')) return { kind: 'plain', body: text };
  let i = 1;
  while (i < trimmed.length && !/\s/.test(trimmed[i]!)) i++;
  const ref = trimmed.slice(1, i);
  if (!ref) return { kind: 'plain', body: text };
  return { kind: 'mention', agentRef: ref, body: trimmed.slice(i).trimStart() };
}

/** Cached name→id index with fingerprint-based invalidation. */
let nameIndex: Map<string, string> | null = null;
let indexFP = '';

function getNameIndex(agents: Record<string, Agent>): Map<string, string> {
  const fp = Object.entries(agents).map(([id, c]) => `${id}:${c.name}`).sort().join('|');
  if (nameIndex && indexFP === fp) return nameIndex;
  const idx = new Map<string, string>();
  for (const [id, cfg] of Object.entries(agents)) {
    idx.set(id.toLowerCase(), id);
    if (cfg.name) idx.set(cfg.name.toLowerCase(), id);
  }
  nameIndex = idx;
  indexFP = fp;
  return idx;
}

/** Build team name/id → leader index. IDs take priority over display names. */
let teamIndex: Map<string, string> | null = null;
let teamIndexFP = '';

function getTeamIndex(teams: Record<string, Team>): Map<string, string> {
  const fp = Object.entries(teams).map(([id, t]) => `${id}:${t.name}:${t.leader}`).sort().join('|');
  if (teamIndex && teamIndexFP === fp) return teamIndex;
  const idx = new Map<string, string>();
  // Names first so IDs override on collision
  for (const [id, t] of Object.entries(teams)) idx.set(t.name.toLowerCase(), t.leader);
  for (const [id, t] of Object.entries(teams)) idx.set(id.toLowerCase(), t.leader);
  teamIndex = idx;
  teamIndexFP = fp;
  return idx;
}

/** 4-priority routing: pre-routed → @mention (agent/team) → sticky session → default */
export function resolveRoute(msg: InboundMsg): RouteResult {
  const agents = getAgents();
  const teams = getTeams();

  // 1. Pre-routed
  if (msg.agent && agents[msg.agent]) {
    L.debug('pre-routed', { agentId: msg.agent });
    return { agentId: msg.agent, message: msg.message, routeType: 'pre-routed', isTeamRouted: false };
  }

  // 2. @mention (agent first, then team)
  const directive = parseDirective(msg.message);
  if (directive.kind === 'mention') {
    const ref = directive.agentRef.toLowerCase();

    // Agent match takes priority
    const agentId = getNameIndex(agents).get(ref);
    if (agentId) {
      L.debug('mention-routed', { agentId, ref: directive.agentRef });
      return { agentId, message: directive.body, routeType: 'mention', isTeamRouted: false };
    }

    // Team match — resolve to leader
    const leaderId = getTeamIndex(teams).get(ref);
    if (leaderId && agents[leaderId]) {
      L.debug('team-routed', { agentId: leaderId, team: directive.agentRef });
      return { agentId: leaderId, message: directive.body, routeType: 'mention', isTeamRouted: true };
    }
  }

  // 3. Sticky session
  if (msg.sessionKey) {
    const sticky = getSessionAgent(msg.sessionKey);
    if (sticky && agents[sticky]) {
      L.debug('sticky-routed', { agentId: sticky });
      return { agentId: sticky, message: msg.message, routeType: 'sticky', isTeamRouted: false };
    }
  }

  // 4. Default
  const defaultId = getDefaultAgentId();
  if (!agents[defaultId]) {
    throw new RoutingError('No agents configured');
  }
  L.debug('default-routed', { agentId: defaultId });
  return { agentId: defaultId, message: msg.message, routeType: 'default', isTeamRouted: false };
}
