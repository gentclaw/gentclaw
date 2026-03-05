/** Team CRUD command handlers */

import { getAgents, getSettings, getTeams, updateTeam, removeTeam } from '../config.js';
import { auditLog } from '../audit.js';
import { cmdReply } from '../types.js';
import { splitArgs, parseRef, parseSafeId, parseForceFlag, parseSubcommand } from '../text.js';
import type { CmdResult, CmdContext, Agent, Team } from '../types.js';

/** Validate team config — returns error string or null if valid */
export function validateTeam(team: Team, agents: Record<string, Agent>): string | null {
  if (!team.agents.length) return 'Team must have at least one agent.';
  for (const id of team.agents) {
    if (!agents[id]) return `Agent '${id}' not found.`;
  }
  if (!team.agents.includes(team.leader)) {
    return `Leader '${team.leader}' is not in the team.`;
  }
  return null;
}

/** Parse "<team> <agent>" args with @-prefix stripping and lowercasing */
function parseTeamAgentArgs(args: string): { teamId: string; agentId: string } | null {
  const parts = splitArgs(args);
  if (parts.length < 2) return null;
  return { teamId: parseRef(parts[0] ?? ''), agentId: parseRef(parts[1] ?? '') };
}

type TeamRef = { teamId: string; agentId: string; team: Team };

/** Parse team+agent args and look up the team. Returns CmdResult on validation failure. */
function resolveTeamRef(args: string, usage: string): { ref: TeamRef } | { err: CmdResult } {
  const parsed = parseTeamAgentArgs(args);
  if (!parsed) return { err: cmdReply(usage) };
  const { teamId, agentId } = parsed;
  const teams = getTeams();
  const team = teams[teamId];
  if (!team) return { err: cmdReply(`Team '${teamId}' not found.`) };
  return { ref: { teamId, agentId, team } };
}

export function teamList(): CmdResult {
  const teams = getTeams();
  const ids = Object.keys(teams);
  if (!ids.length) return cmdReply('No teams configured.');
  const lines = ['*Teams:*'];
  for (const [id, t] of Object.entries(teams)) {
    lines.push(`*@${id}* — ${t.name} (leader: @${t.leader}, agents: ${t.agents.join(', ')})`);
  }
  return cmdReply(lines.join('\n'));
}

export function teamShow(args: string): CmdResult {
  const id = parseRef(args.trim());
  if (!id) return cmdReply('Usage: `/team show <id>`');
  const teams = getTeams();
  const team = teams[id];
  if (!team) return cmdReply(`Team '${id}' not found.`);
  const agents = getAgents();
  const lines = [
    `*@${id}* — ${team.name}`,
    `Leader: @${team.leader}`,
    `Agents: ${team.agents.map(a => {
      const cfg = agents[a];
      return cfg ? `@${a} (${cfg.provider}/${cfg.model})` : `@${a} (missing)`;
    }).join(', ')}`,
  ];
  return cmdReply(lines.join('\n'));
}

/** /team add <id> <display-name> <leader> [agent2...] — name must be single word (no spaces) */
export function teamAdd(args: string, ctx: CmdContext): CmdResult {
  const parts = splitArgs(args);
  if (parts.length < 3) {
    return cmdReply('Usage: `/team add <id> <display-name> <leader> [agent2...]` (name: no spaces)');
  }
  const [rawId = '', name = '', rawLeader = '', ...extra] = parts;
  const teamId = parseSafeId(rawId);
  if (!teamId) return cmdReply('Invalid team ID.');

  const settings = getSettings();
  if (settings.teams?.[teamId]) return cmdReply(`Team '${teamId}' already exists.`);
  if (settings.agents?.[teamId]) return cmdReply(`Team ID '${teamId}' conflicts with agent ID.`);

  const leader = parseRef(rawLeader);
  const agentIds = [leader, ...extra.map(parseRef)];
  const unique = [...new Set(agentIds)];
  const team = { name, agents: unique, leader };

  const agents = settings.agents ?? {};
  const err = validateTeam(team, agents);
  if (err) return cmdReply(err);

  updateTeam(teamId, team);
  auditLog({ action: 'cmd:team-add', sender: ctx.sender, detail: args, status: 'allowed' });
  return cmdReply(`Team '${teamId}' created (${unique.length} agents, leader: @${leader}).`);
}

