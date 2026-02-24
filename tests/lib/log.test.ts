import { describe, it, expect } from 'vitest';
import { redactData } from '../../src/lib/log.js';

describe('redactData', () => {
  it('redacts string values', () => {
    const result = redactData({ key: 'xoxb-123-abc-def' });
    expect(result.key).toBe('[REDACTED]');
  });

  it('handles circular references without crashing', () => {
    const obj: Record<string, unknown> = { a: 'hello' };
    obj.self = obj;
    const result = redactData(obj);
    expect(result.a).toBe('hello');
    expect(result.self).toBe('[circular]');
  });

  it('handles deeply nested circular references', () => {
    const inner: Record<string, unknown> = { value: 'test' };
    const outer: Record<string, unknown> = { child: inner };
    inner.parent = outer;
    const result = redactData(outer);
    expect((result.child as Record<string, unknown>).value).toBe('test');
    expect((result.child as Record<string, unknown>).parent).toBe('[circular]');
  });

  it('preserves non-string primitives', () => {
    const result = redactData({ num: 42, bool: true, nil: null });
    expect(result).toEqual({ num: 42, bool: true, nil: null });
  });
});
