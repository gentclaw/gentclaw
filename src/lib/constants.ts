// Polling intervals (ms)
export const STOP_FLAG_POLL_MS = 2_000;

// Limits
export const MAX_MSG_LENGTH = 4_000; // Slack block limit
export const MAX_RUN_TIMEOUT_MS = 30 * 60 * 1_000; // 30 minutes

// TTLs
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days
export const SESSION_CLEANUP_PROB = 0.05; // 5% chance per message
