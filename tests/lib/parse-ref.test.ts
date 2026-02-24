import { describe, it, expect } from 'vitest';
import { parseRef, parseSafeId } from '../../src/lib/parse-ref.js';

describe('parseRef', () => {
  it('strips @ prefix and lowercases', () => {
    expect(parseRef('@Alice')).toBe('alice');
  });

  it('lowercases without @ prefix', () => {
    expect(parseRef('BOB')).toBe('bob');
  });

  it('returns empty string for empty input', () => {
    expect(parseRef('')).toBe('');
  });

  it('only strips leading @', () => {
    expect(parseRef('@user@domain')).toBe('user@domain');
  });
});

describe('parseSafeId', () => {
  it('strips @ prefix, lowercases, and removes unsafe chars', () => {
    expect(parseSafeId('@My-Agent_1')).toBe('my-agent_1');
  });

  it('removes spaces and special chars', () => {
    expect(parseSafeId('@Hello World!')).toBe('helloworld');
  });

  it('returns empty string for all-invalid chars', () => {
    expect(parseSafeId('@!!!')).toBe('');
  });
});
