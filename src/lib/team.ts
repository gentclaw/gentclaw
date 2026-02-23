/** Team utilities — pure functions for team validation */

import type { Team, Agent } from './types.js';

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
