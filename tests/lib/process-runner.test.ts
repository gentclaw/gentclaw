import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/sessions.js', () => ({
  clearStopFlag: vi.fn(() => false),
}));

vi.mock('../../src/lib/log.js', () => ({
  log: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import { runCommand } from '../../src/lib/process-runner.js';
import { clearStopFlag } from '../../src/lib/sessions.js';

describe('process-runner', () => {
  beforeEach(() => {
    vi.mocked(clearStopFlag).mockReturnValue(false);
  });

  it('captures stdout from successful command', async () => {
    const result = await runCommand('echo', ['hello world'], {
      cwd: '/tmp',
      timeout: 5_000,
      stopFlagFile: '/tmp/nonexistent-stop-flag',
    });
    expect(result.response.trim()).toBe('hello world');
    expect(result.exitCode).toBe(0);
  });

  it('rejects with RunError on non-zero exit with no stdout', async () => {
    await expect(
      runCommand('sh', ['-c', 'echo "fail" >&2; exit 1'], {
        cwd: '/tmp',
        timeout: 5_000,
        stopFlagFile: '/tmp/nonexistent-stop-flag',
      }),
    ).rejects.toThrow('fail');
  });

  it('resolves with output even on non-zero exit if stdout is present', async () => {
    const result = await runCommand('sh', ['-c', 'echo "partial"; exit 1'], {
      cwd: '/tmp',
      timeout: 5_000,
      stopFlagFile: '/tmp/nonexistent-stop-flag',
    });
    expect(result.response).toContain('partial');
    expect(result.exitCode).toBe(1);
  });

  it('rejects with RunError on timeout', async () => {
    await expect(
      runCommand('sleep', ['10'], {
        cwd: '/tmp',
        timeout: 100,
        stopFlagFile: '/tmp/nonexistent-stop-flag',
      }),
    ).rejects.toThrow('timed out');
  }, 10_000);

  it('resolves with exit 130 when stop flag is detected', async () => {
    // Simulate stop flag found on first poll
    vi.mocked(clearStopFlag).mockReturnValueOnce(false).mockReturnValueOnce(true);

    const result = await runCommand('sleep', ['10'], {
      cwd: '/tmp',
      timeout: 30_000,
      stopFlagFile: '/tmp/test-stop-flag',
    });
    expect(result.exitCode).toBe(130);
  }, 10_000);

  it('rejects with RunError for invalid command', async () => {
    await expect(
      runCommand('/nonexistent/command', [], {
        cwd: '/tmp',
        timeout: 5_000,
        stopFlagFile: '/tmp/nonexistent-stop-flag',
      }),
    ).rejects.toThrow('Spawn failed');
  });

  it('strips ANSI codes from output', async () => {
    const result = await runCommand('printf', ['\x1b[31mred\x1b[0m'], {
      cwd: '/tmp',
      timeout: 5_000,
      stopFlagFile: '/tmp/nonexistent-stop-flag',
    });
    expect(result.response).toBe('red');
  });

  it('kills child when combined output exceeds the cap', async () => {
    // yes prints "y\n" forever — well past MAX_CHILD_OUTPUT_BYTES (10MB) in a fraction of a second.
    // Should be killed before timeout fires.
    const start = Date.now();
    const result = await runCommand('sh', ['-c', 'yes | head -c 20000000'], {
      cwd: '/tmp',
      timeout: 30_000,
      stopFlagFile: '/tmp/nonexistent-stop-flag',
    });
    // Either resolves (cap → kill → exit) or rejects (cap → kill → non-zero). Both prove the cap fired.
    expect(Date.now() - start).toBeLessThan(15_000);
    // Buffer should have been capped — well under the raw 20MB the producer would have written.
    expect(Buffer.byteLength(result.response, 'utf8')).toBeLessThanOrEqual(11 * 1024 * 1024);
  }, 30_000);
});
