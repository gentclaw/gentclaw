import { getAgents, getDefaultAgentId } from './config.js';
import { getSessionAgent } from './sessions.js';
import { RoutingError } from './errors.js';
import type { InboundMsg, Agent } from './types.js';
import { log } from './log.js';

const L = log('routing');

type Directive =
  | { kind: 'mention'; agentRef: string; body: string }
  | { kind: 'plain'; body: string };

type RouteResult = {
  agentId: string;
  message: string; // cleaned message (mention stripped if applicable)
  routeType: 'pre-routed' | 'mention' | 'sticky' | 'default';
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

/**
 * 4-priority routing chain:
 * 1. Pre-routed (msg.agent set by command system)
 * 2. @mention prefix
 * 3. Sticky session (last explicit route for this thread)
 * 4. Default agent
 */
export function resolveRoute(msg: InboundMsg): RouteResult {
  const agents = getAgents();

  // 1. Pre-routed
  if (msg.agent && agents[msg.agent]) {
    L.debug('pre-routed', { agentId: msg.agent });
    return { agentId: msg.agent, message: msg.message, routeType: 'pre-routed' };
  }

  // 2. @mention
  const directive = parseDirective(msg.message);
  if (directive.kind === 'mention') {
    const agentId = getNameIndex(agents).get(directive.agentRef.toLowerCase());
    if (agentId) {
      L.debug('mention-routed', { agentId, ref: directive.agentRef });
      return { agentId, message: directive.body, routeType: 'mention' };
    }
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
