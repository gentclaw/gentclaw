/** Agent CRUD command handlers */

import { getAgents, getDefaultAgentId, getSettings, updateSettings, updateAgent, removeAgent } from '../config.js';
import { listProviders, getProvider } from '../providers.js';
import { auditLog } from '../audit.js';
import { parseRef, parseSafeId, parseForceFlag, parseSubcommand } from '../parse-ref.js';
import { cmdReply } from '../types.js';
import { splitArgs } from '../text.js';
import type { Agent, CmdResult, CmdContext } from '../types.js';

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
  if (!id) return cmdReply('Usage: `/agent show <id>`');

  const agents = getAgents();
  const agent = agents[id];
  if (!agent) return cmdReply(`Agent '${id}' not found.`);

  const defaultId = getDefaultAgentId();
  const lines = [
    `*${id}* — ${agent.name}`,
    `Provider: ${agent.provider}/${agent.model}`,
    `Directory: ${agent.cwd}`,
  ];
  if (agent.systemPrompt) lines.push('Has custom system prompt');
  if (defaultId === id) lines.push('(default agent)');
  return cmdReply(lines.join('\n'));
}

/** /agent add <id> <name> <provider> [model] */
function agentAdd(args: string, ctx: CmdContext): CmdResult {
  const parts = splitArgs(args);
  if (parts.length < 3) {
    return cmdReply('Usage: `/agent add <id> <name> <provider> [model]`');
  }

  const [rawId = '', name = '', providerId = '', ...rest] = parts;
  const id = parseSafeId(rawId);
  if (!id) return cmdReply('Invalid agent ID.');

  const settings = getSettings();
  if (settings.agents?.[id]) {
    return cmdReply(`Agent '${id}' already exists.`);
  }

  let providerDef;
  try { providerDef = getProvider(providerId); } catch {
    return cmdReply(`Unknown provider: ${providerId}. Available: ${listProviders().join(', ')}`);
  }

  const model = rest[0] || providerDef.defaultModel;
  const cwd = process.cwd();

  updateAgent(id, { name, provider: providerId, model, cwd });
  if (!settings.defaultAgent) updateSettings(s => ({ ...s, defaultAgent: id }));

  auditLog({ action: 'cmd:agent-add', sender: ctx.sender, detail: args, status: 'allowed' });
  return cmdReply(`Agent '${id}' created (${providerId}/${model}).`);
}

/** /agent remove <id> [--force] */
function agentRemove(args: string, ctx: CmdContext): CmdResult {
  const { cleanArgs, force: hasForce } = parseForceFlag(args);
  const id = parseRef(cleanArgs);
  if (!id) return cmdReply('Usage: `/agent remove <id> --force`');

  const agents = getAgents();
  if (!agents[id]) return cmdReply(`Agent '${id}' not found.`);

  if (!hasForce) {
    return cmdReply(`Remove '${id}' (${agents[id]?.name ?? id})?\nUse \`/agent remove ${id} --force\` to confirm.`);
  }

  const wasDefault = getSettings().defaultAgent === id;

  removeAgent(id);
  if (wasDefault) updateSettings(s => { const { defaultAgent: _, ...rest } = s; return rest; });

  auditLog({ action: 'cmd:agent-remove', sender: ctx.sender, detail: id, status: 'allowed' });
  const extra = wasDefault ? ' (cleared default)' : '';
  return cmdReply(`Agent '${id}' removed.${extra}`);
}

/** /agent provider <id> [provider] [--model M] */
function agentProvider(args: string, ctx: CmdContext): CmdResult {
  const parts = splitArgs(args);
  const id = parseRef(parts[0] || '');
  if (!id) return cmdReply('Usage: `/agent provider <id> [provider] [--model M]`');

  const agents = getAgents();
  const existing = agents[id];
  if (!existing) return cmdReply(`Agent '${id}' not found.`);

  const providerArg = parts[1];
  if (!providerArg) {
    return cmdReply(`${id} — ${existing.provider}/${existing.model}`);
  }

  try { getProvider(providerArg); } catch {
    return cmdReply(`Unknown provider: ${providerArg}. Available: ${listProviders().join(', ')}`);
  }

  const modelIdx = parts.indexOf('--model');
  const model = modelIdx !== -1 ? parts[modelIdx + 1] : undefined;

  const updated = { ...existing, provider: providerArg };
  if (model) updated.model = model;
  updateAgent(id, updated);

  auditLog({ action: 'cmd:agent-provider', sender: ctx.sender, detail: args, status: 'allowed' });
  return cmdReply(`${id} → ${providerArg}${model ? ` (${model})` : ''}`);
}

/** Dispatch /agent subcommands */
export function dispatchAgentCommand(args: string, ctx: CmdContext): CmdResult {
  if (!args.trim()) {
    return cmdReply(formatAgentList());
  }

  const { sub, subArgs } = parseSubcommand(args);

  if (sub === 'add') return agentAdd(subArgs, ctx);
  if (sub === 'remove') return agentRemove(subArgs, ctx);
  if (sub === 'show') return agentShow(subArgs);
  if (sub === 'provider') return agentProvider(subArgs, ctx);

  // Default: switch to agent by name/id
  const agents = getAgents();
  const agentId = Object.keys(agents).find(id => id.toLowerCase() === sub);
  if (!agentId) return cmdReply(`Unknown agent: ${sub}`);
  return cmdReply(`Switched to agent: ${agentId}`, { agent: agentId });
}
