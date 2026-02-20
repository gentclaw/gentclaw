import * as readline from 'node:readline';
import { existsSync } from 'node:fs';
import { PATHS } from './lib/paths.js';
import { ensureDirectories } from './lib/fs-utils.js';
import { writeSettings } from './lib/config.js';
import type { Settings } from './lib/types.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultVal?: string): Promise<string> {
  const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

async function setup(): Promise<void> {
  console.log('');
  console.log('gentclaw — First-Run Setup');
  console.log('==========================');
  console.log('');

  if (existsSync(PATHS.settings)) {
    const overwrite = await ask('Settings file already exists. Overwrite? (y/N)', 'n');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Setup cancelled.');
      rl.close();
      return;
    }
  }

  ensureDirectories();

  // Slack tokens
  console.log('\n--- Slack Configuration ---');
  console.log('Create a Slack app at https://api.slack.com/apps');
  console.log('Enable Socket Mode and add required scopes.');
  const botToken = await ask('Bot Token (xoxb-...)');
  const appToken = await ask('App Token (xapp-...)');

  // Provider
  console.log('\n--- AI Provider ---');
  const provider = await ask('Provider', 'claude');
  const model = await ask('Default model', 'sonnet');

  // Agent
  console.log('\n--- Default Agent ---');
  const agentName = await ask('Agent name', 'Assistant');
  const folder = await ask('Working directory', process.cwd());

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
    agents: {
      default: {
        name: agentName,
        provider,
        model,
        folder,
      },
    },
    defaultAgent: 'default',
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

  rl.close();
}

setup().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
