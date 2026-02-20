/** Extract a concise error message from any thrown value. */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class RunError extends Error {
  public exitCode?: number;
  constructor(message: string, exitCode?: number) {
    super(message);
    this.name = 'RunError';
    this.exitCode = exitCode;
  }
}

export class RoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingError';
  }
}
