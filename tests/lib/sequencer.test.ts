import { describe, it, expect } from 'vitest';
import { runSequential, activeTasks } from '../../src/lib/sequencer.js';

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
});
