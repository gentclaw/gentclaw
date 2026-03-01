/**
 * Per-key task serialization via explicit queue + async drain loop.
 * Tasks with the same key run sequentially, different keys run in parallel.
 * In-process only — no cross-process coordination. Single daemon instance assumed.
 */
type QueueEntry = {
  task: () => Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
};

/** Max pending tasks per key — rejects with QueueFullError when exceeded */
const MAX_QUEUE_LENGTH = 50;

/** Max concurrent keys — prevents unbounded memory under abuse */
const MAX_QUEUES = 500;

const queues = new Map<string, QueueEntry[]>();
const draining = new Set<string>();

export class QueueFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueFullError';
  }
}

export function runSequential(key: string, task: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let queue = queues.get(key);
    if (!queue) {
      if (queues.size >= MAX_QUEUES) {
        reject(new QueueFullError(`Too many concurrent queues (max ${MAX_QUEUES})`));
        return;
      }
      queue = [];
      queues.set(key, queue);
    }
    if (queue.length >= MAX_QUEUE_LENGTH) {
      reject(new QueueFullError(`Queue full for key '${key}' (max ${MAX_QUEUE_LENGTH})`));
      return;
    }
    queue.push({ task, resolve, reject });
    if (!draining.has(key)) void drain(key);
  });
}

async function drain(key: string): Promise<void> {
  draining.add(key);
  const queue = queues.get(key);
  if (!queue) return;
  let entry = queue.shift();
  while (entry) {
    try { await entry.task(); entry.resolve(); }
    catch (err) { entry.reject(err); }
    entry = queue.shift();
  }
  queues.delete(key);
  draining.delete(key);
}

/** Number of active task queues (for diagnostics). */
export function activeTasks(): number {
  return queues.size;
}
