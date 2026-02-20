import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from './paths.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let minLevel: LogLevel = 'info';
let logFile: string | null = null;

/** Patterns to redact from log output. */
const SECRETS = [/xoxb-[a-zA-Z0-9-]+/g, /xapp-[a-zA-Z0-9-]+/g, /sk-[a-zA-Z0-9-]+/g];

function redact(s: string): string {
  let out = s;
  for (const pat of SECRETS) out = out.replace(pat, '[REDACTED]');
  return out;
}

export function initLog(opts?: { verbose?: boolean; file?: string }): void {
  if (opts?.verbose) minLevel = 'debug';
  if (opts?.file) {
    logFile = opts.file;
  } else {
    mkdirSync(PATHS.logs, { recursive: true });
    logFile = join(PATHS.logs, 'gentclaw.log');
  }
}

function emit(level: LogLevel, mod: string, msg: string, data?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const entry = {
    t: new Date().toISOString(),
    level,
    mod,
    msg: redact(msg),
    ...(data ? { data } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
  if (logFile) {
    try {
      appendFileSync(logFile, line + '\n');
    } catch {
      // best-effort logging
    }
  }
}

export function log(mod: string) {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => emit('debug', mod, msg, data),
    info: (msg: string, data?: Record<string, unknown>) => emit('info', mod, msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => emit('warn', mod, msg, data),
    error: (msg: string, data?: Record<string, unknown>) => emit('error', mod, msg, data),
  };
}
