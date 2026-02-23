import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { getAgents, getDefaultAgentId, getSettings, updateSettings } from './config.js';
import { deleteSession } from './sessions.js';
import { stopFlagPath } from './sessions.js';
import { listProviders, getProvider } from './providers.js';
import { getStatusSnapshot } from './tracker.js';
import { resolveCustomCommand, listCustomCommands, listSkills } from './custom-commands.js';
import { validateShellCmd } from './builtins/shell-safety.js';
import { log } from './log.js';
import { auditLog } from './audit.js';

const PKG_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'package.json'), 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch { return 'unknown'; }
})();

const L = log('commands');

/** Repo root — two levels up from dist/lib/ */
const SCRIPT_DIR = resolve(import.meta.dirname, '..', '..');

type CmdResult = {
  response: string;
  skipInvoke: boolean; // true = don't send to agent, respond directly
  agent?: string; // override agent routing
};

type CmdContext = {
  sessionKey: string;
  sender: string;
};

type CmdHandler = (args: string, ctx: CmdContext) => CmdResult;

function formatAgentList(): string {
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
  const id = rawId!.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
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
  const id = cleanArgs.replace(/^@/, '').toLowerCase();
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
  const id = (parts[0] || '').replace(/^@/, '').toLowerCase();
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

const handlers: Record<string, CmdHandler> = {
  help: () => {
    const lines = [
      '*Commands:*',
      '`/help` — show this help',
      '`/status` — show system status',
      '`/bash <cmd>` — run a shell command (allowlisted)',
      '`/model [model]` — show or set model',
      '`/agent [name]` — show or switch agent',
      '`/agent add <id> <name> <provider> [model]`',
      '`/agent remove <id> --force`',
      '`/agent show <id>` — show agent details',
      '`/agent provider <id> [provider] [--model M]`',
      '`/default [name]` — set default agent',
      '`/reset` — reset current session',
      '`/stop` — stop running agent',
      '`/agents` — list available agents',
      '`/reload --force` — rebuild and restart service',
    ];

    const custom = listCustomCommands();
    const customNames = Object.keys(custom);
    if (customNames.length > 0) {
      lines.push('', '*Custom:*');
      for (const name of customNames) {
        lines.push(`\`/${name}\` — ${custom[name]!.description}`);
      }
    }

    const skills = listSkills();
    const skillNames = Object.keys(skills);
    if (skillNames.length > 0) {
      lines.push('', '*Skills:*');
      for (const name of skillNames) {
        lines.push(`\`/${name}\` — ${skills[name]!.description}`);
      }
    }

    return { response: lines.join('\n'), skipInvoke: true };
  },

  status: (_args, _ctx) => {
    const agents = getAgents();
    const agentCount = Object.keys(agents).length;
    const defaultId = getDefaultAgentId();
    const providers = listProviders();
    const snapshot = getStatusSnapshot();

    const lines = [
      `*Status:*`,
      `Agents: ${agentCount} (default: ${defaultId})`,
      `Providers: ${providers.join(', ')}`,
      `Active tasks: ${snapshot.totalQueuedTasks}`,
    ];

    for (const [agentId, activity] of Object.entries(snapshot.agents)) {
      if (activity.current) {
        const elapsed = Math.round((Date.now() - activity.current.startedAt) / 1000);
        lines.push(`*${agentId}* — busy (${elapsed}s): ${activity.current.messagePreview}`);
      } else {
        lines.push(`*${agentId}* — idle`);
      }
      const last = activity.recentHistory[0];
      if (last) {
        const ago = Math.round((Date.now() - last.finishedAt) / 1000);
        const status = last.success ? 'ok' : 'error';
        lines.push(`  last: ${status} (${Math.round(last.durationMs / 1000)}s, ${ago}s ago)`);
      }
    }

    return { response: lines.join('\n'), skipInvoke: true };
  },

  model: (args) => {
    const defaultId = getDefaultAgentId();
    if (!args.trim()) {
      const agents = getAgents();
      return { response: `Current model: ${agents[defaultId]!.model}`, skipInvoke: true };
    }
    const target = args.trim();
    updateSettings(s => ({
      ...s,
      agents: { ...s.agents, [defaultId]: { ...s.agents![defaultId]!, model: target } },
    }));
    return { response: `Model set to: ${target}`, skipInvoke: true };
  },

  agent: (args, ctx) => {
    if (!args.trim()) {
      return { response: formatAgentList(), skipInvoke: true };
    }

    const parts = args.trim().split(/\s+/);
    const sub = parts[0]!.toLowerCase();
    const subArgs = parts.slice(1).join(' ');

    // Subcommands
    if (sub === 'add') return agentAdd(subArgs, ctx);
    if (sub === 'remove') return agentRemove(subArgs, ctx);
    if (sub === 'show') return agentShow(subArgs);
    if (sub === 'provider') return agentProvider(subArgs, ctx);

    // Default: switch to agent by name/id
    const agents = getAgents();
    const agentId = Object.keys(agents).find(id => id.toLowerCase() === sub);
    if (!agentId) return { response: `Unknown agent: ${sub}`, skipInvoke: true };
    return { response: `Switched to agent: ${agentId}`, skipInvoke: true, agent: agentId };
  },

  agents: () => ({ response: formatAgentList(), skipInvoke: true }),

  default: (args) => {
    if (!args.trim()) {
      return { response: `Default agent: ${getDefaultAgentId()}`, skipInvoke: true };
    }
    const target = args.trim();
    const agents = getAgents();
    if (!agents[target]) return { response: `Unknown agent: ${target}`, skipInvoke: true };
    updateSettings(s => ({ ...s, defaultAgent: target }));
    return { response: `Default agent set to: ${target}`, skipInvoke: true };
  },

  reset: (_args, ctx) => {
    deleteSession(ctx.sessionKey);
    return { response: 'Session reset. Next message starts fresh.', skipInvoke: true };
  },

  stop: (_args, ctx) => {
    const flagFile = stopFlagPath(ctx.sessionKey);
    mkdirSync(dirname(flagFile), { recursive: true });
    writeFileSync(flagFile, Date.now().toString(), 'utf-8');
    L.info('stop flag written', { sessionKey: ctx.sessionKey });
    return { response: 'Stop signal sent.', skipInvoke: true };
  },

  bash: (args, ctx) => {
    const cmd = args.trim();
    if (!cmd) return { response: 'Usage: `/bash <command>`', skipInvoke: true };

    const validation = validateShellCmd(cmd, getSettings().bash?.allowlist);
    if (!validation.safe) {
      auditLog({ action: 'cmd:bash', sender: ctx.sender, detail: cmd, status: 'denied', reason: validation.reason });
      return { response: `Denied: ${validation.reason}`, skipInvoke: true };
    }

    try {
      const parts = cmd.split(/\s+/);
      const output = execFileSync(parts[0]!, parts.slice(1), {
        encoding: 'utf-8',
        timeout: 10_000,
        maxBuffer: 100_000,
      });
      const trimmed = output.trim();
      return { response: trimmed ? `\`\`\`\n${trimmed}\n\`\`\`` : '(no output)', skipInvoke: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { response: `Error: ${msg.slice(0, 500)}`, skipInvoke: true };
    }
  },

  shell: (args, ctx) => handlers.bash(args, ctx),

  reload: (args, ctx) => {
    if (!args.includes('--force')) {
      return {
        response: 'Reloading will rebuild and restart the service.\nUse `/reload --force` to confirm.',
        skipInvoke: true,
      };
    }
    L.warn('/reload triggered', { sender: ctx.sender });
    const child = spawn('node', [resolve(SCRIPT_DIR, 'dist/lib/reload-worker.js')], {
      cwd: SCRIPT_DIR,
      detached: true,
      stdio: 'ignore',
      env: {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
      },
    });
    child.unref();
    return { response: 'Reloading... (build + restart service)', skipInvoke: true };
  },
};

/** Check if a message is a command (/ or ! prefix). ! avoids Slack intercepting. */
export function dispatchCommand(message: string, ctx: CmdContext): CmdResult | null {
  if (!message.startsWith('/') && !message.startsWith('!')) return null;

  const spaceIdx = message.indexOf(' ');
  const cmdName = (spaceIdx > 0 ? message.slice(1, spaceIdx) : message.slice(1)).toLowerCase();
  const args = spaceIdx > 0 ? message.slice(spaceIdx + 1) : '';

  const handler = handlers[cmdName];
  if (handler) {
    L.debug('dispatching built-in command', { command: cmdName });
    const result = handler(args, ctx);
    auditLog({ action: `cmd:${cmdName}`, sender: ctx.sender, detail: args, status: 'allowed' });
    return result;
  }

  // Fall through to custom commands
  const custom = resolveCustomCommand(cmdName, args);
  if (custom) {
    L.debug('dispatching custom command', { command: cmdName, agent: custom.agent });
    auditLog({ action: `custom:${cmdName}`, sender: ctx.sender, detail: args, status: 'allowed' });
    return { response: custom.message, skipInvoke: false, agent: custom.agent };
  }

  return null;
}
