import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveRoute } from '../../src/lib/routing.js';
import type { InboundMsg } from '../../src/lib/types.js';

// Mock config and sessions
vi.mock('../../src/lib/config.js', () => ({
  getAgents: () => ({
    coder: { name: 'Coder', provider: 'claude', model: 'sonnet', folder: '/tmp' },
    writer: { name: 'Writer', provider: 'claude', model: 'sonnet', folder: '/tmp' },
  }),
  getDefaultAgentId: () => 'coder',
}));

vi.mock('../../src/lib/sessions.js', () => ({
  getSessionAgent: (key: string) => {
    if (key === 'sticky-session') return 'writer';
    return undefined;
  },
}));

function makeMsg(overrides: Partial<InboundMsg> = {}): InboundMsg {
  return {
    sender: 'user1',
    message: 'hello',
    timestamp: Date.now(),
    messageId: 'ts1',
    ...overrides,
  };
}

describe('resolveRoute', () => {
  it('routes pre-routed messages', () => {
    const result = resolveRoute(makeMsg({ agent: 'coder' }));
    expect(result.agentId).toBe('coder');
    expect(result.routeType).toBe('pre-routed');
  });

  it('routes @mention messages and strips mention', () => {
    const result = resolveRoute(makeMsg({ message: '@writer please help' }));
    expect(result.agentId).toBe('writer');
    expect(result.message).toBe('please help');
    expect(result.routeType).toBe('mention');
  });

  it('routes @mention by agent name (case-insensitive)', () => {
    const result = resolveRoute(makeMsg({ message: '@Writer help me' }));
    expect(result.agentId).toBe('writer');
    expect(result.routeType).toBe('mention');
  });

  it('routes via sticky session', () => {
    const result = resolveRoute(makeMsg({ sessionKey: 'sticky-session' }));
    expect(result.agentId).toBe('writer');
    expect(result.routeType).toBe('sticky');
  });

  it('falls back to default agent', () => {
    const result = resolveRoute(makeMsg({ sessionKey: 'unknown-session' }));
    expect(result.agentId).toBe('coder');
    expect(result.routeType).toBe('default');
  });

  it('ignores unknown @mentions', () => {
    const result = resolveRoute(makeMsg({ message: '@unknown do stuff' }));
    expect(result.agentId).toBe('coder');
    expect(result.routeType).toBe('default');
  });
});
