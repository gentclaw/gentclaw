import { spawn } from 'node:child_process';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getProvider, buildProviderArgs, parseProviderOutput, extractUsage, getNestedField } from './providers.js';
import { getAgents } from './config.js';
import { getCliSessionId, setCliSessionId, stopFlagPath } from './sessions.js';
import { RunError, errMsg } from './errors.js';
import { MAX_RUN_TIMEOUT_MS, STOP_FLAG_POLL_MS } from './constants.js';
import { stripAnsi } from './text.js';
import type { TokenUsage } from './types.js';
import { runInTmux } from './tmux.js';
import { readAgentMemory, readSharedMemory, buildMemoryPrompt } from './memory.js';
import { log } from './log.js';

const L = log('run');

/**
 * Explicit env allowlist for child processes — never spread process.env.
 * Captured once at module load (intentional — daemon env never mutates at runtime).
 * CLAUDECODE intentionally omitted — its presence triggers nested session detection.
 */
const SPAWN_ENV = {
  PATH: process.env.PATH || '',
  HOME: process.env.HOME || '',
  FORCE_COLOR: '0',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
} as const;

type RunOpts = {
  agentId: string;
  message: string;
  sessionKey: string;
  timeout?: number;
};

type RunResult = {
  response: string;
  exitCode: number;
};

/** Run a CLI command with stdout/stderr buffering. */
function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeout: number; stopFlagFile: string },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearInterval(stopInterval);
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    };

    const settle = (fn: () => void) => {
      if (!settled) { settled = true; cleanup(); fn(); }
    };

    L.info('spawning', { cmd, args: args.slice(0, 4), cwd: opts.cwd });
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: SPAWN_ENV,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => stdout.push(d));
    child.stderr.on('data', (d: Buffer) => stderr.push(d));

    const killWithEscalation = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 5_000);
    };

    // Stop-flag watcher
    const stopInterval = setInterval(() => {
      if (existsSync(opts.stopFlagFile)) {
        L.info('stop flag detected, killing child');
        try { unlinkSync(opts.stopFlagFile); } catch { /* ignore */ }
        killWithEscalation();
        settle(() => resolve({
          response: stripAnsi(Buffer.concat(stdout).toString('utf-8')),
          exitCode: 130,
        }));
      }
    }, STOP_FLAG_POLL_MS);

    // Timeout guard
    const timer = setTimeout(() => {
      L.warn('run timeout, killing child');
      killWithEscalation();
      settle(() => reject(new RunError('Run timed out', 124)));
    }, opts.timeout);

    child.on('close', (code) => {
      const rawOut = stripAnsi(Buffer.concat(stdout).toString('utf-8'));
      const rawErr = stripAnsi(Buffer.concat(stderr).toString('utf-8'));
      if (rawErr) L.warn('child stderr', { code, err: rawErr.slice(0, 200) });
      settle(() => {
        if (code !== 0 && !rawOut) {
          reject(new RunError(rawErr || `Process exited with code ${code}`, code ?? 1));
        } else {
          resolve({ response: rawOut, exitCode: code ?? 0 });
        }
      });
    });

    child.on('error', (err) => {
      settle(() => reject(new RunError(`Spawn failed: ${errMsg(err)}`)));
    });
  });
}

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
      const obj = JSON.parse(raw);
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
