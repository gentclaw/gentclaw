# gentclaw

Always-on AI agent daemon you talk to through Slack.

## Features

- Multi-agent support with configurable providers and models
- Slack integration via [Bolt](https://slack.dev/bolt-js)
- Heartbeat scheduler for periodic agent prompts
- Command routing and custom commands
- Session management with conversation context
- OS service install (launchd / systemd)

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/gentclaw/gentclaw/main/install.sh | bash
```

Clones to `~/.local/share/gentclaw`, builds, adds `gentclaw` to `~/.local/bin`, runs setup.

Override paths: `GENTCLAW_INSTALL`, `GENTCLAW_BIN`.

### Manual

```bash
git clone https://github.com/gentclaw/gentclaw.git && cd gentclaw
npm install && npm run build
node dist/cli.js setup
node dist/cli.js install
```

## Commands

```
node dist/cli.js start          Slack listener (foreground)
node dist/cli.js install        Register as OS service
node dist/cli.js uninstall      Remove OS service
node dist/cli.js config         Show configuration
node dist/cli.js agents         List agents
node dist/cli.js status         Summary
node dist/cli.js heartbeat      Trigger heartbeat
node dist/cli.js setup          Setup wizard
```

## Development

```bash
npm run build       # src/ → dist/
npm test            # vitest
npm run reload      # build + restart daemon
```

## License

[MIT](LICENSE) — [Alex Markovic](https://gentclaw.com)
