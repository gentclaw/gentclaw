import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const testHome = join(tmpdir(), `gentclaw-session-test-${randomBytes(4).toString('hex')}`);
process.env['GENTCLAW_HOME'] = testHome;

const {
  getSessionAgent, setSessionAgent, getCliSessionId, setCliSessionId,
  deleteSession, stopFlagPath, clearStopFlag, maybeCleanupSessions,
} = await import('../../src/lib/sessions.js');
const { ensureDirectories } = await import('../../src/lib/fs-utils.js');
const { PATHS } = await import('../../src/lib/paths.js');

describe('sessions', () => {
  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    ensureDirectories();
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
  });

  it('returns undefined for unknown session', () => {
    expect(getSessionAgent('nonexistent')).toBeUndefined();
  });

  it('sets and reads sticky agent', () => {
    setSessionAgent('chan-123', 'coder', 'claude', 'sonnet');
    expect(getSessionAgent('chan-123')).toBe('coder');
  });

  it('updates existing session agent', () => {
    setSessionAgent('chan-123', 'coder', 'claude', 'sonnet');
    setSessionAgent('chan-123', 'writer', 'gemini', 'flash');
    expect(getSessionAgent('chan-123')).toBe('writer');
  });

  it('sets and reads CLI session ID', () => {
    setCliSessionId('chan-456', 'uuid-abc');
    expect(getCliSessionId('chan-456')).toBe('uuid-abc');
  });

  it('creates stub session when setting CLI session ID without existing session', () => {
    setCliSessionId('new-key', 'session-id');
    expect(getCliSessionId('new-key')).toBe('session-id');
    expect(getSessionAgent('new-key')).toBe(''); // stub has empty agentId
  });

  it('deletes session', () => {
    setSessionAgent('del-me', 'coder', 'claude', 'sonnet');
    deleteSession('del-me');
    expect(getSessionAgent('del-me')).toBeUndefined();
  });

  it('delete is no-op for nonexistent session', () => {
    expect(() => deleteSession('ghost')).not.toThrow();
  });

  it('sanitizes session key in file path', () => {
    setSessionAgent('chan:with/special', 'coder', 'claude', 'sonnet');
    expect(getSessionAgent('chan:with/special')).toBe('coder');
  });

  it('rejects corrupt session files gracefully', () => {
    const sessionFile = join(PATHS.sessions, 'corrupt.json');
    writeFileSync(sessionFile, '{"not":"a session"}', 'utf-8');
    expect(getSessionAgent('corrupt')).toBeUndefined();
  });
});

describe('stop flag', () => {
  beforeEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    ensureDirectories();
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
  });

  it('returns false when no flag exists', () => {
    expect(clearStopFlag(stopFlagPath('nonexistent'))).toBe(false);
  });

  it('clears existing stop flag and returns true', () => {
    const flagFile = stopFlagPath('test-key');
    mkdirSync(join(testHome, 'flags'), { recursive: true });
    writeFileSync(flagFile, Date.now().toString(), 'utf-8');
    expect(clearStopFlag(flagFile)).toBe(true);
    // Second call should return false (already cleared)
    expect(clearStopFlag(flagFile)).toBe(false);
  });
});
