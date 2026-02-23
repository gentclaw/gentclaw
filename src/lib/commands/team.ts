/** Team CRUD command handlers */

import { getAgents, getSettings, getTeams, updateSettings } from '../config.js';
import { validateTeam } from '../team.js';
import { auditLog } from '../audit.js';

type CmdResult = {
  response: string;
  skipInvoke: boolean;
  agent?: string;
};

type CmdContext = {
  sessionKey: string;
  sender: string;
};

/** Parse "<team> <agent>" args with @-prefix stripping and lowercasing */
function parseTeamAgentArgs(args: string): { teamId: string; agentId: string } | null {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return {
    teamId: parts[0]!.replace(/^@/, '').toLowerCase(),
    agentId: parts[1]!.replace(/^@/, '').toLowerCase(),
  };
}

export function teamList(): CmdResult {
  const teams = getTeams();
  const ids = Object.keys(teams);
  if (!ids.length) return { response: 'No teams configured.', skipInvoke: true };
  const lines = ['*Teams:*'];
  for (const [id, t] of Object.entries(teams)) {
    lines.push(`*@${id}* — ${t.name} (leader: @${t.leader}, agents: ${t.agents.join(', ')})`);
  }
  return { response: lines.join('\n'), skipInvoke: true };
}

export function teamShow(args: string): CmdResult {
  const id = args.trim().replace(/^@/, '').toLowerCase();
  if (!id) return { response: 'Usage: `/team show <id>`', skipInvoke: true };
  const teams = getTeams();
  const t = teams[id];
  if (!t) return { response: `Team '${id}' not found.`, skipInvoke: true };
  const agents = getAgents();
  const lines = [
    `*@${id}* — ${t.name}`,
    `Leader: @${t.leader}`,
    `Agents: ${t.agents.map(a => {
      const cfg = agents[a];
      return cfg ? `@${a} (${cfg.provider}/${cfg.model})` : `@${a} (missing)`;
    }).join(', ')}`,
  ];
  return { response: lines.join('\n'), skipInvoke: true };
}

/** /team add <id> <display-name> <leader> [agent2...] — name must be single word (no spaces) */
export function teamAdd(args: string, ctx: CmdContext): CmdResult {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length < 3) {
    return { response: 'Usage: `/team add <id> <display-name> <leader> [agent2...]` (name: no spaces)', skipInvoke: true };
  }
  const [rawId, name, rawLeader, ...extra] = parts;
  const teamId = rawId!.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!teamId) return { response: 'Invalid team ID.', skipInvoke: true };

  const settings = getSettings();
  if (settings.teams?.[teamId]) return { response: `Team '${teamId}' already exists.`, skipInvoke: true };
  if (settings.agents?.[teamId]) return { response: `Team ID '${teamId}' conflicts with agent ID.`, skipInvoke: true };

  const leader = rawLeader!.replace(/^@/, '').toLowerCase();
  const agentIds = [leader, ...extra.map(a => a.replace(/^@/, '').toLowerCase())];
  const unique = [...new Set(agentIds)];
  const team = { name: name!, agents: unique, leader };

  const agents = settings.agents ?? {};
  const err = validateTeam(team, agents);
  if (err) return { response: err, skipInvoke: true };

  updateSettings(s => ({ ...s, teams: { ...s.teams, [teamId]: team } }));
  auditLog({ action: 'cmd:team-add', sender: ctx.sender, detail: args, status: 'allowed' });
  return { response: `Team '${teamId}' created (${unique.length} agents, leader: @${leader}).`, skipInvoke: true };
}

/** /team remove <id> [--force] */
export function teamRemove(args: string, ctx: CmdContext): CmdResult {
  const hasForce = /--force\b/.test(args);
  const cleanArgs = args.replace(/--force\s*/g, '').trim();
  const teamId = cleanArgs.replace(/^@/, '').toLowerCase();
  if (!teamId) return { response: 'Usage: `/team remove <id> [--force]`', skipInvoke: true };

  const teams = getTeams();
  if (!teams[teamId]) return { response: `Team '${teamId}' not found.`, skipInvoke: true };

  if (!hasForce) {
    return { response: `Remove team '${teamId}' (${teams[teamId]!.name})?\nUse \`/team remove ${teamId} --force\` to confirm.`, skipInvoke: true };
  }

  updateSettings(s => {
    const updated = { ...s, teams: { ...s.teams } };
    delete updated.teams![teamId];
    return updated;
  });

  auditLog({ action: 'cmd:team-remove', sender: ctx.sender, detail: teamId, status: 'allowed' });
  return { response: `Team '${teamId}' removed.`, skipInvoke: true };
}

