import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock PATHS before importing module
const mockPaths = { invocations: '' };
vi.mock('../../src/lib/paths.js', () => ({ PATHS: mockPaths }));

const { logInvocation } = await import('../../src/lib/invocation-log.js');

describe('logInvocation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gent-inv-'));
    mockPaths.invocations = join(tmpDir, 'logs', 'invocations.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes JSONL record with auto-timestamp', () => {
    logInvocation({ agentId: 'bot', provider: 'claude', model: 'sonnet', durationMs: 1500, success: true });

    const lines = readFileSync(mockPaths.invocations, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(record.ts).toBeTypeOf('number');
    expect(record.agentId).toBe('bot');
    expect(record.provider).toBe('claude');
    expect(record.model).toBe('sonnet');
    expect(record.durationMs).toBe(1500);
    expect(record.success).toBe(true);
  });

  it('appends multiple records', () => {
    logInvocation({ agentId: 'a', provider: 'claude', model: 's', durationMs: 100, success: true });
    logInvocation({ agentId: 'b', provider: 'gemini', model: 'f', durationMs: 200, success: false, errorType: 'RunError' });

    const lines = readFileSync(mockPaths.invocations, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).errorType).toBe('RunError');
  });

  it('creates parent directory if missing', () => {
    mockPaths.invocations = join(tmpDir, 'deep', 'nested', 'inv.jsonl');
    logInvocation({ agentId: 'a', provider: 'p', model: 'm', durationMs: 0, success: true });

    const content = readFileSync(mockPaths.invocations, 'utf-8');
    expect(content).toContain('"agentId":"a"');
  });

  it('includes optional channel and sender', () => {
    logInvocation({ agentId: 'a', provider: 'p', model: 'm', durationMs: 50, success: true, channel: 'slack', sender: 'U123' });

    const record = JSON.parse(readFileSync(mockPaths.invocations, 'utf-8').trim());
    expect(record.channel).toBe('slack');
    expect(record.sender).toBe('U123');
  });

  it('includes token usage when provided', () => {
    logInvocation({
      agentId: 'a', provider: 'claude', model: 'sonnet', durationMs: 500, success: true,
      tokens: { input: 150, output: 42 },
    });

    const record = JSON.parse(readFileSync(mockPaths.invocations, 'utf-8').trim());
    expect(record.tokens).toEqual({ input: 150, output: 42 });
  });

  it('omits tokens field when not provided', () => {
    logInvocation({ agentId: 'a', provider: 'p', model: 'm', durationMs: 100, success: true });

    const record = JSON.parse(readFileSync(mockPaths.invocations, 'utf-8').trim());
    expect(record.tokens).toBeUndefined();
  });

  it('never throws on fs error', () => {
    mockPaths.invocations = '/nonexistent/readonly/inv.jsonl';
    expect(() => {
      logInvocation({ agentId: 'a', provider: 'p', model: 'm', durationMs: 0, success: false });
    }).not.toThrow();
  });
});
