/**
 * Detached reload worker — spawned by /reload command.
 * Runs build, then restarts the OS service (launchd/systemd).
 * Must be detached so the parent process can die during restart.
 */
import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import { SERVICE_LABEL as LABEL, SUBPROCESS_ENV } from './constants.js';
import { SCRIPT_DIR } from './paths.js';

function exec(cmd: string): void {
  execSync(cmd, {
    cwd: SCRIPT_DIR,
    stdio: 'inherit',
    env: SUBPROCESS_ENV,
  });
}

try {
  exec('npm run build');

  const os = platform();
  if (os === 'darwin') {
    exec(`launchctl kickstart -k gui/$(id -u)/${LABEL}`);
  } else if (os === 'linux') {
    exec('systemctl --user restart gentclaw');
  }
} catch (err) {
  console.error('reload failed:', err);
  process.exit(1);
}
