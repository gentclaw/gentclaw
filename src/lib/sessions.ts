import { readFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from './paths.js';
import { atomicWriteJson } from './fs-utils.js';
import { SESSION_TTL_MS, SESSION_CLEANUP_PROB } from './constants.js';
import { log } from './log.js';
import { errMsg } from './errors.js';
import type { Session } from './types.js';

const L = log('sessions');

/** Lightweight runtime check — rejects corrupt session files */
function isSessionShape(v: unknown): v is Session {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  return typeof s.sessionKey === 'string' && typeof s.agentId === 'string'
    && typeof s.createdAt === 'number' && typeof s.lastAccessAt === 'number';
}

const SAFE_RE = /[^a-zA-Z0-9_-]/g;

function sanitize(key: string): string {
  return key.replace(SAFE_RE, '_');
}

function sessionPath(sessionKey: string): string {
  return join(PATHS.sessions, `${sanitize(sessionKey)}.json`);
}

function readSession(sessionKey: string): Session | null {
  try {
    const raw = readFileSync(sessionPath(sessionKey), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!isSessionShape(parsed)) {
      L.warn('corrupt session file', { sessionKey });
      return null;
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      L.warn('session read failed', { sessionKey, error: errMsg(err) });
    }
    return null;
  }
}

function writeSession(session: Session): void {
  atomicWriteJson(sessionPath(session.sessionKey), session);
}

/** Get the sticky agent for a session. */
export function getSessionAgent(sessionKey: string): string | undefined {
  return readSession(sessionKey)?.agentId;
}

/** Set the sticky agent for a session. */
export function setSessionAgent(sessionKey: string, agentId: string, provider: string, model: string): void {
  const existing = readSession(sessionKey);
  const now = Date.now();
  const session: Session = existing
    ? { ...existing, agentId, provider, model, lastAccessAt: now }
    : { sessionKey, agentId, provider, model, createdAt: now, lastAccessAt: now };
  writeSession(session);
}

/** Get the CLI session ID for a session. */
export function getCliSessionId(sessionKey: string): string | undefined {
  return readSession(sessionKey)?.cliSessionId;
}

/** Set the CLI session ID for a session. Creates a stub session if none exists yet — tmux provider writes cliSessionId before pipeline creates the full session record. */
export function setCliSessionId(sessionKey: string, cliSessionId: string): void {
  const now = Date.now();
  const existing = readSession(sessionKey);
  if (!existing) {
    writeSession({ sessionKey, agentId: '', provider: '', model: '', createdAt: now, lastAccessAt: now, cliSessionId });
    return;
  }
  writeSession({ ...existing, cliSessionId, lastAccessAt: now });
}

/** Delete a session. */
export function deleteSession(sessionKey: string): void {
  try {
    unlinkSync(sessionPath(sessionKey));
  } catch {
    // ignore
  }
}

/** Get the stop-flag path for a session. */
export function stopFlagPath(sessionKey: string): string {
  return join(PATHS.flags, `stop-${sanitize(sessionKey)}`);
}

/** Atomically remove a stop-flag file. Returns true if this caller won the race. */
export function clearStopFlag(flagFile: string): boolean {
  try { unlinkSync(flagFile); return true; } catch { return false; }
}

/** Probabilistic cleanup of expired sessions. Uses random sampling (5% per message) instead of timers — avoids extra interval management in the daemon. */
export function maybeCleanupSessions(): void {
  if (Math.random() > SESSION_CLEANUP_PROB) return;

  const now = Date.now();
  try {
    const files = readdirSync(PATHS.sessions).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const fullPath = join(PATHS.sessions, file);
      try {
        const mt = statSync(fullPath).mtimeMs;
        if (now - mt > SESSION_TTL_MS) {
          unlinkSync(fullPath);
          L.info('cleaned expired session', { file });
        }
      } catch {
        // skip
      }
    }
  } catch {
    // sessions dir may not exist yet
  }
}
