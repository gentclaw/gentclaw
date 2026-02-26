# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in gentclaw, please report it responsibly.

**Email**: security@gentclaw.com

**Do NOT** open a public GitHub issue for security vulnerabilities.

## What to report

- Authentication or authorization bypasses
- Secrets leaking through logs, memory files, or audit trails
- Shell injection via `/exec` or hook execution
- Slack token exposure
- Any way to escape the shell safety allowlist

## Response timeline

- **Acknowledgment**: within 48 hours
- **Assessment**: within 7 days
- **Fix**: critical issues patched within 14 days

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.3.x   | Yes       |
| < 0.3   | No        |

## Built-in protections

gentclaw includes several security mechanisms:

- **Shell safety**: allowlist-based command validation with dangerous token detection
- **Secrets scanning**: API key and password detection in messages
- **Content guard**: configurable content filtering
- **Rate limiting**: per-user rate limits to prevent abuse
- **Audit logging**: append-only JSONL trail of all commands and security events
- **Explicit env allowlist**: child processes receive only explicitly allowed environment variables
