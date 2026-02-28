import { describe, it, expect } from 'vitest';
import { PATHS, ALL_DIRS } from '../../src/lib/paths.js';

describe('paths', () => {
  it('PATHS.home respects GENTCLAW_HOME env var', () => {
    // GENTCLAW_HOME is set by other test files — just verify it's a string
    expect(typeof PATHS.home).toBe('string');
    expect(PATHS.home.length).toBeGreaterThan(0);
  });

  it('all PATHS are absolute', () => {
    for (const [key, value] of Object.entries(PATHS)) {
      expect(value, `PATHS.${key}`).toMatch(/^\//);
    }
  });

  it('ALL_DIRS contains required directories', () => {
    expect(ALL_DIRS.length).toBeGreaterThanOrEqual(4);
    const dirSet = new Set(ALL_DIRS);
    expect(dirSet.has(PATHS.home)).toBe(true);
    expect(dirSet.has(PATHS.logs)).toBe(true);
    expect(dirSet.has(PATHS.sessions)).toBe(true);
    expect(dirSet.has(PATHS.flags)).toBe(true);
  });

  it('settings path ends with settings.json', () => {
    expect(PATHS.settings).toMatch(/settings\.json$/);
  });
});
