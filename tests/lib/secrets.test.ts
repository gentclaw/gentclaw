import { describe, it, expect } from 'vitest';
import { redactSecrets, SECRET_PATTERNS } from '../../src/lib/secrets.js';

describe('redactSecrets', () => {
  it('redacts Slack bot tokens', () => {
    expect(redactSecrets('token xoxb-123-abc-def here')).toBe('token [REDACTED] here');
  });

  it('redacts Slack app tokens', () => {
    expect(redactSecrets('xapp-1-A0B1C2D3E4-abc123')).toBe('[REDACTED]');
  });

  it('redacts OpenAI/Anthropic keys', () => {
    expect(redactSecrets('sk-' + 'a'.repeat(40))).toBe('[REDACTED]');
  });

  it('redacts GitHub PATs', () => {
    expect(redactSecrets('ghp_' + 'A'.repeat(36))).toBe('[REDACTED]');
  });

  it('redacts Google API keys', () => {
    expect(redactSecrets('AIza' + 'X'.repeat(35))).toBe('[REDACTED]');
  });

  it('returns unchanged text when no secrets', () => {
    const clean = 'just a normal message';
    expect(redactSecrets(clean)).toBe(clean);
  });

  it('handles multiple secrets in one string', () => {
    const input = `bot: xoxb-123-abc app: xapp-1-A0B1C2D3E4-abc123`;
    const result = redactSecrets(input);
    expect(result).not.toContain('xoxb');
    expect(result).not.toContain('xapp');
  });

  it('is safe to call repeatedly (global regex lastIndex reset)', () => {
    const input = 'sk-' + 'a'.repeat(40);
    expect(redactSecrets(input)).toBe('[REDACTED]');
    expect(redactSecrets(input)).toBe('[REDACTED]');
  });
});

describe('SECRET_PATTERNS', () => {
  it('exports an array of regex source strings', () => {
    expect(SECRET_PATTERNS).toBeInstanceOf(Array);
    for (const pat of SECRET_PATTERNS) {
      expect(typeof pat).toBe('string');
      expect(() => new RegExp(pat)).not.toThrow();
    }
  });
});
