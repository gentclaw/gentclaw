import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { platform } from 'node:os';
import { getAgents, getDefaultAgentId, getSettings, updateSettings } from './config.js';
import { deleteSession } from './sessions.js';
import { stopFlagPath } from './sessions.js';
import { listProviders } from './providers.js';
import { activeTasks } from './sequencer.js';
import { resolveCustomCommand, listCustomCommands, listSkills } from './custom-commands.js';
import { log } from './log.js';

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

const handlers: Record<string, CmdHandler> = {
  help: () => {
    const lines = [
      '*Commands:*',
      '`/help` — show this help',
      '`/status` — show system status',
      '`/model [model]` — show or set model',
      '`/agent [name]` — show or switch agent',
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
    const active = activeTasks();

    return {
      response: [
        `*Status:*`,
        `Agents: ${agentCount} (default: ${defaultId})`,
        `Providers: ${providers.join(', ')}`,
        `Active tasks: ${active}`,
      ].join('\n'),
      skipInvoke: true,
    };
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

  agent: (args, _ctx) => {
    if (!args.trim()) {
      return { response: formatAgentList(), skipInvoke: true };
    }
    const agents = getAgents();
    const target = args.trim().toLowerCase();
    const agentId = Object.keys(agents).find(id => id.toLowerCase() === target);
    if (!agentId) return { response: `Unknown agent: ${args.trim()}`, skipInvoke: true };
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
    return handler(args, ctx);
  }

  // Fall through to custom commands
  const custom = resolveCustomCommand(cmdName, args);
  if (custom) {
    L.debug('dispatching custom command', { command: cmdName, agent: custom.agent });
    return { response: custom.message, skipInvoke: false, agent: custom.agent };
  }

  return null;
}
