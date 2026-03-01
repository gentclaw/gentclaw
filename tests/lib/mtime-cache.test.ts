import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createMtimeCache } from '../../src/lib/mtime-cache.js';

const testDir = join(tmpdir(), `gentclaw-mtime-test-${randomBytes(4).toString('hex')}`);
const testFile = join(testDir, 'data.json');

describe('createMtimeCache', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testFile, '{"v":1}', 'utf-8');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns cached value on same mtime', () => {
    let calls = 0;
    const cache = createMtimeCache(testFile, () => { calls++; return JSON.parse('{"v":1}'); });
    cache.get();
    cache.get();
    expect(calls).toBe(1);
  });

  it('reloads on mtime change', async () => {
    let calls = 0;
    const cache = createMtimeCache(testFile, () => { calls++; return 'loaded'; });
    cache.get();
    // Wait 10ms then touch file to ensure mtime differs
    await new Promise(r => setTimeout(r, 10));
    writeFileSync(testFile, '{"v":2}', 'utf-8');
    cache.get();
    expect(calls).toBe(2);
  });

  it('clear forces reload', () => {
    let calls = 0;
    const cache = createMtimeCache(testFile, () => { calls++; return 'val'; });
    cache.get();
    cache.clear();
    cache.get();
    expect(calls).toBe(2);
  });

  it('throws when file missing', () => {
    const cache = createMtimeCache(join(testDir, 'missing.json'), () => 'x');
    expect(() => cache.get()).toThrow();
  });

  it('accepts path as function', () => {
    const cache = createMtimeCache(() => testFile, () => 'dynamic');
    expect(cache.get()).toBe('dynamic');
  });
});
