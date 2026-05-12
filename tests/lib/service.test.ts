import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { xmlEscape, systemdEnvValue, safeUserName, resolveNodeBin, writePlist, writeUnit } from '../../src/lib/service.js';

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

// ─── writePlist / writeUnit (regression: catch missing escapes at interpolation sites) ────

describe('writePlist', () => {
  let tmpHome: string;
  const originalHome = process.env['HOME'];
  const originalPath = process.env['PATH'];

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'gentclaw-svc-'));
    process.env['HOME'] = tmpHome;
  });

  afterEach(() => {
    process.env['HOME'] = originalHome;
    process.env['PATH'] = originalPath;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')('escapes & in PATH so the plist remains valid XML', () => {
    /** A PATH like /opt/A&B/bin would corrupt the plist without xmlEscape. */
    process.env['PATH'] = '/usr/bin:/opt/A&B/bin';
    const path = writePlist();
    const xml = readFileSync(path, 'utf-8');
    expect(xml).toContain('/opt/A&amp;B/bin');
    expect(xml).not.toMatch(/<string>[^<]*\/opt\/A&B\/bin/);
  });

  it.skipIf(process.platform === 'win32')('escapes <, >, ", \' anywhere a value is interpolated', () => {
    process.env['PATH'] = `<bad>"'&`;
    const xml = readFileSync(writePlist(), 'utf-8');
    expect(xml).toContain('&lt;bad&gt;&quot;&apos;&amp;');
    // No unescaped angle bracket between <string>…</string> on the PATH line
    expect(xml).not.toMatch(/<string><bad>/);
  });
});

describe('writeUnit', () => {
  let tmpHome: string;
  const originalHome = process.env['HOME'];
  const originalPath = process.env['PATH'];

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'gentclaw-svc-'));
    process.env['HOME'] = tmpHome;
  });

  afterEach(() => {
    process.env['HOME'] = originalHome;
    process.env['PATH'] = originalPath;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')('strips newlines from interpolated values', () => {
    /** A newline in PATH would inject a fake systemd directive on the next line. After scrubbing,
     *  the injected fragment must be concatenated onto Environment=PATH=, not standing alone. */
    process.env['PATH'] = '/usr/bin\nMaliciousDirective=1';
    const unit = readFileSync(writeUnit(), 'utf-8');
    // No standalone MaliciousDirective= line — it must be glued onto the PATH value.
    expect(unit.split('\n')).not.toContain('MaliciousDirective=1');
    const pathLines = unit.split('\n').filter(l => l.startsWith('Environment=PATH='));
    expect(pathLines).toHaveLength(1);
    expect(pathLines[0]).toBe('Environment=PATH=/usr/binMaliciousDirective=1');
  });

  it.skipIf(process.platform === 'win32')('produces a parseable systemd unit with required sections', () => {
    process.env['PATH'] = '/usr/bin';
    const unit = readFileSync(writeUnit(), 'utf-8');
    expect(unit).toContain('[Unit]');
    expect(unit).toContain('[Service]');
    expect(unit).toContain('[Install]');
    expect(unit).toContain('ExecStart=');
    expect(unit).toContain('WantedBy=default.target');
  });
});
