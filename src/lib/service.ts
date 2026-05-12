import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { PATHS, SCRIPT_DIR } from './paths.js';
import { SERVICE_LABEL as LABEL, SUBPROCESS_ENV } from './constants.js';
import { log } from './log.js';

const L = log('service');
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

/** Query call — empty output is the "not running / already gone" signal; non-zero exit is treated the same. */
function runQuery(bin: string, args: string[]): string {
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

/** Mutating call — non-zero exit is a real failure that the user needs to see.
 *  `allowFail` is for idempotent teardown (e.g. bootout when nothing is registered). */
function runMutating(bin: string, args: string[], opts: { allowFail?: boolean } = {}): void {
  try {
    execFileSync(bin, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: SUBPROCESS_ENV,
    });
  } catch (err) {
    if (opts.allowFail) {
      L.debug('mutating call exited non-zero (allowed)', { bin, args });
      return;
    }
    L.error('service command failed', { bin, args, error: (err as Error).message });
    throw err;
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

export function writePlist(): string {
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

export function writeUnit(): string {
  const path = unitPath();
  mkdirSync(resolve(homedir(), '.config', 'systemd', 'user'), { recursive: true, mode: 0o700 });
  /** Scrub newlines from every interpolated path — a newline in SCRIPT_DIR/PATHS.logs would
   *  corrupt the unit file just like one in Environment=. systemdEnvValue is the same rule. */
  const scrub = systemdEnvValue;
  const unit = `[Unit]
Description=gentclaw
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${scrub(SCRIPT_DIR)}
ExecStart=${scrub(NODE_BIN)} ${scrub(SCRIPT_DIR)}/dist/cli.js start
Restart=on-failure
RestartSec=10
Environment=PATH=${scrub(process.env['PATH'] ?? '')}
Environment=HOME=${scrub(homedir())}
StandardOutput=append:${scrub(PATHS.logs)}/systemd-stdout.log
StandardError=append:${scrub(PATHS.logs)}/systemd-stderr.log

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
    /** bootout is idempotent teardown — non-zero exit when nothing is registered is expected. */
    runMutating('launchctl', ['bootout', domain], { allowFail: true });
    writePlist();
    runMutating('launchctl', ['bootstrap', target, plistPath()]);
  } else if (os === 'linux') {
    runMutating('systemctl', ['--user', 'stop', 'gentclaw'], { allowFail: true });
    writeUnit();
    runMutating('systemctl', ['--user', 'daemon-reload']);
    runMutating('systemctl', ['--user', 'enable', '--now', 'gentclaw']);
    const user = safeUserName();
    if (user) {
      runMutating('loginctl', ['enable-linger', user]);
    } else {
      /** Silent skip is a footgun — user won't know their service won't survive logout. */
      L.warn('loginctl enable-linger skipped — $USER is unset or contains characters outside [a-zA-Z0-9_.-]. Service will stop on logout. Run `loginctl enable-linger <user>` manually.');
    }
  } else {
    throw new Error(`Unsupported platform: ${os}. Start manually with: npm start`);
  }
}

/** Stop and remove the OS service. */
export function uninstallService(): void {
  const os = platform();
  if (os === 'darwin') {
    runMutating('launchctl', ['bootout', `gui/${uid()}/${LABEL}`], { allowFail: true });
    try { unlinkSync(plistPath()); } catch { /* already gone */ }
  } else if (os === 'linux') {
    runMutating('systemctl', ['--user', 'disable', '--now', 'gentclaw'], { allowFail: true });
    try { unlinkSync(unitPath()); } catch { /* already gone */ }
    runMutating('systemctl', ['--user', 'daemon-reload']);
  }
}

/** Check whether the service is registered and running. */
export function serviceStatus(): { registered: boolean; running: boolean } {
  const os = platform();
  if (os === 'darwin') {
    const registered = existsSync(plistPath());
    const out = runQuery('launchctl', ['print', `gui/${uid()}/${LABEL}`]);
    return { registered, running: out.length > 0 };
  } else if (os === 'linux') {
    const registered = existsSync(unitPath());
    const out = runQuery('systemctl', ['--user', 'is-active', 'gentclaw']);
    return { registered, running: out === 'active' };
  }
  return { registered: false, running: false };
}
