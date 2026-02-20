import { describe, it, expect } from 'vitest';
import { errMsg, ConfigError, ProviderError, RunError } from '../../src/lib/errors.js';

describe('errMsg', () => {
  it('extracts message from Error', () => {
    expect(errMsg(new Error('test error'))).toBe('test error');
  });

  it('returns string directly', () => {
    expect(errMsg('raw string')).toBe('raw string');
  });

  it('converts non-string/error to string', () => {
    expect(errMsg(42)).toBe('42');
    expect(errMsg(null)).toBe('null');
    expect(errMsg(undefined)).toBe('undefined');
  });
});

describe('custom errors', () => {
  it('ConfigError has correct name', () => {
    const err = new ConfigError('bad config');
    expect(err.name).toBe('ConfigError');
    expect(err.message).toBe('bad config');
    expect(err).toBeInstanceOf(Error);
  });

  it('ProviderError has correct name', () => {
    const err = new ProviderError('bad provider');
    expect(err.name).toBe('ProviderError');
  });

  it('RunError stores exitCode', () => {
    const err = new RunError('process failed', 1);
    expect(err.name).toBe('RunError');
    expect(err.exitCode).toBe(1);
  });
});
