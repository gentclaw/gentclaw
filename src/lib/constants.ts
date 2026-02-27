// Polling intervals (ms)
export const STOP_FLAG_POLL_MS = 2_000;

// Limits
export const MAX_MSG_LENGTH = 4_000; // Slack block limit
export const MAX_RUN_TIMEOUT_MS = 30 * 60 * 1_000; // 30 minutes

// TTLs
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days
export const SESSION_CLEANUP_PROB = 0.05; // 5% chance per message

// Tmux
export const TMUX_SESSION = 'gentclaw';
export const TMUX_POLL_MS = 500; // poll for tmux command completion

// Heartbeat
export const DEFAULT_HEARTBEAT_INTERVAL_MIN = 60;
export const HEARTBEAT_RUN_TIMEOUT_MS = 2 * 60 * 1_000; // 2 min (shorter than regular 30 min)
export const HEARTBEAT_FALLBACK_PROMPT = 'Quick status check: Any pending tasks? Keep response brief.';

// Service
export const SERVICE_LABEL = 'com.gentclaw.agent';

/**
 * Explicit env allowlist for child processes — never spread process.env.
 * Captured once at module load (daemon env never mutates at runtime).
 * CLAUDECODE intentionally omitted — triggers nested session detection.
 * CLAUDE_CODE_ENTRYPOINT hardcoded to 'cli' — launchd env lacks this var,
 * causing SDK auth failure ("Not logged in") when inherited as empty string.
 */
export const SPAWN_ENV = {
  PATH: process.env.PATH || '',
  HOME: process.env.HOME || '',
  FORCE_COLOR: '0',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
} as const;

/** Minimal env for non-Claude subprocesses (no CLAUDE_CODE_ENTRYPOINT needed). */
export const SUBPROCESS_ENV = {
  PATH: process.env.PATH || '',
  HOME: process.env.HOME || '',
} as const;
