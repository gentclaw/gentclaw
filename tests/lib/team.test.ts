import { describe, it, expect } from 'vitest';
import { validateTeam } from '../../src/lib/team.js';
import type { Agent, Team } from '../../src/lib/types.js';

const agents: Record<string, Agent> = {
  coder: { name: 'Coder', provider: 'claude', model: 'sonnet', cwd: '/tmp' },
  writer: { name: 'Writer', provider: 'claude', model: 'sonnet', cwd: '/tmp' },
  reviewer: { name: 'Reviewer', provider: 'claude', model: 'haiku', cwd: '/tmp' },
};

describe('validateTeam', () => {
  it('accepts valid team config', () => {
    const team: Team = { name: 'Dev', agents: ['coder', 'writer'], leader: 'coder' };
    expect(validateTeam(team, agents)).toBeNull();
  });

  it('rejects empty agents list', () => {
    const team: Team = { name: 'Empty', agents: [], leader: 'coder' };
    expect(validateTeam(team, agents)).toContain('at least one agent');
  });

  it('rejects unknown agent', () => {
    const team: Team = { name: 'Bad', agents: ['coder', 'unknown'], leader: 'coder' };
    expect(validateTeam(team, agents)).toContain("'unknown' not found");
  });

  it('rejects leader not in agents list', () => {
    const team: Team = { name: 'Bad', agents: ['coder'], leader: 'writer' };
    expect(validateTeam(team, agents)).toContain("'writer' is not in the team");
  });
});

