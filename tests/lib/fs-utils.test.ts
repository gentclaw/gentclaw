import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { atomicWriteText, atomicWriteJson, appendJsonlWithTs } from '../../src/lib/fs-utils.js';

const testDir = join(tmpdir(), `gentclaw-fs-test-${randomBytes(4).toString('hex')}`);

describe('fs-utils', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('atomicWriteText', () => {
    it('writes text to file', () => {
      const p = join(testDir, 'test.txt');
      atomicWriteText(p, 'hello');
      expect(readFileSync(p, 'utf-8')).toBe('hello');
    });

    it('creates parent directories', () => {
      const p = join(testDir, 'nested', 'deep', 'test.txt');
      atomicWriteText(p, 'deep');
      expect(readFileSync(p, 'utf-8')).toBe('deep');
    });

    it('overwrites existing file atomically', () => {
      const p = join(testDir, 'overwrite.txt');
      atomicWriteText(p, 'first');
      atomicWriteText(p, 'second');
      expect(readFileSync(p, 'utf-8')).toBe('second');
    });

    it('leaves no tmp files on success', () => {
      const p = join(testDir, 'clean.txt');
      atomicWriteText(p, 'data');
      const files = require('node:fs').readdirSync(testDir) as string[];
      const tmpFiles = files.filter((f: string) => f.startsWith('.tmp-'));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  describe('atomicWriteJson', () => {
    it('writes JSON with trailing newline', () => {
      const p = join(testDir, 'data.json');
      atomicWriteJson(p, { key: 'value' });
      const raw = readFileSync(p, 'utf-8');
      expect(raw.endsWith('\n')).toBe(true);
      expect(JSON.parse(raw)).toEqual({ key: 'value' });
    });

    it('pretty-prints with 2-space indent', () => {
      const p = join(testDir, 'pretty.json');
      atomicWriteJson(p, { a: 1 });
      const raw = readFileSync(p, 'utf-8');
      expect(raw).toBe('{\n  "a": 1\n}\n');
    });
  });

  describe('appendJsonlWithTs', () => {
    it('appends timestamped JSONL record', () => {
      const p = join(testDir, 'log.jsonl');
      appendJsonlWithTs(p, { action: 'test' });
      const raw = readFileSync(p, 'utf-8').trim();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed.action).toBe('test');
      expect(typeof parsed.ts).toBe('number');
    });

    it('appends multiple records as separate lines', () => {
      const p = join(testDir, 'multi.jsonl');
      appendJsonlWithTs(p, { n: 1 });
      appendJsonlWithTs(p, { n: 2 });
      const lines = readFileSync(p, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('creates parent directories if missing', () => {
      const p = join(testDir, 'sub', 'dir', 'log.jsonl');
      appendJsonlWithTs(p, { ok: true });
      expect(existsSync(p)).toBe(true);
    });
  });
});
