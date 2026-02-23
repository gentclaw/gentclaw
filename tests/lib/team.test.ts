import { describe, it, expect } from 'vitest';
import { validateTeam, findTeamForAgent } from '../../src/lib/team.js';
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

describe('findTeamForAgent', () => {
  const teams: Record<string, Team> = {
    dev: { name: 'Dev Team', agents: ['coder', 'reviewer'], leader: 'coder' },
    content: { name: 'Content', agents: ['writer'], leader: 'writer' },
  };

  it('finds team for agent', () => {
    const result = findTeamForAgent('coder', teams);
    expect(result).not.toBeNull();
    expect(result!.teamId).toBe('dev');
  });

  it('returns null for agent not in any team', () => {
    expect(findTeamForAgent('unknown', teams)).toBeNull();
  });

  it('finds first team when agent is in multiple', () => {
    const overlapping = {
      ...teams,
      both: { name: 'Both', agents: ['coder', 'writer'], leader: 'coder' },
    };
    const result = findTeamForAgent('coder', overlapping);
    expect(result).not.toBeNull();
    expect(result!.teamId).toBe('dev');
  });
});
