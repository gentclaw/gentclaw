import * as readline from 'node:readline';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { PATHS } from './lib/paths.js';
import { ensureDirectories } from './lib/fs-utils.js';
import { writeSettings, updateSettings, getSettings } from './lib/config.js';
import type { Settings, Agent, MsgChannel } from './lib/types.js';

// ANSI colors
const BLUE = '\x1b[34m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultVal?: string): Promise<string> {
  const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

type SlackManifest = {
  display_information: { name: string; description: string };
  features: { bot_user: { display_name: string; always_online: boolean }; app_home: Record<string, boolean> };
  oauth_config: { scopes: { bot: string[] } };
  settings: { socket_mode_enabled: boolean; event_subscriptions: { bot_events: string[] } };
};

/** Slack app manifest scoped to gentclaw's requirements */
function buildSlackManifest(): SlackManifest {
  return {
    display_information: {
      name: 'gentclaw',
      description: 'gentclaw AI assistant',
    },
    features: {
      bot_user: { display_name: 'gentclaw', always_online: false },
      app_home: {
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
    },
    oauth_config: {
      scopes: {
        bot: [
          'chat:write',
          'im:history',
          'im:read',
          'im:write',
          'files:read',
          'files:write',
          'reactions:write',
          'users:read',
          'channels:history',
          'groups:history',
        ],
      },
    },
    settings: {
      socket_mode_enabled: true,
      event_subscriptions: {
        bot_events: ['message.im', 'message.channels', 'message.groups'],
      },
    },
  };
}

/** Show Slack app creation instructions with manifest */
function showSlackInstructions(): void {
  const manifest = JSON.stringify(buildSlackManifest(), null, 2);

  console.log(`${BLUE}Step 1:${NC} Go to https://api.slack.com/apps → Create New App → ${GREEN}From an app manifest${NC}`);
  console.log(`${BLUE}Step 2:${NC} Select your workspace`);
  console.log(`${BLUE}Step 3:${NC} Switch to the ${GREEN}JSON${NC} tab and paste this manifest:\n`);
  console.log(`${DIM}${manifest}${NC}\n`);
  console.log(`${BLUE}Step 4:${NC} Review & Create App`);
  console.log(`${BLUE}Step 5:${NC} Settings → Socket Mode → generate an app-level token (${GREEN}xapp-...${NC})`);
  console.log(`${BLUE}Step 6:${NC} Settings → Install App → Install to Workspace`);
  console.log(`${BLUE}Step 7:${NC} OAuth & Permissions → copy the Bot Token (${GREEN}xoxb-...${NC})`);
  console.log('');
}

/** Prompt for and validate Slack tokens */
async function promptSlackTokens(): Promise<{ botToken: string; appToken: string }> {
  const botToken = await ask('Bot Token (xoxb-...)');
  if (!botToken.startsWith('xoxb-')) {
    throw new Error('Invalid bot token — must start with xoxb-');
  }

  const appToken = await ask('App Token (xapp-...)');
  if (!appToken.startsWith('xapp-')) {
    throw new Error('Invalid app token — must start with xapp-');
  }

  return { botToken, appToken };
}

/** Create agent working directory with a minimal CLAUDE.md scaffold */
function ensureAgentDir(agentDir: string): void {
  mkdirSync(agentDir, { recursive: true });

  const claudeMd = resolve(agentDir, 'CLAUDE.md');
  if (!existsSync(claudeMd)) {
    writeFileSync(claudeMd, `# Agent Workspace\n\nThis directory is the agent's working directory for gentclaw.\n`);
  }
}

/** Build default agent config with zero prompts — matches claw's bootstrapFreshSettings */
function buildDefaultAgent(): { id: string; agent: Agent } {
  const wsDir = resolve(homedir(), 'gentclaw-workspace');
  const agentDir = resolve(wsDir, 'assistant');
  return {
    id: 'assistant',
    agent: {
      name: 'Assistant',
      provider: 'claude',
      model: 'sonnet',
      cwd: agentDir,
    },
  };
}

/** Add channel to enabled list idempotently */
function addEnabledChannel(settings: Settings, channel: MsgChannel): Settings['channels'] {
  const existing = settings.channels ?? {};
  const enabled = existing.enabled ?? [];
  const deduped = Array.from(new Set([...enabled, channel]));
  return { ...existing, enabled: deduped };
}

/** Show next-steps. Omits build step when running from installed binary. */
function showNextSteps(): void {
  const runningFromDist = process.argv[1]?.includes('/dist/');
  const binaryName = basename(process.argv[1] ?? 'gentclaw').replace(/\.js$/, '');
  const cmd = runningFromDist ? binaryName : 'gentclaw';

  console.log(`\nNext steps:`);
  if (!runningFromDist) {
    console.log(`  1. Build: ${GREEN}npm run build${NC}`);
    console.log(`  2. Start: ${GREEN}${cmd} start${NC}`);
  } else {
    console.log(`  Start: ${GREEN}${cmd} start${NC}`);
  }
  console.log('');
}

/** Prompt user for agent config. Validates ID against existing agents. */
async function promptAgent(existingIds: string[]): Promise<{ id: string; agent: Agent }> {
  console.log('\n--- Add Agent ---');
  console.log(`${DIM}Press Enter to accept defaults for a quick setup.${NC}\n`);

  const defaultAgent = buildDefaultAgent();

  let id = '';
  while (!id) {
    const raw = await ask('Agent ID (e.g. reviewer)', defaultAgent.id);
    if (!raw) {
      console.log('Agent ID cannot be empty.');
      continue;
    }
    if (/\s/.test(raw)) {
      console.log('Agent ID cannot contain spaces.');
      continue;
    }
    if (existingIds.some(e => e.toLowerCase() === raw.toLowerCase())) {
      console.log(`Agent "${raw}" already exists.`);
      continue;
    }
    id = raw;
  }

  const isDefault = id === defaultAgent.id;
  const defaultName = isDefault ? defaultAgent.agent.name : id.charAt(0).toUpperCase() + id.slice(1);
  const defaultCwd = isDefault ? defaultAgent.agent.cwd : process.cwd();

  const name = await ask('Agent name', defaultName);
  const provider = await ask('Provider', defaultAgent.agent.provider);
  const model = await ask('Model', defaultAgent.agent.model);
  const cwd = await ask('Working directory', defaultCwd);

  return { id, agent: { name, provider, model, cwd } };
}

/** Standalone Slack onboarding — shows instructions, collects tokens, saves config */
async function setupSlack(): Promise<void> {
  console.log(`\n${BLUE}gentclaw — Slack Setup${NC}\n`);

  const existing = getSettings();
  if (existing.channels?.slack?.botToken && existing.channels?.slack?.appToken) {
    console.log(`${DIM}Slack already configured. Tokens will be overwritten.${NC}\n`);
  }

  showSlackInstructions();
  const { botToken, appToken } = await promptSlackTokens();

  if (existsSync(PATHS.settings)) {
    updateSettings(s => ({
      ...s,
      channels: { ...addEnabledChannel(s, 'slack'), slack: { botToken, appToken } },
    }));
  } else {
    ensureDirectories();
    writeSettings({
      channels: { enabled: ['slack'], slack: { botToken, appToken } },
      devMode: false,
      logging: { verbose: false },
    });
  }

  console.log(`\n${GREEN}Slack configured.${NC}`);
  console.log(`  Config: ${DIM}${PATHS.settings}${NC}`);

  if (!existing.agents || Object.keys(existing.agents).length === 0) {
    console.log(`\nNo agents configured yet.`);

    const useDefault = await ask('Create default assistant agent? (Y/n)', 'y');
    const isCustom = useDefault.toLowerCase() === 'n' || useDefault.toLowerCase() === 'no';
    const { id, agent } = isCustom ? await promptAgent([]) : buildDefaultAgent();

    ensureAgentDir(agent.cwd);
    updateSettings(s => ({
      ...s,
      agents: { ...s.agents, [id]: agent },
      defaultAgent: s.defaultAgent || id,
    }));
    console.log(`\n${GREEN}Agent "${id}" created at ${agent.cwd}${NC}`);
  }

  showNextSteps();
}

async function addAgent(): Promise<void> {
  console.log(`\n${BLUE}gentclaw — Add Agent${NC}\n`);

  const settings = getSettings();
  const existingIds = Object.keys(settings.agents ?? {});

  if (existingIds.length > 0) {
    console.log(`Existing agents: ${existingIds.join(', ')}`);
  }

  const { id, agent } = await promptAgent(existingIds);
  ensureAgentDir(agent.cwd);

  updateSettings(s => ({
    ...s,
    agents: { ...s.agents, [id]: agent },
  }));

  console.log(`\n${GREEN}Agent "${id}" added.${NC}`);
  console.log(`Verify: gentclaw agents\n`);
}

async function fullSetup(): Promise<void> {
  console.log(`\n${BLUE}gentclaw — First-Run Setup${NC}\n`);

  ensureDirectories();

  // Slack tokens
  console.log('--- Slack Configuration ---');
  showSlackInstructions();
  const { botToken, appToken } = await promptSlackTokens();

  // Default agent — offer zero-config path
  console.log('\n--- Agent Configuration ---');
  const useDefault = await ask('Create default assistant agent? (Y/n)', 'y');

  let agentId: string;
  let agent: Agent;

  if (useDefault.toLowerCase() === 'n' || useDefault.toLowerCase() === 'no') {
    const result = await promptAgent([]);
    agentId = result.id;
    agent = result.agent;
  } else {
    const result = buildDefaultAgent();
    agentId = result.id;
    agent = result.agent;
    console.log(`${DIM}Using defaults: ${agentId} (${agent.provider}/${agent.model}) at ${agent.cwd}${NC}`);
  }

  ensureAgentDir(agent.cwd);

  // Allowed senders
  console.log('\n--- Access Control ---');
  const sendersRaw = await ask('Allowed Slack user IDs (comma-separated, empty = allow all)');
  const allowedSenders = sendersRaw ? sendersRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  const settings: Settings = {
    channels: { enabled: ['slack'], slack: { botToken, appToken } },
    agents: { [agentId]: agent },
    defaultAgent: agentId,
    allowedSenders: allowedSenders.length > 0 ? allowedSenders : undefined,
    devMode: false,
    logging: { verbose: false },
  };

  writeSettings(settings);

  console.log(`\n${GREEN}Settings written to: ${PATHS.settings}${NC}`);
  console.log(`Agent directory created: ${DIM}${agent.cwd}${NC}`);
  showNextSteps();
}

export async function setup(subcmd?: string): Promise<void> {
  try {
    if (subcmd === 'slack') {
      await setupSlack();
    } else if (existsSync(PATHS.settings)) {
      await addAgent();
    } else {
      await fullSetup();
    }
  } finally {
    rl.close();
  }
}

// Direct execution
const isDirectRun = process.argv[1]?.endsWith('setup.js');
if (isDirectRun) {
  const subcmd = process.argv[2];
  setup(subcmd).catch(err => {
    console.error(`${RED}Setup failed: ${err instanceof Error ? err.message : err}${NC}`);
    process.exit(1);
  });
}
