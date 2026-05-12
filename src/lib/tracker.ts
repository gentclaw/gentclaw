import { PATHS } from './paths.js';
import { atomicWriteJson } from './fs-utils.js';
import { activeTasks } from './sequencer.js';
import { log } from './log.js';
import { redactSecrets } from './secrets.js';
import { elapsedSec, formatDurationSec } from './text.js';

const L = log('tracker');

const MAX_HISTORY = 10;
const MAX_PREVIEW = 80;

export type ActiveTask = { agentId: string; sessionKey: string; messagePreview: string; startedAt: number };
export type CompletedTask = ActiveTask & { finishedAt: number; durationMs: number; success: boolean };
export type AgentActivity = { agentId: string; current: ActiveTask | null; recentHistory: CompletedTask[] };
export type StatusSnapshot = { agents: Record<string, AgentActivity>; totalQueuedTasks: number; timestamp: number };

const active = new Map<string, ActiveTask>();
const history = new Map<string, CompletedTask[]>();

/** Redact secrets before truncating — status.json is persisted to disk and surfaced via `/status`,
 *  so a Slack message containing an API key must not echo through. */
function truncate(s: string): string {
  const safe = redactSecrets(s);
  return safe.length > MAX_PREVIEW ? safe.slice(0, MAX_PREVIEW) + '...' : safe;
}

function persist(): void {
  try {
    atomicWriteJson(PATHS.status, getStatusSnapshot());
  } catch (err) { L.warn('status persist failed', { error: (err as Error).message }); }
}

export function trackStart(agentId: string, sessionKey: string, message: string): void {
  if (!history.has(agentId)) history.set(agentId, []);
  active.set(sessionKey, { agentId, sessionKey, messagePreview: truncate(message), startedAt: Date.now() });
  persist();
}

export function trackFinish(sessionKey: string, success: boolean): void {
  const task = active.get(sessionKey);
  if (!task) return;
  active.delete(sessionKey);

  const now = Date.now();
  const finished: CompletedTask = {
    ...task,
    finishedAt: now,
    durationMs: now - task.startedAt,
    success,
  };

  let ring = history.get(task.agentId);
  if (!ring) { ring = []; history.set(task.agentId, ring); }
  ring.unshift(finished);
  if (ring.length > MAX_HISTORY) ring.length = MAX_HISTORY;

  persist();
}

export function getAgentActivity(agentId: string): AgentActivity {
  const current = [...active.values()].find(t => t.agentId === agentId) ?? null;
  return { agentId, current, recentHistory: history.get(agentId) ?? [] };
}

export function getStatusSnapshot(): StatusSnapshot {
  const agents: Record<string, AgentActivity> = {};

  for (const agentId of history.keys()) {
    agents[agentId] = getAgentActivity(agentId);
  }
  for (const task of active.values()) {
    if (!agents[task.agentId]) {
      agents[task.agentId] = getAgentActivity(task.agentId);
    }
  }

  return { agents, totalQueuedTasks: activeTasks(), timestamp: Date.now() };
}

export type FormattedAgent = { id: string; busy: boolean; status: string; preview?: string; lastLine?: string };

/** Summarize agent activity into structured data for display. */
export function summarizeAgents(snapshot: StatusSnapshot): FormattedAgent[] {
  return Object.entries(snapshot.agents).map(([agentId, activity]) => {
    const { current } = activity;
    const busy = !!current;
    const status = current ? `busy (${elapsedSec(current.startedAt)}s)` : 'idle';
    const preview = current ? current.messagePreview : undefined;
    const last = activity.recentHistory[0];
    const lastLine = last
      ? `last: ${last.success ? 'ok' : 'error'} (${formatDurationSec(last.durationMs)}, ${elapsedSec(last.finishedAt)}s ago)`
      : undefined;
    return { id: agentId, busy, status, preview, lastLine };
  });
}

export function resetTracker(): void {
  active.clear();
  history.clear();
}
