/**
 * Detached reload worker — spawned by /reload command.
 * Runs build, then restarts the OS service (launchd/systemd).
 * Must be detached so the parent process can die during restart.
 */
import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import { SERVICE_LABEL as LABEL, SUBPROCESS_ENV } from './constants.js';
import { SCRIPT_DIR } from './paths.js';

/** execFile (argv, no shell) — avoids shell metacharacter interpretation in privileged restart path.
 *  Mirrors service.ts hardening; never use execSync with interpolated strings here. */
function run(bin: string, args: string[]): void {
  execFileSync(bin, args, {
    cwd: SCRIPT_DIR,
    stdio: 'inherit',
    env: SUBPROCESS_ENV,
  });
}

try {
  run('npm', ['run', 'build']);

  const os = platform();
  if (os === 'darwin') {
    /** UID resolved via process.getuid() instead of `$(id -u)` shell substitution — keeps the privileged
     *  launchctl call out of any shell. process.getuid is POSIX-only; this branch is darwin-gated. */
    const uid = process.getuid?.() ?? 0;
    run('launchctl', ['kickstart', '-k', `gui/${uid}/${LABEL}`]);
  } else if (os === 'linux') {
    run('systemctl', ['--user', 'restart', 'gentclaw']);
  }
} catch (err) {
  console.error('reload failed:', err);
  process.exit(1);
}
