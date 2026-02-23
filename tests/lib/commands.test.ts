import { describe, it, expect, vi } from 'vitest';
import { dispatchCommand } from '../../src/lib/commands.js';

const mockGetSettings = vi.fn(() => ({}));

// Mock dependencies
vi.mock('../../src/lib/config.js', () => ({
  getAgents: () => ({
    coder: { name: 'Coder', provider: 'claude', model: 'sonnet', cwd: '/tmp' },
    writer: { name: 'Writer', provider: 'claude', model: 'haiku', cwd: '/tmp' },
  }),
  getDefaultAgentId: () => 'coder',
  getSettings: () => mockGetSettings(),
  getTeams: () => mockGetSettings().teams ?? {},
  updateSettings: vi.fn((mutator: (s: Record<string, unknown>) => Record<string, unknown>) => mutator({})),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    if (cmd === 'echo') return (args as string[]).join(' ') + '\n';
    return '';
  }),
}));

vi.mock('../../src/lib/sessions.js', () => ({
  deleteSession: vi.fn(),
  stopFlagPath: () => '/tmp/stop-test',
}));

vi.mock('../../src/lib/providers.js', () => ({
  listProviders: () => ['claude'],
  getProvider: (id: string) => {
    if (id === 'claude') return { name: 'Claude', defaultModel: 'sonnet' };
    throw new Error(`Unknown provider: ${id}`);
  },
}));

vi.mock('../../src/lib/tracker.js', () => ({
  getStatusSnapshot: () => ({
    agents: {
      coder: {
        agentId: 'coder',
        current: { agentId: 'coder', sessionKey: 's1', messagePreview: 'fix bug', startedAt: Date.now() - 5000 },
        recentHistory: [],
      },
      writer: {
        agentId: 'writer',
        current: null,
        recentHistory: [{ agentId: 'writer', sessionKey: 's0', messagePreview: 'write docs', startedAt: 0, finishedAt: Date.now() - 10000, durationMs: 3000, success: true }],
      },
    },
    totalQueuedTasks: 1,
    timestamp: Date.now(),
  }),
}));

const mockResolveCustomCommand = vi.fn();
const mockListCustomCommands = vi.fn(() => ({}));
const mockListSkills = vi.fn(() => ({}));

vi.mock('../../src/lib/custom-commands.js', () => ({
  resolveCustomCommand: (...args: unknown[]) => mockResolveCustomCommand(...args),
  listCustomCommands: () => mockListCustomCommands(),
  listSkills: () => mockListSkills(),
}));

const ctx = { sessionKey: 'test-session', sender: 'user1' };

