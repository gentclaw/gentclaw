import { describe, it, expect } from 'vitest';
import { splitMessage, stripAnsi, elapsedSec } from '../../src/lib/text.js';

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
