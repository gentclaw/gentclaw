import * as readline from 'node:readline';
import { existsSync } from 'node:fs';
import { PATHS } from './lib/paths.js';
import { ensureDirectories } from './lib/fs-utils.js';
import { writeSettings, updateSettings, getSettings } from './lib/config.js';
import type { Settings, Agent } from './lib/types.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultVal?: string): Promise<string> {
  const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
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

async function addAgent(): Promise<void> {
  console.log('');
  console.log('gentclaw — Add Agent');
  console.log('====================');

  const settings = getSettings();
  const existingIds = Object.keys(settings.agents ?? {});

  if (existingIds.length > 0) {
    console.log(`\nExisting agents: ${existingIds.join(', ')}`);
  }

  const { id, agent } = await promptAgent(existingIds);

  updateSettings(s => ({
    ...s,
    agents: { ...s.agents, [id]: agent },
  }));

  console.log('');
  console.log(`Agent "${id}" added.`);
  console.log(`Verify: gentclaw agents`);
  console.log('');
}

async function fullSetup(): Promise<void> {
  console.log('');
  console.log('gentclaw — First-Run Setup');
  console.log('==========================');
  console.log('');

  ensureDirectories();

  // Slack tokens
  console.log('\n--- Slack Configuration ---');
  console.log('Create a Slack app at https://api.slack.com/apps');
  console.log('Enable Socket Mode and add required scopes.');
  const botToken = await ask('Bot Token (xoxb-...)');
  const appToken = await ask('App Token (xapp-...)');

  // Default agent
  const { id, agent } = await promptAgent([]);

  // Allowed senders
  console.log('\n--- Access Control ---');
  const sendersRaw = await ask('Allowed Slack user IDs (comma-separated, empty = allow all)');
  const allowedSenders = sendersRaw ? sendersRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  const settings: Settings = {
    channels: {
      slack: {
        botToken: botToken || undefined,
        appToken: appToken || undefined,
      },
    },
    agents: { [id]: agent },
    defaultAgent: id,
    allowedSenders: allowedSenders.length > 0 ? allowedSenders : undefined,
    devMode: false,
    logging: { verbose: false },
  };

  writeSettings(settings);

  console.log('');
  console.log(`Settings written to: ${PATHS.settings}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Build: npm run build');
  console.log('  2. Start: npm start');
  console.log('');
}

async function setup(): Promise<void> {
  try {
    if (existsSync(PATHS.settings)) {
      await addAgent();
    } else {
      await fullSetup();
    }
  } finally {
    rl.close();
  }
}

setup().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
