import { spawn } from 'node:child_process';
import { RunError, errMsg } from './errors.js';
import { STOP_FLAG_POLL_MS, SPAWN_ENV } from './constants.js';
import { clearStopFlag } from './sessions.js';
import { stripAnsi } from './text.js';
import { log } from './log.js';

const L = log('process-runner');

export type RunResult = {
  response: string;
  exitCode: number;
};

type RunCommandOpts = {
  cwd: string;
  timeout: number;
  stopFlagFile: string;
};

/** Spawn a CLI command with stdout/stderr buffering, stop-flag watcher, and timeout guard with SIGTERM→SIGKILL escalation. */
export function runCommand(
  cmd: string,
  args: string[],
  opts: RunCommandOpts,
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

    /**
     * Stop-flag watcher — polls filesystem for a stop-flag file.
     * Uses file-based IPC instead of signals because child processes may run
     * inside tmux panes where POSIX signals can't reach reliably.
     */
    const stopInterval = setInterval(() => {
      if (clearStopFlag(opts.stopFlagFile)) {
        L.info('stop flag detected, killing child');
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
