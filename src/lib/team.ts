/** Team utilities — pure functions for team lookups and validation */

import type { Team, Agent } from './types.js';

/** Find which team an agent belongs to. Returns first match. */
export function findTeamForAgent(
  agentId: string,
  teams: Record<string, Team>,
): { teamId: string; team: Team } | null {
  for (const [teamId, team] of Object.entries(teams)) {
    if (team.agents.includes(agentId)) return { teamId, team };
  }
  return null;
}

/** Validate team config — returns error string or null if valid */
export function validateTeam(
  team: Team,
  agents: Record<string, Agent>,
): string | null {
  if (!team.agents.length) return 'Team must have at least one agent.';
  for (const id of team.agents) {
    if (!agents[id]) return `Agent '${id}' not found.`;
  }
  if (!team.agents.includes(team.leader)) {
    return `Leader '${team.leader}' is not in the team.`;
  }
  return null;
}
