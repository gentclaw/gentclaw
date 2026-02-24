import { execFile } from 'node:child_process';
import { getSettings } from './config.js';
import { log } from './log.js';
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

/** Run a single subprocess hook. Receives JSON on stdin, parses JSON from stdout. */
function runSubprocess(hook: HookDef, msg: InboundMsg): Promise<HookAction> {
  const timeout = hook.timeout ?? DEFAULT_TIMEOUT;

  return new Promise(resolve => {
    const child = execFile(hook.command!, [], { timeout }, (err, stdout) => {
      if (err) {
        L.warn('hook subprocess failed, allowing', { hook: hook.name, error: String(err) });
        resolve({ action: 'allow' });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
        if (!parsed || typeof parsed.action !== 'string' || !VALID_ACTIONS.has(parsed.action)) {
          L.warn('hook returned invalid action, allowing', { hook: hook.name });
          resolve({ action: 'allow' });
          return;
        }
        if (parsed.action === 'block') {
          resolve({ action: 'block', reason: typeof parsed.reason === 'string' ? parsed.reason : '' });
        } else if (parsed.action === 'transform' && typeof parsed.message === 'string') {
          resolve({ action: 'transform', message: parsed.message });
        } else {
          resolve({ action: 'allow' });
        }
      } catch {
        L.warn('hook returned invalid JSON, allowing', { hook: hook.name });
        resolve({ action: 'allow' });
      }
    });

    child.stdin?.write(JSON.stringify({ message: msg.message, sender: msg.sender, timestamp: msg.timestamp }));
    child.stdin?.end();
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
    return runSubprocess(hook, msg);
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
  // Deduplicate: skip defaults already configured by user (by builtin name)
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
