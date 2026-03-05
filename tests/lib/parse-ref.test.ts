import { describe, it, expect } from 'vitest';
import { parseRef, parseSafeId, parseSubcommand } from '../../src/lib/text.js';

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

describe('parseSubcommand', () => {
  it('splits into sub and subArgs', () => {
    expect(parseSubcommand('add foo bar')).toEqual({ sub: 'add', subArgs: 'foo bar' });
  });

  it('lowercases the subcommand', () => {
    expect(parseSubcommand('SHOW details')).toEqual({ sub: 'show', subArgs: 'details' });
  });

  it('returns empty strings for empty input', () => {
    expect(parseSubcommand('')).toEqual({ sub: '', subArgs: '' });
  });

  it('handles subcommand with no args', () => {
    expect(parseSubcommand('list')).toEqual({ sub: 'list', subArgs: '' });
  });

  it('trims leading/trailing whitespace', () => {
    expect(parseSubcommand('  remove  foo  ')).toEqual({ sub: 'remove', subArgs: 'foo' });
  });
});
