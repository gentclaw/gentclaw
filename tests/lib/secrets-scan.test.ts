import { describe, it, expect } from 'vitest';
import { secretsScan } from '../../src/lib/builtins/secrets-scan.js';
import type { InboundMsg } from '../../src/lib/types.js';

function makeMsg(message: string): InboundMsg {
  return { sender: 'user1', message, timestamp: Date.now(), messageId: 'm1' };
}

const REDACTED = '[REDACTED]';

describe('secretsScan', () => {
  it('allows clean text', () => {
    expect(secretsScan(makeMsg('hello world')).action).toBe('allow');
    expect(secretsScan(makeMsg('sk-short')).action).toBe('allow'); // too short for key pattern
  });

  it('redacts Slack bot token', () => {
    const result = secretsScan(makeMsg('token: xoxb-123-456-abc'));
    expect(result.action).toBe('transform');
    if (result.action === 'transform') {
      expect(result.message).toBe(`token: ${REDACTED}`);
      expect(result.message).not.toContain('xoxb-');
    }
  });

  it('redacts Slack app token', () => {
    const result = secretsScan(makeMsg('xapp-1-ABC123-def456'));
    expect(result.action).toBe('transform');
    if (result.action === 'transform') {
      expect(result.message).not.toContain('xapp-');
    }
  });

  it('redacts OpenAI/Anthropic API key', () => {
    const key = 'sk-' + 'a'.repeat(48);
    const result = secretsScan(makeMsg(`key=${key}`));
    expect(result.action).toBe('transform');
    if (result.action === 'transform') {
      expect(result.message).toBe(`key=${REDACTED}`);
    }
  });

  it('redacts GitHub personal access token', () => {
    const token = 'ghp_' + 'A'.repeat(36);
    const result = secretsScan(makeMsg(token));
    expect(result.action).toBe('transform');
    if (result.action === 'transform') {
      expect(result.message).toBe(REDACTED);
    }
  });

  it('redacts GitHub OAuth token', () => {
    const token = 'gho_' + 'B'.repeat(36);
    const result = secretsScan(makeMsg(token));
    expect(result.action).toBe('transform');
    if (result.action === 'transform') {
      expect(result.message).toBe(REDACTED);
    }
  });

  it('redacts GitLab personal access token', () => {
    const token = 'glpat-' + 'x'.repeat(20);
    const result = secretsScan(makeMsg(`gitlab: ${token}`));
    expect(result.action).toBe('transform');
    if (result.action === 'transform') {
      expect(result.message).toBe(`gitlab: ${REDACTED}`);
    }
  });

  it('redacts Google/Gemini API key', () => {
    const key = 'AIza' + 'X'.repeat(35);
    const result = secretsScan(makeMsg(key));
    expect(result.action).toBe('transform');
    if (result.action === 'transform') {
      expect(result.message).toBe(REDACTED);
    }
  });

  it('redacts multiple secrets in one message', () => {
    const slackToken = 'xoxb-123-456-abc';
    const apiKey = 'sk-' + 'z'.repeat(48);
    const result = secretsScan(makeMsg(`slack=${slackToken} openai=${apiKey}`));
    expect(result.action).toBe('transform');
    if (result.action === 'transform') {
      expect(result.message).toBe(`slack=${REDACTED} openai=${REDACTED}`);
    }
  });

  it('preserves surrounding text', () => {
    const token = 'ghp_' + 'C'.repeat(36);
    const result = secretsScan(makeMsg(`before ${token} after`));
    expect(result.action).toBe('transform');
    if (result.action === 'transform') {
      expect(result.message).toBe(`before ${REDACTED} after`);
    }
  });
});
