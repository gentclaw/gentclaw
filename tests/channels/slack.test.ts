import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the event handler registered via app.event()
let eventHandlers: Record<string, (payload: { event: unknown }) => Promise<void>> = {};

const mockPostMessage = vi.fn().mockResolvedValue({});
const mockReactionsAdd = vi.fn().mockResolvedValue({});
const mockReactionsRemove = vi.fn().mockResolvedValue({});

vi.mock('@slack/bolt', () => ({
  App: vi.fn().mockImplementation(() => ({
    client: {
      auth: { test: vi.fn().mockResolvedValue({ user_id: 'U_BOT' }) },
      chat: { postMessage: mockPostMessage },
      reactions: { add: mockReactionsAdd, remove: mockReactionsRemove },
    },
    event: vi.fn((name: string, handler: (payload: { event: unknown }) => Promise<void>) => {
      eventHandlers[name] = handler;
    }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
  LogLevel: { DEBUG: 'debug', WARN: 'warn' },
}));

vi.mock('../../src/lib/config.js', () => ({
  getSettings: () => ({
    channels: { slack: { botToken: 'xoxb-test', appToken: 'xapp-test' } },
    logging: { verbose: false },
  }),
  hasAgents: () => true,
}));

const mockProcessMessage = vi.fn().mockResolvedValue('agent response');
vi.mock('../../src/lib/pipeline.js', () => ({
  processMessage: (...args: unknown[]) => mockProcessMessage(...args),
}));

vi.mock('../../src/lib/commands.js', () => ({
  dispatchCommand: () => null,
}));

vi.mock('../../src/lib/sequencer.js', () => ({
  runSequential: vi.fn((_key: string, fn: () => Promise<void>) => fn()),
}));

vi.mock('../../src/channels/slack-fmt.js', () => ({
  formatForSlack: (t: string) => t,
}));

vi.mock('../../src/lib/text.js', () => ({
  splitMessage: (t: string) => [t],
}));

vi.mock('../../src/lib/fs-utils.js', () => ({
  ensureDirectories: vi.fn(),
}));

vi.mock('../../src/lib/log.js', () => ({
  initLog: vi.fn(),
  log: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../src/lib/errors.js', () => ({
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  ConfigError: class ConfigError extends Error {},
}));

vi.mock('../../src/lib/heartbeat.js', () => ({
  startHeartbeat: vi.fn(),
  stopHeartbeat: vi.fn(),
}));

describe('slack channel', () => {
  beforeEach(async () => {
    eventHandlers = {};
    mockProcessMessage.mockClear().mockResolvedValue('agent response');
    mockPostMessage.mockClear();
    mockReactionsAdd.mockClear();
    mockReactionsRemove.mockClear();

    // Dynamic import returns cached module (vi.mock hoisted) — re-runs startSlack to register fresh handlers
    const mod = await import('../../src/channels/slack.js');
    await mod.startSlack();
  });

  it('registers message and app_mention handlers', () => {
    expect(eventHandlers['message']).toBeDefined();
    expect(eventHandlers['app_mention']).toBeDefined();
  });

  it('ignores events missing channel or ts (type guard)', async () => {
    await eventHandlers['message']!({ event: { user: 'U1', text: 'hi' } });
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('ignores bot messages', async () => {
    await eventHandlers['message']!({
      event: { bot_id: 'B1', channel: 'C1', ts: '1.0', text: 'bot msg' },
    });
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('ignores subtypes', async () => {
    await eventHandlers['message']!({
      event: { subtype: 'message_changed', channel: 'C1', ts: '1.0', user: 'U1', text: 'edited' },
    });
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('processes valid user message and replies', async () => {
    await eventHandlers['message']!({
      event: { user: 'U1', text: 'hello agent', channel: 'C1', ts: '1.0' },
    });
    expect(mockProcessMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: 'U1',
        message: 'hello agent',
        channel: 'slack',
      }),
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C1', text: 'agent response', thread_ts: '1.0' }),
    );
  });

  it('uses thread_ts for session key and reply when in thread', async () => {
    await eventHandlers['message']!({
      event: { user: 'U1', text: 'reply', channel: 'C1', ts: '2.0', thread_ts: '1.0' },
    });
    expect(mockProcessMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: 'slack-C1-1.0' }),
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: '1.0' }),
    );
  });

  it('follows 4-phase emoji lifecycle: eyes → gear → outcome', async () => {
    await eventHandlers['message']!({
      event: { user: 'U1', text: 'test', channel: 'C1', ts: '1.0' },
    });

    const adds = mockReactionsAdd.mock.calls.map((c: { name: string }[]) => c[0].name);
    const removes = mockReactionsRemove.mock.calls.map((c: { name: string }[]) => c[0].name);

    // Phase 1: eyes added on receive
    expect(adds[0]).toBe('eyes');
    // Phase 2: eyes removed + gear added when processing starts
    expect(removes[0]).toBe('eyes');
    expect(adds[1]).toBe('gear');
    // Phase 3: gear removed + outcome added when done
    expect(removes[1]).toBe('gear');
    expect(adds[2]).toBe('white_check_mark');
  });

  it('sets x reaction and removes gear on processing error', async () => {
    mockProcessMessage.mockRejectedValueOnce(new Error('agent failed'));
    await eventHandlers['message']!({
      event: { user: 'U1', text: 'test', channel: 'C1', ts: '1.0' },
    });

    const adds = mockReactionsAdd.mock.calls.map((c: { name: string }[]) => c[0].name);
    const removes = mockReactionsRemove.mock.calls.map((c: { name: string }[]) => c[0].name);

    // gear should be removed, x should be added as outcome
    expect(removes).toContain('gear');
    expect(adds).toContain('x');
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Error: agent failed') }),
    );
  });

  it('ignores empty text after bot mention stripping', async () => {
    await eventHandlers['message']!({
      event: { user: 'U1', text: '<@U_BOT>', channel: 'C1', ts: '1.0' },
    });
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('ignores events with non-object payloads', async () => {
    await eventHandlers['message']!({ event: null });
    await eventHandlers['message']!({ event: 'string' });
    expect(mockPostMessage).not.toHaveBeenCalled();
  });
});
