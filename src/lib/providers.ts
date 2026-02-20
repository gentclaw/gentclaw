import type { Provider } from './types.js';
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
  baseArgs: ['--verbose'],
  modelFlag: '--model',
  promptFlag: '-p',
  systemPromptFlag: '--append-system-prompt',
  session: { startFlag: '--session-id', resumeFlag: '--session-id' },
  output: 'jsonl',
  jsonlExtract: { type: 'assistant', textField: 'content' },
};

const registry = new Map<string, Provider>([['claude', CLAUDE]]);

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

  // Session
  if (opts.sessionId && def.session) {
    const flag = opts.isResume ? def.session.resumeFlag : def.session.startFlag;
    args.push(flag, opts.sessionId);
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

/** Parse raw CLI output based on provider output format. */
export function parseProviderOutput(def: Provider, raw: string): string {
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
