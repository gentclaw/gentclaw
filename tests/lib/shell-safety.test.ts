import { describe, it, expect } from 'vitest';
import { validateShellCmd, SAFE_CMDS } from '../../src/lib/builtins/shell-safety.js';

describe('validateShellCmd', () => {
  it('allows safe commands', () => {
    expect(validateShellCmd('git status')).toEqual({ safe: true });
    expect(validateShellCmd('ls -la')).toEqual({ safe: true });
    expect(validateShellCmd('cat /etc/hostname')).toEqual({ safe: true });
    expect(validateShellCmd('npm test')).toEqual({ safe: true });
  });

  it('rejects empty commands', () => {
    expect(validateShellCmd('')).toEqual({ safe: false, reason: 'empty command' });
    expect(validateShellCmd('   ')).toEqual({ safe: false, reason: 'empty command' });
  });

  it('rejects commands not in allowlist', () => {
    const result = validateShellCmd('rm -rf /');
    expect(result.safe).toBe(false);
    expect(result).toHaveProperty('reason');
    if (!result.safe) expect(result.reason).toContain('not in allowlist');
  });

  it('blocks pipe operators', () => {
    const result = validateShellCmd('cat file | grep foo');
    expect(result.safe).toBe(false);
  });

  it('blocks redirect operators', () => {
    expect(validateShellCmd('echo hi > /tmp/x').safe).toBe(false);
    expect(validateShellCmd('cat < /etc/passwd').safe).toBe(false);
  });

  it('blocks command chaining', () => {
    expect(validateShellCmd('ls && rm -rf /').safe).toBe(false);
    expect(validateShellCmd('ls; rm -rf /').safe).toBe(false);
    expect(validateShellCmd('ls || rm -rf /').safe).toBe(false);
  });

  it('blocks backtick subshells', () => {
    expect(validateShellCmd('echo `whoami`').safe).toBe(false);
  });

  it('blocks $() subshells', () => {
    expect(validateShellCmd('echo $(whoami)').safe).toBe(false);
  });

  it('handles absolute paths to binaries', () => {
    expect(validateShellCmd('/usr/bin/git status')).toEqual({ safe: true });
    expect(validateShellCmd('/usr/bin/rm -rf /').safe).toBe(false);
  });

  it('uses custom allowlist when provided', () => {
    expect(validateShellCmd('curl http://example.com', ['curl'])).toEqual({ safe: true });
    expect(validateShellCmd('git status', ['curl']).safe).toBe(false);
  });

  it('blocks eval flags on interpreters', () => {
    expect(validateShellCmd('node -e "process.exit(1)"').safe).toBe(false);
    expect(validateShellCmd('python3 -c "import os"').safe).toBe(false);
    expect(validateShellCmd('ruby -e "puts 1"').safe).toBe(false);
    expect(validateShellCmd('node --eval "1+1"').safe).toBe(false);
    expect(validateShellCmd('node --print "1"').safe).toBe(false);
    expect(validateShellCmd('python3 -p "1"').safe).toBe(false);
    // attached-value form must also be blocked (no space between flag and value)
    expect(validateShellCmd('node --eval=1+1').safe).toBe(false);
    expect(validateShellCmd('python3 -c=import_os').safe).toBe(false);
    expect(validateShellCmd('node --print=1').safe).toBe(false);
    // non-eval flags still allowed
    expect(validateShellCmd('node --version')).toEqual({ safe: true });
    expect(validateShellCmd('python3 script.py')).toEqual({ safe: true });
    // non-interpreter commands unaffected
    expect(validateShellCmd('git -c user.name=x status')).toEqual({ safe: true });
  });

  it('has expected safe commands', () => {
    expect(SAFE_CMDS.has('git')).toBe(true);
    expect(SAFE_CMDS.has('ls')).toBe(true);
    expect(SAFE_CMDS.has('rm')).toBe(false);
    expect(SAFE_CMDS.has('curl')).toBe(false);
    expect(SAFE_CMDS.has('sudo')).toBe(false);
  });
});
