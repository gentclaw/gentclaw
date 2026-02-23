/** Token counts extracted from CLI provider output */
export type TokenUsage = {
  input: number;
  output: number;
};

// Provider — declarative CLI backend definition (serializable, no functions)
export type Provider = {
  name: string;
  command: string;
  models: Record<string, string>; // alias → canonical ID
  defaultModel: string;
  baseArgs: string[];
  modelFlag?: string; // e.g. '--model'
  promptFlag?: string; // e.g. '-p' (omit = positional)
  systemPromptFlag?: string; // e.g. '--append-system-prompt'
  session?: { startFlag?: string; resumeFlag: string; captureIdField?: string };
  output?: 'text' | 'jsonl' | 'json';
  jsonlExtract?: { type: string; textField: string };
  jsonExtract?: string; // dot-path to text field in JSON output (e.g. 'response.text')
  /** Run CLI in a tmux pane instead of direct spawn — visible via `tmux attach -t gentclaw` */
  tmux?: boolean;
};

// Agent
export type Agent = {
  name: string;
  provider: string;
  model: string;
  cwd: string;
  systemPrompt?: string;
  heartbeat?: {
    enabled: boolean;
    intervalMinutes?: number; // default: 60
    prompt?: string; // inline heartbeat prompt; falls back to HEARTBEAT_FALLBACK_PROMPT
  };
};

// Custom command — user-defined slash command that routes a prompt to an agent
export type CustomCommand = {
  description: string;
  prompt: string; // $ARGUMENTS replaced with user input
  agent?: string; // optional agent routing
};

// Settings
export type Settings = {
  channels?: {
    slack?: { botToken?: string; appToken?: string };
  };
  providers?: Record<string, Provider>;
  agents?: Record<string, Agent>;
  defaultAgent?: string;
  allowedSenders?: string[];
  bash?: { allowlist?: string[] };
  devMode?: boolean;
  logging?: { verbose?: boolean };
  hooks?: Partial<Record<HookEvent, HookDef[]>>;
  commands?: Record<string, CustomCommand>;
};

/** Message source channel */
export type MsgChannel = 'slack' | 'heartbeat';

// Message pipeline
export type InboundMsg = {
  sender: string;
  message: string;
  timestamp: number;
  messageId: string;
  sessionKey?: string;
  agent?: string; // pre-routed agent ID
  channel?: MsgChannel;
};

// Hooks
export type HookEvent = 'preMessage' | 'postMessage';

export type HookAction =
  | { action: 'allow' }
  | { action: 'block'; reason: string }
  | { action: 'transform'; message: string };

export type HookDef = {
  name: string;
  builtin?: string;
  command?: string;
  timeout?: number;
  config?: Record<string, unknown>;
};

// Session
export type Session = {
  sessionKey: string;
  agentId: string;
  provider: string;
  model: string;
  createdAt: number;
  lastAccessAt: number;
  cliSessionId?: string;
};
