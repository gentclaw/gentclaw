import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { TMUX_SESSION, TMUX_POLL_MS, SUBPROCESS_ENV } from './constants.js';
import { RunError } from './errors.js';
import { clearStopFlag } from './sessions.js';
import { stripAnsi } from './text.js';
import { log } from './log.js';

const L = log('tmux');

/** Run tmux with array args — no shell interpretation, no escaping needed. */
function tmux(...args: string[]): string {
  try {
    return execFileSync('tmux', args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: SUBPROCESS_ENV,
    }).trim();
  } catch {
    return '';
  }
}

function sessionExists(): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', TMUX_SESSION], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureSession(): void {
  if (!sessionExists()) {
    tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', '200', '-y', '50');
    if (!sessionExists()) {
      throw new RunError('Failed to create tmux session — is tmux installed?');
    }
    L.info('created tmux session', { session: TMUX_SESSION });
  }
}

/** Escape a string for safe embedding in a single-quoted shell argument. */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

type TmuxRunOpts = {
  cwd: string;
  timeout: number;
  stopFlagFile: string;
  env?: Record<string, string>;
};

/** Run a command in a tmux pane — visible via `tmux attach -t gentclaw`. */
export async function runInTmux(
  cmd: string,
  args: string[],
  opts: TmuxRunOpts,
): Promise<{ response: string; exitCode: number }> {
  ensureSession();

  const id = randomUUID().slice(0, 8);
  const outFile = join(tmpdir(), `gentclaw-${id}.out`);
  const exitFile = join(tmpdir(), `gentclaw-${id}.exit`);
  const winName = `gent-${id}`;

  // Build shell command: run CLI, capture stdout+stderr, write exit code
  // shellEscape needed here because this string is interpreted by tmux's shell
  const shellCmd = [cmd, ...args.map(shellEscape)].join(' ');
  const wrapped = `cd ${shellEscape(opts.cwd)} && ${shellCmd} > ${shellEscape(outFile)} 2>&1; echo $? > ${shellEscape(exitFile)}`;

  // Build tmux new-window args array (no shell interpretation — execFileSync)
  const tmuxArgs = ['new-window', '-d', '-t', TMUX_SESSION, '-n', winName];
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    tmuxArgs.push('-e', `${k}=${v}`);
  }
  tmuxArgs.push(wrapped);

  tmux(...tmuxArgs);
  L.info('tmux run started', { winName, cmd, args: args.slice(0, 4) });

  // Poll for completion or stop/timeout
  const deadline = Date.now() + opts.timeout;
  let stopped = false;

  await new Promise<void>((resolve, reject) => {
    const poll = setInterval(() => {
      // Check stop flag
      if (clearStopFlag(opts.stopFlagFile)) {
        L.info('stop flag detected, killing tmux window');
        tmux('kill-window', '-t', `${TMUX_SESSION}:${winName}`);
        stopped = true;
        clearInterval(poll);
        resolve();
        return;
      }

      // Check timeout
      if (Date.now() > deadline) {
        L.warn('tmux run timeout, killing window');
        tmux('kill-window', '-t', `${TMUX_SESSION}:${winName}`);
        clearInterval(poll);
        reject(new RunError('Run timed out', 124));
        return;
      }

      // Check completion
      if (existsSync(exitFile)) {
        clearInterval(poll);
        resolve();
      }
    }, TMUX_POLL_MS);
  });

  // Read results
  const response = existsSync(outFile) ? stripAnsi(readFileSync(outFile, 'utf-8')) : '';
  const exitCode = existsSync(exitFile)
    ? parseInt(readFileSync(exitFile, 'utf-8').trim(), 10) || 0
    : stopped ? 130 : 1;

  // Cleanup temp files
  try { unlinkSync(outFile); } catch { /* ignore */ }
  try { unlinkSync(exitFile); } catch { /* ignore */ }

  L.info('tmux run completed', { winName, exitCode, len: response.length });

  if (exitCode !== 0 && !response) {
    throw new RunError(`Process exited with code ${exitCode}`, exitCode);
  }

  return { response, exitCode };
}
