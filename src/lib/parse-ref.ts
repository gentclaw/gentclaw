/** Strip @-prefix, lowercase, and sanitize to safe ID chars. */
export function parseRef(raw: string): string {
  return raw.replace(/^@/, '').toLowerCase();
}

/** parseRef + strip non-alphanumeric (for new entity creation). */
export function parseSafeId(raw: string): string {
  return parseRef(raw).replace(/[^a-z0-9_-]/g, '');
}

/** Extract --force flag from args string, return cleaned args + flag state. */
export function parseForceFlag(args: string): { cleanArgs: string; force: boolean } {
  const force = /--force\b/.test(args);
  return { cleanArgs: args.replace(/--force\s*/g, '').trim(), force };
}
