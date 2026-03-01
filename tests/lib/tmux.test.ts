import { describe, it, expect } from 'vitest';
import { shellEscape } from '../../src/lib/tmux.js';

describe('shellEscape', () => {
  it('wraps simple strings in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'");
  });

  it('escapes single quotes', () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it('handles empty string', () => {
    expect(shellEscape('')).toBe("''");
  });

  it('handles strings with spaces', () => {
    expect(shellEscape('hello world')).toBe("'hello world'");
  });

  it('handles strings with special shell characters', () => {
    expect(shellEscape('$HOME && rm -rf /')).toBe("'$HOME && rm -rf /'");
  });

  it('handles strings with newlines', () => {
    expect(shellEscape('line1\nline2')).toBe("'line1\nline2'");
  });

  it('handles strings with backticks', () => {
    expect(shellEscape('`whoami`')).toBe("'`whoami`'");
  });

  it('handles multiple single quotes', () => {
    expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  it('handles strings with double quotes', () => {
    expect(shellEscape('"quoted"')).toBe("'\"quoted\"'");
  });

  it('preserves unicode characters', () => {
    expect(shellEscape('héllo 🌍')).toBe("'héllo 🌍'");
  });
});
