import { describe, it, expect, beforeEach } from 'vitest';
import { getProvider, buildProviderArgs, parseProviderOutput, registerProvider } from '../../src/lib/providers.js';
import type { Provider } from '../../src/lib/types.js';

describe('providers', () => {
  it('has built-in claude provider', () => {
    const claude = getProvider('claude');
    expect(claude.name).toBe('Claude Code');
    expect(claude.command).toBe('claude');
    expect(claude.models['sonnet']).toBeDefined();
  });

  it('throws for unknown provider', () => {
    expect(() => getProvider('nonexistent')).toThrow('Unknown provider');
  });

  it('allows registering custom providers', () => {
    const custom: Provider = {
      name: 'Test',
      command: 'test-cli',
      models: { fast: 'test-fast' },
      defaultModel: 'fast',
      baseArgs: [],
    };
    registerProvider('test', custom);
    expect(getProvider('test').name).toBe('Test');
  });
});

describe('buildProviderArgs', () => {
  const def: Provider = {
    name: 'Test',
    command: 'test',
    models: { small: 'test-small-v1', large: 'test-large-v1' },
    defaultModel: 'small',
    baseArgs: ['--verbose'],
    modelFlag: '--model',
    promptFlag: '-p',
    session: { startFlag: '--session', resumeFlag: '--resume' },
  };

  it('includes base args', () => {
    const args = buildProviderArgs(def, {});
    expect(args).toContain('--verbose');
  });

  it('resolves model aliases', () => {
    const args = buildProviderArgs(def, { model: 'small' });
    expect(args).toContain('--model');
    expect(args).toContain('test-small-v1');
  });

  it('passes through unknown model names', () => {
    const args = buildProviderArgs(def, { model: 'custom-model-id' });
    expect(args).toContain('custom-model-id');
  });

  it('uses startFlag for new sessions', () => {
    const args = buildProviderArgs(def, { sessionId: 'abc', isResume: false });
    expect(args).toContain('--session');
    expect(args).toContain('abc');
  });

  it('uses resumeFlag for resumed sessions', () => {
    const args = buildProviderArgs(def, { sessionId: 'abc', isResume: true });
    expect(args).toContain('--resume');
  });

  it('adds prompt with flag', () => {
    const args = buildProviderArgs(def, { prompt: 'hello' });
    expect(args).toContain('-p');
    expect(args).toContain('hello');
  });

  it('adds prompt positionally when no flag', () => {
    const noflag: Provider = { ...def, promptFlag: undefined };
    const args = buildProviderArgs(noflag, { prompt: 'hello' });
    expect(args).toContain('hello');
    expect(args).not.toContain('-p');
  });

  it('adds system prompt with flag', () => {
    const withSys: Provider = { ...def, systemPromptFlag: '--append-system-prompt' };
    const args = buildProviderArgs(withSys, { systemPrompt: 'Be concise' });
    expect(args).toContain('--append-system-prompt');
    expect(args).toContain('Be concise');
  });
});

describe('parseProviderOutput', () => {
  it('returns trimmed text for text output', () => {
    const def: Provider = {
      name: 'T', command: 't', models: {}, defaultModel: '', baseArgs: [],
      output: 'text',
    };
    expect(parseProviderOutput(def, '  hello world  ')).toBe('hello world');
  });

  it('extracts JSONL content', () => {
    const def: Provider = {
      name: 'T', command: 't', models: {}, defaultModel: '', baseArgs: [],
      output: 'jsonl',
      jsonlExtract: { type: 'assistant', textField: 'content' },
    };
    const raw = [
      '{"type":"system","content":"ignore"}',
      '{"type":"assistant","content":"Hello "}',
      '{"type":"assistant","content":"world"}',
    ].join('\n');
    expect(parseProviderOutput(def, raw)).toBe('Hello world');
  });

  it('falls back to raw text if no matching JSONL', () => {
    const def: Provider = {
      name: 'T', command: 't', models: {}, defaultModel: '', baseArgs: [],
      output: 'jsonl',
      jsonlExtract: { type: 'assistant', textField: 'content' },
    };
    expect(parseProviderOutput(def, 'plain text')).toBe('plain text');
  });
});
