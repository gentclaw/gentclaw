import { statSync } from 'node:fs';

/** Generic file-based cache with mtime invalidation. Avoids re-parsing files that haven't changed. */
export function createMtimeCache<T>(path: string | (() => string), load: () => T): { get: () => T; clear: () => void } {
  let cached: { value: T; mtime: number } | null = null;

  return {
    get(): T {
      const p = typeof path === 'function' ? path() : path;
      const mt = statSync(p).mtimeMs;
      if (cached && cached.mtime === mt) return cached.value;
      const value = load();
      cached = { value, mtime: mt };
      return value;
    },
    clear(): void {
      cached = null;
    },
  };
}
