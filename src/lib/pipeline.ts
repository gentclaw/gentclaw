import { existsSync, unlinkSync } from 'node:fs';
import { resolveRoute } from './routing.js';
import { runAgent } from './run.js';
import { getAgents } from './config.js';
import { setSessionAgent, stopFlagPath, maybeCleanupSessions } from './sessions.js';
import { runHooks } from './hooks.js';
import { HEARTBEAT_RUN_TIMEOUT_MS } from './constants.js';
import { log } from './log.js';
import { logInvocation } from './invocation-log.js';
import { auditLog } from './audit.js';
import { trackStart, trackFinish } from './tracker.js';
import { extractMemoryFromResponse } from './memory.js';
import type { InboundMsg } from './types.js';

const L = log('pipeline');

/** Process a single message through the pipeline: hooks → route → run agent → hooks → response. */
export async function processMessage(msg: InboundMsg): Promise<string> {
  // Pre-message hooks (rate limit, content guard, custom validation)
  const pre = await runHooks('preMessage', msg);
  if (pre.action === 'block') {
    L.info('message blocked by preMessage hook', { reason: pre.blockReason });
    auditLog({ action: 'message', sender: msg.sender, detail: msg.messageId, status: 'blocked', reason: pre.blockReason });
    return pre.blockReason ?? 'Message blocked.';
  }

  // Apply any transforms from hooks
  const transformedMsg = { ...msg, message: pre.message };

  const route = resolveRoute(transformedMsg);
  L.info('routed', { agentId: route.agentId, routeType: route.routeType, messageId: msg.messageId });

  const agents = getAgents();

  // Persist sticky session — skip for team routes (team mentions are one-shot, not sticky)
  if (msg.sessionKey && !route.isTeamRouted) {
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
  const sk = msg.sessionKey ?? msg.messageId;
  const agentCfgForLog = agents[route.agentId];
  const startMs = Date.now();

  trackStart(route.agentId, sk, msg.message);
  let success = true;
  try {
    const result = await runAgent({
      agentId: route.agentId,
      message: route.message,
      sessionKey: sk,
      timeout,
    });

    if (agentCfgForLog) {
      logInvocation({
        agentId: route.agentId, provider: agentCfgForLog.provider, model: agentCfgForLog.model,
        durationMs: Date.now() - startMs, success: true,
        tokens: result.tokens, channel: msg.channel, sender: msg.sender,
      });
    }

    // Extract and persist memory tags from agent response
    const responseText = extractMemoryFromResponse(route.agentId, result.text);

    // Post-message hooks (audit, transform response)
    const postMsg: InboundMsg = { ...msg, message: responseText };
    const post = await runHooks('postMessage', postMsg);

    maybeCleanupSessions();
    return post.action === 'block' ? (post.blockReason ?? 'Response blocked.') : post.message;
  } catch (err) {
    success = false;
    if (agentCfgForLog) {
      logInvocation({
        agentId: route.agentId, provider: agentCfgForLog.provider, model: agentCfgForLog.model,
        durationMs: Date.now() - startMs, success: false,
        errorType: err instanceof Error ? err.constructor.name : 'Unknown',
        channel: msg.channel, sender: msg.sender,
      });
    }
    throw err;
  } finally {
    trackFinish(sk, success);
  }
}
