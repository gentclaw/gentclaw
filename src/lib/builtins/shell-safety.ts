/** Shell command safety — allowlist + dangerous token detection */

export const SAFE_CMDS = new Set([
  // Data processing
  'jq', 'grep', 'cut', 'sort', 'awk', 'sed', 'tr', 'uniq', 'wc', 'xargs',
  // File inspection
  'cat', 'head', 'tail', 'ls', 'find', 'stat', 'file', 'diff', 'tree',
  // System info
  'uname', 'whoami', 'pwd', 'date', 'df', 'du', 'uptime', 'env', 'printenv',
  // Dev tools
  'git', 'npm', 'npx', 'node', 'python', 'python3', 'ruby', 'go', 'cargo', 'make',
  // Archive
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  // Other safe
  'echo', 'which', 'type', 'dirname', 'basename', 'realpath', 'readlink',
]);

/** Shell metacharacters that enable chaining, piping, or redirection */
const DANGEROUS_TOKENS = /[|><;`]|\$\(|&&|\|\|/;

/** Interpreters that can execute arbitrary code via flags like -e/-c */
const INTERPRETERS = new Set(['node', 'python', 'python3', 'ruby', 'perl']);

/** Flags that trigger inline code execution on interpreters */
const EVAL_FLAGS = new Set(['-e', '-c', '--eval', '--print', '-p']);

type ShellSafetyResult =
  | { safe: true }
  | { safe: false; reason: string };

/** Validate a shell command against allowlist and dangerous syntax */
export function validateShellCmd(cmd: string, allowlist?: string[]): ShellSafetyResult {
  const trimmed = cmd.trim();
  if (!trimmed) return { safe: false, reason: 'empty command' };

  if (DANGEROUS_TOKENS.test(trimmed)) {
    return { safe: false, reason: 'unsafe shell syntax (pipes, redirects, or chaining not allowed)' };
  }

  const binary = extractBinary(trimmed);
  if (!binary) return { safe: false, reason: 'could not parse command' };

  const allowed = allowlist ? new Set(allowlist) : SAFE_CMDS;
  if (!allowed.has(binary)) {
    return { safe: false, reason: `command "${binary}" not in allowlist` };
  }

  if (INTERPRETERS.has(binary)) {
    const args = trimmed.split(/\s+/).slice(1);
    if (args.some(a => EVAL_FLAGS.has(a))) {
      return { safe: false, reason: `eval flag not allowed for ${binary}` };
    }
  }

  return { safe: true };
}

/** Extract binary name, handling paths like /usr/bin/git → git */
function extractBinary(cmd: string): string | null {
  const match = cmd.match(/^(\S+)/);
  if (!match?.[1]) return null;
  const token = match[1];
  const base = token.includes('/') ? (token.split('/').pop() ?? token) : token;
  return base.toLowerCase();
}
