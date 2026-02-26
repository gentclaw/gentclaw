# Contributing to gentclaw

## Setup

```bash
git clone https://github.com/gentclaw/gentclaw.git
cd gentclaw
npm install
npm run build
npm test
```

Requires Node.js ≥20.

## Development workflow

1. Create a branch from `main`
2. Make changes in `src/`
3. Run `npm test` — all tests must pass
4. Run `npm run build` — must compile cleanly
5. Open a PR against `main`

## Code standards

- **TypeScript strict mode** — no `any`, no implicit types
- **TDD** — write tests alongside code, not after
- **KISS** — minimal code to solve the problem
- **Type safety first** — discriminated unions, exhaustive checks, compiler-enforced correctness

## Architecture overview

```
Slack message → pipeline.ts
  1. preMessage hooks (rate limit, content guard)
  2. routing.ts — 4-priority: pre-routed → @mention → sticky → default
  3. run.ts — spawn CLI subprocess (claude, gemini, custom)
  4. postMessage hooks (secrets scan, audit)
  → Slack reply
```

Key patterns:
- **Providers are declarative JSON** — no functions, fully serializable
- **Sequencer** — per-key task serialization (serial per agent, parallel across agents)
- **Hooks fail open** — errors in hooks don't block messaging
- **Atomic file writes** — no partial config corruption
- **Explicit env allowlist** — child processes get only approved env vars

## Project structure

| Directory | Purpose |
|-----------|---------|
| `src/lib/` | Core logic — routing, providers, sessions, hooks |
| `src/channels/` | Channel adapters (Slack) |
| `src/lib/builtins/` | Built-in safety hooks |
| `tests/` | Unit and integration tests (vitest) |
| `examples/` | Example configurations |

## Adding a feature

1. Add types to `src/lib/types.ts`
2. Implement in `src/lib/`
3. Add tests in `tests/lib/`
4. Wire into pipeline/CLI as needed

## Adding a provider

Providers are declarative — define a `Provider` object in config or code:

```typescript
const myProvider: Provider = {
  name: 'My CLI Tool',
  command: 'my-tool',
  models: { default: 'my-model-v1' },
  defaultModel: 'default',
  baseArgs: ['--format', 'text'],
  promptFlag: '--prompt',
};
```

## Commit style

```
type: lowercase message (max 50 chars)
```

Types: `fix`, `feat`, `update`, `refactor`, `chore`, `docs`
