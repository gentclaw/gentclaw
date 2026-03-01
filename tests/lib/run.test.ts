import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgent } from '../../src/lib/run.js';

// Mock all external dependencies
vi.mock('../../src/lib/config.js', () => ({
  getAgents: () => ({
    coder: { name: 'Coder', provider: 'test-provider', model: 'small', cwd: '/tmp/agent' },
    with_prompt: { name: 'Prompt', provider: 'test-provider', model: 'small', cwd: '/tmp/agent', systemPrompt: 'Be helpful' },
  }),
}));

const mockGetCliSessionId = vi.fn<(key: string) => string | undefined>();
const mockSetCliSessionId = vi.fn();

vi.mock('../../src/lib/sessions.js', () => ({
  getCliSessionId: (...args: unknown[]) => mockGetCliSessionId(args[0] as string),
  setCliSessionId: (...args: unknown[]) => mockSetCliSessionId(...args),
  stopFlagPath: (key: string) => `/tmp/flags/stop-${key}`,
}));

const mockRunCommand = vi.fn<(cmd: string, args: string[], opts: unknown) => Promise<{ response: string; exitCode: number }>>();
vi.mock('../../src/lib/process-runner.js', () => ({
  runCommand: (...args: unknown[]) => mockRunCommand(args[0] as string, args[1] as string[], args[2]),
}));

vi.mock('../../src/lib/tmux.js', () => ({
  runInTmux: vi.fn(),
  shellEscape: vi.fn(),
}));

vi.mock('../../src/lib/memory.js', () => ({
  readAgentMemory: () => '',
  readSharedMemory: () => '',
  buildMemoryPrompt: (agent: string, shared: string, sys?: string) => sys ?? '',
}));

const mockBuildProviderArgs = vi.fn<() => string[]>();
const mockParseProviderOutput = vi.fn<() => string>();
const mockExtractUsage = vi.fn<() => undefined>();
const mockGetNestedField = vi.fn<() => unknown>();

vi.mock('../../src/lib/providers.js', () => ({
  getProvider: () => ({
    name: 'Test',
    command: 'test-cli',
    models: { small: 'test-small-v1' },
    defaultModel: 'small',
    baseArgs: ['--verbose'],
    modelFlag: '--model',
    promptFlag: '-p',
    session: { startFlag: '--session', resumeFlag: '--resume' },
    output: 'text',
  }),
  buildProviderArgs: (...args: unknown[]) => mockBuildProviderArgs(),
  parseProviderOutput: (...args: unknown[]) => mockParseProviderOutput(),
  extractUsage: (...args: unknown[]) => mockExtractUsage(),
  getNestedField: (...args: unknown[]) => mockGetNestedField(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:fs')>();
  return { ...orig, mkdirSync: vi.fn() };
});

describe('runAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildProviderArgs.mockReturnValue(['--verbose', '-p', 'hello']);
    mockParseProviderOutput.mockReturnValue('agent response');
    mockExtractUsage.mockReturnValue(undefined);
    mockGetCliSessionId.mockReturnValue(undefined);
    mockRunCommand.mockResolvedValue({ response: 'raw output', exitCode: 0 });
  });

  it('throws for unknown agent', async () => {
    await expect(runAgent({
      agentId: 'nonexistent',
      message: 'hello',
      sessionKey: 'sess1',
    })).rejects.toThrow('Agent not found: nonexistent');
  });

  it('creates new session on first message', async () => {
    mockGetCliSessionId.mockReturnValue(undefined);

    const result = await runAgent({
      agentId: 'coder',
      message: 'hello',
      sessionKey: 'sess1',
    });

    expect(mockSetCliSessionId).toHaveBeenCalled();
    expect(result.text).toBe('agent response');
  });

  it('passes provider command and built args to runCommand', async () => {
    mockBuildProviderArgs.mockReturnValue(['--verbose', '-p', 'test msg']);

    await runAgent({
      agentId: 'coder',
      message: 'test msg',
      sessionKey: 'sess1',
    });

    expect(mockRunCommand).toHaveBeenCalledWith(
      'test-cli',
      ['--verbose', '-p', 'test msg'],
      expect.objectContaining({ cwd: '/tmp/agent' }),
    );
  });

  it('returns parsed text from provider output', async () => {
    mockParseProviderOutput.mockReturnValue('parsed result');

    const result = await runAgent({
      agentId: 'coder',
      message: 'hello',
      sessionKey: 'sess1',
    });

    expect(result.text).toBe('parsed result');
  });

  it('returns token usage when available', async () => {
    mockExtractUsage.mockReturnValue({ input: 100, output: 50 } as never);

    const result = await runAgent({
      agentId: 'coder',
      message: 'hello',
      sessionKey: 'sess1',
    });

    expect(result.tokens).toEqual({ input: 100, output: 50 });
  });

  it('resumes existing session', async () => {
    mockGetCliSessionId.mockReturnValue('existing-uuid');

    await runAgent({
      agentId: 'coder',
      message: 'follow up',
      sessionKey: 'sess1',
    });

    // Should not create a new session ID — uses existing
    expect(mockSetCliSessionId).not.toHaveBeenCalled();
  });

  it('propagates RunError from process execution', async () => {
    const { RunError } = await import('../../src/lib/errors.js');
    mockRunCommand.mockRejectedValue(new RunError('Process exited with code 1', 1));

    await expect(runAgent({
      agentId: 'coder',
      message: 'hello',
      sessionKey: 'sess1',
    })).rejects.toThrow('Process exited with code 1');
  });
});
