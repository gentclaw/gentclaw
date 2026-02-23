import { describe, it, expect, beforeEach } from 'vitest';
import { getProvider, buildProviderArgs, parseProviderOutput, extractUsage, registerProvider, getNestedField } from '../../src/lib/providers.js';
import type { Provider } from '../../src/lib/types.js';

describe('providers', () => {
  it('has built-in claude provider', () => {
    const claude = getProvider('claude');
    expect(claude.name).toBe('Claude Code');
    expect(claude.command).toBe('claude');
    expect(claude.models['sonnet']).toBeDefined();
  });

  it('has built-in gemini provider', () => {
    const gemini = getProvider('gemini');
    expect(gemini.name).toBe('Gemini CLI');
    expect(gemini.command).toBe('gemini');
    expect(gemini.models['flash']).toBeDefined();
    expect(gemini.models['pro']).toBeDefined();
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

  it('skips session args when startFlag is undefined (gemini-style)', () => {
    const noStart: Provider = {
      ...def,
      session: { resumeFlag: '--resume', captureIdField: 'session_id' },
    };
    const args = buildProviderArgs(noStart, { sessionId: 'abc', isResume: false });
    expect(args).not.toContain('abc');
  });

  it('uses resumeFlag even when startFlag is undefined', () => {
    const noStart: Provider = {
      ...def,
      session: { resumeFlag: '--resume', captureIdField: 'session_id' },
    };
    const args = buildProviderArgs(noStart, { sessionId: 'abc', isResume: true });
    expect(args).toContain('--resume');
    expect(args).toContain('abc');
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

  it('extracts JSON content via dot-path', () => {
    const def: Provider = {
      name: 'T', command: 't', models: {}, defaultModel: '', baseArgs: [],
      output: 'json',
      jsonExtract: 'response',
    };
    const raw = JSON.stringify({ response: 'Hello from Gemini', session_id: 's1' });
    expect(parseProviderOutput(def, raw)).toBe('Hello from Gemini');
  });

  it('falls back to raw text if JSON parse fails', () => {
    const def: Provider = {
      name: 'T', command: 't', models: {}, defaultModel: '', baseArgs: [],
      output: 'json',
      jsonExtract: 'response.text',
    };
    expect(parseProviderOutput(def, 'not json')).toBe('not json');
  });

  it('falls back to raw text if dot-path yields non-string', () => {
    const def: Provider = {
      name: 'T', command: 't', models: {}, defaultModel: '', baseArgs: [],
      output: 'json',
      jsonExtract: 'response.missing',
    };
    const raw = JSON.stringify({ response: { text: 'hi' } });
    expect(parseProviderOutput(def, raw)).toBe(raw.trim());
  });
});

describe('extractUsage', () => {
  it('extracts tokens from Claude JSONL result line', () => {
    const def: Provider = {
      name: 'T', command: 't', models: {}, defaultModel: '', baseArgs: [],
      output: 'jsonl', jsonlExtract: { type: 'assistant', textField: 'content' },
    };
    const raw = [
      '{"type":"assistant","content":"Hello"}',
      '{"type":"result","usage":{"input_tokens":150,"output_tokens":42}}',
    ].join('\n');
    expect(extractUsage(def, raw)).toEqual({ input: 150, output: 42 });
  });

  it('returns undefined when no result line in JSONL', () => {
    const def: Provider = {
      name: 'T', command: 't', models: {}, defaultModel: '', baseArgs: [],
      output: 'jsonl', jsonlExtract: { type: 'assistant', textField: 'content' },
    };
    const raw = '{"type":"assistant","content":"Hello"}';
    expect(extractUsage(def, raw)).toBeUndefined();
  });

  it('extracts tokens from Gemini JSON usageMetadata', () => {
    const def: Provider = {
      name: 'T', command: 't', models: {}, defaultModel: '', baseArgs: [],
      output: 'json', jsonExtract: 'response',
    };
    const raw = JSON.stringify({
      response: 'Hello',
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 80 },
    });
    expect(extractUsage(def, raw)).toEqual({ input: 200, output: 80 });
  });

  it('handles snake_case Gemini usage fields', () => {
    const def: Provider = {
      name: 'T', command: 't', models: {}, defaultModel: '', baseArgs: [],
      output: 'json', jsonExtract: 'response',
    };
    const raw = JSON.stringify({
      response: 'Hi',
      usage_metadata: { prompt_token_count: 100, candidates_token_count: 50 },
    });
    expect(extractUsage(def, raw)).toEqual({ input: 100, output: 50 });
  });

  it('returns undefined for text output format', () => {
    const def: Provider = {
      name: 'T', command: 't', models: {}, defaultModel: '', baseArgs: [],
      output: 'text',
    };
    expect(extractUsage(def, 'hello')).toBeUndefined();
  });

  it('returns undefined for JSON without usage metadata', () => {
    const def: Provider = {
      name: 'T', command: 't', models: {}, defaultModel: '', baseArgs: [],
      output: 'json', jsonExtract: 'response',
    };
    const raw = JSON.stringify({ response: 'Hello' });
    expect(extractUsage(def, raw)).toBeUndefined();
  });
});

describe('getNestedField', () => {
  it('extracts nested values', () => {
    expect(getNestedField({ a: { b: { c: 'deep' } } }, 'a.b.c')).toBe('deep');
  });

  it('returns undefined for missing paths', () => {
    expect(getNestedField({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(getNestedField(null, 'a')).toBeUndefined();
  });

  it('extracts top-level values', () => {
    expect(getNestedField({ session_id: 's1' }, 'session_id')).toBe('s1');
  });
});
