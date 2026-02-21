import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { PATHS } from './paths.js';

const LABEL = 'com.gentclaw.agent';
const SCRIPT_DIR = resolve(import.meta.dirname, '..', '..');
/** Resolve stable node path — prefer brew symlink over versioned Cellar path. */
const NODE_BIN = (() => {
  const p = process.execPath;
  if (!p.includes('/Cellar/')) return p;
  try {
    const symlink = '/opt/homebrew/bin/node';
    if (realpathSync(symlink) === p) return symlink;
  } catch { /* fallback to execPath */ }
  return p;
})();

function plistPath(): string {
  return resolve(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function unitPath(): string {
  return resolve(homedir(), '.config', 'systemd', 'user', 'gentclaw.service');
}

function exec(cmd: string): string {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        USER: process.env.USER || '',
      },
    }).trim();
  } catch {
    return '';
  }
}

function writePlist(): string {
  const path = plistPath();
  mkdirSync(resolve(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${NODE_BIN}</string>
    <string>${SCRIPT_DIR}/dist/cli.js</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key><string>${SCRIPT_DIR}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${PATHS.logs}/launchd-stdout.log</string>
  <key>StandardErrorPath</key><string>${PATHS.logs}/launchd-stderr.log</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${process.env['PATH'] ?? ''}</string>
    <key>HOME</key><string>${homedir()}</string>
  </dict>
</dict></plist>`;
  writeFileSync(path, xml + '\n');
  return path;
}

function writeUnit(): string {
  const path = unitPath();
  mkdirSync(resolve(homedir(), '.config', 'systemd', 'user'), { recursive: true });
  const unit = `[Unit]
Description=gentclaw
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${NODE_BIN} ${SCRIPT_DIR}/dist/cli.js start
Restart=on-failure
RestartSec=10
Environment=PATH=${process.env['PATH'] ?? ''}
Environment=HOME=${homedir()}
StandardOutput=append:${PATHS.logs}/systemd-stdout.log
StandardError=append:${PATHS.logs}/systemd-stderr.log

[Install]
WantedBy=default.target`;
  writeFileSync(path, unit + '\n');
  return path;
}

/** Register and start as an OS service (launchd or systemd). */
export function installService(): void {
  mkdirSync(PATHS.logs, { recursive: true });
  const os = platform();
  if (os === 'darwin') {
    exec(`launchctl bootout gui/$(id -u)/${LABEL}`);
    writePlist();
    exec(`launchctl bootstrap gui/$(id -u) ${plistPath()}`);
  } else if (os === 'linux') {
    exec('systemctl --user stop gentclaw');
    writeUnit();
    exec('systemctl --user daemon-reload');
    exec('systemctl --user enable --now gentclaw');
    exec(`loginctl enable-linger ${process.env['USER'] ?? ''}`);
  } else {
    throw new Error(`Unsupported platform: ${os}. Start manually with: npm start`);
  }
}

/** Stop and remove the OS service. */
export function uninstallService(): void {
  const os = platform();
  if (os === 'darwin') {
    exec(`launchctl bootout gui/$(id -u)/${LABEL}`);
    try { unlinkSync(plistPath()); } catch { /* already gone */ }
  } else if (os === 'linux') {
    exec('systemctl --user disable --now gentclaw');
    try { unlinkSync(unitPath()); } catch { /* already gone */ }
    exec('systemctl --user daemon-reload');
  }
}

/** Check whether the service is registered and running. */
export function serviceStatus(): { registered: boolean; running: boolean } {
  const os = platform();
  if (os === 'darwin') {
    const registered = existsSync(plistPath());
    const out = exec(`launchctl print gui/$(id -u)/${LABEL}`);
    return { registered, running: out.length > 0 };
  } else if (os === 'linux') {
    const registered = existsSync(unitPath());
    const out = exec('systemctl --user is-active gentclaw');
    return { registered, running: out === 'active' };
  }
  return { registered: false, running: false };
}
