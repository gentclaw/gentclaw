/** Agent CRUD command handlers */

import { getAgents, getDefaultAgentId, getSettings, updateSettings } from '../config.js';
import { listProviders, getProvider } from '../providers.js';
import { auditLog } from '../audit.js';
import { parseRef, parseSafeId } from '../parse-ref.js';
import type { CmdResult, CmdContext } from '../types.js';

export function formatAgentList(): string {
  const agents = getAgents();
  const defaultId = getDefaultAgentId();
  const lines = Object.entries(agents).map(([id, cfg]) =>
    `${id === defaultId ? '→ ' : '  '}${id}: ${cfg.name} (${cfg.provider}/${cfg.model})`
  );
  return `*Agents:*\n${lines.join('\n')}`;
}

/** /agent show <id> */
function agentShow(args: string): CmdResult {
  const id = args.trim().toLowerCase();
  if (!id) return { response: 'Usage: `/agent show <id>`', skipInvoke: true };

  const agents = getAgents();
  const agent = agents[id];
  if (!agent) return { response: `Agent '${id}' not found.`, skipInvoke: true };

  const defaultId = getDefaultAgentId();
  const lines = [
    `*${id}* — ${agent.name}`,
    `Provider: ${agent.provider}/${agent.model}`,
    `Directory: ${agent.cwd}`,
  ];
  if (agent.systemPrompt) lines.push('Has custom system prompt');
  if (defaultId === id) lines.push('(default agent)');
  return { response: lines.join('\n'), skipInvoke: true };
}

/** /agent add <id> <name> <provider> [model] */
function agentAdd(args: string, ctx: CmdContext): CmdResult {
  const parts = args.split(/\s+/);
  if (parts.length < 3) {
    return { response: 'Usage: `/agent add <id> <name> <provider> [model]`', skipInvoke: true };
  }

  const [rawId, name, providerId, ...rest] = parts;
  const id = parseSafeId(rawId!);
  if (!id) return { response: 'Invalid agent ID.', skipInvoke: true };

  const settings = getSettings();
  if (settings.agents?.[id]) {
    return { response: `Agent '${id}' already exists.`, skipInvoke: true };
  }

  let providerDef;
  try { providerDef = getProvider(providerId!); } catch {
    return { response: `Unknown provider: ${providerId}. Available: ${listProviders().join(', ')}`, skipInvoke: true };
  }

  const model = rest[0] || providerDef.defaultModel;
  const cwd = process.cwd();

  updateSettings(s => ({
    ...s,
    agents: { ...s.agents, [id]: { name: name!, provider: providerId!, model, cwd } },
    defaultAgent: s.defaultAgent || id,
  }));

  auditLog({ action: 'cmd:agent-add', sender: ctx.sender, detail: args, status: 'allowed' });
  return { response: `Agent '${id}' created (${providerId}/${model}).`, skipInvoke: true };
}

/** /agent remove <id> [--force] */
function agentRemove(args: string, ctx: CmdContext): CmdResult {
  const hasForce = /--force\b/.test(args);
  const cleanArgs = args.replace(/--force\s*/g, '').trim();
  const id = parseRef(cleanArgs);
  if (!id) return { response: 'Usage: `/agent remove <id> --force`', skipInvoke: true };

  const agents = getAgents();
  if (!agents[id]) return { response: `Agent '${id}' not found.`, skipInvoke: true };

  if (!hasForce) {
    return { response: `Remove '${id}' (${agents[id]!.name})?\nUse \`/agent remove ${id} --force\` to confirm.`, skipInvoke: true };
  }

  const settings = getSettings();
  const wasDefault = settings.defaultAgent === id;

  updateSettings(s => {
    const updated = { ...s, agents: { ...s.agents } };
    delete updated.agents![id];
    if (wasDefault) delete updated.defaultAgent;
    return updated;
  });

  auditLog({ action: 'cmd:agent-remove', sender: ctx.sender, detail: id, status: 'allowed' });
  const extra = wasDefault ? ' (cleared default)' : '';
  return { response: `Agent '${id}' removed.${extra}`, skipInvoke: true };
}

/** /agent provider <id> [provider] [--model M] */
function agentProvider(args: string, ctx: CmdContext): CmdResult {
  const parts = args.split(/\s+/);
  const id = parseRef(parts[0] || '');
  if (!id) return { response: 'Usage: `/agent provider <id> [provider] [--model M]`', skipInvoke: true };

  const agents = getAgents();
  if (!agents[id]) return { response: `Agent '${id}' not found.`, skipInvoke: true };

  const providerArg = parts[1];
  if (!providerArg) {
    const a = agents[id]!;
    return { response: `${id} — ${a.provider}/${a.model}`, skipInvoke: true };
  }

  try { getProvider(providerArg); } catch {
    return { response: `Unknown provider: ${providerArg}. Available: ${listProviders().join(', ')}`, skipInvoke: true };
  }

  const modelIdx = parts.indexOf('--model');
  const model = modelIdx !== -1 ? parts[modelIdx + 1] : undefined;

  updateSettings(s => {
    const a = { ...s.agents![id]!, provider: providerArg };
    if (model) a.model = model;
    return { ...s, agents: { ...s.agents, [id]: a } };
  });

  auditLog({ action: 'cmd:agent-provider', sender: ctx.sender, detail: args, status: 'allowed' });
  return { response: `${id} → ${providerArg}${model ? ` (${model})` : ''}`, skipInvoke: true };
}

/** Dispatch /agent subcommands */
export function dispatchAgentCommand(args: string, ctx: CmdContext): CmdResult {
  if (!args.trim()) {
    return { response: formatAgentList(), skipInvoke: true };
  }

  const parts = args.trim().split(/\s+/);
  const sub = parts[0]!.toLowerCase();
  const subArgs = parts.slice(1).join(' ');

  if (sub === 'add') return agentAdd(subArgs, ctx);
  if (sub === 'remove') return agentRemove(subArgs, ctx);
  if (sub === 'show') return agentShow(subArgs);
  if (sub === 'provider') return agentProvider(subArgs, ctx);

  // Default: switch to agent by name/id
  const agents = getAgents();
  const agentId = Object.keys(agents).find(id => id.toLowerCase() === sub);
  if (!agentId) return { response: `Unknown agent: ${sub}`, skipInvoke: true };
  return { response: `Switched to agent: ${agentId}`, skipInvoke: true, agent: agentId };
}
