import { execFile } from 'node:child_process';
import { getSettings } from './config.js';
import { auditLog } from './audit.js';
import { log } from './log.js';
import { tryParseJson } from './text.js';
import { checkRateLimit } from './builtins/rate-limit.js';
import { checkContentGuard } from './builtins/content-guard.js';
import { secretsScan } from './builtins/secrets-scan.js';
import type { HookAction, HookDef, HookEvent, InboundMsg } from './types.js';

const L = log('hooks');
const DEFAULT_TIMEOUT = 5000;
const VALID_ACTIONS = new Set(['allow', 'block', 'transform']);

/** Safety hooks that always run, even without explicit settings config. */
const DEFAULT_HOOKS: Partial<Record<HookEvent, HookDef[]>> = {
  postMessage: [{ name: 'secrets-scan', builtin: 'secrets-scan' }],
};

type BuiltinFn = (msg: InboundMsg, config?: Record<string, unknown>) => HookAction;

const BUILTINS: Record<string, BuiltinFn> = {
  'rate-limit': checkRateLimit,
  'content-guard': checkContentGuard,
  'secrets-scan': secretsScan,
};

/** Parse raw JSON into a typed HookAction. Returns 'allow' for invalid/unrecognizable input. */
export function parseHookAction(raw: unknown): HookAction {
  if (raw == null || typeof raw !== 'object') return { action: 'allow' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.action !== 'string' || !VALID_ACTIONS.has(obj.action)) return { action: 'allow' };
  if (obj.action === 'block') return { action: 'block', reason: typeof obj.reason === 'string' ? obj.reason : '' };
  if (obj.action === 'transform' && typeof obj.message === 'string') return { action: 'transform', message: obj.message };
  return { action: 'allow' };
}

/** Run a single subprocess hook. Receives JSON on stdin, parses JSON from stdout. Caller guarantees `command` is non-empty. */
function runSubprocess(name: string, command: string, timeoutMs: number, msg: InboundMsg): Promise<HookAction> {
  return new Promise(resolve => {
    let settled = false;
    const settleAllow = (why: string) => {
      if (settled) return;
      settled = true;
      L.warn(why, { hook: name });
      auditLog({ action: 'hook-error', sender: '', detail: `${name}: ${why}`, status: 'allowed' });
      resolve({ action: 'allow' });
    };

    const child = execFile(command, [], { timeout: timeoutMs }, (err, stdout) => {
      if (settled) return;
      if (err) { settleAllow(`subprocess failed: ${err.message}`); return; }
      const parsed = tryParseJson(stdout.trim());
      /** Audit invalid JSON — silent allow-on-parse-fail used to mask buggy/compromised hooks. */
      if (!parsed) { settleAllow('returned invalid JSON, allowing'); return; }
      settled = true;
      resolve(parseHookAction(parsed));
    });

    /** Spawn failure (ENOENT, EACCES) — the child never ran, so there is no stdout decision to
     *  honor; fail-open. execFile routes this to its callback too, so settling here is harmless
     *  (settled-guarded) redundancy that keeps the path explicit. */
    child.on('error', (err) => settleAllow(`spawn error: ${err.message}`));

    /** A hook that exits before reading stdin makes our write hit a closed pipe (EPIPE). That is
     *  NOT a hook failure — its stdout decision is still valid — so a stdin error must never settle
     *  the promise (settling would race the callback and discard a real `block`). Log only; the
     *  execFile callback, guaranteed to fire by the `timeout` option, is the sole authority. The
     *  try/catch + 'error' listener exist purely so an EPIPE can't crash the daemon. */
    const onStdinError = (err: Error) => L.debug('hook stdin write failed (ignored)', { hook: name, error: err.message });
    try {
      child.stdin?.write(JSON.stringify({ message: msg.message, sender: msg.sender, timestamp: msg.timestamp }));
      child.stdin?.end();
    } catch (err) {
      onStdinError(err as Error);
    }
    child.stdin?.on('error', onStdinError);
  });
}

/** Execute a single hook definition against a message. */
async function executeHook(hook: HookDef, msg: InboundMsg): Promise<HookAction> {
  if (hook.builtin) {
    const fn = BUILTINS[hook.builtin];
    if (!fn) {
      L.warn('unknown builtin hook, allowing', { builtin: hook.builtin });
      return { action: 'allow' };
    }
    const config = hook.config && typeof hook.config === 'object' ? hook.config : undefined;
    return fn(msg, config);
  }

  if (hook.command) {
    return runSubprocess(hook.name, hook.command, hook.timeout ?? DEFAULT_TIMEOUT, msg);
  }

  L.warn('hook has no builtin or command, allowing', { hook: hook.name });
  return { action: 'allow' };
}

/**
 * Run all hooks for a given event. Sequential execution, first block wins.
 * Transforms accumulate (each transform feeds into the next hook).
 * Returns final action + potentially transformed message.
 */
export async function runHooks(
  event: HookEvent,
  msg: InboundMsg,
): Promise<{ action: 'allow' | 'block'; message: string; blockReason?: string }> {
  const settings = getSettings();
  const userHooks = settings.hooks?.[event] ?? [];
  const defaultHooks = DEFAULT_HOOKS[event] ?? [];
  // Deduplicate: user hooks override defaults by builtin name — allows user
  // to reconfigure built-in hooks (e.g. secrets-scan with custom config).
  const userBuiltins = new Set(userHooks.filter(h => h.builtin).map(h => h.builtin));
  const hooks = [...userHooks, ...defaultHooks.filter(h => !userBuiltins.has(h.builtin))];
  if (!hooks.length) return { action: 'allow', message: msg.message };

  let currentMessage = msg.message;

  for (const hook of hooks) {
    const currentMsg = { ...msg, message: currentMessage };
    const result = await executeHook(hook, currentMsg);

    L.debug('hook result', { hook: hook.name, event, action: result.action });

    if (result.action === 'block') {
      L.info('message blocked by hook', { hook: hook.name, reason: result.reason });
      return { action: 'block', message: currentMessage, blockReason: result.reason };
    }

    if (result.action === 'transform') {
      currentMessage = result.message;
    }
  }

  return { action: 'allow', message: currentMessage };
}
