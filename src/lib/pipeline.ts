import { existsSync, unlinkSync } from 'node:fs';
import { resolveRoute } from './routing.js';
import { runAgent } from './run.js';
import { getAgents } from './config.js';
import { setSessionAgent, stopFlagPath, maybeCleanupSessions } from './sessions.js';
import { runHooks } from './hooks.js';
import { HEARTBEAT_RUN_TIMEOUT_MS } from './constants.js';
import { log } from './log.js';
import type { InboundMsg } from './types.js';

const L = log('pipeline');

/** Process a single message through the pipeline: hooks → route → run agent → hooks → response. */
export async function processMessage(msg: InboundMsg): Promise<string> {
  // Pre-message hooks (rate limit, content guard, custom validation)
  const pre = await runHooks('preMessage', msg);
  if (pre.action === 'block') {
    L.info('message blocked by preMessage hook', { reason: pre.blockReason });
    return pre.blockReason ?? 'Message blocked.';
  }

  // Apply any transforms from hooks
  const transformedMsg = { ...msg, message: pre.message };

  const route = resolveRoute(transformedMsg);
  L.info('routed', { agentId: route.agentId, routeType: route.routeType, messageId: msg.messageId });

  // Ensure session exists for all routes (enables CLI session persistence)
  if (msg.sessionKey) {
    const agents = getAgents();
    const agentCfg = agents[route.agentId];
    if (agentCfg) {
      setSessionAgent(msg.sessionKey, route.agentId, agentCfg.provider, agentCfg.model);
    }
  }

  // Check stop flag
  if (msg.sessionKey && existsSync(stopFlagPath(msg.sessionKey))) {
    try { unlinkSync(stopFlagPath(msg.sessionKey)); } catch {}
    return 'Agent stopped.';
  }

  const timeout = msg.channel === 'heartbeat' ? HEARTBEAT_RUN_TIMEOUT_MS : undefined;
  const response = await runAgent({
    agentId: route.agentId,
    message: route.message,
    sessionKey: msg.sessionKey ?? msg.messageId,
    timeout,
  });

  // Post-message hooks (audit, transform response)
  const postMsg: InboundMsg = { ...msg, message: response };
  const post = await runHooks('postMessage', postMsg);

  maybeCleanupSessions();
  return post.action === 'block' ? (post.blockReason ?? 'Response blocked.') : post.message;
}
