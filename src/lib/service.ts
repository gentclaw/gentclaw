import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { PATHS, SCRIPT_DIR } from './paths.js';
import { SERVICE_LABEL as LABEL, SUBPROCESS_ENV } from './constants.js';
/** Resolve stable node path — prefer /opt/homebrew/bin/node symlink over versioned Cellar path. Cellar paths break on `brew upgrade node`. */
export function resolveNodeBin(execPath: string = process.execPath): string {
  if (!execPath.includes('/Cellar/')) return execPath;
  try {
    const symlink = '/opt/homebrew/bin/node';
    if (realpathSync(symlink) === execPath) return symlink;
  } catch { /* fallback to execPath */ }
  return execPath;
}
const NODE_BIN = resolveNodeBin();

function plistPath(): string {
  return resolve(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function unitPath(): string {
  return resolve(homedir(), '.config', 'systemd', 'user', 'gentclaw.service');
}

/** Run a service-management binary with argv (no shell). Suppresses non-zero exits — callers treat
 *  empty output as "not running / already gone". Argv form avoids shell interpolation of USER/UID. */
function run(bin: string, args: string[]): string {
  try {
    return execFileSync(bin, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: SUBPROCESS_ENV,
    }).trim();
  } catch {
    return '';
  }
}

/** Stable numeric UID for launchctl `gui/<uid>` domain. process.getuid() is POSIX-only;
 *  service install isn't supported on Windows so this branch is unreachable there. */
function uid(): number {
  const fn = process.getuid;
  return fn ? fn.call(process) : 0;
}

/** POSIX-style username for `loginctl enable-linger`. Validated to a strict character set
 *  before being passed as an argv element — defence in depth even though execFileSync
 *  does not invoke a shell. Empty / invalid → null (caller skips the call). */
export function safeUserName(raw: string = process.env['USER'] ?? ''): string | null {
  return /^[a-zA-Z0-9_.-]+$/.test(raw) ? raw : null;
}

/** XML-escape a value before embedding in a plist `<string>` body. PATH commonly contains `&`. */
export function xmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** systemd `Environment=` values may not contain newlines; strip them defensively. */
export function systemdEnvValue(v: string): string {
  return v.replace(/[\r\n]/g, '');
}

function writePlist(): string {
  const path = plistPath();
  mkdirSync(resolve(homedir(), 'Library', 'LaunchAgents'), { recursive: true, mode: 0o700 });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xmlEscape(LABEL)}</string>
  <key>ProgramArguments</key><array>
    <string>${xmlEscape(NODE_BIN)}</string>
    <string>${xmlEscape(`${SCRIPT_DIR}/dist/cli.js`)}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key><string>${xmlEscape(SCRIPT_DIR)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xmlEscape(`${PATHS.logs}/launchd-stdout.log`)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(`${PATHS.logs}/launchd-stderr.log`)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${xmlEscape(process.env['PATH'] ?? '')}</string>
    <key>HOME</key><string>${xmlEscape(homedir())}</string>
  </dict>
</dict></plist>`;
  writeFileSync(path, xml + '\n', { mode: 0o600 });
  return path;
}

function writeUnit(): string {
  const path = unitPath();
  mkdirSync(resolve(homedir(), '.config', 'systemd', 'user'), { recursive: true, mode: 0o700 });
  const unit = `[Unit]
Description=gentclaw
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${NODE_BIN} ${SCRIPT_DIR}/dist/cli.js start
Restart=on-failure
RestartSec=10
Environment=PATH=${systemdEnvValue(process.env['PATH'] ?? '')}
Environment=HOME=${systemdEnvValue(homedir())}
StandardOutput=append:${PATHS.logs}/systemd-stdout.log
StandardError=append:${PATHS.logs}/systemd-stderr.log

[Install]
WantedBy=default.target`;
  writeFileSync(path, unit + '\n', { mode: 0o600 });
  return path;
}

/** Register and start as an OS service (launchd or systemd). */
export function installService(): void {
  mkdirSync(PATHS.logs, { recursive: true });
  const os = platform();
  if (os === 'darwin') {
    const domain = `gui/${uid()}/${LABEL}`;
    const target = `gui/${uid()}`;
    run('launchctl', ['bootout', domain]);
    writePlist();
    run('launchctl', ['bootstrap', target, plistPath()]);
  } else if (os === 'linux') {
    run('systemctl', ['--user', 'stop', 'gentclaw']);
    writeUnit();
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', '--now', 'gentclaw']);
    const user = safeUserName();
    if (user) run('loginctl', ['enable-linger', user]);
  } else {
    throw new Error(`Unsupported platform: ${os}. Start manually with: npm start`);
  }
}

/** Stop and remove the OS service. */
export function uninstallService(): void {
  const os = platform();
  if (os === 'darwin') {
    run('launchctl', ['bootout', `gui/${uid()}/${LABEL}`]);
    try { unlinkSync(plistPath()); } catch { /* already gone */ }
  } else if (os === 'linux') {
    run('systemctl', ['--user', 'disable', '--now', 'gentclaw']);
    try { unlinkSync(unitPath()); } catch { /* already gone */ }
    run('systemctl', ['--user', 'daemon-reload']);
  }
}

/** Check whether the service is registered and running. */
export function serviceStatus(): { registered: boolean; running: boolean } {
  const os = platform();
  if (os === 'darwin') {
    const registered = existsSync(plistPath());
    const out = run('launchctl', ['print', `gui/${uid()}/${LABEL}`]);
    return { registered, running: out.length > 0 };
  } else if (os === 'linux') {
    const registered = existsSync(unitPath());
    const out = run('systemctl', ['--user', 'is-active', 'gentclaw']);
    return { registered, running: out === 'active' };
  }
  return { registered: false, running: false };
}
