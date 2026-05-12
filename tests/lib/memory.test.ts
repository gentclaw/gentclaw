import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('node:fs');
vi.mock('../../src/lib/paths.js', () => ({
  PATHS: { memory: '/mem' },
}));

import {
  MEMORY_FILE, SHARED_MEMORY_FILE, MEMORY_MAX_LINES, ENTRY_MAX_LINES, ENTRY_MAX_BYTES,
  readMemoryFile, appendMemoryFile,
  readAgentMemory, clearAgentMemory,
  readSharedMemory, appendSharedMemory, clearSharedMemory,
  buildMemoryPrompt, stripMemoryTags, extractMemoryFromResponse,
} from '../../src/lib/memory.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: new Date('2026-02-23T14:30:00.000Z') });
});

// ─── constants ───────────────────────────────────────────────────

describe('constants', () => {
  it('exports expected values', () => {
    expect(MEMORY_FILE).toBe('memory.md');
    expect(SHARED_MEMORY_FILE).toBe('shared-memory.md');
    expect(MEMORY_MAX_LINES).toBe(200);
    expect(ENTRY_MAX_LINES).toBe(20);
  });
});

// ─── readMemoryFile ──────────────────────────────────────────────

describe('readMemoryFile', () => {
  it('returns empty string when file is missing', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    expect(readMemoryFile('/dir', 'memory.md')).toBe('');
  });

  it('returns content when file exists', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('saved memory');
    expect(readMemoryFile('/dir', 'memory.md')).toBe('saved memory');
    expect(fs.readFileSync).toHaveBeenCalledWith(path.join('/dir', 'memory.md'), 'utf8');
  });
});

// ─── appendMemoryFile ────────────────────────────────────────────

describe('appendMemoryFile', () => {
  it('creates new file with timestamped entry via atomic write', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    appendMemoryFile('/dir', 'memory.md', 'first note');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.tmp-'),
      expect.stringContaining('first note'),
      { encoding: 'utf-8', mode: 0o600 },
    );
    expect(fs.renameSync).toHaveBeenCalledWith(
      expect.stringContaining('.tmp-'),
      path.join('/dir', 'memory.md'),
    );
  });

  it('appends to existing content', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('<!-- 2026-02-23T10:00:00.000Z -->\nexisting\n');
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    appendMemoryFile('/dir', 'memory.md', 'new note');

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('existing');
    expect(written).toContain('new note');
  });

  it('entry-based FIFO trim drops oldest entries first', () => {
    const entries = Array.from({ length: 50 }, (_, i) =>
      `<!-- 2026-02-23T${String(i).padStart(2, '0')}:00:00.000Z -->\n${'line\n'.repeat(4)}`,
    ).join('');
    vi.mocked(fs.readFileSync).mockReturnValue(entries);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    appendMemoryFile('/dir', 'memory.md', 'overflow note');

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const lineCount = written.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(MEMORY_MAX_LINES);
    expect(written).toContain('overflow note');
    expect(written).not.toContain('T00:00:00');
  });
});

// ─── per-entry size cap ──────────────────────────────────────────

describe('per-entry size cap', () => {
  it('truncates entries exceeding ENTRY_MAX_LINES', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const hugeContent = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    appendMemoryFile('/dir', 'memory.md', hugeContent);

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('…(truncated)');
  });

  it('does not truncate entries within limit', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    appendMemoryFile('/dir', 'memory.md', 'short note');

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).not.toContain('…(truncated)');
  });

  it('truncates entries exceeding ENTRY_MAX_BYTES', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const huge = 'x'.repeat(ENTRY_MAX_BYTES + 1000);
    appendMemoryFile('/dir', 'memory.md', huge);

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    // Capped content (excluding timestamp wrapper) must be within ENTRY_MAX_BYTES
    const entryBody = written.replace(/^<!-- [^>]+-->\n/, '').replace(/\n$/, '');
    expect(Buffer.byteLength(entryBody, 'utf8')).toBeLessThanOrEqual(ENTRY_MAX_BYTES);
    expect(written).toContain('…(truncated)');
  });
});

// ─── agent memory convenience wrappers ───────────────────────────

describe('readAgentMemory', () => {
  it('reads from agent memory dir', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('agent mem');
    expect(readAgentMemory('bot')).toBe('agent mem');
    expect(fs.readFileSync).toHaveBeenCalledWith(path.join('/mem', 'bot', 'memory.md'), 'utf8');
  });
});

describe('clearAgentMemory', () => {
  it('deletes the memory file', () => {
    vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);
    clearAgentMemory('bot');
    expect(fs.unlinkSync).toHaveBeenCalledWith(path.join('/mem', 'bot', 'memory.md'));
  });

  it('no-op when file is missing', () => {
    vi.mocked(fs.unlinkSync).mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => clearAgentMemory('bot')).not.toThrow();
  });
});

// ─── shared memory ───────────────────────────────────────────────

describe('readSharedMemory', () => {
  it('reads shared-memory.md from memory root', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('shared data');
    expect(readSharedMemory()).toBe('shared data');
    expect(fs.readFileSync).toHaveBeenCalledWith(path.join('/mem', 'shared-memory.md'), 'utf8');
  });
});

