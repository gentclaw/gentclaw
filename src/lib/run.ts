import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getProvider, buildProviderArgs, parseProviderOutput, extractUsage, getNestedField } from './providers.js';
import { getAgents } from './config.js';
import { getCliSessionId, setCliSessionId, stopFlagPath } from './sessions.js';
import { RunError } from './errors.js';
import { MAX_RUN_TIMEOUT_MS, SPAWN_ENV } from './constants.js';
import type { TokenUsage } from './types.js';
import { runInTmux } from './tmux.js';
import { runCommand } from './process-runner.js';
import type { RunResult } from './process-runner.js';
import { readAgentMemory, readSharedMemory, buildMemoryPrompt } from './memory.js';
import { log } from './log.js';

const L = log('run');

type RunOpts = {
  agentId: string;
  message: string;
  sessionKey: string;
  timeout?: number;
};

export type RunAgentResult = {
  text: string;
  tokens?: TokenUsage;
};

/** Run an agent's CLI provider with the given message. */
export async function runAgent(opts: RunOpts): Promise<RunAgentResult> {
  const agents = getAgents();
  const config = agents[opts.agentId];
  if (!config) throw new RunError(`Agent not found: ${opts.agentId}`);

  const provider = getProvider(config.provider);
  const cwd = config.cwd ?? process.cwd();

  // Session management — first message creates UUID, subsequent resume
  let cliSessionId = getCliSessionId(opts.sessionKey);
  const isResume = !!cliSessionId;
  if (!cliSessionId) {
    cliSessionId = randomUUID();
    setCliSessionId(opts.sessionKey, cliSessionId);
  }

  // Inject persistent memory into system prompt (per-agent + shared)
  const agentMem = readAgentMemory(opts.agentId);
  const sharedMem = readSharedMemory();
  const systemPrompt = (agentMem || sharedMem)
    ? buildMemoryPrompt(agentMem, sharedMem, config.systemPrompt)
    : config.systemPrompt;

  const common = {
    model: config.model,
    prompt: opts.message,
    systemPrompt,
  };

  const args = buildProviderArgs(provider, { ...common, sessionId: cliSessionId, isResume });

  // Ensure flags directory exists
  const flagFile = stopFlagPath(opts.sessionKey);
  mkdirSync(dirname(flagFile), { recursive: true });

  /** Capture session ID from provider output if captureIdField is set. */
  const captureSessionId = (raw: string) => {
    const field = provider.session?.captureIdField;
    if (!field) return;
    try {
      const obj: unknown = JSON.parse(raw);
      const id = getNestedField(obj, field);
      if (typeof id === 'string' && id) {
        setCliSessionId(opts.sessionKey, id);
        L.info('captured session id from output', { field, id });
      }
    } catch { /* not JSON — skip capture */ }
  };

  /** Execute command via spawn or tmux based on provider config. */
  const execCmd = (command: string, cmdArgs: string[]): Promise<RunResult> => {
    const runOpts = { cwd, timeout: opts.timeout ?? MAX_RUN_TIMEOUT_MS, stopFlagFile: flagFile };
    if (provider.tmux) {
      return runInTmux(command, cmdArgs, { ...runOpts, env: SPAWN_ENV });
    }
    return runCommand(command, cmdArgs, runOpts);
  };

  const toResult = (raw: string): RunAgentResult => ({
    text: parseProviderOutput(provider, raw),
    tokens: extractUsage(provider, raw),
  });

  const freshRun = async () => {
    const id = randomUUID();
    setCliSessionId(opts.sessionKey, id);
    const a = buildProviderArgs(provider, { ...common, sessionId: id, isResume: false });
    const r = await execCmd(provider.command, a);
    captureSessionId(r.response);
    return toResult(r.response);
  };

  try {
    const result = await execCmd(provider.command, args);
    if (!isResume) captureSessionId(result.response);
    return toResult(result.response);
  } catch (err) {
    if (isResume && err instanceof RunError && /session/i.test(err.message)) {
      L.warn('session resume failed, retrying fresh');
      return freshRun();
    }
    throw err;
  }
}
