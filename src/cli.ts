import { existsSync } from 'node:fs';
import { getSettings, getAgents, getDefaultAgentId } from './lib/config.js';
import { listProviders } from './lib/providers.js';
import { PATHS } from './lib/paths.js';
import { installService, uninstallService, serviceStatus } from './lib/service.js';

const command = process.argv[2];

function showHelp(): void {
  console.log(`gentclaw — always-on AI agent daemon

Usage: gentclaw <command> [options]

Process:
  start        Start the Slack listener (foreground)
  install      Register + start as OS service (launchd/systemd)
  uninstall    Stop + remove OS service

Info:
  config       Show current configuration
  agents       List configured agents
  providers    List available providers
  status       Show configuration summary

Maintenance:
  setup        Run interactive setup wizard

Paths:
  home         Show GENTCLAW_HOME path
`);
}

function showConfig(): void {
  const s = getSettings();
  console.log(JSON.stringify(s, null, 2));
}

function showAgents(): void {
  const agents = getAgents();
  const defaultId = getDefaultAgentId();
  for (const [id, cfg] of Object.entries(agents)) {
    const marker = id === defaultId ? '→' : ' ';
    console.log(`${marker} ${id}: ${cfg.name} (${cfg.provider}/${cfg.model}) — ${cfg.folder}`);
  }
}

function showProviders(): void {
  for (const id of listProviders()) {
    console.log(`  ${id}`);
  }
}

function showStatus(): void {
  const agents = getAgents();
  const defaultId = getDefaultAgentId();
  const providers = listProviders();
  console.log(`Agents: ${Object.keys(agents).length} (default: ${defaultId})`);
  console.log(`Providers: ${providers.join(', ')}`);
}

async function startProcess(): Promise<void> {
  // Load .env if present
  try {
    const dotenv = await import('dotenv');
    dotenv.config({ path: PATHS.env });
  } catch { /* dotenv optional */ }

  const { startSlack } = await import('./channels/slack.js');
  await startSlack();
}

const commands: Record<string, () => void> = {
  start: () => {
    startProcess().catch(err => {
      console.error('Failed to start:', err);
      process.exit(1);
    });
  },
  config: showConfig,
  agents: showAgents,
  providers: showProviders,
  status: showStatus,
  home: () => console.log(PATHS.home),
  help: showHelp,
  setup: () => {
    import('./setup.js').catch(err => {
      console.error('Setup failed:', err);
      process.exit(1);
    });
  },
  install: () => {
    (async () => {
      if (!existsSync(PATHS.settings)) {
        console.log('No settings found — running setup wizard first...');
        await import('./setup.js');
        if (!existsSync(PATHS.settings)) {
          console.error('Setup cancelled — no settings.json');
          process.exit(1);
        }
      }
      installService();
      console.log('Service registered. Waiting 3s to verify...');
      await new Promise(r => setTimeout(r, 3_000));
      const s = serviceStatus();
      console.log(s.running ? 'Service is running.' : 'Service may not have started — check logs.');
      console.log(`\nLogs: ${PATHS.logs}/`);
      console.log('Status: node dist/cli.js status');
    })().catch(err => {
      console.error('Install failed:', err);
      process.exit(1);
    });
  },
  uninstall: () => {
    uninstallService();
    console.log('Service removed.');
  },
};

if (!command || command === '--help' || command === '-h') {
  showHelp();
} else if (commands[command]) {
  commands[command]!();
} else {
  console.error(`Unknown command: ${command}`);
  showHelp();
  process.exit(1);
}
