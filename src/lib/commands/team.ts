/** Team CRUD command handlers */

import { getAgents, getSettings, getTeams, updateSettings } from '../config.js';
import { validateTeam } from '../team.js';
import { auditLog } from '../audit.js';
import { parseRef, parseSafeId, parseForceFlag } from '../parse-ref.js';
import { cmdReply } from '../types.js';
import type { CmdResult, CmdContext } from '../types.js';

/** Parse "<team> <agent>" args with @-prefix stripping and lowercasing */
function parseTeamAgentArgs(args: string): { teamId: string; agentId: string } | null {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { teamId: parseRef(parts[0]!), agentId: parseRef(parts[1]!) };
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
  const t = teams[id];
  if (!t) return cmdReply(`Team '${id}' not found.`);
  const agents = getAgents();
  const lines = [
    `*@${id}* — ${t.name}`,
    `Leader: @${t.leader}`,
    `Agents: ${t.agents.map(a => {
      const cfg = agents[a];
      return cfg ? `@${a} (${cfg.provider}/${cfg.model})` : `@${a} (missing)`;
    }).join(', ')}`,
  ];
  return cmdReply(lines.join('\n'));
}

/** /team add <id> <display-name> <leader> [agent2...] — name must be single word (no spaces) */
export function teamAdd(args: string, ctx: CmdContext): CmdResult {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length < 3) {
    return cmdReply('Usage: `/team add <id> <display-name> <leader> [agent2...]` (name: no spaces)');
  }
  const [rawId, name, rawLeader, ...extra] = parts;
  const teamId = parseSafeId(rawId!);
  if (!teamId) return cmdReply('Invalid team ID.');

  const settings = getSettings();
  if (settings.teams?.[teamId]) return cmdReply(`Team '${teamId}' already exists.`);
  if (settings.agents?.[teamId]) return cmdReply(`Team ID '${teamId}' conflicts with agent ID.`);

  const leader = parseRef(rawLeader!);
  const agentIds = [leader, ...extra.map(parseRef)];
  const unique = [...new Set(agentIds)];
  const team = { name: name!, agents: unique, leader };

  const agents = settings.agents ?? {};
  const err = validateTeam(team, agents);
  if (err) return cmdReply(err);

  updateSettings(s => ({ ...s, teams: { ...s.teams, [teamId]: team } }));
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
    return cmdReply(`Remove team '${teamId}' (${teams[teamId]!.name})?\nUse \`/team remove ${teamId} --force\` to confirm.`);
  }

  updateSettings(s => {
    const updated = { ...s, teams: { ...s.teams } };
    delete updated.teams![teamId];
    return updated;
  });

  auditLog({ action: 'cmd:team-remove', sender: ctx.sender, detail: teamId, status: 'allowed' });
  return cmdReply(`Team '${teamId}' removed.`);
}

/** /team addagent <team> <agent> */
export function teamAddAgent(args: string, ctx: CmdContext): CmdResult {
  const parsed = parseTeamAgentArgs(args);
  if (!parsed) return cmdReply('Usage: `/team addagent <team> <agent>`');
  const { teamId, agentId } = parsed;

  const teams = getTeams();
  if (!teams[teamId]) return cmdReply(`Team '${teamId}' not found.`);

  const agents = getAgents();
  if (!agents[agentId]) return cmdReply(`Agent '${agentId}' not found.`);
  if (teams[teamId]!.agents.includes(agentId)) return cmdReply(`Agent '${agentId}' is already in team '${teamId}'.`);

  updateSettings(s => {
    const team = { ...s.teams![teamId]!, agents: [...s.teams![teamId]!.agents, agentId] };
    return { ...s, teams: { ...s.teams, [teamId]: team } };
  });

  auditLog({ action: 'cmd:team-addagent', sender: ctx.sender, detail: args, status: 'allowed' });
  return cmdReply(`Added @${agentId} to team '${teamId}'.`);
}

/** /team setleader <team> <agent> */
export function teamSetLeader(args: string, ctx: CmdContext): CmdResult {
  const parsed = parseTeamAgentArgs(args);
  if (!parsed) return cmdReply('Usage: `/team setleader <team> <agent>`');
  const { teamId, agentId } = parsed;

  const teams = getTeams();
  if (!teams[teamId]) return cmdReply(`Team '${teamId}' not found.`);

  const team = teams[teamId]!;
  if (!team.agents.includes(agentId)) return cmdReply(`Agent '${agentId}' is not in team '${teamId}'.`);
  if (team.leader === agentId) return cmdReply(`Agent '${agentId}' is already leader of '${teamId}'.`);

  updateSettings(s => ({
    ...s,
    teams: { ...s.teams, [teamId]: { ...team, leader: agentId } },
  }));

  auditLog({ action: 'cmd:team-setleader', sender: ctx.sender, detail: args, status: 'allowed' });
  return cmdReply(`Team '${teamId}' leader changed to @${agentId}.`);
}

/** /team removeagent <team> <agent> */
export function teamRemoveAgent(args: string, ctx: CmdContext): CmdResult {
  const parsed = parseTeamAgentArgs(args);
  if (!parsed) return cmdReply('Usage: `/team removeagent <team> <agent>`');
  const { teamId, agentId } = parsed;

  const teams = getTeams();
  if (!teams[teamId]) return cmdReply(`Team '${teamId}' not found.`);

  const team = teams[teamId]!;
  if (!team.agents.includes(agentId)) return cmdReply(`Agent '${agentId}' is not in team '${teamId}'.`);
  if (team.leader === agentId) return cmdReply('Cannot remove leader. Use `/team setleader` first or remove the team.');
  if (team.agents.length <= 1) return cmdReply('Cannot remove last agent from team. Remove the team instead.');

  updateSettings(s => {
    const updated = { ...s.teams![teamId]!, agents: s.teams![teamId]!.agents.filter(a => a !== agentId) };
    return { ...s, teams: { ...s.teams, [teamId]: updated } };
  });

  auditLog({ action: 'cmd:team-removeagent', sender: ctx.sender, detail: args, status: 'allowed' });
  return cmdReply(`Removed @${agentId} from team '${teamId}'.`);
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
