import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/paths.js', () => ({
  PATHS: { status: '/tmp/test-status.json' },
}));

vi.mock('../../src/lib/fs-utils.js', () => ({
  atomicWriteJson: vi.fn(),
}));

vi.mock('../../src/lib/sequencer.js', () => ({
  activeTasks: vi.fn(() => 0),
}));

import { trackStart, trackFinish, getAgentActivity, getStatusSnapshot, resetTracker } from '../../src/lib/tracker.js';

beforeEach(() => {
  resetTracker();
});

describe('tracker', () => {
  it('trackStart records active task with correct fields', () => {
    trackStart('coder', 'sess-1', 'hello world');
    const activity = getAgentActivity('coder');
    expect(activity.current).not.toBeNull();
    expect(activity.current!.agentId).toBe('coder');
    expect(activity.current!.sessionKey).toBe('sess-1');
    expect(activity.current!.messagePreview).toBe('hello world');
    expect(activity.current!.startedAt).toBeGreaterThan(0);
  });

  it('trackFinish clears active and adds to history with timing', () => {
    trackStart('coder', 'sess-1', 'fix bug');
    trackFinish('sess-1', true);
    const activity = getAgentActivity('coder');
    expect(activity.current).toBeNull();
    expect(activity.recentHistory).toHaveLength(1);
    expect(activity.recentHistory[0]!.success).toBe(true);
    expect(activity.recentHistory[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(activity.recentHistory[0]!.finishedAt).toBeGreaterThan(0);
  });

  it('records failure in history', () => {
    trackStart('coder', 'sess-2', 'bad task');
    trackFinish('sess-2', false);
    const activity = getAgentActivity('coder');
    expect(activity.recentHistory[0]!.success).toBe(false);
  });

  it('truncates long messages to 80 chars', () => {
    const longMsg = 'a'.repeat(200);
    trackStart('coder', 'sess-3', longMsg);
    const activity = getAgentActivity('coder');
    expect(activity.current!.messagePreview.length).toBe(83); // 80 + '...'
  });

  it('caps history ring buffer at 10 (newest first)', () => {
    for (let i = 0; i < 15; i++) {
      trackStart('coder', `sess-${i}`, `msg-${i}`);
      trackFinish(`sess-${i}`, true);
    }
    const activity = getAgentActivity('coder');
    expect(activity.recentHistory).toHaveLength(10);
    expect(activity.recentHistory[0]!.messagePreview).toBe('msg-14');
  });

  it('tracks multiple agents independently', () => {
    trackStart('coder', 'sess-a', 'code task');
    trackStart('writer', 'sess-b', 'write task');
    expect(getAgentActivity('coder').current!.agentId).toBe('coder');
    expect(getAgentActivity('writer').current!.agentId).toBe('writer');
  });

  it('trackFinish for unknown sessionKey is no-op', () => {
    trackFinish('nonexistent', true);
    const snapshot = getStatusSnapshot();
    expect(Object.keys(snapshot.agents)).toHaveLength(0);
  });

  it('getStatusSnapshot includes all known agents', () => {
    trackStart('coder', 'sess-1', 'task1');
    trackStart('writer', 'sess-2', 'task2');
    trackFinish('sess-2', true);
    const snapshot = getStatusSnapshot();
    expect(snapshot.agents['coder']).toBeDefined();
    expect(snapshot.agents['writer']).toBeDefined();
    expect(snapshot.agents['coder']!.current).not.toBeNull();
    expect(snapshot.agents['writer']!.current).toBeNull();
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });

  it('resetTracker clears everything', () => {
    trackStart('coder', 'sess-1', 'task');
    trackFinish('sess-1', true);
    resetTracker();
    const snapshot = getStatusSnapshot();
    expect(Object.keys(snapshot.agents)).toHaveLength(0);
  });
});