/** /team addagent <team> <agent> */
export function teamAddAgent(args: string, ctx: CmdContext): CmdResult {
  const parsed = parseTeamAgentArgs(args);
  if (!parsed) return { response: 'Usage: `/team addagent <team> <agent>`', skipInvoke: true };
  const { teamId, agentId } = parsed;

  const teams = getTeams();
  if (!teams[teamId]) return { response: `Team '${teamId}' not found.`, skipInvoke: true };

  const agents = getAgents();
  if (!agents[agentId]) return { response: `Agent '${agentId}' not found.`, skipInvoke: true };
  if (teams[teamId]!.agents.includes(agentId)) return { response: `Agent '${agentId}' is already in team '${teamId}'.`, skipInvoke: true };

  updateSettings(s => {
    const team = { ...s.teams![teamId]!, agents: [...s.teams![teamId]!.agents, agentId] };
    return { ...s, teams: { ...s.teams, [teamId]: team } };
  });

  auditLog({ action: 'cmd:team-addagent', sender: ctx.sender, detail: args, status: 'allowed' });
  return { response: `Added @${agentId} to team '${teamId}'.`, skipInvoke: true };
}

/** /team setleader <team> <agent> */
export function teamSetLeader(args: string, ctx: CmdContext): CmdResult {
  const parsed = parseTeamAgentArgs(args);
  if (!parsed) return { response: 'Usage: `/team setleader <team> <agent>`', skipInvoke: true };
  const { teamId, agentId } = parsed;

  const teams = getTeams();
  if (!teams[teamId]) return { response: `Team '${teamId}' not found.`, skipInvoke: true };

  const team = teams[teamId]!;
  if (!team.agents.includes(agentId)) return { response: `Agent '${agentId}' is not in team '${teamId}'.`, skipInvoke: true };
  if (team.leader === agentId) return { response: `Agent '${agentId}' is already leader of '${teamId}'.`, skipInvoke: true };

  updateSettings(s => ({
    ...s,
    teams: { ...s.teams, [teamId]: { ...team, leader: agentId } },
  }));

  auditLog({ action: 'cmd:team-setleader', sender: ctx.sender, detail: args, status: 'allowed' });
  return { response: `Team '${teamId}' leader changed to @${agentId}.`, skipInvoke: true };
}

/** /team removeagent <team> <agent> */
export function teamRemoveAgent(args: string, ctx: CmdContext): CmdResult {
  const parsed = parseTeamAgentArgs(args);
  if (!parsed) return { response: 'Usage: `/team removeagent <team> <agent>`', skipInvoke: true };
  const { teamId, agentId } = parsed;

  const teams = getTeams();
  if (!teams[teamId]) return { response: `Team '${teamId}' not found.`, skipInvoke: true };

  const team = teams[teamId]!;
  if (!team.agents.includes(agentId)) return { response: `Agent '${agentId}' is not in team '${teamId}'.`, skipInvoke: true };
  if (team.leader === agentId) return { response: 'Cannot remove leader. Use `/team setleader` first or remove the team.', skipInvoke: true };
  if (team.agents.length <= 1) return { response: 'Cannot remove last agent from team. Remove the team instead.', skipInvoke: true };

  updateSettings(s => {
    const updated = { ...s.teams![teamId]!, agents: s.teams![teamId]!.agents.filter(a => a !== agentId) };
    return { ...s, teams: { ...s.teams, [teamId]: updated } };
  });

  auditLog({ action: 'cmd:team-removeagent', sender: ctx.sender, detail: args, status: 'allowed' });
  return { response: `Removed @${agentId} from team '${teamId}'.`, skipInvoke: true };
}

/** Dispatch /team subcommands */
export function dispatchTeamCommand(args: string, ctx: CmdContext): CmdResult {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const subArgs = parts.slice(1).join(' ');

  if (sub === 'show') return teamShow(subArgs);
  if (sub === 'add') return teamAdd(subArgs, ctx);
  if (sub === 'remove' || sub === 'rm') return teamRemove(subArgs, ctx);
  if (sub === 'addagent') return teamAddAgent(subArgs, ctx);
  if (sub === 'removeagent') return teamRemoveAgent(subArgs, ctx);
  if (sub === 'setleader') return teamSetLeader(subArgs, ctx);
  return teamList();
}
