import { describe, it, expect } from 'vitest';
import { xmlEscape, systemdEnvValue, safeUserName, resolveNodeBin } from '../../src/lib/service.js';

// ─── xmlEscape ───────────────────────────────────────────────────

describe('xmlEscape', () => {
  it('escapes the five XML entities', () => {
    expect(xmlEscape('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('escapes ampersand in PATH (common case)', () => {
    /** A PATH like /opt/with&amp/bin must produce a valid plist — unescaped `&` would corrupt XML parsing. */
    const path = '/usr/bin:/opt/A&B/bin';
    expect(xmlEscape(path)).toBe('/usr/bin:/opt/A&amp;B/bin');
  });

  it('escapes ampersand before angle brackets to avoid double-encoding', () => {
    /** Order matters — replacing `&` first prevents `&lt;` from becoming `&amp;lt;`. */
    expect(xmlEscape('<&>')).toBe('&lt;&amp;&gt;');
  });

  it('passes plain strings through unchanged', () => {
    expect(xmlEscape('/Users/al/projects/gent')).toBe('/Users/al/projects/gent');
  });

  it('handles empty string', () => {
    expect(xmlEscape('')).toBe('');
  });
});

// ─── systemdEnvValue ─────────────────────────────────────────────

describe('systemdEnvValue', () => {
  it('strips LF and CR', () => {
    expect(systemdEnvValue('a\nb\rc\r\nd')).toBe('abcd');
  });

  it('preserves other whitespace', () => {
    expect(systemdEnvValue('  a b  ')).toBe('  a b  ');
  });

  it('passes plain values through', () => {
    expect(systemdEnvValue('/usr/bin')).toBe('/usr/bin');
  });

  it('handles empty string', () => {
    expect(systemdEnvValue('')).toBe('');
  });
});

// ─── safeUserName ────────────────────────────────────────────────

describe('safeUserName', () => {
  it('accepts ascii letters, digits, underscore, dot, dash', () => {
    expect(safeUserName('al')).toBe('al');
    expect(safeUserName('user_1')).toBe('user_1');
    expect(safeUserName('first.last')).toBe('first.last');
    expect(safeUserName('a-b')).toBe('a-b');
  });

  it('rejects shell metacharacters', () => {
    expect(safeUserName('foo;rm')).toBeNull();
    expect(safeUserName('foo bar')).toBeNull();
    expect(safeUserName('$(whoami)')).toBeNull();
    expect(safeUserName('a|b')).toBeNull();
    expect(safeUserName('a`b')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(safeUserName('')).toBeNull();
  });

  it('rejects unicode/special chars', () => {
    expect(safeUserName('user\n')).toBeNull();
    expect(safeUserName('üser')).toBeNull();
  });
});

// ─── resolveNodeBin ──────────────────────────────────────────────

describe('resolveNodeBin', () => {
  it('returns execPath unchanged for non-Cellar paths', () => {
    expect(resolveNodeBin('/usr/local/bin/node')).toBe('/usr/local/bin/node');
    expect(resolveNodeBin('/opt/homebrew/bin/node')).toBe('/opt/homebrew/bin/node');
    expect(resolveNodeBin('/usr/bin/node')).toBe('/usr/bin/node');
  });

  it('returns Cellar path unchanged when symlink target does not match', () => {
    /** /opt/homebrew/bin/node may not exist (Linux, non-homebrew darwin) — falls back to execPath. */
    expect(resolveNodeBin('/usr/local/Cellar/node/24.0/bin/node')).toBe('/usr/local/Cellar/node/24.0/bin/node');
  });
});
