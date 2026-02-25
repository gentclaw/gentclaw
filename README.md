<p align="center">
  <strong>gentclaw</strong><br>
  Always-on AI agent daemon — talk to Claude, Gemini, or any CLI model through Slack.
</p>

<p align="center">
  <a href="https://github.com/gentclaw/gentclaw/actions/workflows/ci.yml"><img src="https://github.com/gentclaw/gentclaw/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://www.npmjs.com/package/gentclaw"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node ≥20"></a>
</p>

---

gentclaw runs as a macOS/Linux daemon and gives your team AI agents they can message in Slack — like having a developer on call 24/7. Point it at Claude Code, Gemini CLI, or any CLI tool that takes a prompt and returns text.

```
┌─────────┐     ┌──────────────────────────────────────┐     ┌─────────────┐
│  Slack   │────▶│            gentclaw daemon            │────▶│ Claude Code │
│  message │     │                                      │     ├─────────────┤
│          │◀────│  routing · sessions · hooks · memory │◀────│ Gemini CLI  │
└─────────┘     └──────────────────────────────────────┘     ├─────────────┤
                                                             │ Any CLI     │
                                                             └─────────────┘
```

## Why gentclaw?

- **Always on** — runs as a system service (launchd/systemd), survives reboots
- **Multi-agent** — run different models for different tasks, route with `@mentions`
- **Team-aware** — agent teams with leaders, shared memory, sticky sessions
- **Safe by default** — rate limiting, content filtering, secrets scanning, shell allowlists
- **Zero lock-in** — agents are CLI commands; swap providers without code changes
- **Hackable** — hooks, custom commands, audit logs — extend everything

## Features

| Feature | Description |
|---------|-------------|
| **Multi-agent routing** | `@claude review this` / `@gemini summarize` — 4-priority routing (pre-routed → @mention → sticky → default) |
| **Agent teams** | Named groups with leaders; `@backend-team` routes to team leader |
| **Session memory** | Persistent conversations with 7-day TTL, per-agent markdown memory files |
| **Heartbeat scheduler** | Periodic autonomous prompts — agents check in on their own |
| **Custom commands** | Define `/shortcuts` that route prompts to specific agents |
| **Safety hooks** | Built-in rate limiter, content guard, secrets scanner — plus custom subprocess hooks |
| **Shell safety** | Allowlist-based command validation with dangerous token detection |
| **Audit trail** | Append-only JSONL logging of all commands and security events |
| **OS service** | One-command install as launchd (macOS) or systemd (Linux) service |
| **Tmux support** | Watch agent output live via `tmux attach -t gentclaw` |

## Quick start

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/gentclaw/gentclaw/main/install.sh | bash

# Or manually
git clone https://github.com/gentclaw/gentclaw.git && cd gentclaw
npm install && npm run build

# Setup — interactive wizard configures Slack + first agent
gentclaw setup

# Start
gentclaw start

# Install as OS service (auto-starts on boot)
gentclaw install
```

The setup wizard walks you through creating a Slack app (with a copy-paste manifest) and configuring your first agent.

## Configuration

gentclaw stores config in `~/.config/gentclaw/settings.json`. See [`examples/config.example.json`](examples/config.example.json) for a full annotated example.

```jsonc
{
  "agents": {
    "assistant": {
      "name": "Assistant",
      "provider": "claude",      // built-in: claude, gemini — or define custom
      "model": "sonnet",         // provider model aliases
      "cwd": "~/gentclaw-workspace/assistant"
    }
  },
  "defaultAgent": "assistant"
}
```

### Built-in providers

| Provider | Command | Models | Output |
|----------|---------|--------|--------|
| `claude` | `claude` (Claude Code CLI) | haiku, sonnet, opus | JSONL streaming |
| `gemini` | `gemini` (Gemini CLI) | flash, pro | JSON |

Add any CLI tool as a custom provider — if it takes a prompt and returns text, it works.

## Commands

```
gentclaw start          Start Slack listener (foreground)
gentclaw install        Register as OS service
gentclaw uninstall      Remove OS service
gentclaw config         Show configuration
gentclaw agents         List agents
gentclaw status         Runtime summary
gentclaw heartbeat      Trigger heartbeat
gentclaw setup          Interactive setup wizard
gentclaw setup slack    Reconfigure Slack tokens
```

## Slack commands

Once running, message gentclaw in Slack:

```
@assistant help me debug this     Route to specific agent
/agent list                       List available agents
/agent switch <name>              Switch session agent
/memory show                      View agent memory
/exec <command>                   Run safe shell commands
/team list                        List agent teams
```

## Architecture

```
src/
├── cli.ts              CLI entry point
├── setup.ts            Interactive setup wizard
├── channels/
│   └── slack.ts        Slack event handler + message routing
└── lib/
    ├── pipeline.ts     preHooks → route → invoke → postHooks
    ├── routing.ts      4-priority message routing
    ├── run.ts          Agent subprocess execution
    ├── providers.ts    Declarative CLI provider registry
    ├── sessions.ts     Persistent session + sticky routing
    ├── memory.ts       Per-agent markdown memory
    ├── hooks.ts        Built-in + custom hook runner
    ├── commands.ts     Slash command dispatcher
    ├── sequencer.ts    Per-key task serialization
    ├── service.ts      launchd/systemd service management
    └── builtins/       Rate limit, content guard, secrets scan, shell safety
```

## Development

```bash
npm run build       # src/ → dist/ via tsc
npm test            # vitest (22 test files)
npm run reload      # build + restart daemon
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, architecture overview, and PR guidelines.

## License

[MIT](LICENSE) — [Alex Markovic](https://gentclaw.com)
