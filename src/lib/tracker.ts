import { PATHS } from './paths.js';
import { atomicWriteJson } from './fs-utils.js';
import { activeTasks } from './sequencer.js';

const MAX_HISTORY = 10;
const MAX_PREVIEW = 80;

export type ActiveTask = { agentId: string; sessionKey: string; messagePreview: string; startedAt: number };
export type CompletedTask = ActiveTask & { finishedAt: number; durationMs: number; success: boolean };
export type AgentActivity = { agentId: string; current: ActiveTask | null; recentHistory: CompletedTask[] };
export type StatusSnapshot = { agents: Record<string, AgentActivity>; totalQueuedTasks: number; timestamp: number };

const active = new Map<string, ActiveTask>();
const history = new Map<string, CompletedTask[]>();

function truncate(s: string): string {
  return s.length > MAX_PREVIEW ? s.slice(0, MAX_PREVIEW) + '...' : s;
}

function persist(): void {
  try {
    atomicWriteJson(PATHS.status, getStatusSnapshot());
  } catch { /* best-effort */ }
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

export function resetTracker(): void {
  active.clear();
  history.clear();
}
