/**
 * Per-key task serialization via explicit queue + async drain loop.
 * Tasks with the same key run sequentially, different keys run in parallel.
 */
type QueueEntry = {
  task: () => Promise<void>;
  resolve: (value: void) => void;
  reject: (reason: unknown) => void;
};

const queues = new Map<string, QueueEntry[]>();
const draining = new Set<string>();

export function runSequential(key: string, task: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let queue = queues.get(key);
    if (!queue) { queue = []; queues.set(key, queue); }
    queue.push({ task, resolve, reject });
    if (!draining.has(key)) drain(key);
  });
}

async function drain(key: string): Promise<void> {
  draining.add(key);
  const queue = queues.get(key)!;
  while (queue.length > 0) {
    const entry = queue.shift()!;
    try { await entry.task(); entry.resolve(); }
    catch (err) { entry.reject(err); }
  }
  queues.delete(key);
  draining.delete(key);
}

/** Number of active task queues (for diagnostics). */
export function activeTasks(): number {
  return queues.size;
}
