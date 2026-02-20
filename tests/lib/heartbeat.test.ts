import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const testHome = join(tmpdir(), `gentclaw-hb-test-${randomBytes(4).toString('hex')}`);
process.env['GENTCLAW_HOME'] = testHome;

vi.mock('../../src/lib/pipeline.js', () => ({
  processMessage: vi.fn().mockResolvedValue('heartbeat response'),
}));

const { readPrompt, fireHeartbeat, startHeartbeat, stopHeartbeat, heartbeatAgents } =
  await import('../../src/lib/heartbeat.js');
const { processMessage } = await import('../../src/lib/pipeline.js');
const { writeSettings, clearConfigCache } = await import('../../src/lib/config.js');
const { ensureDirectories } = await import('../../src/lib/fs-utils.js');
const { HEARTBEAT_FALLBACK_PROMPT } = await import('../../src/lib/constants.js');

import type { Agent } from '../../src/lib/types.js';

const agentFolder = join(testHome, 'agent-workspace');

function makeAgent(overrides?: Partial<Agent>): Agent {
  return {
    name: 'test-agent',
    provider: 'claude',
    model: 'sonnet',
    folder: agentFolder,
    heartbeat: { enabled: true, intervalMinutes: 1 },
    ...overrides,
  };
}

describe('heartbeat', () => {
  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    ensureDirectories();
    mkdirSync(agentFolder, { recursive: true });
    clearConfigCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopHeartbeat();
    rmSync(testHome, { recursive: true, force: true });
  });

  describe('readPrompt', () => {
    it('reads HEARTBEAT.md from agent folder', () => {
      writeFileSync(join(agentFolder, 'HEARTBEAT.md'), 'Check pending PRs.');
      const prompt = readPrompt(makeAgent());
      expect(prompt).toBe('Check pending PRs.');
    });

    it('falls back to lowercase heartbeat.md', () => {
      writeFileSync(join(agentFolder, 'heartbeat.md'), 'lowercase prompt');
      const prompt = readPrompt(makeAgent());
      expect(prompt).toBe('lowercase prompt');
    });

    it('returns fallback when no file exists', () => {
      const prompt = readPrompt(makeAgent());
      expect(prompt).toBe(HEARTBEAT_FALLBACK_PROMPT);
    });

    it('uses custom promptFile from agent config', () => {
      writeFileSync(join(agentFolder, 'CUSTOM.md'), 'custom prompt');
      const agent = makeAgent({ heartbeat: { enabled: true, promptFile: 'CUSTOM.md' } });
      const prompt = readPrompt(agent);
      expect(prompt).toBe('custom prompt');
    });
  });

  describe('fireHeartbeat', () => {
    it('calls processMessage with correct shape', async () => {
      writeFileSync(join(agentFolder, 'HEARTBEAT.md'), 'do stuff');
      const resp = await fireHeartbeat('test', makeAgent());

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

    it('returns null on error', async () => {
      vi.mocked(processMessage).mockRejectedValueOnce(new Error('boom'));
      const resp = await fireHeartbeat('test', makeAgent());
      expect(resp).toBeNull();
    });
  });

  describe('startHeartbeat / stopHeartbeat', () => {
    it('schedules timers for enabled agents only', () => {
      const noHb: Agent = { name: 'c', provider: 'claude', model: 'sonnet', folder: agentFolder };
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
