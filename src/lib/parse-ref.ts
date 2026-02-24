/** Strip @-prefix, lowercase, and sanitize to safe ID chars. */
export function parseRef(raw: string): string {
  return raw.replace(/^@/, '').toLowerCase();
}

/** parseRef + strip non-alphanumeric (for new entity creation). */
export function parseSafeId(raw: string): string {
  return parseRef(raw).replace(/[^a-z0-9_-]/g, '');
}
