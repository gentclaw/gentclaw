# Roadmap

## Done

- [x] **SSRF guard on Slack file downloads** — `src/lib/url-safety.ts` blocks private/reserved/metadata URLs; applied to `downloadAttachments` so a malformed `url_private` can never leak the bot token.
- [x] **`/bash` env hardened** — `execFileSync` now uses `SUBPROCESS_ENV` (PATH/HOME/FORCE_COLOR only); `/bash env` no longer dumps `SLACK_*` / `ANTHROPIC_API_KEY` to Slack replies.
- [x] **Pipeline stop-flag DRY** — replaced ad-hoc `existsSync + try/unlinkSync/catch` with the existing atomic `clearStopFlag()` helper; race-safe and silent-failure removed.
- [x] **Custom provider config validation** — `getProvider()` validates settings-loaded providers (name/command/defaultModel/baseArgs/models) and throws a clear `ProviderError` instead of crashing deep in `buildProviderArgs`.
- [x] **Hooks subprocess type tightening** — `runSubprocess` takes `(name, command, timeoutMs, msg)` so the empty-string fallback (`hook.command ?? ''`) is gone; non-empty contract enforced at compile time.
- [x] **Slack download body cap** — `downloadAttachments` streams response bodies and aborts past `MAX_FILE_SIZE`; Slack's reported `size` (untrusted) can no longer be used to smuggle multi-GB payloads into daemon RAM via `resp.text()`.
- [x] **Process-runner output cap** — `runCommand` tracks combined stdout+stderr bytes and kills the child once `MAX_CHILD_OUTPUT_BYTES` (10 MB) is reached; a runaway CLI tool can no longer exhaust daemon RAM.
- [x] **Inbound memory-tag stripping** — `processMessage` strips `<memory>` / `<shared-memory>` tags from user input before hooks/routing; closes the prompt-injection path where attacker-supplied tags echoed by the LLM would plant arbitrary persistent memory entries.
- [x] **Per-response memory tag cap** — `extractMemoryFromResponse` honours at most `MAX_MEMORY_TAGS_PER_RESPONSE` (5) tags of each kind, preventing a single chatty reply from flooding agent/shared memory.
- [x] **Slack reply error propagation** — `reply()` rethrows on `chat.postMessage` failure so the reaction lifecycle marks ❌ instead of ✅ when delivery fails; outer error path wraps the fallback reply in try/catch.

## Planned (see `llm/plan/`)

- [ ] Tool system (`exec`, `web_fetch`) — `top-2-features.md`
- [ ] HTTP API providers — `top-2-features.md`
- [ ] Draft streaming responses — `adopt-claw-features.md`
- [ ] File-based durable queue + DLQ — `adopt-claw-features.md`
- [ ] Provider failover with circuit breaker — `provider-failover.md`
- [ ] Webhook channel — `add-webhook-channel.md`
