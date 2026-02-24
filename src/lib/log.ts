import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from './paths.js';
import { redactSecrets } from './secrets.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let minLevel: LogLevel = 'info';
let logFile: string | null = null;

/** Deep-redact all string values in a data object (recurses into arrays, circular-ref safe) */
export function redactData(data: Record<string, unknown>, seen = new WeakSet<object>()): Record<string, unknown> {
  seen.add(data);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') out[k] = redactSecrets(v);
    else if (Array.isArray(v)) out[k] = v.map(el => typeof el === 'string' ? redactSecrets(el) : el);
    else if (v && typeof v === 'object') {
      out[k] = seen.has(v) ? '[circular]' : redactData(v as Record<string, unknown>, seen);
    }
    else out[k] = v;
  }
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
    msg: redactSecrets(msg),
    ...(data ? { data: redactData(data) } : {}),
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
