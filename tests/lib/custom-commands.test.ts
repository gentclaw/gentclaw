import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveCustomCommand,
  listCustomCommands,
  parseFrontmatter,
  discoverSkills,
  listSkills,
} from '../../src/lib/custom-commands.js';

const mockGetSettings = vi.fn();

vi.mock('../../src/lib/config.js', () => ({
  getSettings: () => mockGetSettings(),
}));

// Mock fs for skill discovery
const mockReaddirSync = vi.fn();
const mockStatSync = vi.fn();
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('node:fs', () => ({
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

describe('parseFrontmatter', () => {
  it('parses frontmatter with description and agent', () => {
    const content = '---\ndescription: Review PRs\nagent: coder\n---\nPlease review $ARGUMENTS';
    const { meta, body } = parseFrontmatter(content);
    expect(meta).toEqual({ description: 'Review PRs', agent: 'coder' });
    expect(body).toBe('Please review $ARGUMENTS');
  });

  it('returns full content as body when no frontmatter', () => {
    const content = 'Just a prompt with no frontmatter';
    const { meta, body } = parseFrontmatter(content);
    expect(meta).toEqual({});
    expect(body).toBe('Just a prompt with no frontmatter');
  });

  it('handles frontmatter with only description', () => {
    const content = '---\ndescription: Simple skill\n---\nDo the thing';
    const { meta, body } = parseFrontmatter(content);
    expect(meta).toEqual({ description: 'Simple skill' });
    expect(body).toBe('Do the thing');
  });

  it('trims whitespace from body', () => {
    const content = '---\ndescription: test\n---\n\n  body text  \n\n';
    const { body } = parseFrontmatter(content);
    expect(body).toBe('body text');
  });
});

describe('discoverSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discovers valid SKILL.md files', () => {
    mockReaddirSync.mockReturnValue(['review-pr', 'summarize']);
    mockStatSync.mockReturnValue({ isDirectory: () => true });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync
      .mockReturnValueOnce('---\ndescription: Review PRs\nagent: coder\n---\nReview $ARGUMENTS')
      .mockReturnValueOnce('---\ndescription: Summarize text\n---\nSummarize: $ARGUMENTS');

    const skills = discoverSkills();
    expect(skills['review-pr']).toEqual({
      description: 'Review PRs',
      prompt: 'Review $ARGUMENTS',
      agent: 'coder',
    });
    expect(skills['summarize']).toEqual({
      description: 'Summarize text',
      prompt: 'Summarize: $ARGUMENTS',
      agent: undefined,
    });
  });

  it('returns empty when skills dir does not exist', () => {
    mockReaddirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(discoverSkills()).toEqual({});
  });

  it('skips non-directory entries', () => {
    mockReaddirSync.mockReturnValue(['file.txt']);
    mockStatSync.mockReturnValue({ isDirectory: () => false });
    expect(discoverSkills()).toEqual({});
  });

  it('skips directories without SKILL.md', () => {
    mockReaddirSync.mockReturnValue(['no-skill']);
    mockStatSync.mockReturnValue({ isDirectory: () => true });
    mockExistsSync.mockReturnValue(false);
    expect(discoverSkills()).toEqual({});
  });

  it('skips SKILL.md with empty body', () => {
    mockReaddirSync.mockReturnValue(['empty']);
    mockStatSync.mockReturnValue({ isDirectory: () => true });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('---\ndescription: Empty\n---\n');
    expect(discoverSkills()).toEqual({});
  });

  it('skips reserved names', () => {
    mockReaddirSync.mockReturnValue(['help']);
    mockStatSync.mockReturnValue({ isDirectory: () => true });
    mockExistsSync.mockReturnValue(true);
    expect(discoverSkills()).toEqual({});
  });

  it('uses default description when frontmatter has none', () => {
    mockReaddirSync.mockReturnValue(['my-skill']);
    mockStatSync.mockReturnValue({ isDirectory: () => true });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('Just a prompt body');

    const skills = discoverSkills();
    expect(skills['my-skill']!.description).toBe('Skill: my-skill');
  });
});

describe('resolveCustomCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockReturnValue({
      commands: {
        review: { description: 'Review code', prompt: 'Review this: $ARGUMENTS', agent: 'coder' },
        summarize: { description: 'Summarize', prompt: 'Summarize: $ARGUMENTS' },
      },
    });
    // Default: no skills dir
    mockReaddirSync.mockImplementation(() => { throw new Error('ENOENT'); });
  });

  it('resolves a known custom command with $ARGUMENTS', () => {
    const result = resolveCustomCommand('review', 'my code');
    expect(result).toEqual({ message: 'Review this: my code', agent: 'coder' });
  });

  it('resolves command without agent routing', () => {
    const result = resolveCustomCommand('summarize', 'this text');
    expect(result).toEqual({ message: 'Summarize: this text', agent: undefined });
  });

  it('trims args before interpolation', () => {
    const result = resolveCustomCommand('review', '  spaced  ');
    expect(result!.message).toBe('Review this: spaced');
  });

  it('returns null for unknown command', () => {
    expect(resolveCustomCommand('unknown', 'args')).toBeNull();
  });

  it('returns null for reserved command names', () => {
    expect(resolveCustomCommand('help', 'args')).toBeNull();
    expect(resolveCustomCommand('status', 'args')).toBeNull();
    expect(resolveCustomCommand('reload', 'args')).toBeNull();
  });

  it('returns null when no commands configured', () => {
    mockGetSettings.mockReturnValue({});
    expect(resolveCustomCommand('review', 'args')).toBeNull();
  });

  it('replaces multiple $ARGUMENTS occurrences', () => {
    mockGetSettings.mockReturnValue({
      commands: {
        double: { description: 'test', prompt: '$ARGUMENTS and $ARGUMENTS' },
      },
    });
    const result = resolveCustomCommand('double', 'foo');
    expect(result!.message).toBe('foo and foo');
  });

  it('falls back to skill when no settings command matches', () => {
    mockGetSettings.mockReturnValue({});
    mockReaddirSync.mockReturnValue(['deploy']);
    mockStatSync.mockReturnValue({ isDirectory: () => true });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('---\ndescription: Deploy\nagent: ops\n---\nDeploy $ARGUMENTS');

    const result = resolveCustomCommand('deploy', 'prod');
    expect(result).toEqual({ message: 'Deploy prod', agent: 'ops' });
  });

  it('settings command wins over same-named skill', () => {
    mockGetSettings.mockReturnValue({
      commands: {
        review: { description: 'Settings review', prompt: 'Settings: $ARGUMENTS', agent: 'coder' },
      },
    });
    mockReaddirSync.mockReturnValue(['review']);
    mockStatSync.mockReturnValue({ isDirectory: () => true });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('---\ndescription: Skill review\n---\nSkill: $ARGUMENTS');

    const result = resolveCustomCommand('review', 'test');
    expect(result!.message).toBe('Settings: test');
  });
});

