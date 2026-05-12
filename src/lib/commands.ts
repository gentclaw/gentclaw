import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { getAgents, getDefaultAgentId, getSettings, updateSettings, updateAgent } from './config.js';
import { deleteSession, stopFlagPath } from './sessions.js';
import { listProviders } from './providers.js';
import { getStatusSnapshot, summarizeAgents } from './tracker.js';
import { resolveCustomCommand, listCustomCommands, listSkills } from './custom-commands.js';
import { validateShellCmd } from './builtins/shell-safety.js';
import { readAgentMemory, readSharedMemory, clearAgentMemory, clearSharedMemory } from './memory.js';
import { dispatchTeamCommand, teamList } from './commands/team.js';
import { dispatchAgentCommand, formatAgentList } from './commands/agent.js';
import { log } from './log.js';
import { auditLog } from './audit.js';
import { errMsg } from './errors.js';
import { SCRIPT_DIR } from './paths.js';
import { SUBPROCESS_ENV, MAX_MEMORY_PREVIEW, MAX_MEMORY_PER_AGENT, MAX_ERROR_PREVIEW } from './constants.js';
import { cmdReply } from './types.js';
import type { CmdResult, CmdContext } from './types.js';

const L = log('commands');

const require = createRequire(import.meta.url);
const PKG_VERSION: string = (require('../../package.json') as { version: string }).version;

/** Split a command string into args, respecting single/double quotes. */
function tokenizeArgs(cmd: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote = '';
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) { quote = ''; continue; }
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