describe('appendSharedMemory', () => {
  it('writes to memory root shared-memory.md', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    appendSharedMemory('shared fact');

    expect(fs.renameSync).toHaveBeenCalledWith(
      expect.stringContaining('.tmp-'),
      path.join('/mem', 'shared-memory.md'),
    );
  });
});

describe('clearSharedMemory', () => {
  it('deletes shared-memory.md', () => {
    vi.mocked(fs.unlinkSync).mockImplementation(() => undefined);
    clearSharedMemory();
    expect(fs.unlinkSync).toHaveBeenCalledWith(path.join('/mem', 'shared-memory.md'));
  });
});

// ─── buildMemoryPrompt ───────────────────────────────────────────

describe('buildMemoryPrompt', () => {
  it('includes both agent and shared memory blocks', () => {
    const result = buildMemoryPrompt('agent mem', 'shared mem');
    expect(result).toContain('<shared-memory>');
    expect(result).toContain('shared mem');
    expect(result).toContain('<agent-memory>');
    expect(result).toContain('agent mem');
  });

  it('omits shared-memory block when empty', () => {
    const result = buildMemoryPrompt('agent mem', '');
    expect(result).not.toContain('<shared-memory>\n');
    expect(result).toContain('<agent-memory>');
  });

  it('omits agent-memory block when empty', () => {
    const result = buildMemoryPrompt('', 'shared mem');
    expect(result).toContain('<shared-memory>');
    expect(result).not.toContain('<agent-memory>');
  });

  it('appends existing system prompt', () => {
    const result = buildMemoryPrompt('mem', '', 'You are helpful.');
    expect(result).toContain('You are helpful.');
    expect(result).toContain('<agent-memory>');
  });

  it('includes save instructions for both memory types', () => {
    const result = buildMemoryPrompt('m', 's');
    expect(result).toContain('<memory>');
    expect(result).toContain('<shared-memory>content</shared-memory>');
  });
});

// ─── stripMemoryTags ─────────────────────────────────────────────

describe('stripMemoryTags', () => {
  it('strips single memory tag', () => {
    expect(stripMemoryTags('before <memory>note</memory> after')).toBe('before  after');
  });

  it('strips shared-memory tags', () => {
    expect(stripMemoryTags('before <shared-memory>note</shared-memory> after')).toBe('before  after');
  });

  it('strips both tag types', () => {
    expect(stripMemoryTags('<memory>a</memory> text <shared-memory>b</shared-memory>')).toBe('text');
  });

  it('is case-insensitive', () => {
    expect(stripMemoryTags('<Memory>note</MEMORY> text')).toBe('text');
    expect(stripMemoryTags('<Shared-Memory>note</SHARED-MEMORY> text')).toBe('text');
  });

  it('preserves text without memory tags', () => {
    expect(stripMemoryTags('just normal text')).toBe('just normal text');
  });

  it('handles multiline content in tags', () => {
    const input = 'before\n<memory>\nline1\nline2\n</memory>\nafter';
    const result = stripMemoryTags(input);
    expect(result).not.toContain('line1');
    expect(result).toContain('before');
    expect(result).toContain('after');
  });
});

// ─── extractMemoryFromResponse ───────────────────────────────────

describe('extractMemoryFromResponse', () => {
  it('returns unchanged response when no tags', () => {
    expect(extractMemoryFromResponse('bot', 'plain response')).toBe('plain response');
  });

  it('extracts agent memory and strips from response', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const result = extractMemoryFromResponse('bot', 'hello <memory>remember this</memory> world');

    expect(result).toBe('hello  world');
    expect(fs.renameSync).toHaveBeenCalledWith(
      expect.stringContaining('.tmp-'),
      path.join('/mem', 'bot', 'memory.md'),
    );
  });

  it('extracts shared memory', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const result = extractMemoryFromResponse('bot', 'hello <shared-memory>team fact</shared-memory> world');

    expect(result).toBe('hello  world');
    expect(fs.renameSync).toHaveBeenCalledWith(
      expect.stringContaining('.tmp-'),
      path.join('/mem', 'shared-memory.md'),
    );
  });

  it('extracts both agent and shared memory from same response', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    const result = extractMemoryFromResponse('bot', '<memory>private</memory> mid <shared-memory>public</shared-memory>');

    expect(result).toBe('mid');
    expect(fs.renameSync).toHaveBeenCalledTimes(2);
  });

  it('caps tags processed per response to prevent bulk memory pollution', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.renameSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

    // 20 agent + 20 shared tags — only MAX_MEMORY_TAGS_PER_RESPONSE (5) of each should be honoured.
    const agent = Array.from({ length: 20 }, (_, i) => `<memory>a${i}</memory>`).join(' ');
    const shared = Array.from({ length: 20 }, (_, i) => `<shared-memory>s${i}</shared-memory>`).join(' ');
    const result = extractMemoryFromResponse('bot', `${agent} keep ${shared}`);

    // All tags stripped from visible response regardless of cap
    expect(result).toBe('keep');
    // 5 agent writes + 5 shared writes = 10 renameSync calls
    expect(fs.renameSync).toHaveBeenCalledTimes(10);
  });
});
