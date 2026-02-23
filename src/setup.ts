import * as readline from 'node:readline';
import { existsSync } from 'node:fs';
import { PATHS } from './lib/paths.js';
import { ensureDirectories } from './lib/fs-utils.js';
import { writeSettings, updateSettings, getSettings } from './lib/config.js';
import type { Settings, Agent } from './lib/types.js';

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

/** Slack app manifest scoped to gentclaw's requirements */
function buildSlackManifest(): object {
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
    console.log(`${RED}Invalid bot token — must start with xoxb-${NC}`);
    process.exit(1);
  }

  const appToken = await ask('App Token (xapp-...)');
  if (!appToken.startsWith('xapp-')) {
    console.log(`${RED}Invalid app token — must start with xapp-${NC}`);
    process.exit(1);
  }

  return { botToken, appToken };
}

/** Prompt user for agent config. Validates ID against existing agents. */
async function promptAgent(existingIds: string[]): Promise<{ id: string; agent: Agent }> {
  console.log('\n--- Add Agent ---');

  let id = '';
  while (!id) {
    const raw = await ask('Agent ID (e.g. reviewer)');
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

  const defaultName = id.charAt(0).toUpperCase() + id.slice(1);
  const name = await ask('Agent name', defaultName);
  const provider = await ask('Provider', 'claude');
  const model = await ask('Model', 'sonnet');
  const cwd = await ask('Working directory', process.cwd());

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
      channels: { ...s.channels, slack: { botToken, appToken } },
    }));
  } else {
    ensureDirectories();
    writeSettings({
      channels: { slack: { botToken, appToken } },
      devMode: false,
      logging: { verbose: false },
    });
  }

  console.log(`\n${GREEN}Slack configured.${NC}`);
  console.log(`  Config: ${DIM}${PATHS.settings}${NC}`);

  if (!existing.agents || Object.keys(existing.agents).length === 0) {
    console.log(`\nNo agents configured yet. Add one now to complete setup.`);
    const { id, agent } = await promptAgent([]);
    updateSettings(s => ({
      ...s,
      agents: { ...s.agents, [id]: agent },
      defaultAgent: s.defaultAgent || id,
    }));
    console.log(`\n${GREEN}Agent "${id}" added.${NC}`);
  }

  console.log(`\nNext steps:`);
  console.log(`  1. Build: ${GREEN}npm run build${NC}`);
  console.log(`  2. Start: ${GREEN}gentclaw start${NC}`);
  console.log('');
}

async function addAgent(): Promise<void> {
  console.log(`\n${BLUE}gentclaw — Add Agent${NC}\n`);

  const settings = getSettings();
  const existingIds = Object.keys(settings.agents ?? {});

  if (existingIds.length > 0) {
    console.log(`Existing agents: ${existingIds.join(', ')}`);
  }

  const { id, agent } = await promptAgent(existingIds);

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

  // Default agent
  const { id, agent } = await promptAgent([]);

  // Allowed senders
  console.log('\n--- Access Control ---');
  const sendersRaw = await ask('Allowed Slack user IDs (comma-separated, empty = allow all)');
  const allowedSenders = sendersRaw ? sendersRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  const settings: Settings = {
    channels: { slack: { botToken, appToken } },
    agents: { [id]: agent },
    defaultAgent: id,
    allowedSenders: allowedSenders.length > 0 ? allowedSenders : undefined,
    devMode: false,
    logging: { verbose: false },
  };

  writeSettings(settings);

  console.log(`\n${GREEN}Settings written to: ${PATHS.settings}${NC}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Build: ${GREEN}npm run build${NC}`);
  console.log(`  2. Start: ${GREEN}gentclaw start${NC}`);
  console.log('');
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
