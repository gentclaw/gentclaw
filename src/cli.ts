#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { getSettings, getAgents, getDefaultAgentId } from './lib/config.js';
import { listProviders } from './lib/providers.js';
import { PATHS } from './lib/paths.js';
import { installService, uninstallService, serviceStatus } from './lib/service.js';
import { DEFAULT_HEARTBEAT_INTERVAL_MIN } from './lib/constants.js';
import { elapsedSec, formatDurationSec } from './lib/text.js';
import type { StatusSnapshot } from './lib/tracker.js';

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

Heartbeat:
  heartbeat [agent]  Trigger heartbeat manually (one agent or all)

Maintenance:
  setup        Run interactive setup wizard
  setup slack  Reconfigure Slack tokens

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
    console.log(`${marker} ${id}: ${cfg.name} (${cfg.provider}/${cfg.model}) — ${cfg.cwd}`);
  }
}

function showProviders(): void {
  for (const id of listProviders()) {
    console.log(`  ${id}`);
  }
}

function showStatus(): void {
  const settings = getSettings();
  const agents = getAgents();
  const defaultId = getDefaultAgentId();
  const providers = listProviders();
  const channels = settings.channels?.slack ? ['slack'] : [];
  console.log(`Channels: ${channels.length > 0 ? channels.join(', ') : 'none'}`);
  console.log(`Agents: ${Object.keys(agents).length} (default: ${defaultId})`);
  console.log(`Providers: ${providers.join(', ')}`);

  const hbAgents = Object.entries(agents).filter(([, a]) => a.heartbeat?.enabled);
  if (hbAgents.length > 0) {
    console.log(`Heartbeat: ${hbAgents.map(([id, a]) => `${id} (${a.heartbeat?.intervalMinutes ?? DEFAULT_HEARTBEAT_INTERVAL_MIN}m)`).join(', ')}`);
  }

  if (!existsSync(PATHS.status)) {
    console.log('\nNo runtime data (daemon not running?)');
    return;
  }

  try {
    const snapshot = JSON.parse(readFileSync(PATHS.status, 'utf-8')) as StatusSnapshot;
    console.log(`\nRuntime (${elapsedSec(snapshot.timestamp)}s ago):`);
    console.log(`Queued tasks: ${snapshot.totalQueuedTasks}`);

    for (const [agentId, activity] of Object.entries(snapshot.agents)) {
      if (activity.current) {
        console.log(`  ${agentId}: busy (${elapsedSec(activity.current.startedAt)}s) — ${activity.current.messagePreview}`);
      } else {
        console.log(`  ${agentId}: idle`);
      }
      const last = activity.recentHistory[0];
      if (last) {
        const status = last.success ? 'ok' : 'error';
        console.log(`    last: ${status} (${formatDurationSec(last.durationMs)}, ${elapsedSec(last.finishedAt)}s ago)`);
      }
    }
  } catch {
    console.log('\nFailed to read runtime data');
  }
}

async function startProcess(): Promise<void> {
  process.on('unhandledRejection', (err) => {
    console.error('[FATAL] unhandled rejection:', err);
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaught exception:', err);
    process.exit(1);
  });

  // Load .env if present
  try {
    const dotenv = await import('dotenv');
    dotenv.config({ path: PATHS.env });
  } catch { /* dotenv optional */ }

  const { startSlack } = await import('./channels/slack.js');
  await startSlack();
}

async function runHeartbeat(): Promise<void> {
  const { initLog } = await import('./lib/log.js');
  const { ensureDirectories } = await import('./lib/fs-utils.js');
  ensureDirectories();
  initLog({ verbose: getSettings().logging?.verbose });

  const { fireHeartbeat } = await import('./lib/heartbeat.js');
  const agents = getAgents();
  const targetId = process.argv[3];

  if (targetId) {
    const agent = agents[targetId];
    if (!agent) { console.error(`Agent not found: ${targetId}`); process.exit(1); }
    const resp = await fireHeartbeat(targetId, agent);
    if (resp) console.log(resp);
  } else {
    for (const [id, agent] of Object.entries(agents)) {
      if (!agent.heartbeat?.enabled) {
        console.log(`⏭ ${id}: heartbeat disabled`);
        continue;
      }
      console.log(`▶ ${id}:`);
      const resp = await fireHeartbeat(id, agent);
      if (resp) console.log(resp);
    }
  }
}

function runAsync(label: string, fn: () => Promise<void>): void {
  fn().catch((err: unknown) => { console.error(`${label} failed:`, err); process.exit(1); });
}

const commands: Record<string, () => void> = {
  start: () => runAsync('Start', startProcess),
  config: showConfig,
  agents: showAgents,
  providers: showProviders,
  status: showStatus,
  home: () => console.log(PATHS.home),
  help: showHelp,
  setup: () => {
    const subcmd = process.argv[3];
    runAsync('Setup', () => import('./setup.js').then(m => m.setup(subcmd)));
  },
  install: () => runAsync('Install', async () => {
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
  }),
  uninstall: () => {
    uninstallService();
    console.log('Service removed.');
  },
  heartbeat: () => runAsync('Heartbeat', runHeartbeat),
};

if (!command || command === '--help' || command === '-h') {
  showHelp();
} else if (commands[command]) {
  commands[command]();
} else {
  console.error(`Unknown command: ${command}`);
  showHelp();
  process.exit(1);
}
