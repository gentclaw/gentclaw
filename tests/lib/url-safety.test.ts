import { describe, it, expect } from 'vitest';
import { isBlockedUrl } from '../../src/lib/url-safety.js';

describe('url-safety', () => {
  describe('blocks localhost variants', () => {
    for (const url of [
      'http://localhost/secret',
      'http://127.0.0.1/admin',
      'http://[::1]/api',
      'http://[::]/api',
      'http://0.0.0.0/api',
    ]) it(`blocks ${url}`, () => expect(isBlockedUrl(url)).toBe(true));
  });

  describe('blocks IPv4 private ranges', () => {
    for (const url of [
      'http://10.0.0.1/api',
      'http://10.255.255.255/api',
      'http://172.16.0.1/api',
      'http://172.31.255.255/api',
      'http://192.168.0.1/api',
      'http://192.168.255.255/api',
      'http://127.0.0.2/api',
      'http://169.254.1.1/api',
    ]) it(`blocks ${url}`, () => expect(isBlockedUrl(url)).toBe(true));
  });

  describe('blocks IPv6 private ranges', () => {
    for (const url of [
      // Link-local fe80::/10 — fe80–febf first hextet
      'http://[fe80::1]/api',
      'http://[fe90::1]/api',
      'http://[fea0::1]/api',
      'http://[feab::1]/api',
      'http://[febf::1]/api',
      // ULA fc00::/7 — fc00–fdff first hextet
      'http://[fc00::1]/api',
      'http://[fc12::1]/api',
      'http://[fcff::1]/api',
      'http://[fd00::abcd]/api',
      'http://[fdab::1]/api',
      'http://[fdff::1]/api',
    ]) it(`blocks ${url}`, () => expect(isBlockedUrl(url)).toBe(true));
  });

  describe('blocks .local / .internal / .localhost / cloud metadata', () => {
    for (const url of [
      'http://myserver.local/api',
      'http://db.internal/query',
      'http://db.localhost/admin',
      'http://files.localhost/secret',
      'http://169.254.169.254/latest/meta-data',
      'http://metadata.google.internal/computeMetadata',
    ]) it(`blocks ${url}`, () => expect(isBlockedUrl(url)).toBe(true));
  });

  describe('blocks IPv4-mapped IPv6', () => {
    for (const url of [
      'http://[::ffff:127.0.0.1]/api',
      'http://[::ffff:10.0.0.1]/api',
      'http://[::ffff:192.168.1.1]/api',
    ]) it(`blocks ${url}`, () => expect(isBlockedUrl(url)).toBe(true));
  });

  describe('blocks malformed input', () => {
    it('blocks non-URL strings', () => expect(isBlockedUrl('not a url')).toBe(true));
    it('blocks empty string', () => expect(isBlockedUrl('')).toBe(true));
  });

  describe('allows public URLs', () => {
    for (const url of [
      'https://files.slack.com/file.txt',
      'https://api.openai.com/v1/chat',
      'https://example.com/page',
      'http://8.8.8.8/dns',
      'https://172.32.0.1/api',
      'https://192.167.1.1/api',
      'https://11.0.0.1/api',
      // IPv6 ranges adjacent to private — must remain allowed
      'http://[fe7f::1]/api',  // just below link-local
      'http://[fec0::1]/api',  // deprecated site-local, not link-local
      'http://[fb00::1]/api',  // just below ULA
      'http://[fe00::1]/api',  // not link-local (top 10 bits differ)
    ]) it(`allows ${url}`, () => expect(isBlockedUrl(url)).toBe(false));
  });

  describe('IPv4 boundaries', () => {
    it('blocks 172.16.x but allows 172.15.x', () => {
      expect(isBlockedUrl('http://172.16.0.1/api')).toBe(true);
      expect(isBlockedUrl('http://172.15.0.1/api')).toBe(false);
    });
    it('blocks 172.31.x but allows 172.32.x', () => {
      expect(isBlockedUrl('http://172.31.0.1/api')).toBe(true);
      expect(isBlockedUrl('http://172.32.0.1/api')).toBe(false);
    });
  });
});