describe('listCustomCommands', () => {
  it('returns all non-reserved custom commands', () => {
    mockGetSettings.mockReturnValue({
      commands: {
        review: { description: 'Review', prompt: 'Review: $ARGUMENTS' },
        help: { description: 'Override', prompt: 'nope' },
      },
    });
    const result = listCustomCommands();
    expect(result).toHaveProperty('review');
    expect(result).not.toHaveProperty('help');
  });

  it('returns empty when no commands configured', () => {
    mockGetSettings.mockReturnValue({});
    expect(listCustomCommands()).toEqual({});
  });
});

describe('listSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns skills not shadowed by custom commands', () => {
    mockGetSettings.mockReturnValue({
      commands: {
        review: { description: 'Custom review', prompt: 'Custom: $ARGUMENTS' },
      },
    });
    mockReaddirSync.mockReturnValue(['review', 'deploy']);
    mockStatSync.mockReturnValue({ isDirectory: () => true });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync
      .mockReturnValueOnce('---\ndescription: Skill review\n---\nSkill review body')
      .mockReturnValueOnce('---\ndescription: Deploy\n---\nDeploy body');

    const skills = listSkills();
    expect(skills).not.toHaveProperty('review'); // shadowed by custom command
    expect(skills).toHaveProperty('deploy');
  });

  it('returns empty when no skills exist', () => {
    mockGetSettings.mockReturnValue({});
    mockReaddirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(listSkills()).toEqual({});
  });
});
