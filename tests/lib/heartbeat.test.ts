import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const testHome = join(tmpdir(), `gentclaw-hb-test-${randomBytes(4).toString('hex')}`);
process.env['GENTCLAW_HOME'] = testHome;

vi.mock('../../src/lib/pipeline.js', () => ({
  processMessage: vi.fn().mockResolvedValue('heartbeat response'),
}));

const { resolvePrompt, fireHeartbeat, startHeartbeat, stopHeartbeat, heartbeatAgents } =
  await import('../../src/lib/heartbeat.js');
const { processMessage } = await import('../../src/lib/pipeline.js');
const { writeSettings, clearConfigCache } = await import('../../src/lib/config.js');
const { ensureDirectories } = await import('../../src/lib/fs-utils.js');
const { HEARTBEAT_FALLBACK_PROMPT } = await import('../../src/lib/constants.js');

import type { Agent } from '../../src/lib/types.js';

const agentCwd = join(testHome, 'agent-workspace');

function makeAgent(overrides?: Partial<Agent>): Agent {
  return {
    name: 'test-agent',
    provider: 'claude',
    model: 'sonnet',
    cwd: agentCwd,
    heartbeat: { enabled: true, intervalMinutes: 1 },
    ...overrides,
  };
}

describe('heartbeat', () => {
  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    ensureDirectories();
    mkdirSync(agentCwd, { recursive: true });
    clearConfigCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopHeartbeat();
    rmSync(testHome, { recursive: true, force: true });
  });

  describe('resolvePrompt', () => {
    it('returns inline prompt from agent config', () => {
      const agent = makeAgent({ heartbeat: { enabled: true, prompt: 'Check pending PRs.' } });
      expect(resolvePrompt(agent)).toBe('Check pending PRs.');
    });

    it('returns fallback when no inline prompt', () => {
      const agent = makeAgent();
      expect(resolvePrompt(agent)).toBe(HEARTBEAT_FALLBACK_PROMPT);
    });

    it('returns fallback when heartbeat config absent', () => {
      const agent = makeAgent({ heartbeat: undefined });
      expect(resolvePrompt(agent)).toBe(HEARTBEAT_FALLBACK_PROMPT);
    });
  });

  describe('fireHeartbeat', () => {
    it('calls processMessage with correct shape', async () => {
      const agent = makeAgent({ heartbeat: { enabled: true, prompt: 'do stuff' } });
      const resp = await fireHeartbeat('test', agent);

      expect(resp).toBe('heartbeat response');
      expect(processMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sender: 'heartbeat',
          message: 'do stuff',
          agent: 'test',
          channel: 'heartbeat',
          sessionKey: 'heartbeat-test',
        }),
      );
    });

    it('uses fallback prompt when none configured', async () => {
      await fireHeartbeat('test', makeAgent());
      expect(processMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: HEARTBEAT_FALLBACK_PROMPT }),
      );
    });

    it('returns null on error', async () => {
      vi.mocked(processMessage).mockRejectedValueOnce(new Error('boom'));
      const resp = await fireHeartbeat('test', makeAgent());
      expect(resp).toBeNull();
    });
  });

  describe('startHeartbeat / stopHeartbeat', () => {
    it('schedules timers for enabled agents only', () => {
      const noHb: Agent = { name: 'c', provider: 'claude', model: 'sonnet', cwd: agentCwd };
      writeSettings({
        agents: {
          a: makeAgent({ name: 'a', heartbeat: { enabled: true, intervalMinutes: 5 } }),
          b: makeAgent({ name: 'b', heartbeat: { enabled: false } }),
          c: noHb, // no heartbeat config at all
        },
      });
      clearConfigCache();

      startHeartbeat();
      expect(heartbeatAgents()).toEqual(['a']);

      stopHeartbeat();
      expect(heartbeatAgents()).toEqual([]);
    });

    it('clears previous timers on restart', () => {
      writeSettings({
        agents: { a: makeAgent({ name: 'a', heartbeat: { enabled: true } }) },
      });
      clearConfigCache();

      startHeartbeat();
      startHeartbeat(); // double-start should not duplicate
      expect(heartbeatAgents()).toEqual(['a']);
    });
  });
});
