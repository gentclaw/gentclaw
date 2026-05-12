# Roadmap

## Done

- [x] **SSRF guard on Slack file downloads** — `src/lib/url-safety.ts` blocks private/reserved/metadata URLs; applied to `downloadAttachments` so a malformed `url_private` can never leak the bot token.
- [x] **`/bash` env hardened** — `execFileSync` now uses `SUBPROCESS_ENV` (PATH/HOME/FORCE_COLOR only); `/bash env` no longer dumps `SLACK_*` / `ANTHROPIC_API_KEY` to Slack replies.
- [x] **Pipeline stop-flag DRY** — replaced ad-hoc `existsSync + try/unlinkSync/catch` with the existing atomic `clearStopFlag()` helper; race-safe and silent-failure removed.
- [x] **Custom provider config validation** — `getProvider()` validates settings-loaded providers (name/command/defaultModel/baseArgs/models) and throws a clear `ProviderError` instead of crashing deep in `buildProviderArgs`.
- [x] **Hooks subprocess type tightening** — `runSubprocess` takes `(name, command, timeoutMs, msg)` so the empty-string fallback (`hook.command ?? ''`) is gone; non-empty contract enforced at compile time.

## Planned (see `llm/plan/`)

- [ ] Tool system (`exec`, `web_fetch`) — `top-2-features.md`
- [ ] HTTP API providers — `top-2-features.md`
- [ ] Draft streaming responses — `adopt-claw-features.md`
- [ ] File-based durable queue + DLQ — `adopt-claw-features.md`
- [ ] Provider failover with circuit breaker — `provider-failover.md`
- [ ] Webhook channel — `add-webhook-channel.md`