/** /team remove <id> [--force] */
export function teamRemove(args: string, ctx: CmdContext): CmdResult {
  const { cleanArgs, force: hasForce } = parseForceFlag(args);
  const teamId = parseRef(cleanArgs);
  if (!teamId) return cmdReply('Usage: `/team remove <id> [--force]`');

  const teams = getTeams();
  if (!teams[teamId]) return cmdReply(`Team '${teamId}' not found.`);

  if (!hasForce) {
    return cmdReply(`Remove team '${teamId}' (${teams[teamId]?.name ?? teamId})?\nUse \`/team remove ${teamId} --force\` to confirm.`);
  }

  removeTeam(teamId);
  auditLog({ action: 'cmd:team-remove', sender: ctx.sender, detail: teamId, status: 'allowed' });
  return cmdReply(`Team '${teamId}' removed.`);
}

/** /team addagent <team> <agent> */
export function teamAddAgent(args: string, ctx: CmdContext): CmdResult {
  const resolved = resolveTeamRef(args, 'Usage: `/team addagent <team> <agent>`');
  if ('err' in resolved) return resolved.err;
  const { teamId, agentId, team } = resolved.ref;

  const agents = getAgents();
  if (!agents[agentId]) return cmdReply(`Agent '${agentId}' not found.`);
  if (team.agents.includes(agentId)) return cmdReply(`Agent '${agentId}' is already in team '${teamId}'.`);

  updateTeam(teamId, { ...team, agents: [...team.agents, agentId] });
  auditLog({ action: 'cmd:team-addagent', sender: ctx.sender, detail: args, status: 'allowed' });
  return cmdReply(`Added @${agentId} to team '${teamId}'.`);
}

/** /team setleader <team> <agent> */
export function teamSetLeader(args: string, ctx: CmdContext): CmdResult {
  const resolved = resolveTeamRef(args, 'Usage: `/team setleader <team> <agent>`');
  if ('err' in resolved) return resolved.err;
  const { teamId, agentId, team } = resolved.ref;

  if (!team.agents.includes(agentId)) return cmdReply(`Agent '${agentId}' is not in team '${teamId}'.`);
  if (team.leader === agentId) return cmdReply(`Agent '${agentId}' is already leader of '${teamId}'.`);

  updateTeam(teamId, { ...team, leader: agentId });
  auditLog({ action: 'cmd:team-setleader', sender: ctx.sender, detail: args, status: 'allowed' });
  return cmdReply(`Team '${teamId}' leader changed to @${agentId}.`);
}

/** /team removeagent <team> <agent> */
export function teamRemoveAgent(args: string, ctx: CmdContext): CmdResult {
  const resolved = resolveTeamRef(args, 'Usage: `/team removeagent <team> <agent>`');
  if ('err' in resolved) return resolved.err;
  const { teamId, agentId, team } = resolved.ref;

  if (!team.agents.includes(agentId)) return cmdReply(`Agent '${agentId}' is not in team '${teamId}'.`);
  if (team.leader === agentId) return cmdReply('Cannot remove leader. Use `/team setleader` first or remove the team.');
  if (team.agents.length <= 1) return cmdReply('Cannot remove last agent from team. Remove the team instead.');

  updateTeam(teamId, { ...team, agents: team.agents.filter(a => a !== agentId) });
  auditLog({ action: 'cmd:team-removeagent', sender: ctx.sender, detail: args, status: 'allowed' });
  return cmdReply(`Removed @${agentId} from team '${teamId}'.`);
}

/** Dispatch /team subcommands */
export function dispatchTeamCommand(args: string, ctx: CmdContext): CmdResult {
  const { sub, subArgs } = parseSubcommand(args);

  if (sub === 'show') return teamShow(subArgs);
  if (sub === 'add') return teamAdd(subArgs, ctx);
  if (sub === 'remove' || sub === 'rm') return teamRemove(subArgs, ctx);
  if (sub === 'addagent') return teamAddAgent(subArgs, ctx);
  if (sub === 'removeagent') return teamRemoveAgent(subArgs, ctx);
  if (sub === 'setleader') return teamSetLeader(subArgs, ctx);
  return teamList();
}
