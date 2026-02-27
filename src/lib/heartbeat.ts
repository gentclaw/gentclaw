import { getAgents } from './config.js';
import { processMessage } from './pipeline.js';
import { runSequential } from './sequencer.js';
import { log } from './log.js';
import {
  DEFAULT_HEARTBEAT_INTERVAL_MIN,
  HEARTBEAT_FALLBACK_PROMPT,
} from './constants.js';
import type { Agent, InboundMsg } from './types.js';

const L = log('heartbeat');

type AgentTimer = { agentId: string; timer: ReturnType<typeof setInterval> };

let timers: AgentTimer[] = [];

/** Resolve heartbeat prompt: inline config → fallback default. */
export function resolvePrompt(agent: Agent): string {
  return agent.heartbeat?.prompt ?? HEARTBEAT_FALLBACK_PROMPT;
}

/** Fire a single heartbeat for an agent. */
export async function fireHeartbeat(agentId: string, agent: Agent): Promise<string | null> {
  const prompt = resolvePrompt(agent);
  const msg: InboundMsg = {
    sender: 'heartbeat',
    message: prompt,
    timestamp: Date.now(),
    messageId: `hb-${agentId}-${Date.now()}`,
    sessionKey: `heartbeat-${agentId}`,
    agent: agentId,
    channel: 'heartbeat',
  };

  try {
    L.info('firing heartbeat', { agentId });
    const response = await processMessage(msg);
    L.info('heartbeat response', { agentId, len: response.length });
    return response;
  } catch (err) {
    L.error('heartbeat failed', { agentId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Start heartbeat timers for all enabled agents. */
export function startHeartbeat(): void {
  stopHeartbeat();

  const agents = getAgents();
  for (const [id, agent] of Object.entries(agents)) {
    if (!agent.heartbeat?.enabled) continue;

    const intervalMin = agent.heartbeat.intervalMinutes ?? DEFAULT_HEARTBEAT_INTERVAL_MIN;
    const intervalMs = intervalMin * 60 * 1_000;

    L.info('scheduling heartbeat', { agentId: id, intervalMin });

    const timer = setInterval(() => {
      runSequential('heartbeat-' + id, () => fireHeartbeat(id, agent).then(() => {}))
        .catch(err => L.error('heartbeat queue error', { agentId: id, error: err instanceof Error ? err.message : String(err) }));
    }, intervalMs);

    // Unref so heartbeat timers don't keep process alive on shutdown
    timer.unref();
    timers.push({ agentId: id, timer });
  }

  const count = timers.length;
  if (count > 0) {
    L.info('heartbeat started', { agents: count });
  }
}

/** Stop all heartbeat timers. */
export function stopHeartbeat(): void {
  for (const { timer } of timers) clearInterval(timer);
  timers = [];
}

/** @internal Test-only — get active heartbeat agent IDs. */
export function heartbeatAgents(): string[] {
  return timers.map(t => t.agentId);
}