const handlers: Record<string, (args: string, ctx: CmdContext) => CmdResult> = {
  /* ── Info / Config ─────────────────────────────────── */
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
      '`/memory show [--shared]` — view agent/shared memory',
      '`/memory clear [--shared]` — clear agent/shared memory',
      '`/agents` — list available agents',
      '`/team` — list teams',
      '`/team add <id> <display-name> <leader> [agents...]`',
      '`/team remove <id> --force`',
      '`/team show <id>` — show team details',
      '`/team addagent <team> <agent>`',
      '`/team removeagent <team> <agent>`',
      '`/team setleader <team> <agent>`',
      '`/teams` — list teams',
      '`/reload --force` — rebuild and restart service',
    ];

    const custom = listCustomCommands();
    const customNames = Object.keys(custom);
    if (customNames.length > 0) {
      lines.push('', '*Custom:*');
      for (const name of customNames) {
        lines.push(`\`/${name}\` — ${custom[name]?.description ?? ''}`);
      }
    }

    const skills = listSkills();
    const skillNames = Object.keys(skills);
    if (skillNames.length > 0) {
      lines.push('', '*Skills:*');
      for (const name of skillNames) {
        lines.push(`\`/${name}\` — ${skills[name]?.description ?? ''}`);
      }
    }

    return cmdReply(lines.join('\n'));
  },

  status: () => {
    const agents = getAgents();
    const agentCount = Object.keys(agents).length;
    const defaultId = getDefaultAgentId();
    const providers = listProviders();
    const snapshot = getStatusSnapshot();

    const lines = [
      `*Status:* gentclaw v${PKG_VERSION}`,
      `Agents: ${agentCount} (default: ${defaultId})`,
      `Providers: ${providers.join(', ')}`,
      `Active tasks: ${snapshot.totalQueuedTasks}`,
    ];

    for (const a of summarizeAgents(snapshot)) {
      lines.push(`*${a.id}* — ${a.status}${a.preview ? `: ${a.preview}` : ''}`);
      if (a.lastLine) lines.push(`  ${a.lastLine}`);
    }

    return cmdReply(lines.join('\n'));
  },

  model: (args) => {
    const defaultId = getDefaultAgentId();
    if (!args.trim()) {
      const agents = getAgents();
      return cmdReply(`Current model: ${agents[defaultId]?.model ?? 'unknown'}`);
    }
    const target = args.trim();
    const current = getAgents()[defaultId];
    if (current) updateAgent(defaultId, { ...current, model: target });
    return cmdReply(`Model set to: ${target}`);
  },

  agent: (args, ctx) => dispatchAgentCommand(args, ctx),

  agents: () => cmdReply(formatAgentList()),

  team: (args, ctx) => dispatchTeamCommand(args, ctx),

  teams: () => teamList(),

  default: (args) => {
    if (!args.trim()) {
      return cmdReply(`Default agent: ${getDefaultAgentId()}`);
    }
    const target = args.trim();
    const agents = getAgents();
    if (!agents[target]) return cmdReply(`Unknown agent: ${target}`);
    updateSettings(s => ({ ...s, defaultAgent: target }));
    return cmdReply(`Default agent set to: ${target}`);
  },

  /* ── Session / State ────────────────────────────────── */
  reset: (_args, ctx) => {
    deleteSession(ctx.sessionKey);
    return cmdReply('Session reset. Next message starts fresh.');
  },

  stop: (_args, ctx) => {
    const flagFile = stopFlagPath(ctx.sessionKey);
    mkdirSync(dirname(flagFile), { recursive: true, mode: 0o700 });
    /** mode 0o600 — IPC file must not be world-writable; any local user could otherwise signal stop. */
    writeFileSync(flagFile, Date.now().toString(), { encoding: 'utf-8', mode: 0o600 });
    L.info('stop flag written', { sessionKey: ctx.sessionKey });
    return cmdReply('Stop signal sent.');
  },

  /* ── System / Ops ───────────────────────────────────── */
  bash: (args, ctx) => {
    const cmd = args.trim();
    if (!cmd) return cmdReply('Usage: `/bash <command>`');

    const validation = validateShellCmd(cmd, getSettings().bash?.allowlist);
    if (!validation.safe) {
      auditLog({ action: 'cmd:bash', sender: ctx.sender, detail: cmd, status: 'denied', reason: validation.reason });
      return cmdReply(`Denied: ${validation.reason}`, { audited: true });
    }

    try {
      const parts = tokenizeArgs(cmd);
      if (!parts[0]) return cmdReply('Empty command.');
      /** Use SUBPROCESS_ENV — without this, `/bash env` would dump SLACK_*, ANTHROPIC_API_KEY, etc. straight to a Slack reply. SUBPROCESS_ENV exposes only PATH/HOME/FORCE_COLOR. */
      const output = execFileSync(parts[0], parts.slice(1), {
        encoding: 'utf-8',
        timeout: 10_000,
        maxBuffer: 100_000,
        env: SUBPROCESS_ENV,
      });
      const trimmed = output.trim();
      return cmdReply(trimmed ? `\`\`\`\n${trimmed}\n\`\`\`` : '(no output)');
    } catch (err) {
      return cmdReply(`Error: ${errMsg(err).slice(0, MAX_ERROR_PREVIEW)}`);
    }
  },

  memory: (args) => {
    const sub = args.trim().split(/\s+/)[0]?.toLowerCase();
    const isShared = args.includes('--shared');

    if (sub === 'clear') {
      if (isShared) {
        clearSharedMemory();
        return cmdReply('Shared memory cleared.');
      }
      const agents = getAgents();
      for (const id of Object.keys(agents)) clearAgentMemory(id);
      return cmdReply('All agent memories cleared.');
    }

    if (sub === 'show') {
      if (isShared) {
        const mem = readSharedMemory();
        return cmdReply(mem ? `*Shared memory:*\n\`\`\`\n${mem.slice(0, MAX_MEMORY_PREVIEW)}\n\`\`\`` : 'No shared memory.');
      }
      const agents = getAgents();
      const lines: string[] = [];
      for (const id of Object.keys(agents)) {
        const mem = readAgentMemory(id);
        if (mem) lines.push(`*${id}:*\n\`\`\`\n${mem.slice(0, MAX_MEMORY_PER_AGENT)}\n\`\`\``);
      }
      return cmdReply(lines.length > 0 ? lines.join('\n\n') : 'No agent memories.');
    }

    return cmdReply('Usage: `/memory show [--shared]` or `/memory clear [--shared]`');
  },

  reload: (args, ctx) => {
    if (!args.includes('--force')) {
      return cmdReply('Reloading will rebuild and restart the service.\nUse `/reload --force` to confirm.');
    }
    L.warn('/reload triggered', { sender: ctx.sender });
    const child = spawn('node', [resolve(SCRIPT_DIR, 'dist/lib/reload-worker.js')], {
      cwd: SCRIPT_DIR,
      detached: true,
      stdio: 'ignore',
      env: SUBPROCESS_ENV,
    });
    child.unref();
    return cmdReply('Reloading... (build + restart service)');
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
    if (!result.audited) {
      auditLog({ action: `cmd:${cmdName}`, sender: ctx.sender, detail: args, status: 'allowed' });
    }
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
