import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { TMUX_SESSION, TMUX_POLL_MS, STOP_FLAG_POLL_MS } from './constants.js';
import { RunError } from './errors.js';
import { stripAnsi } from './text.js';
import { log } from './log.js';

const L = log('tmux');

function tmux(cmd: string): string {
  try {
    return execSync(`tmux ${cmd}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '' },
    }).trim();
  } catch {
    return '';
  }
}

function sessionExists(): boolean {
  try {
    execSync(`tmux has-session -t ${TMUX_SESSION}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureSession(): void {
  if (!sessionExists()) {
    tmux(`new-session -d -s ${TMUX_SESSION} -x 200 -y 50`);
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
  const shellCmd = [cmd, ...args.map(shellEscape)].join(' ');
  const wrapped = `cd ${shellEscape(opts.cwd)} && ${shellCmd} > ${shellEscape(outFile)} 2>&1; echo $? > ${shellEscape(exitFile)}`;

  // Pass env vars via -e flags
  const envFlags = Object.entries(opts.env ?? {})
    .map(([k, v]) => `-e ${k}=${shellEscape(v)}`)
    .join(' ');

  tmux(`new-window -d -t ${TMUX_SESSION} -n ${winName} ${envFlags} ${shellEscape(wrapped)}`);
  L.info('tmux run started', { winName, cmd, args: args.slice(0, 4) });

  // Poll for completion or stop/timeout
  const deadline = Date.now() + opts.timeout;
  let stopped = false;

  await new Promise<void>((resolve, reject) => {
    const poll = setInterval(() => {
      // Check stop flag
      if (existsSync(opts.stopFlagFile)) {
        L.info('stop flag detected, killing tmux window');
        try { unlinkSync(opts.stopFlagFile); } catch { /* ignore */ }
        tmux(`kill-window -t ${TMUX_SESSION}:${winName}`);
        stopped = true;
        clearInterval(poll);
        resolve();
        return;
      }

      // Check timeout
      if (Date.now() > deadline) {
        L.warn('tmux run timeout, killing window');
        tmux(`kill-window -t ${TMUX_SESSION}:${winName}`);
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
  return { response, exitCode };
}
