import { describe, it, expect } from 'vitest';
import { runSequential, activeTasks, QueueFullError } from '../../src/lib/sequencer.js';

describe('runSequential', () => {
  it('runs tasks with same key sequentially', async () => {
    const order: number[] = [];

    const p1 = runSequential('a', async () => {
      await new Promise(r => setTimeout(r, 50));
      order.push(1);
    });

    const p2 = runSequential('a', async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('runs tasks with different keys in parallel', async () => {
    const order: string[] = [];

    const p1 = runSequential('x', async () => {
      await new Promise(r => setTimeout(r, 50));
      order.push('x');
    });

    const p2 = runSequential('y', async () => {
      order.push('y');
    });

    await Promise.all([p1, p2]);
    // y should finish before x since x waits 50ms
    expect(order).toEqual(['y', 'x']);
  });

  it('continues chain even after rejection', async () => {
    const order: number[] = [];

    // Attach catch immediately to prevent unhandled rejection
    const p1 = runSequential('err', async () => {
      throw new Error('fail');
    }).catch(() => {});

    const p2 = runSequential('err', async () => {
      order.push(2);
    });

    await p1;
    await p2;
    expect(order).toEqual([2]);
  });

  it('cleans up tasks after settling', async () => {
    await runSequential('cleanup', async () => {});
    // Allow microtask to run
    await new Promise(r => setTimeout(r, 10));
    expect(activeTasks()).toBe(0);
  });

  it('rejects with QueueFullError when too many concurrent queues', async () => {
    // Block drain so queues stay open
    let unblock!: () => void;
    const blocker = new Promise<void>(r => { unblock = r; });

    const tasks: Promise<void>[] = [];
    for (let i = 0; i < 500; i++) {
      tasks.push(runSequential(`key-${i}`, () => blocker).catch(() => {}));
    }

    // 501st key should be rejected
    await expect(runSequential('overflow-key', async () => {})).rejects.toThrow(QueueFullError);

    // Cleanup
    unblock();
    await Promise.allSettled(tasks);
  });

  it('rejects with QueueFullError when queue exceeds max length', async () => {
    // Block the drain loop so tasks queue up
    let unblock!: () => void;
    const blocker = new Promise<void>(r => { unblock = r; });

    const first = runSequential('full', () => blocker);
    // Fill queue to max (50 = MAX_QUEUE_LENGTH, first is draining so 49 queued + 1 active)
    const fills = Array.from({ length: 50 }, () =>
      runSequential('full', async () => {}).catch(() => {}),
    );

    // Next one should be rejected
    await expect(runSequential('full', async () => {})).rejects.toThrow(QueueFullError);

    // Cleanup
    unblock();
    await first;
    await Promise.allSettled(fills);
  });
});
