import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const testHome = join(tmpdir(), `gentclaw-cfg-test-${randomBytes(4).toString('hex')}`);
process.env['GENTCLAW_HOME'] = testHome;

const { getSettings, updateSettings, writeSettings, getAgents, getDefaultAgentId, hasAgents, clearConfigCache, updateAgent, removeAgent, updateTeam, removeTeam } =
  await import('../../src/lib/config.js');
const { ConfigError } = await import('../../src/lib/errors.js');
const { ensureDirectories } = await import('../../src/lib/fs-utils.js');

describe('config', () => {
  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    ensureDirectories();
    clearConfigCache();
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
  });

  it('returns empty settings when file missing', () => {
    const s = getSettings();
    expect(s).toEqual({});
  });

  it('writes and reads settings', () => {
    writeSettings({ devMode: true, defaultAgent: 'test' });
    clearConfigCache();
    const s = getSettings();
    expect(s.devMode).toBe(true);
    expect(s.defaultAgent).toBe('test');
  });

  it('updates settings atomically', () => {
    writeSettings({ devMode: false });
    clearConfigCache();
    updateSettings(s => ({ ...s, devMode: true }));
    clearConfigCache();
    expect(getSettings().devMode).toBe(true);
  });

  it('throws ConfigError when no agents configured', () => {
    writeSettings({});
    clearConfigCache();
    expect(() => getAgents()).toThrow(ConfigError);
  });

  it('returns configured agents', () => {
    writeSettings({
      agents: {
        coder: { name: 'Coder', provider: 'claude', model: 'opus', cwd: '/tmp' },
      },
    });
    clearConfigCache();
    const agents = getAgents();
    expect(agents['coder']!.name).toBe('Coder');
  });

  it('returns configured defaultAgentId', () => {
    writeSettings({ defaultAgent: 'myagent', agents: { myagent: { name: 'My', provider: 'claude', model: 'sonnet', cwd: '/tmp' } } });
    clearConfigCache();
    expect(getDefaultAgentId()).toBe('myagent');
  });

  it('hasAgents returns false when none configured', () => {
    writeSettings({});
    clearConfigCache();
    expect(hasAgents()).toBe(false);
  });

  it('hasAgents returns true when agents exist', () => {
    writeSettings({
      agents: { a: { name: 'A', provider: 'claude', model: 'sonnet', cwd: '/tmp' } },
    });
    clearConfigCache();
    expect(hasAgents()).toBe(true);
  });

  it('rejects corrupt settings file (array instead of object)', () => {
    writeFileSync(join(testHome, 'settings.json'), '["not","an","object"]', 'utf-8');
    clearConfigCache();
    expect(() => getSettings()).toThrow(ConfigError);
  });

  it('rejects settings with agents as array', () => {
    writeFileSync(join(testHome, 'settings.json'), '{"agents":["bad"]}', 'utf-8');
    clearConfigCache();
    expect(() => getSettings()).toThrow(ConfigError);
  });

  it('updateAgent adds or replaces an agent', () => {
    writeSettings({ agents: { a: { name: 'A', provider: 'claude', model: 'sonnet', cwd: '/tmp' } } });
    clearConfigCache();
    updateAgent('b', { name: 'B', provider: 'claude', model: 'opus', cwd: '/tmp' });
    clearConfigCache();
    const agents = getAgents();
    expect(agents['b']!.name).toBe('B');
    expect(agents['a']!.name).toBe('A');
  });

  it('removeAgent removes an agent', () => {
    writeSettings({ agents: { a: { name: 'A', provider: 'claude', model: 'sonnet', cwd: '/tmp' }, b: { name: 'B', provider: 'claude', model: 'opus', cwd: '/tmp' } } });
    clearConfigCache();
    removeAgent('a');
    clearConfigCache();
    const s = getSettings();
    expect(s.agents).not.toHaveProperty('a');
    expect(s.agents).toHaveProperty('b');
  });

  it('updateTeam adds or replaces a team', () => {
    writeSettings({ agents: { a: { name: 'A', provider: 'claude', model: 'sonnet', cwd: '/tmp' } } });
    clearConfigCache();
    updateTeam('t1', { name: 'Team One', agents: ['a'], leader: 'a' });
    clearConfigCache();
    const teams = getSettings().teams;
    expect(teams?.['t1']?.name).toBe('Team One');
  });

  it('removeTeam removes a team', () => {
    writeSettings({ agents: { a: { name: 'A', provider: 'claude', model: 'sonnet', cwd: '/tmp' } }, teams: { t1: { name: 'T1', agents: ['a'], leader: 'a' } } });
    clearConfigCache();
    removeTeam('t1');
    clearConfigCache();
    expect(getSettings().teams).not.toHaveProperty('t1');
  });
});
