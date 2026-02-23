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
import { log } from './log.js';

const L = log('run');

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
    const settle = (fn: () => void) => {
      if (!settled) { settled = true; fn(); }
    };

    const spawnEnv = {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      FORCE_COLOR: '0',
      // Claude Code SDK auth — must be 'cli' for spawned claude to authenticate.
      // Hardcoded because launchd environment doesn't inherit this.
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      // CLAUDECODE intentionally omitted — its presence (even empty) triggers nested session detection
    };
    L.info('spawning', { cmd, args: args.slice(0, 4), cwd: opts.cwd, env: spawnEnv });
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: spawnEnv,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => stdout.push(d));
    child.stderr.on('data', (d: Buffer) => stderr.push(d));

    // Stop-flag watcher
    const stopInterval = setInterval(() => {
      if (existsSync(opts.stopFlagFile)) {
        L.info('stop flag detected, killing child');
        try { unlinkSync(opts.stopFlagFile); } catch { /* ignore */ }
        child.kill('SIGTERM');
        setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 5_000);
        settle(() => resolve({
          response: stripAnsi(Buffer.concat(stdout).toString('utf-8')),
          exitCode: 130,
        }));
      }
    }, STOP_FLAG_POLL_MS);

    // Timeout guard
    const timer = setTimeout(() => {
      L.warn('run timeout, killing child');
      child.kill('SIGTERM');
      setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 5_000);
      settle(() => reject(new RunError('Run timed out', 124)));
    }, opts.timeout);

    child.on('close', (code) => {
      clearInterval(stopInterval);
      clearTimeout(timer);
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
      clearInterval(stopInterval);
      clearTimeout(timer);
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

  const common = {
    model: config.model,
    prompt: opts.message,
    systemPrompt: config.systemPrompt,
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
      return runInTmux(command, cmdArgs, {
        ...runOpts,
        env: {
          PATH: process.env.PATH || '',
          HOME: process.env.HOME || '',
          FORCE_COLOR: '0',
          CLAUDE_CODE_ENTRYPOINT: 'cli',
        },
      });
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
