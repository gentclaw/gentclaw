import { describe, it, expect, vi } from 'vitest';
import { dispatchCommand } from '../../src/lib/commands.js';

const mockGetSettings = vi.fn(() => ({}));

// Mock dependencies
vi.mock('../../src/lib/config.js', () => ({
  getAgents: () => ({
    coder: { name: 'Coder', provider: 'claude', model: 'sonnet', folder: '/tmp' },
    writer: { name: 'Writer', provider: 'claude', model: 'haiku', folder: '/tmp' },
  }),
  getDefaultAgentId: () => 'coder',
  getSettings: () => mockGetSettings(),
  updateSettings: vi.fn((mutator: (s: Record<string, unknown>) => Record<string, unknown>) => mutator({})),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock('../../src/lib/sessions.js', () => ({
  deleteSession: vi.fn(),
  stopFlagPath: () => '/tmp/stop-test',
}));

vi.mock('../../src/lib/providers.js', () => ({
  listProviders: () => ['claude'],
}));

vi.mock('../../src/lib/sequencer.js', () => ({
  activeTasks: () => 0,
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

  it('handles /status', () => {
    const result = dispatchCommand('/status', ctx);
    expect(result).not.toBeNull();
    expect(result!.skipInvoke).toBe(true);
    expect(result!.response).toContain('Agents:');
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
});