describe('dispatchCommand', () => {
  it('returns null for non-commands', () => {
    expect(dispatchCommand('hello', ctx)).toBeNull();
  });

  it('returns null for unknown commands', () => {
    mockResolveCustomCommand.mockReturnValue(null);
    expect(dispatchCommand('/nonexistent', ctx)).toBeNull();
  });

  it('handles ! prefix (Slack-safe)', () => {
    const result = dispatchCommand('!help', ctx);
    expect(result).not.toBeNull();
    expect(result!.skipInvoke).toBe(true);
    expect(result!.response).toContain('/help');
  });

  it('handles /help', () => {
    const result = dispatchCommand('/help', ctx);
    expect(result).not.toBeNull();
    expect(result!.skipInvoke).toBe(true);
    expect(result!.response).toContain('/help');
  });

  it('handles /status with per-agent info', () => {
    const result = dispatchCommand('/status', ctx);
    expect(result).not.toBeNull();
    expect(result!.skipInvoke).toBe(true);
    expect(result!.response).toContain('Agents:');
    expect(result!.response).toContain('*coder* — busy');
    expect(result!.response).toContain('fix bug');
    expect(result!.response).toContain('*writer* — idle');
    expect(result!.response).toContain('last: ok');
  });

  it('handles /agent without args (list)', () => {
    const result = dispatchCommand('/agent', ctx);
    expect(result!.response).toContain('coder');
    expect(result!.response).toContain('writer');
  });

  it('handles /agent with valid target', () => {
    const result = dispatchCommand('/agent writer', ctx);
    expect(result!.agent).toBe('writer');
  });

  it('handles /agent with invalid target', () => {
    const result = dispatchCommand('/agent nonexistent', ctx);
    expect(result!.response).toContain('Unknown agent');
  });

  it('handles /reset', () => {
    const result = dispatchCommand('/reset', ctx);
    expect(result!.skipInvoke).toBe(true);
  });

  it('handles /model without args', () => {
    const result = dispatchCommand('/model', ctx);
    expect(result!.response).toContain('sonnet');
  });

  it('handles /agents', () => {
    const result = dispatchCommand('/agents', ctx);
    expect(result!.response).toContain('coder');
    expect(result!.response).toContain('writer');
  });

  it('handles /reload without --force (confirmation prompt)', () => {
    const result = dispatchCommand('/reload', ctx);
    expect(result!.skipInvoke).toBe(true);
    expect(result!.response).toContain('/reload --force');
  });

  it('handles /reload --force (triggers rebuild)', () => {
    const result = dispatchCommand('/reload --force', ctx);
    expect(result!.skipInvoke).toBe(true);
    expect(result!.response).toContain('Reloading');
  });

  it('dispatches custom command to agent pipeline', () => {
    mockResolveCustomCommand.mockReturnValue({ message: 'Review: my code', agent: 'coder' });
    const result = dispatchCommand('/review my code', ctx);
    expect(result).not.toBeNull();
    expect(result!.skipInvoke).toBe(false);
    expect(result!.response).toBe('Review: my code');
    expect(result!.agent).toBe('coder');
  });

  it('returns null for unknown custom command', () => {
    mockResolveCustomCommand.mockReturnValue(null);
    expect(dispatchCommand('/nope', ctx)).toBeNull();
  });

  it('shows custom commands in /help', () => {
    mockListCustomCommands.mockReturnValue({
      review: { description: 'Review code', prompt: 'Review: $ARGUMENTS' },
    });
    mockListSkills.mockReturnValue({});
    const result = dispatchCommand('/help', ctx);
    expect(result!.response).toContain('*Custom:*');
    expect(result!.response).toContain('/review');
    expect(result!.response).toContain('Review code');
  });

  it('shows skills in /help under Skills section', () => {
    mockListCustomCommands.mockReturnValue({});
    mockListSkills.mockReturnValue({
      deploy: { description: 'Deploy to production', prompt: 'Deploy $ARGUMENTS' },
    });
    const result = dispatchCommand('/help', ctx);
    expect(result!.response).toContain('*Skills:*');
    expect(result!.response).toContain('/deploy');
    expect(result!.response).toContain('Deploy to production');
  });

  it('shows both custom commands and skills in /help', () => {
    mockListCustomCommands.mockReturnValue({
      review: { description: 'Review code', prompt: 'Review: $ARGUMENTS' },
    });
    mockListSkills.mockReturnValue({
      deploy: { description: 'Deploy', prompt: 'Deploy $ARGUMENTS' },
    });
    const result = dispatchCommand('/help', ctx);
    expect(result!.response).toContain('*Custom:*');
    expect(result!.response).toContain('*Skills:*');
  });

  // /bash command
  it('handles /bash with no args', () => {
    const result = dispatchCommand('/bash', ctx);
    expect(result!.skipInvoke).toBe(true);
    expect(result!.response).toContain('Usage');
  });

  it('handles /bash with safe command', () => {
    const result = dispatchCommand('/bash echo hello', ctx);
    expect(result!.skipInvoke).toBe(true);
    expect(result!.response).toContain('hello');
  });

  it('handles /shell alias', () => {
    const result = dispatchCommand('/shell echo test', ctx);
    expect(result!.skipInvoke).toBe(true);
    expect(result!.response).toContain('test');
  });

  it('blocks unsafe bash commands', () => {
    const result = dispatchCommand('/bash rm -rf /', ctx);
    expect(result!.skipInvoke).toBe(true);
    expect(result!.response).toContain('Denied');
  });

  it('blocks bash pipe injection', () => {
    const result = dispatchCommand('/bash echo hi | cat', ctx);
    expect(result!.response).toContain('Denied');
  });

  // /agent subcommands
  it('handles /agent show with valid id', () => {
    const result = dispatchCommand('/agent show coder', ctx);
    expect(result!.response).toContain('coder');
    expect(result!.response).toContain('Coder');
    expect(result!.response).toContain('claude/sonnet');
  });

  it('handles /agent show with invalid id', () => {
    const result = dispatchCommand('/agent show nonexistent', ctx);
    expect(result!.response).toContain('not found');
  });

  it('handles /agent add with valid args', () => {
    const result = dispatchCommand('/agent add helper Helper claude haiku', ctx);
    expect(result!.response).toContain("Agent 'helper' created");
  });

  it('handles /agent add with missing args', () => {
    const result = dispatchCommand('/agent add foo', ctx);
    expect(result!.response).toContain('Usage');
  });

  it('handles /agent remove without --force (confirmation)', () => {
    const result = dispatchCommand('/agent remove coder', ctx);
    expect(result!.response).toContain('--force');
  });

  it('handles /agent remove with --force', () => {
    const result = dispatchCommand('/agent remove coder --force', ctx);
    expect(result!.response).toContain('removed');
  });

  it('handles /agent provider show', () => {
    const result = dispatchCommand('/agent provider coder', ctx);
    expect(result!.response).toContain('claude');
  });

  it('shows /bash in /help', () => {
    mockListCustomCommands.mockReturnValue({});
    mockListSkills.mockReturnValue({});
    const result = dispatchCommand('/help', ctx);
    expect(result!.response).toContain('/bash');
    expect(result!.response).toContain('/agent add');
    expect(result!.response).toContain('/agent remove');
    expect(result!.response).toContain('/team');
  });

  // /team commands
  it('handles /team with no teams', () => {
    const result = dispatchCommand('/team', ctx);
    expect(result!.skipInvoke).toBe(true);
    expect(result!.response).toContain('No teams configured');
  });

  it('handles /teams alias', () => {
    const result = dispatchCommand('/teams', ctx);
    expect(result!.skipInvoke).toBe(true);
    expect(result!.response).toContain('No teams configured');
  });

  it('handles /team show with missing id', () => {
    const result = dispatchCommand('/team show', ctx);
    expect(result!.response).toContain('Usage');
  });

  it('handles /team show with unknown id', () => {
    const result = dispatchCommand('/team show nonexistent', ctx);
    expect(result!.response).toContain('not found');
  });

  it('handles /team add with missing args', () => {
    const result = dispatchCommand('/team add foo', ctx);
    expect(result!.response).toContain('Usage');
  });

  it('handles /team add with valid args', () => {
    mockGetSettings.mockReturnValueOnce({
      agents: {
        coder: { name: 'Coder', provider: 'claude', model: 'sonnet', cwd: '/tmp' },
        writer: { name: 'Writer', provider: 'claude', model: 'haiku', cwd: '/tmp' },
      },
    });
    const result = dispatchCommand('/team add dev DevTeam coder writer', ctx);
    expect(result!.response).toContain("Team 'dev' created");
    expect(result!.response).toContain('leader: @coder');
  });

  it('handles /team remove without --force', () => {
    const result = dispatchCommand('/team remove dev', ctx);
    expect(result!.response).toContain('not found');
  });

  it('handles /team addagent with missing args', () => {
    const result = dispatchCommand('/team addagent dev', ctx);
    expect(result!.response).toContain('Usage');
  });

  it('handles /team removeagent with missing args', () => {
    const result = dispatchCommand('/team removeagent', ctx);
    expect(result!.response).toContain('Usage');
  });

  it('handles /team setleader with missing args', () => {
    const result = dispatchCommand('/team setleader dev', ctx);
    expect(result!.response).toContain('Usage');
  });

  it('handles /team setleader with valid args', () => {
    mockGetSettings.mockReturnValueOnce({
      agents: {
        coder: { name: 'Coder', provider: 'claude', model: 'sonnet', cwd: '/tmp' },
        writer: { name: 'Writer', provider: 'claude', model: 'haiku', cwd: '/tmp' },
      },
      teams: {
        dev: { name: 'DevTeam', agents: ['coder', 'writer'], leader: 'coder' },
      },
    });
    const result = dispatchCommand('/team setleader dev writer', ctx);
    expect(result!.response).toContain('leader changed to @writer');
  });

  it('handles /team setleader with agent not in team', () => {
    mockGetSettings.mockReturnValueOnce({
      agents: {
        coder: { name: 'Coder', provider: 'claude', model: 'sonnet', cwd: '/tmp' },
      },
      teams: {
        dev: { name: 'DevTeam', agents: ['coder'], leader: 'coder' },
      },
    });
    const result = dispatchCommand('/team setleader dev writer', ctx);
    expect(result!.response).toContain('not in team');
  });

  it('handles /team add with id conflicting agent id', () => {
    mockGetSettings.mockReturnValueOnce({
      agents: {
        coder: { name: 'Coder', provider: 'claude', model: 'sonnet', cwd: '/tmp' },
      },
    });
    const result = dispatchCommand('/team add coder DevTeam coder', ctx);
    expect(result!.response).toContain('conflicts with agent ID');
  });

  it('shows /team setleader in /help', () => {
    mockListCustomCommands.mockReturnValue({});
    mockListSkills.mockReturnValue({});
    const result = dispatchCommand('/help', ctx);
    expect(result!.response).toContain('/team setleader');
  });
});
