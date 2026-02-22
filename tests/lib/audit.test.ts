import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock PATHS before importing module
const mockPaths = { audit: '' };
vi.mock('../../src/lib/paths.js', () => ({ PATHS: mockPaths }));

const { auditLog } = await import('../../src/lib/audit.js');

describe('auditLog', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gent-audit-'));
    mockPaths.audit = join(tmpDir, 'logs', 'audit.jsonl');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes JSONL record with auto-timestamp', () => {
    auditLog({ action: 'cmd:reset', sender: 'U123', detail: '', status: 'allowed' });

    const lines = readFileSync(mockPaths.audit, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(record.ts).toBeTypeOf('number');
    expect(record.action).toBe('cmd:reset');
    expect(record.sender).toBe('U123');
    expect(record.status).toBe('allowed');
  });

  it('appends multiple records', () => {
    auditLog({ action: 'cmd:model', sender: 'U1', detail: 'opus', status: 'allowed' });
    auditLog({ action: 'message', sender: 'U2', detail: 'msg-1', status: 'blocked', reason: 'rate limit' });

    const lines = readFileSync(mockPaths.audit, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).reason).toBe('rate limit');
  });

  it('creates parent directory if missing', () => {
    mockPaths.audit = join(tmpDir, 'deep', 'nested', 'audit.jsonl');
    auditLog({ action: 'cmd:stop', sender: 'U1', detail: '', status: 'allowed' });

    const content = readFileSync(mockPaths.audit, 'utf-8');
    expect(content).toContain('"action":"cmd:stop"');
  });

  it('includes optional reason field', () => {
    auditLog({ action: 'message', sender: 'U1', detail: 'msg-2', status: 'blocked', reason: 'content guard' });

    const record = JSON.parse(readFileSync(mockPaths.audit, 'utf-8').trim());
    expect(record.reason).toBe('content guard');
  });

  it('never throws on fs error', () => {
    mockPaths.audit = '/nonexistent/readonly/audit.jsonl';
    expect(() => {
      auditLog({ action: 'cmd:test', sender: 'U1', detail: '', status: 'allowed' });
    }).not.toThrow();
  });
});
