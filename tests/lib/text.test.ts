import { describe, it, expect } from 'vitest';
import { splitMessage, stripAnsi, elapsedSec, formatDurationSec, splitArgs, tryParseJson } from '../../src/lib/text.js';

describe('splitMessage', () => {
  it('returns single chunk for short messages', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello']);
  });

  it('splits at newlines within limit', () => {
    const text = 'line1\nline2\nline3';
    const chunks = splitMessage(text, 10);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
  });

  it('splits at spaces if no newlines', () => {
    const text = 'word1 word2 word3 word4';
    const chunks = splitMessage(text, 12);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('hard-splits if no spaces or newlines', () => {
    const text = 'a'.repeat(20);
    const chunks = splitMessage(text, 8);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('elapsedSec', () => {
  it('returns seconds elapsed since timestamp', () => {
    const fiveSecondsAgo = Date.now() - 5000;
    const result = elapsedSec(fiveSecondsAgo);
    expect(result).toBeGreaterThanOrEqual(4);
    expect(result).toBeLessThanOrEqual(6);
  });

  it('returns 0 for current timestamp', () => {
    expect(elapsedSec(Date.now())).toBe(0);
  });
});

describe('formatDurationSec', () => {
  it('formats milliseconds as rounded seconds', () => {
    expect(formatDurationSec(1500)).toBe('2s');
    expect(formatDurationSec(3000)).toBe('3s');
    expect(formatDurationSec(500)).toBe('1s');
  });

  it('returns 0s for zero', () => {
    expect(formatDurationSec(0)).toBe('0s');
  });

  it('handles large values', () => {
    expect(formatDurationSec(90_000)).toBe('90s');
  });
});

describe('stripAnsi', () => {
  it('removes ANSI escape codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('leaves plain text unchanged', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('strips non-color CSI sequences (cursor, erase)', () => {
    // Cursor up (\x1b[A), erase line (\x1b[2K), cursor position (\x1b[1;1H)
    expect(stripAnsi('\x1b[2Khello\x1b[A')).toBe('hello');
    expect(stripAnsi('\x1b[1;1Hworld')).toBe('world');
  });
});

describe('splitArgs', () => {
  it('splits on whitespace and drops empties', () => {
    expect(splitArgs('  foo   bar  baz ')).toEqual(['foo', 'bar', 'baz']);
  });

  it('returns empty array for empty/whitespace input', () => {
    expect(splitArgs('')).toEqual([]);
    expect(splitArgs('   ')).toEqual([]);
  });

  it('handles single arg', () => {
    expect(splitArgs('hello')).toEqual(['hello']);
  });

  it('handles tabs and mixed whitespace', () => {
    expect(splitArgs("a\tb\n c")).toEqual(['a', 'b', 'c']);
  });
});

describe('tryParseJson', () => {
  it('parses valid JSON', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
    expect(tryParseJson('"hello"')).toBe('hello');
    expect(tryParseJson('42')).toBe(42);
    expect(tryParseJson('[1,2]')).toEqual([1, 2]);
  });

  it('returns undefined for invalid JSON', () => {
    expect(tryParseJson('not json')).toBeUndefined();
    expect(tryParseJson('')).toBeUndefined();
    expect(tryParseJson('{broken')).toBeUndefined();
  });

  it('supports generic type parameter', () => {
    const result = tryParseJson<{ action: string }>('{"action":"allow"}');
    expect(result?.action).toBe('allow');
  });
});
