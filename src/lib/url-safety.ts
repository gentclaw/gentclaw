/** SSRF protection — block private/reserved network URLs.
 *  Used before any outbound fetch where the URL is not hard-coded — prevents
 *  bot tokens (Authorization headers) leaking to attacker-controlled hosts. */

/** True if URL targets a private, reserved, internal, or unparsable address. */
export function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const raw = parsed.hostname.toLowerCase();
    const host = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;

    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '::' || host === '0.0.0.0') return true;
    if (host.startsWith('fe80:') || host.startsWith('fc00:') || host.startsWith('fd00:')) return true;
    if (host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (host === '169.254.169.254' || host === 'metadata.google.internal') return true;

    if (host.startsWith('::ffff:')) {
      const mapped = host.slice(7);
      if (isPrivateIp(mapped)) return true;
      const hex = mapped.split(':');
      if (hex.length === 2) {
        const hi = parseInt(hex[0], 16);
        const lo = parseInt(hex[1], 16);
        if (!isNaN(hi) && !isNaN(lo)) {
          const ip = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          if (isPrivateIp(ip)) return true;
        }
      }
    }

    return isPrivateIp(host);
  } catch {
    return true;
  }
}

function isPrivateIp(host: string): boolean {
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || !octets.every(n => !isNaN(n))) return false;
  const [a, b] = octets as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  return false;
}
