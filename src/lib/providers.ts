import type { Provider, TokenUsage } from './types.js';
import { ProviderError } from './errors.js';
import { getSettings } from './config.js';

// Built-in providers
const CLAUDE: Provider = {
  name: 'Claude Code',
  command: 'claude',
  models: {
    haiku: 'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-6',
    opus: 'claude-opus-4-6',
  },
  defaultModel: 'sonnet',
  baseArgs: ['--verbose', '--dangerously-skip-permissions'],
  modelFlag: '--model',
  promptFlag: '-p',
  systemPromptFlag: '--append-system-prompt',
  session: { startFlag: '--session-id', resumeFlag: '--session-id' },
  output: 'jsonl',
  jsonlExtract: { type: 'assistant', textField: 'content' },
  tmux: true,
};

const GEMINI: Provider = {
  name: 'Gemini CLI',
  command: 'gemini',
  models: {
    flash: 'gemini-2.5-flash',
    pro: 'gemini-2.5-pro',
  },
  defaultModel: 'flash',
  baseArgs: ['--output-format', 'json'],
  modelFlag: '-m',
  promptFlag: '--prompt',
  session: { resumeFlag: '--resume', captureIdField: 'session_id' },
  output: 'json',
  jsonExtract: 'response',
};

const registry = new Map<string, Provider>([['claude', CLAUDE], ['gemini', GEMINI]]);

export function registerProvider(id: string, def: Provider): void {
  registry.set(id, def);
}

export function getProvider(id: string): Provider {
  // Check dynamic registry first, then settings
  const def = registry.get(id);
  if (def) return def;
  const custom = getSettings().providers?.[id];
  if (custom) return custom;
  throw new ProviderError(`Unknown provider: ${id}`);
}

export function listProviders(): string[] {
  const custom = Object.keys(getSettings().providers ?? {});
  return [...new Set([...registry.keys(), ...custom])];
}

type BuildOpts = {
  model?: string;
  prompt?: string;
  sessionId?: string;
  isResume?: boolean;
  systemPrompt?: string;
  extraArgs?: string[];
};

/** Build CLI arguments from declarative provider config. */
export function buildProviderArgs(def: Provider, opts: BuildOpts): string[] {
  const args = [...def.baseArgs];

  // Model
  if (opts.model && def.modelFlag) {
    const resolved = def.models[opts.model] ?? opts.model;
    args.push(def.modelFlag, resolved);
  }

  // Session — startFlag is optional (Gemini auto-creates sessions)
  if (opts.sessionId && def.session) {
    const flag = opts.isResume ? def.session.resumeFlag : def.session.startFlag;
    if (flag) args.push(flag, opts.sessionId);
  }

  // System prompt
  if (opts.systemPrompt && def.systemPromptFlag) {
    args.push(def.systemPromptFlag, opts.systemPrompt);
  }

  // Prompt
  if (opts.prompt) {
    if (def.promptFlag) {
      args.push(def.promptFlag, opts.prompt);
    } else {
      args.push(opts.prompt);
    }
  }

  if (opts.extraArgs) args.push(...opts.extraArgs);

  return args;
}

/** Extract a nested field via dot-path (e.g. 'response.text'). */
export function getNestedField(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Parse raw CLI output based on provider output format. */
export function parseProviderOutput(def: Provider, raw: string): string {
  if (def.output === 'json' && def.jsonExtract) {
    try {
      const obj: unknown = JSON.parse(raw);
      const val = getNestedField(obj, def.jsonExtract);
      if (typeof val === 'string') return val.trim();
    } catch { /* fall through to raw */ }
    return raw.trim();
  }

  if (def.output !== 'jsonl' || !def.jsonlExtract) return raw.trim();

  const lines = raw.split('\n').filter(Boolean);
  const parts: string[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj['type'] === def.jsonlExtract.type) {
        const content = obj[def.jsonlExtract.textField];
        if (typeof content === 'string') parts.push(content);
      }
    } catch {
      // Not JSON — include as raw text
      parts.push(line);
    }
  }

  return parts.join('').trim() || raw.trim();
}

/** Extract token usage from raw CLI output based on provider format. Returns undefined if unavailable. */
export function extractUsage(def: Provider, raw: string): TokenUsage | undefined {
  if (def.output === 'jsonl') return extractJsonlUsage(raw);
  if (def.output === 'json') return extractJsonUsage(raw);
  return undefined;
}

/** Claude JSONL: find {"type":"result",...,"usage":{"input_tokens":N,"output_tokens":N}} */
function extractJsonlUsage(raw: string): TokenUsage | undefined {
  const lines = raw.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj['type'] === 'result' && obj['usage']) {
        const u = obj['usage'] as Record<string, unknown>;
        const input = typeof u['input_tokens'] === 'number' ? u['input_tokens'] : undefined;
        const output = typeof u['output_tokens'] === 'number' ? u['output_tokens'] : undefined;
        if (input !== undefined && output !== undefined) return { input, output };
      }
    } catch { /* skip non-JSON lines */ }
  }
  return undefined;
}

/** Pick first numeric field found by name from an object (camelCase/snake_case fallback) */
function pickNumericField(obj: Record<string, unknown>, ...names: string[]): number | undefined {
  for (const n of names) {
    if (typeof obj[n] === 'number') return obj[n];
  }
  return undefined;
}

/** Gemini JSON: look for usageMetadata.promptTokenCount / candidatesTokenCount */
function extractJsonUsage(raw: string): TokenUsage | undefined {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const meta = (obj['usageMetadata'] ?? obj['usage_metadata']) as Record<string, unknown> | undefined;
    if (!meta) return undefined;
    const input = pickNumericField(meta, 'promptTokenCount', 'prompt_token_count');
    const output = pickNumericField(meta, 'candidatesTokenCount', 'candidates_token_count');
    if (input !== undefined && output !== undefined) return { input, output };
  } catch { /* not JSON */ }
  return undefined;
}
